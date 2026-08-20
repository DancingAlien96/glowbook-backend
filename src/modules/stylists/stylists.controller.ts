import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../../lib/asyncHandler.js";
import { validate } from "../../middleware/validate.js";
import { requireAuth, requireRole, requireSalon } from "../../middleware/auth.js";
import { blockWritesIfSuspended } from "../../middleware/subscription.js";
import { prisma } from "../../lib/prisma.js";
import { NotFound } from "../../lib/errors.js";
import { hoursArraySchema } from "../../lib/hoursValidation.js";

export const stylistsRoutes = Router();
stylistsRoutes.use(requireAuth, requireRole("OWNER"), requireSalon);
stylistsRoutes.use(blockWritesIfSuspended);

const createSchema = z.object({
  name: z.string().min(2).max(120),
  role: z.string().max(128).optional().nullable(),
  active: z.coerce.boolean().optional(),
  commissionPercent: z.number().int().min(0).max(100).optional(),
  serviceIds: z.array(z.string().cuid()).optional(),
});

const updateSchema = createSchema.partial();

stylistsRoutes.get(
  "/",
  asyncHandler(async (req, res) => {
    const stylists = await prisma.stylist.findMany({
      where: { salonId: req.salonId! },
      orderBy: [{ active: "desc" }, { name: "asc" }],
      include: {
        services: { select: { serviceId: true } },
        hours: { select: { dayOfWeek: true, openMin: true, closeMin: true }, orderBy: { dayOfWeek: "asc" } },
      },
    });
    res.json({ stylists });
  })
);

// Owner sets a stylist's weekly schedule (replaces all rows).
// An empty list means "inherit the salon hours".
const hoursSchema = z.object({ hours: hoursArraySchema });

stylistsRoutes.put(
  "/:id/hours",
  validate(hoursSchema),
  asyncHandler(async (req, res) => {
    const id = req.params.id!;
    const stylist = await prisma.stylist.findFirst({ where: { id, salonId: req.salonId! } });
    if (!stylist) throw NotFound("Stylist not found");

    const { hours } = req.body as z.infer<typeof hoursSchema>;
    await prisma.$transaction(async (tx) => {
      await tx.stylistHour.deleteMany({ where: { stylistId: id } });
      if (hours.length) {
        await tx.stylistHour.createMany({ data: hours.map((h) => ({ ...h, stylistId: id })) });
      }
    });

    const updated = await prisma.stylistHour.findMany({
      where: { stylistId: id },
      orderBy: { dayOfWeek: "asc" },
      select: { dayOfWeek: true, openMin: true, closeMin: true },
    });
    res.json({ hours: updated });
  })
);

// Monthly earnings per stylist. Sums priceCents of COMPLETED appointments
// in the given month, multiplies by each stylist's commissionPercent, and
// returns the breakdown. Used by /dashboard/commissions.
const earningsSchema = z.object({
  // YYYY-MM. Defaults to the current month in the salon timezone (best-effort
  // on the server — the frontend should pass the user's chosen month anyway).
  month: z.string().regex(/^\d{4}-\d{2}$/).optional(),
});

stylistsRoutes.get(
  "/earnings",
  validate(earningsSchema, "query"),
  asyncHandler(async (req, res) => {
    const q = req.query as unknown as z.infer<typeof earningsSchema>;
    const now = new Date();
    const monthStr =
      q.month ?? `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    const [y, m] = monthStr.split("-").map(Number) as [number, number];
    const from = new Date(y, m - 1, 1);
    const to = new Date(y, m, 1);

    const stylists = await prisma.stylist.findMany({
      where: { salonId: req.salonId! },
      orderBy: [{ active: "desc" }, { name: "asc" }],
      select: { id: true, name: true, role: true, active: true, commissionPercent: true },
    });

    // One groupBy fetches all the numbers we need in a single round-trip.
    const grouped = await prisma.appointment.groupBy({
      by: ["stylistId"],
      where: {
        salonId: req.salonId!,
        status: "COMPLETED",
        startAt: { gte: from, lt: to },
        stylistId: { in: stylists.map((s) => s.id) },
      },
      _sum: { priceCents: true },
      _count: { _all: true },
    });

    const byStylist = new Map(grouped.map((g) => [g.stylistId, g] as const));
    const rows = stylists.map((s) => {
      const g = byStylist.get(s.id);
      const revenueCents = g?._sum.priceCents ?? 0;
      const completedCount = g?._count._all ?? 0;
      const commissionCents = Math.round((revenueCents * s.commissionPercent) / 100);
      return {
        stylistId: s.id,
        name: s.name,
        role: s.role,
        active: s.active,
        commissionPercent: s.commissionPercent,
        completedCount,
        revenueCents,
        commissionCents,
      };
    });

    const totals = {
      revenueCents: rows.reduce((a, r) => a + r.revenueCents, 0),
      commissionCents: rows.reduce((a, r) => a + r.commissionCents, 0),
      completedCount: rows.reduce((a, r) => a + r.completedCount, 0),
    };

    res.json({ month: monthStr, rows, totals });
  })
);

stylistsRoutes.post(
  "/",
  validate(createSchema),
  asyncHandler(async (req, res) => {
    const { serviceIds, ...data } = req.body as z.infer<typeof createSchema>;
    const stylist = await prisma.stylist.create({
      data: {
        ...data,
        salonId: req.salonId!,
        active: data.active ?? true,
        services: serviceIds?.length
          ? { create: serviceIds.map((serviceId) => ({ serviceId })) }
          : undefined,
      },
    });
    res.status(201).json({ stylist });
  })
);

stylistsRoutes.patch(
  "/:id",
  validate(updateSchema),
  asyncHandler(async (req, res) => {
    const id = req.params.id!;
    const { serviceIds, ...data } = req.body as z.infer<typeof updateSchema>;
    const existing = await prisma.stylist.findFirst({ where: { id, salonId: req.salonId! } });
    if (!existing) throw NotFound("Stylist not found");

    const stylist = await prisma.$transaction(async (tx) => {
      const updated = await tx.stylist.update({ where: { id }, data });
      if (serviceIds) {
        await tx.stylistService.deleteMany({ where: { stylistId: id } });
        if (serviceIds.length) {
          await tx.stylistService.createMany({
            data: serviceIds.map((serviceId) => ({ stylistId: id, serviceId })),
          });
        }
      }
      return updated;
    });

    res.json({ stylist });
  })
);

stylistsRoutes.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    const id = req.params.id!;
    const existing = await prisma.stylist.findFirst({ where: { id, salonId: req.salonId! } });
    if (!existing) throw NotFound("Stylist not found");
    await prisma.stylist.delete({ where: { id } });
    res.status(204).end();
  })
);
