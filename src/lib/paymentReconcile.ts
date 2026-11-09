// Shared payment-reconciliation logic, used by BOTH the Recurrente webhook
// (reconcile on every verified event) and the scheduled job (reconcile on a
// timer). The timer is what rescues the common real-world flow where no webhook
// ever arrives: the automatic charge fails because the card has no funds, the
// owner tops it up and pays MANUALLY days later, and nothing notifies us.

import { prisma } from "./prisma.js";
import { applyApprovedPayment } from "./billing.js";
import { getRecurrenteCheckout } from "./recurrente.js";

// Activates the salon behind a checkout session from a confirmed payment, once.
// Idempotent: the same Recurrente payment reference is never recorded twice, and
// a session already marked COMPLETED is left untouched.
export async function activateFromCheckoutSession(
  session: {
    id: string;
    salonId: string;
    plan: "MONTHLY" | "YEARLY" | "LIFETIME";
    amountCents: number;
    checkoutId: string;
  },
  payment: { amountCents: number | null; reference: string | null }
): Promise<boolean> {
  const sub = await prisma.subscription.findUnique({ where: { salonId: session.salonId } });
  if (!sub) {
    console.warn(
      `[payment-reconcile] checkout ${session.checkoutId} → salon ${session.salonId} has no subscription`
    );
    return false;
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
      return false;
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
      reviewedBy: "payment-reconcile",
    },
  });
  // Lifts SUSPENDED/OVERDUE back to ACTIVE and extends the period, so the salon's
  // access (and the "subscription suspended" banner) clears on its own.
  await applyApprovedPayment({ subscriptionId: sub.id, periodMonths, plan: session.plan });
  await prisma.checkoutSession.update({
    where: { id: session.id },
    data: { status: "COMPLETED" },
  });
  console.log(
    `[payment-reconcile] Activated salon ${session.salonId} (${session.plan}) via checkout ${session.checkoutId}`
  );
  return true;
}

// Sweeps recently-created checkouts still marked PENDING, asks Recurrente whether
// each was actually paid, and activates the matching salon if so. Returns how
// many salons it activated. Idempotent and safe to run as often as needed.
export async function reconcilePendingCheckouts(): Promise<number> {
  const cutoff = new Date(Date.now() - 45 * 24 * 60 * 60 * 1000);
  const pending = await prisma.checkoutSession.findMany({
    where: { status: "PENDING", createdAt: { gte: cutoff } },
    take: 50,
  });
  let activated = 0;
  for (const session of pending) {
    try {
      const checkout = await getRecurrenteCheckout(session.checkoutId);
      if (!checkout?.paid) continue;
      if (await activateFromCheckoutSession(session, {
        amountCents: checkout.amountCents,
        reference: checkout.paymentReference,
      })) {
        activated++;
      }
    } catch (err) {
      console.error(`[payment-reconcile] reconcile failed for ${session.checkoutId}:`, err);
    }
  }
  return activated;
}
