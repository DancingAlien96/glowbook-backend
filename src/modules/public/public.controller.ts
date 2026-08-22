import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../../lib/asyncHandler.js";
import { validate } from "../../middleware/validate.js";
import { prisma } from "../../lib/prisma.js";
import { NotFound, PaymentRequired } from "../../lib/errors.js";
import { refreshSubscriptionStatus } from "../../lib/billing.js";
import * as appointments from "../appointments/appointments.service.js";
import { serviceNames } from "../appointments/appointments.service.js";
import { sendEmail } from "../../lib/email.js";
import { bookingReceivedTemplate } from "../../lib/emails/bookingReceived.js";
import { bookingNotifyOwnerTemplate } from "../../lib/emails/bookingNotifyOwner.js";
import { sendPushToSalonOwners, sendPushToStylist } from "../../lib/webPush.js";

export const publicRoutes = Router();

// Public salon page — services + stylists + working hours + bank details
publicRoutes.get(
  "/salons/:slug",
  asyncHandler(async (req, res) => {
    const salon = await prisma.salon.findUnique({
      where: { slug: req.params.slug! },
      select: {
        id: true,
        name: true,
        slug: true,
        tagline: true,
        description: true,
        coverImageUrl: true,
        brandColor: true,
        timezone: true,
        currency: true,
        depositMode: true,
        depositPercent: true,
        bankDetails: true,
        aboutText: true,
        instagramUrl: true,
        facebookUrl: true,
        whatsappContact: true,
        address: true,
        latitude: true,
        longitude: true,
        contactEmail: true,
        contactPhone: true,
        photos: {
          orderBy: { createdAt: "asc" },
          select: { id: true, url: true, caption: true },
        },
        testimonials: {
          orderBy: { createdAt: "asc" },
          select: { id: true, clientName: true, text: true, rating: true, serviceName: true },
        },
        services: {
          where: { active: true },
          orderBy: { name: "asc" },
          select: {
            id: true,
            name: true,
            description: true,
            durationMin: true,
            priceCents: true,
            category: true,
            imageUrl: true,
          },
        },
        stylists: {
          where: { active: true },
          orderBy: { name: "asc" },
          select: { id: true, name: true, role: true, photoUrl: true },
        },
        businessHours: { orderBy: { dayOfWeek: "asc" } },
      },
    });
    if (!salon) throw NotFound("Salon not found");
    res.json({ salon });
  })
);

// Availability: returns busy intervals + business hours so the frontend can compute slots.
publicRoutes.get(
  "/salons/:slug/availability",
  validate(
    z.object({
      from: z.coerce.date(),
      to: z.coerce.date(),
      stylistId: z.string().cuid().optional(),
    }),
    "query"
  ),
  asyncHandler(async (req, res) => {
    const salon = await prisma.salon.findUnique({
      where: { slug: req.params.slug! },
      select: { id: true, businessHours: { orderBy: { dayOfWeek: "asc" } } },
    });
    if (!salon) throw NotFound("Salon not found");

    const q = req.query as unknown as { from: Date; to: Date; stylistId?: string };

    // If a specific stylist is requested and she has her own weekly schedule,
    // use it; otherwise fall back to the salon hours.
    let businessHours = salon.businessHours as { dayOfWeek: number; openMin: number; closeMin: number }[];
    if (q.stylistId) {
      const stylistHours = await prisma.stylistHour.findMany({
        where: { stylistId: q.stylistId },
        orderBy: { dayOfWeek: "asc" },
        select: { dayOfWeek: true, openMin: true, closeMin: true },
      });
      if (stylistHours.length > 0) businessHours = stylistHours;
    }

    const where = {
      salonId: salon.id,
      ...(q.stylistId ? { stylistId: q.stylistId } : {}),
      status: { in: ["PENDING", "CONFIRMED"] as Array<"PENDING" | "CONFIRMED"> },
      startAt: { lt: q.to },
      endAt: { gt: q.from },
    };

    const [busy, blocked] = await Promise.all([
      prisma.appointment.findMany({
        where,
        select: { startAt: true, endAt: true, stylistId: true },
      }),
      prisma.blockedSlot.findMany({
        where: {
          salonId: salon.id,
          ...(q.stylistId
            ? { OR: [{ stylistId: q.stylistId }, { stylistId: null }] }
            : {}),
          startAt: { lt: q.to },
          endAt: { gt: q.from },
        },
        select: { startAt: true, endAt: true, stylistId: true },
      }),
    ]);

    res.json({
      businessHours,
      busy,
      blocked,
    });
  })
);

const createBookingSchema = z.object({
  serviceIds: z.array(z.string().cuid()).min(1, "Selecciona al menos un servicio"),
  stylistId: z.string().cuid().optional().nullable(),
  startAt: z.coerce.date(),
  notes: z.string().max(1000).optional().nullable(),
  // Public flow: name + phone required, email optional. Phone is the one
  // identifier we can always count on (WhatsApp reminder + client dedup in
  // appointments.service.ts already falls back to phone when there's no
  // email) — email just adds a confirmation copy when she chooses to share it.
  client: z.object({
    name: z.string().min(2).max(120),
    email: z.union([z.string().trim().email(), z.literal("")]).optional().nullable()
      .transform((v) => (v ? v : undefined)),
    phone: z.string().min(5).max(40),
  }),
});

publicRoutes.post(
  "/salons/:slug/bookings",
  validate(createBookingSchema),
  asyncHandler(async (req, res) => {
    const salon = await prisma.salon.findUnique({
      where: { slug: req.params.slug! },
      select: {
        id: true, name: true, slug: true, currency: true,
        depositMode: true, depositPercent: true, bankDetails: true,
      },
    });
    if (!salon) throw NotFound("Salon not found");

    // Same hard write-block as the owner dashboard: a salon whose trial +
    // grace period both expired with no payment can't keep taking bookings
    // for free through the public page either.
    const sub = await prisma.subscription.findUnique({ where: { salonId: salon.id } });
    if (sub) {
      const fresh = await refreshSubscriptionStatus(sub);
      if (fresh.status === "SUSPENDED") {
        throw PaymentRequired("Este salón no está aceptando reservas en este momento.");
      }
    }

    const data = req.body as z.infer<typeof createBookingSchema>;
    const appointment = await appointments.createAppointment({
      salonId: salon.id,
      serviceIds: data.serviceIds,
      stylistId: data.stylistId ?? null,
      startAt: data.startAt,
      notes: data.notes ?? null,
      client: data.client,
    });

    // Fire-and-forget email to the client confirming we received her booking.
    if (data.client.email) {
      const tpl = bookingReceivedTemplate({
        clientName: data.client.name,
        salonName: salon.name,
        salonSlug: salon.slug,
        serviceName: serviceNames(appointment),
        stylistName: appointment.stylist?.name ?? null,
        startAt: appointment.startAt,
        durationMin: appointment.durationMin,
        depositCents: appointment.depositCents,
        currency: salon.currency,
        requiresReceipt: salon.depositMode !== "NONE",
      });
      sendEmail({ to: data.client.email, subject: tpl.subject, html: tpl.html, text: tpl.text });
    }

    // Email to the salon owner(s) with booking details
    const owners = await prisma.user.findMany({
      where: { salonId: salon.id, role: "OWNER" },
      select: { name: true, email: true },
    });
    if (owners.length > 0) {
      const ownerEmails = owners.map((o) => o.email);
      const ownerName = owners[0]!.name;
      const tpl = bookingNotifyOwnerTemplate({
        ownerName,
        clientName: data.client.name,
        clientEmail: data.client.email ?? null,
        clientPhone: data.client.phone,
        salonName: salon.name,
        serviceName: serviceNames(appointment),
        stylistName: appointment.stylist?.name ?? null,
        startAt: appointment.startAt,
        durationMin: appointment.durationMin,
        depositCents: appointment.depositCents,
        currency: salon.currency,
        requiresReceipt: salon.depositMode !== "NONE",
      });
      sendEmail({ to: ownerEmails, subject: tpl.subject, html: tpl.html, text: tpl.text });
    }

    // Push to the salon's owner(s) — and to the chosen stylist if any.
    const when = new Date(appointment.startAt).toLocaleString("es-EC", {
      day: "numeric", month: "short", hour: "2-digit", minute: "2-digit",
    });
    void sendPushToSalonOwners(salon.id, {
      title: "Nueva reserva ✨",
      body: `${appointment.client.name} · ${serviceNames(appointment)} · ${when}`,
      url: "/dashboard/appointments",
      tag: `booking-${appointment.id}`,
    });
    if (appointment.stylist?.id) {
      void sendPushToStylist(appointment.stylist.id, {
        title: "Nueva cita asignada",
        body: `${appointment.client.name} · ${serviceNames(appointment)} · ${when}`,
        url: "/me/appointments",
        tag: `booking-${appointment.id}`,
      });
    }

    res.status(201).json({
      appointment: {
        id: appointment.id,
        startAt: appointment.startAt,
        endAt: appointment.endAt,
        durationMin: appointment.durationMin,
        priceCents: appointment.priceCents,
        depositCents: appointment.depositCents,
        status: appointment.status,
        services: appointment.services.map((s) => s.service),
        stylist: appointment.stylist,
        client: { id: appointment.client.id, name: appointment.client.name },
      },
      payInstructions: {
        mode: salon.depositMode,
        percent: salon.depositPercent,
        bankDetails: salon.bankDetails,
        uploadUrl: `/api/public/payments/${appointment.id}/receipt`,
      },
    });
  })
);
