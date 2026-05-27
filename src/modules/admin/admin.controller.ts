import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../../lib/asyncHandler.js";
import { validate } from "../../middleware/validate.js";
import { requireAuth, requireRole } from "../../middleware/auth.js";
import { prisma } from "../../lib/prisma.js";
import { NotFound } from "../../lib/errors.js";
import { applyApprovedPayment, refreshSubscriptionStatus } from "../../lib/billing.js";
import { sendEmail } from "../../lib/email.js";
import { subscriptionRenewedTemplate } from "../../lib/emails/subscriptionRenewed.js";

export const adminRoutes = Router();
adminRoutes.use(requireAuth, requireRole("ADMIN"));

// =========================
// Platform-wide settings
// =========================
adminRoutes.get(
  "/settings",
  asyncHandler(async (_req, res) => {
    const settings =
      (await prisma.platformSettings.findUnique({ where: { id: "default" } })) ??
      (await prisma.platformSettings.create({ data: { id: "default" } }));
    res.json({ settings });
  })
);

const settingsSchema = z.object({
  bankDetails: z.string().max(2000).optional().nullable(),
  monthlyPriceCents: z.coerce.number().int().min(0).optional(),
  lifetimePriceCents: z.coerce.number().int().min(0).optional(),
  trialDays: z.coerce.number().int().min(0).max(365).optional(),
  graceDays: z.coerce.number().int().min(0).max(60).optional(),
  contactEmail: z.string().email().max(160).optional().nullable(),
  contactWhatsapp: z.string().max(40).optional().nullable(),
});

adminRoutes.patch(
  "/settings",
  validate(settingsSchema),
  asyncHandler(async (req, res) => {
    const data = req.body as z.infer<typeof settingsSchema>;
    const settings = await prisma.platformSettings.upsert({
      where: { id: "default" },
      create: { id: "default", ...data },
      update: data,
    });
    res.json({ settings });
  })
);

// =========================
// Dashboard metrics
// =========================
adminRoutes.get(
  "/metrics",
  asyncHandler(async (_req, res) => {
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    const [totalSalons, activeSubs, lifetimeSubs, overdueSubs, pendingPaymentsCount, monthRevenueAgg, settings] =
      await Promise.all([
        prisma.salon.count(),
        prisma.subscription.count({ where: { status: { in: ["ACTIVE", "TRIAL"] } } }),
        prisma.subscription.count({ where: { status: "LIFETIME" } }),
        prisma.subscription.count({ where: { status: { in: ["OVERDUE", "SUSPENDED"] } } }),
        prisma.subscriptionPayment.count({ where: { status: "PENDING_REVIEW" } }),
        prisma.subscriptionPayment.aggregate({
          _sum: { amountCents: true },
          where: { status: "APPROVED", reviewedAt: { gte: startOfMonth } },
        }),
        prisma.platformSettings.findUnique({ where: { id: "default" } }),
      ]);

    const mrrCents =
      activeSubs * (settings?.monthlyPriceCents ?? 2000);

    res.json({
      metrics: {
        totalSalons,
        activeSubs,
        lifetimeSubs,
        overdueSubs,
        pendingPayments: pendingPaymentsCount,
        mrrCents,
        monthRevenueCents: monthRevenueAgg._sum.amountCents ?? 0,
      },
    });
  })
);

// =========================
// Salons (all tenants)
// =========================
adminRoutes.get(
  "/salons",
  validate(
    z.object({
      status: z.enum(["TRIAL", "ACTIVE", "OVERDUE", "SUSPENDED", "CANCELLED", "LIFETIME"]).optional(),
      search: z.string().optional(),
    }),
    "query"
  ),
  asyncHandler(async (req, res) => {
    const q = req.query as unknown as { status?: string; search?: string };
    const salons = await prisma.salon.findMany({
      where: {
        ...(q.search
          ? { OR: [{ name: { contains: q.search } }, { slug: { contains: q.search } }] }
          : {}),
        ...(q.status ? { subscription: { is: { status: q.status as never } } } : {}),
      },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        name: true,
        slug: true,
        createdAt: true,
        subscription: true,
        _count: { select: { members: true, appointments: true } },
      },
    });

    // Refresh statuses lazily on read.
    for (const s of salons) {
      if (s.subscription) s.subscription = await refreshSubscriptionStatus(s.subscription);
    }

    res.json({ salons });
  })
);

// =========================
// Subscription payments (pending receipts)
// =========================
adminRoutes.get(
  "/payments",
  validate(
    z.object({
      status: z.enum(["PENDING_REVIEW", "APPROVED", "REJECTED"]).optional(),
    }),
    "query"
  ),
  asyncHandler(async (req, res) => {
    const q = req.query as unknown as { status?: string };
    const payments = await prisma.subscriptionPayment.findMany({
      where: { ...(q.status ? { status: q.status as never } : {}) },
      orderBy: { createdAt: "desc" },
      include: {
        subscription: {
          include: {
            salon: { select: { id: true, name: true, slug: true } },
          },
        },
      },
    });
    res.json({ payments });
  })
);

adminRoutes.post(
  "/payments/:id/approve",
  asyncHandler(async (req, res) => {
    const payment = await prisma.subscriptionPayment.findUnique({
      where: { id: req.params.id! },
      include: { subscription: true },
    });
    if (!payment) throw NotFound("Payment not found");

    const updated = await prisma.$transaction(async (tx) => {
      const p = await tx.subscriptionPayment.update({
        where: { id: payment.id },
        data: { status: "APPROVED", reviewedAt: new Date(), reviewedBy: req.auth!.sub },
      });
      return p;
    });

    const refreshedSub = await applyApprovedPayment({
      subscriptionId: payment.subscriptionId,
      periodMonths: payment.periodMonths,
      plan: payment.periodMonths >= 999 ? "LIFETIME" : "MONTHLY",
    });

    // Notify every OWNER of that salon that their plan was renewed.
    const owners = await prisma.user.findMany({
      where: { salonId: payment.subscription.salonId, role: "OWNER" },
      select: { email: true, name: true },
    });
    const salon = await prisma.salon.findUnique({
      where: { id: payment.subscription.salonId },
      select: { name: true, currency: true },
    });
    for (const owner of owners) {
      const tpl = subscriptionRenewedTemplate({
        ownerName: owner.name,
        salonName: salon?.name ?? "tu salón",
        plan: payment.periodMonths >= 999 ? "LIFETIME" : "MONTHLY",
        periodMonths: payment.periodMonths,
        amountCents: payment.amountCents,
        currency: salon?.currency ?? "USD",
        newPeriodEnd: refreshedSub.currentPeriodEnd,
      });
      sendEmail({ to: owner.email, subject: tpl.subject, html: tpl.html, text: tpl.text });
    }

    res.json({ payment: updated });
  })
);

adminRoutes.post(
  "/payments/:id/reject",
  validate(z.object({ rejectedReason: z.string().max(255).optional() })),
  asyncHandler(async (req, res) => {
    const payment = await prisma.subscriptionPayment.findUnique({ where: { id: req.params.id! } });
    if (!payment) throw NotFound("Payment not found");

    const updated = await prisma.subscriptionPayment.update({
      where: { id: payment.id },
      data: {
        status: "REJECTED",
        reviewedAt: new Date(),
        reviewedBy: req.auth!.sub,
        rejectedReason: (req.body as { rejectedReason?: string }).rejectedReason ?? null,
      },
    });
    res.json({ payment: updated });
  })
);
