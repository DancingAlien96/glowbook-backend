import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../../lib/asyncHandler.js";
import { validate } from "../../middleware/validate.js";
import { requireAuth, requireRole, requireSalon } from "../../middleware/auth.js";
import { prisma } from "../../lib/prisma.js";
import { NotFound } from "../../lib/errors.js";
import { refreshSubscriptionStatus } from "../../lib/billing.js";
import { env } from "../../config/env.js";

export const subscriptionRoutes = Router();
subscriptionRoutes.use(requireAuth, requireRole("OWNER"), requireSalon);

// Owner reads her own subscription + the platform's bank details + prices.
subscriptionRoutes.get(
  "/me",
  asyncHandler(async (req, res) => {
    const [sub, settings] = await Promise.all([
      prisma.subscription.findUnique({ where: { salonId: req.salonId! } }),
      prisma.platformSettings.findUnique({ where: { id: "default" } }),
    ]);
    if (!sub) throw NotFound("Subscription not found");

    const refreshed = await refreshSubscriptionStatus(sub);

    const payments = await prisma.subscriptionPayment.findMany({
      where: { subscriptionId: refreshed.id },
      orderBy: { createdAt: "desc" },
    });

    res.json({
      subscription: refreshed,
      platform: {
        bankDetails: settings?.bankDetails ?? null,
        monthlyPriceCents: settings?.monthlyPriceCents ?? 2000,
        lifetimePriceCents: settings?.lifetimePriceCents ?? 66000,
        contactEmail: settings?.contactEmail ?? null,
        contactWhatsapp: settings?.contactWhatsapp ?? null,
        recurrenteUrl: env.RECURRENTE_SUBSCRIPTION_URL ?? null,
      },
      payments,
    });
  })
);

const receiptSchema = z.object({
  url: z.string().url().max(500),
  name: z.string().max(255).optional(),
  reference: z.string().max(128).optional(),
  plan: z.enum(["MONTHLY", "LIFETIME"]).default("MONTHLY"),
  periodMonths: z.coerce.number().int().min(1).max(36).default(1),
});

// Owner uploads a subscription receipt (transfer for platform fee).
subscriptionRoutes.post(
  "/me/receipts",
  validate(receiptSchema),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof receiptSchema>;
    const sub = await prisma.subscription.findUnique({ where: { salonId: req.salonId! } });
    if (!sub) throw NotFound("Subscription not found");

    const settings = await prisma.platformSettings.findUnique({ where: { id: "default" } });
    const amountCents =
      body.plan === "LIFETIME"
        ? settings?.lifetimePriceCents ?? 66000
        : (settings?.monthlyPriceCents ?? 2000) * body.periodMonths;

    const payment = await prisma.subscriptionPayment.create({
      data: {
        subscriptionId: sub.id,
        amountCents,
        periodMonths: body.plan === "LIFETIME" ? 999 : body.periodMonths,
        status: "PENDING_REVIEW",
        receiptUrl: body.url,
        receiptName: body.name ?? null,
        reference: body.reference ?? null,
      },
    });

    res.status(201).json({ payment });
  })
);
