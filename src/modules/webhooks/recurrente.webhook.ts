import { Router, Request, Response } from "express";
import { Webhook } from "svix";
import { prisma } from "../../lib/prisma.js";
import { applyApprovedPayment } from "../../lib/billing.js";
import { env } from "../../config/env.js";

export const recurrenteWebhookRouter = Router();

recurrenteWebhookRouter.post(
  "/",
  async (req: Request, res: Response): Promise<void> => {
    if (!env.RECURRENTE_WEBHOOK_SECRET) {
      console.warn("[recurrente-webhook] RECURRENTE_WEBHOOK_SECRET not set — ignoring");
      res.status(200).json({ received: true });
      return;
    }

    // req.body is a Buffer here (mounted with express.raw())
    const rawBody = req.body as Buffer;

    // Verify Svix signature
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
      // Return 200 anyway so Svix doesn't retry indefinitely for logic errors
      res.status(200).json({ received: true, warning: "Handler error — check logs" });
      return;
    }

    res.status(200).json({ received: true });
  }
);

async function handleEvent(event: RecurrenteEvent) {
  switch (event.type) {
    case "subscription.created":
    case "subscription.create":
    case "payment.completed":
    case "payment.complete":
    case "payment_intent.succeeded": {
      const email = extractEmail(event);
      if (!email) {
        console.warn("[recurrente-webhook] No customer email in payload — skipping");
        return;
      }

      // Find the salon owner by email
      const user = await prisma.user.findFirst({
        where: { email: email.toLowerCase(), role: "OWNER" },
        include: { salon: { include: { subscription: true } } },
      });

      if (!user?.salon?.subscription) {
        // User hasn't registered yet — store for activation on signup
        await prisma.pendingActivation.upsert({
          where: { email: email.toLowerCase() },
          create: {
            email: email.toLowerCase(),
            plan: "MONTHLY",
            amountCents: amountCents ?? 2000,
            reference: extractReference(event),
          },
          update: {
            amountCents: amountCents ?? 2000,
            reference: extractReference(event),
          },
        });
        console.log(`[recurrente-webhook] No account for ${email} — stored PendingActivation`);
        return;
      }

      const sub = user.salon.subscription;

      // Create an auto-approved SubscriptionPayment record
      const amountCents = extractAmountCents(event) ?? 2000; // fallback $20
      await prisma.subscriptionPayment.create({
        data: {
          subscriptionId: sub.id,
          amountCents,
          periodMonths: 1,
          status: "APPROVED",
          reference: extractReference(event),
          reviewedAt: new Date(),
          reviewedBy: "recurrente-webhook",
        },
      });

      // Activate / extend the subscription
      await applyApprovedPayment({
        subscriptionId: sub.id,
        periodMonths: 1,
        plan: "MONTHLY",
      });

      console.log(`[recurrente-webhook] Subscription activated for salon: ${user.salon.name} (${email})`);
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
      // No action needed — subscription stays in current state, will expire naturally
      break;
    }

    default:
      console.log(`[recurrente-webhook] Unhandled event type: ${event.type}`);
  }
}

// ─── Payload helpers ────────────────────────────────────────────────────────
// Recurrente's exact payload shape isn't publicly documented so we probe
// common locations where customer email might appear.

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
