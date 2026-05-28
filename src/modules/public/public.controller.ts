import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../../lib/asyncHandler.js";
import { validate } from "../../middleware/validate.js";
import { prisma } from "../../lib/prisma.js";
import { NotFound } from "../../lib/errors.js";
import * as appointments from "../appointments/appointments.service.js";
import { sendEmail } from "../../lib/email.js";
import { bookingReceivedTemplate } from "../../lib/emails/bookingReceived.js";
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
          },
        },
        stylists: {
          where: { active: true },
          orderBy: { name: "asc" },
          select: { id: true, name: true, role: true },
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
  serviceId: z.string().cuid(),
  stylistId: z.string().cuid().optional().nullable(),
  startAt: z.coerce.date(),
  notes: z.string().max(1000).optional().nullable(),
  client: z.object({
    name: z.string().min(2).max(120),
    email: z.string().email(),
    phone: z.string().min(5).max(40).optional().nullable(),
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

    const data = req.body as z.infer<typeof createBookingSchema>;
    const appointment = await appointments.createAppointment({
      salonId: salon.id,
      serviceId: data.serviceId,
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
        serviceName: appointment.service.name,
        stylistName: appointment.stylist?.name ?? null,
        startAt: appointment.startAt,
        durationMin: appointment.durationMin,
        depositCents: appointment.depositCents,
        currency: salon.currency,
        requiresReceipt: salon.depositMode !== "NONE",
      });
      sendEmail({ to: data.client.email, subject: tpl.subject, html: tpl.html, text: tpl.text });
    }

    // Push to the salon's owner(s) — and to the chosen stylist if any.
    const when = new Date(appointment.startAt).toLocaleString("es-EC", {
      day: "numeric", month: "short", hour: "2-digit", minute: "2-digit",
    });
    void sendPushToSalonOwners(salon.id, {
      title: "Nueva reserva ✨",
      body: `${appointment.client.name} · ${appointment.service.name} · ${when}`,
      url: "/dashboard/appointments",
      tag: `booking-${appointment.id}`,
    });
    if (appointment.stylist?.id) {
      void sendPushToStylist(appointment.stylist.id, {
        title: "Nueva cita asignada",
        body: `${appointment.client.name} · ${appointment.service.name} · ${when}`,
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
        service: appointment.service,
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
