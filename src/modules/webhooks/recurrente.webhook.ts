import { Router, Request, Response } from "express";
import { Webhook } from "svix";
import { prisma } from "../../lib/prisma.js";
import { applyApprovedPayment } from "../../lib/billing.js";
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
      res.status(200).json({ received: true, warning: "Handler error — check logs" });
      return;
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
