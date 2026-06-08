import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../../lib/asyncHandler.js";
import { validate } from "../../middleware/validate.js";
import { requireAuth, requireRole, requireSalon } from "../../middleware/auth.js";
import { prisma } from "../../lib/prisma.js";
import { NotFound, BadRequest } from "../../lib/errors.js";
import { refreshSubscriptionStatus } from "../../lib/billing.js";
import { createRecurrenteCheckout } from "../../lib/recurrente.js";
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
        yearlyPriceCents: settings?.yearlyPriceCents ?? 20000,
        lifetimePriceCents: settings?.lifetimePriceCents ?? 100000,
        contactEmail: settings?.contactEmail ?? null,
        contactWhatsapp: settings?.contactWhatsapp ?? null,
        recurrenteUrl: env.RECURRENTE_SUBSCRIPTION_URL ?? null,
        recurrenteYearlyUrl: env.RECURRENTE_YEARLY_URL ?? null,
        recurrenteLifetimeUrl: env.RECURRENTE_LIFETIME_URL ?? null,
      },
      payments,
    });
  })
);

// Creates a Recurrente checkout for the requested plan and records a mapping
// (checkoutId → salon) so the webhook can activate the right account no matter
// what email the customer types. Falls back to the static product link if the
// Recurrente API is unavailable.
const checkoutSchema = z.object({
  plan: z.enum(["MONTHLY", "YEARLY", "LIFETIME"]),
});

subscriptionRoutes.post(
  "/checkout",
  validate(checkoutSchema),
  asyncHandler(async (req, res) => {
    const { plan } = req.body as z.infer<typeof checkoutSchema>;
    const salonId = req.salonId!;

    const settings = await prisma.platformSettings.findUnique({ where: { id: "default" } });
    const amountCents =
      plan === "LIFETIME"
        ? settings?.lifetimePriceCents ?? 100000
        : plan === "YEARLY"
        ? settings?.yearlyPriceCents ?? 20000
        : settings?.monthlyPriceCents ?? 2000;

    const successUrl = `${env.APP_URL}/dashboard/billing?success=true`;
    const cancelUrl = `${env.APP_URL}/dashboard/billing?cancelled=true`;

    // Preferred path: create the checkout via API and map it to this salon.
    if (env.RECURRENTE_SECRET_KEY) {
      try {
        const checkout = await createRecurrenteCheckout({ plan, amountCents, successUrl, cancelUrl });
        await prisma.checkoutSession.create({
          data: { checkoutId: checkout.id, salonId, plan, amountCents },
        });
        res.json({ url: checkout.url });
        return;
      } catch (err) {
        console.error("[subscription/checkout] Recurrente API failed, using static link:", err);
      }
    }

    // Fallback: static product link (relies on email match — see warning UI).
    const fallback =
      plan === "LIFETIME"
        ? env.RECURRENTE_LIFETIME_URL
        : plan === "YEARLY"
        ? env.RECURRENTE_YEARLY_URL
        : env.RECURRENTE_SUBSCRIPTION_URL;
    if (!fallback) throw BadRequest("No hay un enlace de pago configurado para este plan.");
    res.json({ url: fallback });
  })
);

const receiptSchema = z.object({
  url: z.string().url().max(500),
  name: z.string().max(255).optional(),
  reference: z.string().max(128).optional(),
  plan: z.enum(["MONTHLY", "YEARLY", "LIFETIME"]).default("MONTHLY"),
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
        ? settings?.lifetimePriceCents ?? 100000
        : body.plan === "YEARLY"
        ? settings?.yearlyPriceCents ?? 20000
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
