import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../../lib/asyncHandler.js";
import { validate } from "../../middleware/validate.js";
import { requireAuth, requireStylistUser } from "../../middleware/auth.js";
import { prisma } from "../../lib/prisma.js";
import { NotFound, Unauthorized } from "../../lib/errors.js";

export const meRoutes = Router();

// Stylist portal — all routes assume the logged-in user is a STYLIST.
meRoutes.use(requireAuth, requireStylistUser);

// Stylist's own profile + linked Stylist record.
meRoutes.get(
  "/profile",
  asyncHandler(async (req, res) => {
    const stylist = await prisma.stylist.findUnique({
      where: { id: req.stylistId! },
      select: {
        id: true,
        name: true,
        role: true,
        active: true,
        services: {
          select: {
            service: { select: { id: true, name: true, durationMin: true } },
          },
        },
        salon: { select: { id: true, name: true, slug: true, currency: true, timezone: true } },
      },
    });
    if (!stylist) throw NotFound("Stylist not found");
    res.json({ stylist });
  })
);

// Password changes go through POST /auth/change-password (verifies the current
// password and revokes other sessions). This route only updates display fields.
const updateProfileSchema = z.object({
  name: z.string().min(2).max(120).optional(),
});

meRoutes.patch(
  "/profile",
  validate(updateProfileSchema),
  asyncHandler(async (req, res) => {
    const input = req.body as z.infer<typeof updateProfileSchema>;

    await prisma.$transaction(async (tx) => {
      if (input.name) {
        await tx.user.update({ where: { id: req.auth!.sub }, data: { name: input.name } });
        await tx.stylist.update({ where: { id: req.stylistId! }, data: { name: input.name } });
      }
    });

    res.json({ ok: true });
  })
);

// Stylist's appointments. Only her own.
meRoutes.get(
  "/appointments",
  validate(
    z.object({
      from: z.coerce.date().optional(),
      to: z.coerce.date().optional(),
      status: z.enum(["PENDING", "CONFIRMED", "COMPLETED", "CANCELLED", "NO_SHOW"]).optional(),
    }),
    "query"
  ),
  asyncHandler(async (req, res) => {
    const q = req.query as unknown as { from?: Date; to?: Date; status?: string };
    const appointments = await prisma.appointment.findMany({
      where: {
        salonId: req.salonId!,
        stylistId: req.stylistId!,
        ...(q.status ? { status: q.status as never } : {}),
        ...(q.from || q.to
          ? { startAt: { ...(q.from ? { gte: q.from } : {}), ...(q.to ? { lt: q.to } : {}) } }
          : {}),
      },
      orderBy: { startAt: "asc" },
      // No price / deposit info — stylist doesn't need to see money.
      select: {
        id: true,
        startAt: true,
        endAt: true,
        durationMin: true,
        status: true,
        notes: true,
        service: { select: { id: true, name: true, durationMin: true, category: true } },
        client: { select: { id: true, name: true, phone: true } },
      },
    });
    res.json({ appointments });
  })
);

const statusSchema = z.object({
  status: z.enum(["CONFIRMED", "COMPLETED", "CANCELLED", "NO_SHOW"]),
});

// Stylist can update the status of HER OWN appointments only.
meRoutes.patch(
  "/appointments/:id/status",
  validate(statusSchema),
  asyncHandler(async (req, res) => {
    if (!req.stylistId) throw Unauthorized();
    const id = req.params.id!;
    const existing = await prisma.appointment.findFirst({
      where: { id, salonId: req.salonId!, stylistId: req.stylistId },
      select: { id: true },
    });
    if (!existing) throw NotFound("Appointment not found");

    const updated = await prisma.appointment.update({
      where: { id },
      data: { status: (req.body as z.infer<typeof statusSchema>).status },
      select: {
        id: true,
        startAt: true,
        endAt: true,
        status: true,
        service: { select: { name: true } },
        client: { select: { name: true } },
      },
    });
    res.json({ appointment: updated });
  })
);

// Quick stats for the portal dashboard (counts only — no revenue).
meRoutes.get(
  "/stats",
  asyncHandler(async (req, res) => {
    const now = new Date();
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const endOfDay = new Date(startOfDay.getTime() + 86_400_000);
    const startOfWeek = new Date(startOfDay.getTime() - 6 * 86_400_000);

    const [today, weekConfirmed, weekCompleted] = await Promise.all([
      prisma.appointment.count({
        where: {
          salonId: req.salonId!,
          stylistId: req.stylistId!,
          startAt: { gte: startOfDay, lt: endOfDay },
          status: { in: ["PENDING", "CONFIRMED"] },
        },
      }),
      prisma.appointment.count({
        where: {
          salonId: req.salonId!,
          stylistId: req.stylistId!,
          startAt: { gte: startOfWeek, lt: endOfDay },
          status: "CONFIRMED",
        },
      }),
      prisma.appointment.count({
        where: {
          salonId: req.salonId!,
          stylistId: req.stylistId!,
          startAt: { gte: startOfWeek, lt: endOfDay },
          status: "COMPLETED",
        },
      }),
    ]);

    res.json({
      stats: { todayAppointments: today, weekConfirmed, weekCompleted },
    });
  })
);
