import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../../lib/asyncHandler.js";
import { validate } from "../../middleware/validate.js";
import { requireAuth, requireRole, requireSalon } from "../../middleware/auth.js";
import { prisma } from "../../lib/prisma.js";

export const salonRoutes = Router();
salonRoutes.use(requireAuth, requireRole("OWNER"), requireSalon);

const HEX_COLOR = /^#([0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;

const updateSchema = z.object({
  name: z.string().min(2).max(120).optional(),
  tagline: z.string().max(160).optional().nullable(),
  description: z.string().max(2000).optional().nullable(),
  coverImageUrl: z.string().url().max(500).optional().nullable(),
  brandColor: z.string().regex(HEX_COLOR, "Use a hex color like #D89888").optional(),
  timezone: z.string().min(3).max(64).optional(),
  currency: z.string().min(3).max(8).optional(),
  depositMode: z.enum(["NONE", "PERCENTAGE", "FULL"]).optional(),
  depositPercent: z.coerce.number().int().min(0).max(100).optional(),
  approvalMode: z.enum(["MANUAL", "AUTOMATIC"]).optional(),
  bankDetails: z.string().max(2000).optional().nullable(),
});

salonRoutes.get(
  "/me",
  asyncHandler(async (req, res) => {
    const salon = await prisma.salon.findUnique({
      where: { id: req.salonId! },
      include: { businessHours: { orderBy: { dayOfWeek: "asc" } } },
    });
    res.json({ salon });
  })
);

salonRoutes.patch(
  "/me",
  validate(updateSchema),
  asyncHandler(async (req, res) => {
    const salon = await prisma.salon.update({
      where: { id: req.salonId! },
      data: req.body as z.infer<typeof updateSchema>,
    });
    res.json({ salon });
  })
);

const hoursSchema = z.object({
  hours: z
    .array(
      z.object({
        dayOfWeek: z.number().int().min(0).max(6),
        openMin: z.number().int().min(0).max(1440),
        closeMin: z.number().int().min(0).max(1440),
      })
    )
    .max(7),
});

salonRoutes.put(
  "/me/hours",
  validate(hoursSchema),
  asyncHandler(async (req, res) => {
    const { hours } = req.body as z.infer<typeof hoursSchema>;
    await prisma.$transaction(async (tx) => {
      await tx.businessHour.deleteMany({ where: { salonId: req.salonId! } });
      if (hours.length) {
        await tx.businessHour.createMany({
          data: hours.map((h) => ({ ...h, salonId: req.salonId! })),
        });
      }
    });
    const businessHours = await prisma.businessHour.findMany({
      where: { salonId: req.salonId! },
      orderBy: { dayOfWeek: "asc" },
    });
    res.json({ businessHours });
  })
);

// Metrics for dashboard overview
salonRoutes.get(
  "/me/metrics",
  asyncHandler(async (req, res) => {
    const salonId = req.salonId!;
    const now = new Date();
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const endOfDay = new Date(startOfDay.getTime() + 86_400_000);
    const startOfWeek = new Date(startOfDay.getTime() - 6 * 86_400_000);

    const [todayCount, weekRevenueAgg, weekPayments, pendingPayments, newClients] = await Promise.all([
      prisma.appointment.count({
        where: { salonId, startAt: { gte: startOfDay, lt: endOfDay } },
      }),
      prisma.payment.aggregate({
        _sum: { amountCents: true },
        where: { salonId, status: "APPROVED", createdAt: { gte: startOfWeek } },
      }),
      prisma.payment.findMany({
        where: { salonId, status: "APPROVED", createdAt: { gte: startOfWeek } },
        select: { amountCents: true, createdAt: true },
      }),
      prisma.payment.count({ where: { salonId, status: "PENDING_REVIEW" } }),
      prisma.client.count({ where: { salonId, createdAt: { gte: startOfWeek } } }),
    ]);

    // Bucket revenue per day for last 7 days
    const buckets = new Array(7).fill(0);
    for (const p of weekPayments) {
      const day = Math.floor(
        (p.createdAt.getTime() - startOfWeek.getTime()) / 86_400_000
      );
      if (day >= 0 && day < 7) buckets[day] += p.amountCents;
    }

    res.json({
      metrics: {
        todayAppointments: todayCount,
        weekRevenueCents: weekRevenueAgg._sum.amountCents ?? 0,
        weekRevenueBuckets: buckets,
        pendingPayments,
        newClientsThisWeek: newClients,
      },
    });
  })
);
