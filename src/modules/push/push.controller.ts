import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../../lib/asyncHandler.js";
import { validate } from "../../middleware/validate.js";
import { requireAuth } from "../../middleware/auth.js";
import { prisma } from "../../lib/prisma.js";
import { getVapidPublicKey } from "../../lib/webPush.js";

export const pushRoutes = Router();

// Public — the frontend needs this to call PushManager.subscribe().
pushRoutes.get(
  "/vapid",
  asyncHandler(async (_req, res) => {
    res.json({ publicKey: getVapidPublicKey() });
  })
);

const subscribeSchema = z.object({
  endpoint: z.string().url().max(500),
  keys: z.object({
    p256dh: z.string().min(8).max(255),
    auth: z.string().min(8).max(255),
  }),
  userAgent: z.string().max(255).optional().nullable(),
});

// Authenticated — ties the subscription to the logged-in user.
// Re-subscribing the same endpoint updates keys instead of duplicating rows.
pushRoutes.post(
  "/subscribe",
  requireAuth,
  validate(subscribeSchema),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof subscribeSchema>;
    const userId = req.auth!.sub;

    const sub = await prisma.pushSubscription.upsert({
      where: { endpoint: body.endpoint },
      create: {
        userId,
        endpoint: body.endpoint,
        p256dh: body.keys.p256dh,
        auth: body.keys.auth,
        userAgent: body.userAgent ?? null,
      },
      update: {
        // If a different user logs in on the same browser, re-tie the
        // subscription to the new user instead of orphaning it.
        userId,
        p256dh: body.keys.p256dh,
        auth: body.keys.auth,
        userAgent: body.userAgent ?? null,
      },
      select: { id: true, createdAt: true },
    });

    res.status(201).json({ subscription: sub });
  })
);

const unsubscribeSchema = z.object({
  endpoint: z.string().url().max(500),
});

pushRoutes.post(
  "/unsubscribe",
  requireAuth,
  validate(unsubscribeSchema),
  asyncHandler(async (req, res) => {
    const { endpoint } = req.body as z.infer<typeof unsubscribeSchema>;
    // Only the owner of the subscription can remove it.
    await prisma.pushSubscription.deleteMany({
      where: { endpoint, userId: req.auth!.sub },
    });
    res.status(204).end();
  })
);
