import type { RequestHandler } from "express";
import { verifyAccessToken, type AccessTokenPayload } from "../lib/jwt.js";
import { Unauthorized, Forbidden } from "../lib/errors.js";
import { prisma } from "../lib/prisma.js";

declare global {
  namespace Express {
    interface Request {
      auth?: AccessTokenPayload;
      salonId?: string;
      stylistId?: string;
    }
  }
}

export const requireAuth: RequestHandler = (req, _res, next) => {
  const header = req.headers.authorization ?? "";
  const [scheme, token] = header.split(" ");
  if (scheme !== "Bearer" || !token) return next(Unauthorized("Missing access token"));

  try {
    req.auth = verifyAccessToken(token);
    if (req.auth.salonId) req.salonId = req.auth.salonId;
    next();
  } catch {
    next(Unauthorized("Invalid or expired access token"));
  }
};

// Ensures req.salonId is set — fetched from the user's membership if not in the token yet.
export const requireSalon: RequestHandler = async (req, _res, next) => {
  if (!req.auth) return next(Unauthorized());
  if (req.salonId) return next();

  try {
    const user = await prisma.user.findUnique({
      where: { id: req.auth.sub },
      select: { salonId: true },
    });
    if (!user?.salonId) return next(Forbidden("No salon associated with this user"));
    req.salonId = user.salonId;
    next();
  } catch (e) {
    next(e);
  }
};

// Restricts a route to one or more roles.
export const requireRole = (...allowed: Array<"OWNER" | "STYLIST" | "STAFF" | "ADMIN">): RequestHandler => {
  return (req, _res, next) => {
    if (!req.auth) return next(Unauthorized());
    if (!allowed.includes(req.auth.role as never)) return next(Forbidden("Insufficient role"));
    next();
  };
};

// Resolves the Stylist record linked to the authenticated user (for the portal).
export const requireStylistUser: RequestHandler = async (req, _res, next) => {
  if (!req.auth) return next(Unauthorized());
  if (req.auth.role !== "STYLIST") return next(Forbidden("Stylist-only route"));

  try {
    const stylist = await prisma.stylist.findUnique({
      where: { userId: req.auth.sub },
      select: { id: true, salonId: true, active: true },
    });
    if (!stylist) return next(Forbidden("Stylist profile not found"));
    if (!stylist.active) return next(Forbidden("Your stylist profile is paused"));
    req.salonId = stylist.salonId;
    req.stylistId = stylist.id;
    next();
  } catch (e) {
    next(e);
  }
};
