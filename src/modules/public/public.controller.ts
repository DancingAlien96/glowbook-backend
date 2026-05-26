import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../../lib/asyncHandler.js";
import { validate } from "../../middleware/validate.js";
import { prisma } from "../../lib/prisma.js";
import { NotFound } from "../../lib/errors.js";
import * as appointments from "../appointments/appointments.service.js";

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
        description: true,
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
      select: { id: true, businessHours: true },
    });
    if (!salon) throw NotFound("Salon not found");

    const q = req.query as unknown as { from: Date; to: Date; stylistId?: string };
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
      businessHours: salon.businessHours,
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
      select: { id: true, depositMode: true, depositPercent: true, bankDetails: true },
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
