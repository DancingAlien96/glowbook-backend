import { Router, Request, Response } from "express";
import { Webhook } from "svix";
import { prisma } from "../../lib/prisma.js";
import { applyApprovedPayment } from "../../lib/billing.js";
import { getRecurrenteCheckout } from "../../lib/recurrente.js";
import { env } from "../../config/env.js";
import { sendEmail } from "../../lib/email.js";
import { paymentPendingTemplate } from "../../lib/emails/paymentPending.js";
import { trialStartedTemplate } from "../../lib/emails/trialStarted.js";

export const recurrenteWebhookRouter = Router();

recurrenteWebhookRouter.post(
  "/",
  async (req: Request, res: Response): Promise<void> => {
    if (!env.RECURRENTE_WEBHOOK_SECRET) {
      console.warn("[recurrente-webhook] RECURRENTE_WEBHOOK_SECRET not set — ignoring");
      res.status(200).json({ received: true });
      return;
    }

    const rawBody = req.body as Buffer;

    const wh = new Webhook(env.RECURRENTE_WEBHOOK_SECRET);
    let event: RecurrenteEvent;
    try {
      event = wh.verify(rawBody, {
        "webhook-id": req.headers["webhook-id"] as string,
        "webhook-timestamp": req.headers["webhook-timestamp"] as string,
        "webhook-signature": req.headers["webhook-signature"] as string,
      }) as RecurrenteEvent;
    } catch (err) {
      console.error("[recurrente-webhook] Signature verification failed:", err);
      res.status(400).json({ error: "Invalid signature" });
      return;
    }

    console.log(`[recurrente-webhook] Event received: ${event.type}`);

    try {
      await handleEvent(event);
    } catch (err) {
      console.error("[recurrente-webhook] Handler error:", err);
    }

    // Safety net — independent of the event type/shape: ask Recurrente directly
    // about any checkout we created that is still pending, and activate the ones
    // that were paid. This is what guarantees a subscription payment lands on
    // the right salon even when the event body doesn't carry the checkout id.
    try {
      await reconcilePendingCheckouts();
    } catch (err) {
      console.error("[recurrente-webhook] Reconcile sweep failed:", err);
    }

    res.status(200).json({ received: true });
  }
);

// ─── Plan detection ────────────────────────────────────────────────────────

function detectPlanFromEvent(event: RecurrenteEvent): "MONTHLY" | "YEARLY" | "LIFETIME" {
  const d = event.data as Record<string, unknown>;
  const product = d?.product as Record<string, unknown>;
  const name = (product?.name as string || d?.name as string || "").toLowerCase();

  if (name.includes("lifetime") || name.includes("vida")) return "LIFETIME";
  if (name.includes("annual") || name.includes("yearly") || name.includes("anual")) return "YEARLY";
  return "MONTHLY";
}

function getPriceForPlan(plan: "MONTHLY" | "YEARLY" | "LIFETIME"): number {
  switch (plan) {
    case "LIFETIME":
      return 100000;
    case "YEARLY":
      return 20000;
    case "MONTHLY":
      return 2000;
  }
}

async function handleEvent(event: RecurrenteEvent) {
  switch (event.type) {
    case "subscription.created":
    case "subscription.create": {
      const email = extractEmail(event);
      if (!email) {
        console.warn("[recurrente-webhook] subscription.create — no email in payload");
        return;
      }

      const user = await prisma.user.findFirst({
        where: { email: email.toLowerCase(), role: "OWNER" },
      });

      const plan = detectPlanFromEvent(event);

      if (!user) {
        await prisma.pendingActivation.upsert({
          where: { email: email.toLowerCase() },
          create: { email: email.toLowerCase(), plan, amountCents: 0, isTrial: true },
          update: { isTrial: true, amountCents: 0, reference: null },
        });
        console.log(`[recurrente-webhook] Trial started for unregistered email: ${email} (plan: ${plan})`);
        sendEmail({ to: email, ...trialStartedTemplate({ email }) });
      } else {
        console.log(`[recurrente-webhook] Trial started for existing user: ${email} (plan: ${plan})`);
      }
      break;
    }

    case "payment.completed":
    case "payment.complete":
    case "payment_intent.succeeded": {
      // ── Reliable path: checkout-id mapping ────────────────────────────────
      // When the checkout was created server-side (POST /subscription/checkout)
      // we stored checkoutId → salon. This activates the EXACT account no matter
      // what email the customer typed at Recurrente's page.
      const checkoutId = extractCheckoutId(event);
      if (checkoutId) {
        const session = await prisma.checkoutSession.findUnique({ where: { checkoutId } });
        if (session) {
          await activateFromCheckoutSession(session, {
            amountCents: extractAmountCents(event),
            reference: extractReference(event),
          });
          return;
        }
        console.warn(`[recurrente-webhook] checkoutId ${checkoutId} had no matching session — falling back to email`);
      }

      // ── Fallback: match by customer email (legacy static-link flow) ───────
      const email = extractEmail(event);
      if (!email) {
        console.warn("[recurrente-webhook] No customer email in payload — skipping");
        return;
      }

      const user = await prisma.user.findFirst({
        where: { email: email.toLowerCase(), role: "OWNER" },
        include: { salon: { include: { subscription: true } } },
      });

      const plan = detectPlanFromEvent(event);
      const amountCents = extractAmountCents(event) ?? getPriceForPlan(plan);

      if (!user?.salon?.subscription) {
        await prisma.pendingActivation.upsert({
          where: { email: email.toLowerCase() },
          create: {
            email: email.toLowerCase(),
            plan,
            amountCents,
            isTrial: false,
            reference: extractReference(event),
          },
          update: {
            plan,
            amountCents,
            isTrial: false,
            reference: extractReference(event),
          },
        });
        console.log(`[recurrente-webhook] Payment received, no account for ${email} — stored PendingActivation (plan: ${plan})`);
        sendEmail({ to: email, ...paymentPendingTemplate({ email }) });
        return;
      }

      const sub = user.salon.subscription;
      const periodMonths = plan === "LIFETIME" ? 999 : plan === "YEARLY" ? 12 : 1;
      await prisma.subscriptionPayment.create({
        data: {
          subscriptionId: sub.id,
          amountCents,
          periodMonths,
          status: "APPROVED",
          reference: extractReference(event),
          reviewedAt: new Date(),
          reviewedBy: "recurrente-webhook",
        },
      });

      await applyApprovedPayment({
        subscriptionId: sub.id,
        periodMonths,
        plan,
      });

      console.log(`[recurrente-webhook] Subscription activated for salon: ${user.salon.name} (${email}, plan: ${plan})`);
      break;
    }

    case "subscription.cancelled":
    case "subscription.cancel": {
      const email = extractEmail(event);
      if (!email) return;

      const user = await prisma.user.findFirst({
        where: { email: email.toLowerCase(), role: "OWNER" },
        include: { salon: { include: { subscription: true } } },
      });

      if (!user?.salon?.subscription) return;

      await prisma.subscription.update({
        where: { id: user.salon.subscription.id },
        data: { status: "CANCELLED", cancelledAt: new Date() },
      });

      console.log(`[recurrente-webhook] Subscription cancelled for salon: ${user.salon.name}`);
      break;
    }

    case "payment.failed":
    case "payment.fail":
    case "payment_intent.failed": {
      const email = extractEmail(event);
      console.warn(`[recurrente-webhook] Payment failed for: ${email ?? "unknown"}`);
      break;
    }

    default:
      console.log(`[recurrente-webhook] Unhandled event type: ${event.type}`);
  }
}

// ─── Activation + reconciliation ─────────────────────────────────────────────

// Activates the salon behind a checkout session from a confirmed payment, once.
// Idempotent: the same Recurrente payment reference is never recorded twice, and
// a session already marked COMPLETED is left untouched.
async function activateFromCheckoutSession(
  session: {
    id: string;
    salonId: string;
    plan: "MONTHLY" | "YEARLY" | "LIFETIME";
    amountCents: number;
    checkoutId: string;
  },
  payment: { amountCents: number | null; reference: string | null }
): Promise<void> {
  const sub = await prisma.subscription.findUnique({ where: { salonId: session.salonId } });
  if (!sub) {
    console.warn(
      `[recurrente-webhook] checkout ${session.checkoutId} → salon ${session.salonId} has no subscription`
    );
    return;
  }

  // Never double-apply the same Recurrente payment.
  if (payment.reference) {
    const already = await prisma.subscriptionPayment.findFirst({
      where: { subscriptionId: sub.id, reference: payment.reference },
      select: { id: true },
    });
    if (already) {
      await prisma.checkoutSession.update({
        where: { id: session.id },
        data: { status: "COMPLETED" },
      });
      return;
    }
  }

  const periodMonths = session.plan === "LIFETIME" ? 999 : session.plan === "YEARLY" ? 12 : 1;
  await prisma.subscriptionPayment.create({
    data: {
      subscriptionId: sub.id,
      amountCents: payment.amountCents ?? session.amountCents,
      periodMonths,
      status: "APPROVED",
      reference: payment.reference,
      reviewedAt: new Date(),
      reviewedBy: "recurrente-webhook",
    },
  });
  await applyApprovedPayment({ subscriptionId: sub.id, periodMonths, plan: session.plan });
  await prisma.checkoutSession.update({
    where: { id: session.id },
    data: { status: "COMPLETED" },
  });
  console.log(
    `[recurrente-webhook] Activated salon ${session.salonId} (${session.plan}) via checkout ${session.checkoutId}`
  );
}

// Every verified webhook triggers this sweep of recently-created checkouts still
// marked PENDING. For each, we ask Recurrente whether it was actually paid and
// activate it if so — so a payment reaches the right salon no matter what the
// event body looked like (the bug that left paid salons suspended).
async function reconcilePendingCheckouts(): Promise<void> {
  const cutoff = new Date(Date.now() - 45 * 24 * 60 * 60 * 1000);
  const pending = await prisma.checkoutSession.findMany({
    where: { status: "PENDING", createdAt: { gte: cutoff } },
    take: 50,
  });
  for (const session of pending) {
    try {
      const checkout = await getRecurrenteCheckout(session.checkoutId);
      if (!checkout?.paid) continue;
      await activateFromCheckoutSession(session, {
        amountCents: checkout.amountCents,
        reference: checkout.paymentReference,
      });
    } catch (err) {
      console.error(`[recurrente-webhook] reconcile failed for ${session.checkoutId}:`, err);
    }
  }
}

// ─── Payload helpers ────────────────────────────────────────────────────────

function extractEmail(event: RecurrenteEvent): string | null {
  const d = event.data as Record<string, unknown>;
  return (
    (d?.customer as Record<string, unknown>)?.email as string ||
    (d?.checkout as Record<string, unknown>)?.email as string ||
    (d?.billing as Record<string, unknown>)?.email as string ||
    d?.email as string ||
    null
  );
}

function extractAmountCents(event: RecurrenteEvent): number | null {
  const d = event.data as Record<string, unknown>;
  const raw =
    (d?.payment as Record<string, unknown>)?.amount ||
    (d?.checkout as Record<string, unknown>)?.amount ||
    d?.amount;
  if (typeof raw === "number") return Math.round(raw * 100);
  return null;
}

function extractReference(event: RecurrenteEvent): string | null {
  const d = event.data as Record<string, unknown>;
  return (
    (d?.payment as Record<string, unknown>)?.id as string ||
    (d?.checkout as Record<string, unknown>)?.id as string ||
    d?.id as string ||
    null
  );
}

// The Recurrente checkout id ("ch_...") used to map a payment back to the salon
// that started it (see CheckoutSession). Probes the documented checkout.id plus
// a couple of common aliases.
function extractCheckoutId(event: RecurrenteEvent): string | null {
  const d = event.data as Record<string, unknown>;
  return (
    ((d?.checkout as Record<string, unknown>)?.id as string) ||
    (d?.checkout_id as string) ||
    null
  );
}

// ─── Types ───────────────────────────────────────────────────────────────────

interface RecurrenteEvent {
  type:
    | "subscription.created"   | "subscription.create"
    | "subscription.cancelled" | "subscription.cancel"
    | "payment.completed"      | "payment.complete"    | "payment_intent.succeeded"
    | "payment.failed"         | "payment.fail"        | "payment_intent.failed"
    | string;
  data: unknown;
}
