import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../../lib/asyncHandler.js";
import { validate } from "../../middleware/validate.js";
import { requireAuth, requireRole, requireSalon } from "../../middleware/auth.js";
import { blockWritesIfSuspended } from "../../middleware/subscription.js";
import { prisma } from "../../lib/prisma.js";
import { hoursArraySchema } from "../../lib/hoursValidation.js";
import { NotFound } from "../../lib/errors.js";

// Cap the gallery generously (enough for a real portfolio) without letting
// it grow unbounded on the public page.
const MAX_SALON_PHOTOS = 24;

export const salonRoutes = Router();
salonRoutes.use(requireAuth, requireRole("OWNER"), requireSalon);
salonRoutes.use(blockWritesIfSuspended);

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
  aboutText: z.string().max(4000).optional().nullable(),
  instagramUrl: z.string().url().max(300).optional().nullable(),
  facebookUrl: z.string().url().max(300).optional().nullable(),
  whatsappContact: z.string().min(5).max(40).optional().nullable(),
});

salonRoutes.get(
  "/me",
  asyncHandler(async (req, res) => {
    const salon = await prisma.salon.findUnique({
      where: { id: req.salonId! },
      include: {
        businessHours: { orderBy: { dayOfWeek: "asc" } },
        photos: { orderBy: { createdAt: "asc" } },
      },
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

const hoursSchema = z.object({ hours: hoursArraySchema });

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

// Portfolio gallery shown on the public booking page. The frontend uploads
// the file to UploadThing directly, then calls this with the resulting URL
// — same pattern as coverImageUrl and payment receipts.
const addPhotoSchema = z.object({
  url: z.string().url().max(500),
  caption: z.string().max(160).optional().nullable(),
});

salonRoutes.post(
  "/me/photos",
  validate(addPhotoSchema),
  asyncHandler(async (req, res) => {
    const salonId = req.salonId!;
    const count = await prisma.salonPhoto.count({ where: { salonId } });
    if (count >= MAX_SALON_PHOTOS) {
      res.status(422).json({
        error: { code: "TOO_MANY_PHOTOS", message: `Máximo ${MAX_SALON_PHOTOS} fotos en la galería.` },
      });
      return;
    }
    const { url, caption } = req.body as z.infer<typeof addPhotoSchema>;
    const photo = await prisma.salonPhoto.create({
      data: { salonId, url, caption: caption ?? null },
    });
    res.status(201).json({ photo });
  })
);

salonRoutes.delete(
  "/me/photos/:id",
  asyncHandler(async (req, res) => {
    const existing = await prisma.salonPhoto.findFirst({
      where: { id: req.params.id!, salonId: req.salonId! },
    });
    if (!existing) throw NotFound("Photo not found");
    await prisma.salonPhoto.delete({ where: { id: existing.id } });
    res.status(204).end();
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

// Dashboard analytics — six chart datasets in a single round-trip:
// 1. revenueByMonth: sum of APPROVED payments per month, last 6 months
// 2. revenueByStylist: sum of COMPLETED appointment priceCents per stylist,
//    current month (drives the "who's generating most" bar chart)
// 3. topServices: top 5 services by COMPLETED count, current month
// 4. statusDistribution: appointment counts by status, last 30 days
// 5. weekdayOccupancy: appointment counts by weekday (Mon-Sun), last 30 days
// 6. clientMix: new vs returning clients for the current month
salonRoutes.get(
  "/me/analytics",
  asyncHandler(async (req, res) => {
    const salonId = req.salonId!;
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const startOfNextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    const sixMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 5, 1);
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 86_400_000);

    const [
      paymentsLast6,
      completedThisMonth,
      statusLast30,
      apptsLast30,
      newClientsThisMonth,
      clientsWithApptsThisMonth,
      stylists,
      services,
    ] = await Promise.all([
      prisma.payment.findMany({
        where: { salonId, status: "APPROVED", createdAt: { gte: sixMonthsAgo } },
        select: { amountCents: true, createdAt: true },
      }),
      prisma.appointment.findMany({
        where: {
          salonId,
          status: "COMPLETED",
          startAt: { gte: startOfMonth, lt: startOfNextMonth },
        },
        select: {
          stylistId: true,
          priceCents: true,
          clientId: true,
          services: { select: { serviceId: true, priceCents: true } },
        },
      }),
      prisma.appointment.groupBy({
        by: ["status"],
        where: { salonId, startAt: { gte: thirtyDaysAgo } },
        _count: { _all: true },
      }),
      prisma.appointment.findMany({
        where: { salonId, startAt: { gte: thirtyDaysAgo } },
        select: { startAt: true },
      }),
      prisma.client.count({
        where: { salonId, createdAt: { gte: startOfMonth, lt: startOfNextMonth } },
      }),
      prisma.appointment.findMany({
        where: { salonId, startAt: { gte: startOfMonth, lt: startOfNextMonth } },
        distinct: ["clientId"],
        select: { clientId: true, client: { select: { createdAt: true } } },
      }),
      prisma.stylist.findMany({
        where: { salonId },
        select: { id: true, name: true },
      }),
      prisma.service.findMany({
        where: { salonId },
        select: { id: true, name: true },
      }),
    ]);

    // 1. revenueByMonth — pre-fill 6 buckets so months without payments
    //    still appear on the chart (a flat zero is more honest than a gap).
    const revenueByMonth: { month: string; cents: number }[] = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      revenueByMonth.push({
        month: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`,
        cents: 0,
      });
    }
    for (const p of paymentsLast6) {
      const key = `${p.createdAt.getFullYear()}-${String(p.createdAt.getMonth() + 1).padStart(2, "0")}`;
      const slot = revenueByMonth.find((m) => m.month === key);
      if (slot) slot.cents += p.amountCents;
    }

    // 2. revenueByStylist — sum priceCents per stylist this month; "Sin
    //    asignar" bucket captures cita without a stylist so the totals add up.
    const stylistMap = new Map(stylists.map((s) => [s.id, s.name] as const));
    const stylistRevenue = new Map<string, number>();
    for (const a of completedThisMonth) {
      const name = a.stylistId
        ? stylistMap.get(a.stylistId) ?? "—"
        : "Sin asignar";
      stylistRevenue.set(name, (stylistRevenue.get(name) ?? 0) + a.priceCents);
    }
    const revenueByStylist = Array.from(stylistRevenue.entries())
      .map(([name, cents]) => ({ name, cents }))
      .sort((a, b) => b.cents - a.cents);

    // 3. topServices — count + revenue per service, top 5 by count. Each
    //    completed appointment can carry more than one service now, so we
    //    tally per line in AppointmentService rather than per appointment.
    const serviceMap = new Map(services.map((s) => [s.id, s.name] as const));
    const serviceStats = new Map<string, { count: number; cents: number }>();
    for (const a of completedThisMonth) {
      for (const line of a.services) {
        const name = serviceMap.get(line.serviceId) ?? "—";
        const prev = serviceStats.get(name) ?? { count: 0, cents: 0 };
        serviceStats.set(name, { count: prev.count + 1, cents: prev.cents + line.priceCents });
      }
    }
    const topServices = Array.from(serviceStats.entries())
      .map(([name, s]) => ({ name, count: s.count, cents: s.cents }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);

    // 4. statusDistribution — keyed map so the frontend can render in a
    //    stable order with the right colour per status.
    const statusDistribution = statusLast30.map((s) => ({
      status: s.status,
      count: s._count._all,
    }));

    // 5. weekdayOccupancy — JS-side bucket so we don't lock the query to a
    //    specific DB date-function dialect. Monday=0 to align with the
    //    rest of the UI (WEEKDAYS array starts at Mon).
    const weekdayOccupancy = [0, 0, 0, 0, 0, 0, 0];
    for (const a of apptsLast30) {
      const idx = (a.startAt.getDay() + 6) % 7;
      weekdayOccupancy[idx]!++;
    }

    // 6. clientMix — a client counts as "new" if her createdAt falls in the
    //    current month; otherwise she's "returning" (assuming she actually
    //    visited this month).
    let newCount = 0;
    let returningCount = 0;
    for (const row of clientsWithApptsThisMonth) {
      const created = row.client.createdAt;
      if (created >= startOfMonth) newCount++;
      else returningCount++;
    }

    res.json({
      analytics: {
        revenueByMonth,
        revenueByStylist,
        topServices,
        statusDistribution,
        weekdayOccupancy,
        clientMix: { newCount, returningCount, totalNewThisMonth: newClientsThisMonth },
      },
    });
  })
);
