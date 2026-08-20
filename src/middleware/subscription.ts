import type { RequestHandler } from "express";
import { prisma } from "../lib/prisma.js";
import { refreshSubscriptionStatus } from "../lib/billing.js";
import { PaymentRequired } from "../lib/errors.js";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * Hard write-block once a salon's subscription is SUSPENDED — trial *and*
 * the grace period after it both expired with no payment approved (see the
 * state machine in lib/billing.ts). Reads stay open so the dueña never
 * loses access to her own data/history, only the ability to keep operating
 * the business for free past the grace period.
 *
 * Mount AFTER requireSalon / requireStylistUser (needs req.salonId). Do NOT
 * mount on /subscription (she must still be able to check status + upload a
 * receipt to reactivate) or /admin.
 */
export const blockWritesIfSuspended: RequestHandler = async (req, _res, next) => {
  if (SAFE_METHODS.has(req.method)) return next();
  if (!req.salonId) return next();

  try {
    const sub = await prisma.subscription.findUnique({ where: { salonId: req.salonId } });
    if (!sub) return next(); // no subscription row (shouldn't happen) — fail open, not closed.

    const fresh = await refreshSubscriptionStatus(sub);
    if (fresh.status === "SUSPENDED") {
      return next(
        PaymentRequired(
          "Tu período de prueba y de gracia vencieron. Renueva tu plan en Facturación para seguir usando GlowBook."
        )
      );
    }
    next();
  } catch (e) {
    next(e);
  }
};
