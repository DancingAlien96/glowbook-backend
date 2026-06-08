import { prisma } from "./prisma.js";
import type { SubStatus, Subscription } from "@prisma/client";

/**
 * Recalculates a subscription's status based on dates + grace period.
 * Should be called whenever we read a subscription that could have expired.
 *
 * State machine:
 *   LIFETIME / CANCELLED → returned as-is (terminal)
 *   TRIAL  → trialEndsAt passed → OVERDUE
 *   ACTIVE → currentPeriodEnd passed → OVERDUE
 *   OVERDUE → OVERDUE for > graceDays → SUSPENDED
 */
export async function refreshSubscriptionStatus(sub: Subscription): Promise<Subscription> {
  if (sub.status === "LIFETIME" || sub.status === "CANCELLED") return sub;

  const now = new Date();
  const settings = await prisma.platformSettings.findUnique({ where: { id: "default" } });
  const graceDays = settings?.graceDays ?? 7;

  let next: SubStatus = sub.status;

  if (sub.status === "TRIAL" && sub.trialEndsAt && sub.trialEndsAt < now) {
    next = "OVERDUE";
  } else if (sub.status === "ACTIVE" && sub.currentPeriodEnd && sub.currentPeriodEnd < now) {
    next = "OVERDUE";
  } else if (sub.status === "OVERDUE") {
    // Pick the reference date: end of paid period if any, else end of trial.
    const ref = sub.currentPeriodEnd ?? sub.trialEndsAt;
    if (ref) {
      const graceEnd = new Date(ref.getTime() + graceDays * 86_400_000);
      if (now > graceEnd) next = "SUSPENDED";
    }
  }

  if (next !== sub.status) {
    return prisma.subscription.update({ where: { id: sub.id }, data: { status: next } });
  }
  return sub;
}

/** True if the subscription allows full access to the dashboard. */
export function isActive(status: SubStatus): boolean {
  return status === "TRIAL" || status === "ACTIVE" || status === "OVERDUE" || status === "LIFETIME";
}

/** Apply an approved payment: extends currentPeriodEnd and updates status + plan. */
export async function applyApprovedPayment(params: {
  subscriptionId: string;
  periodMonths: number;
  plan: "MONTHLY" | "YEARLY" | "LIFETIME";
}): Promise<Subscription> {
  const { subscriptionId, periodMonths, plan } = params;
  const sub = await prisma.subscription.findUnique({ where: { id: subscriptionId } });
  if (!sub) throw new Error("Subscription not found");

  if (plan === "LIFETIME") {
    return prisma.subscription.update({
      where: { id: subscriptionId },
      data: { status: "LIFETIME", plan: "LIFETIME", currentPeriodEnd: null },
    });
  }

  // Start from now if expired/trial, otherwise extend from currentPeriodEnd so
  // upgrading mid-trial doesn't lose the days already paid for.
  const now = new Date();
  const base =
    sub.currentPeriodEnd && sub.currentPeriodEnd > now ? sub.currentPeriodEnd : now;
  // Add whole calendar months so YEARLY = exactly 12 months (no 30-day drift).
  const newEnd = new Date(base);
  newEnd.setMonth(newEnd.getMonth() + periodMonths);

  // IMPORTANT: also persist `plan` so the UI reflects what was actually bought
  // (a YEARLY purchase used to stay labelled MONTHLY).
  return prisma.subscription.update({
    where: { id: subscriptionId },
    data: { status: "ACTIVE", plan, currentPeriodEnd: newEnd },
  });
}
