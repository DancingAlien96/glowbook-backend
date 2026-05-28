// Web Push wrapper around the `web-push` package.
// Sends are fire-and-forget from the caller's perspective (we never block the
// HTTP response on push delivery) and self-prune subscriptions that the push
// service reports as gone (404 / 410).
import webpush from "web-push";
import { env } from "../config/env.js";
import { prisma } from "./prisma.js";

const ready = !!(env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY);

if (ready) {
  webpush.setVapidDetails(env.VAPID_SUBJECT, env.VAPID_PUBLIC_KEY!, env.VAPID_PRIVATE_KEY!);
} else {
  console.warn("[webPush] VAPID keys missing — push sends will be no-ops.");
}

export function isPushConfigured() {
  return ready;
}

export function getVapidPublicKey(): string | null {
  return env.VAPID_PUBLIC_KEY ?? null;
}

export type PushPayload = {
  title: string;
  body: string;
  /** App path to open when the user taps the notification, e.g. "/dashboard/appointments". */
  url?: string;
  /** Coalesce identifier — same `tag` replaces an older notification of the same kind. */
  tag?: string;
  /** Whether the notification should remain visible until the user dismisses it. */
  requireInteraction?: boolean;
};

/**
 * Send `payload` to every push subscription registered by `userIds`.
 * Returns the number of successful deliveries.
 */
export async function sendPushToUsers(userIds: string[], payload: PushPayload): Promise<number> {
  if (!ready || userIds.length === 0) return 0;

  const subs = await prisma.pushSubscription.findMany({
    where: { userId: { in: userIds } },
  });
  if (subs.length === 0) return 0;

  const json = JSON.stringify(payload);
  let delivered = 0;
  const gone: string[] = [];

  await Promise.all(
    subs.map(async (s) => {
      try {
        await webpush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          json
        );
        delivered++;
      } catch (err: unknown) {
        const status =
          (err as { statusCode?: number } | null)?.statusCode ??
          (err as { status?: number } | null)?.status;
        // 404/410 = the subscription is permanently gone. Anything else is
        // transient — leave the row so the next attempt can retry.
        if (status === 404 || status === 410) {
          gone.push(s.id);
        } else {
          console.warn("[webPush] send failed", status, (err as Error)?.message);
        }
      }
    })
  );

  if (gone.length > 0) {
    await prisma.pushSubscription.deleteMany({ where: { id: { in: gone } } }).catch(() => {});
  }

  return delivered;
}

/** Convenience: notify every OWNER user of a salon. */
export async function sendPushToSalonOwners(salonId: string, payload: PushPayload): Promise<number> {
  const owners = await prisma.user.findMany({
    where: { salonId, role: "OWNER" },
    select: { id: true },
  });
  return sendPushToUsers(owners.map((o) => o.id), payload);
}

/** Convenience: notify the User linked to a given stylist (if any). */
export async function sendPushToStylist(stylistId: string, payload: PushPayload): Promise<number> {
  const stylist = await prisma.stylist.findUnique({
    where: { id: stylistId },
    select: { userId: true },
  });
  if (!stylist?.userId) return 0;
  return sendPushToUsers([stylist.userId], payload);
}
