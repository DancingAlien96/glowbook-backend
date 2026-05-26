import type { RequestHandler } from "express";
import { verifyAccessToken, type AccessTokenPayload } from "../lib/jwt.js";
import { Unauthorized, Forbidden } from "../lib/errors.js";
import { prisma } from "../lib/prisma.js";

declare global {
  namespace Express {
    interface Request {
      auth?: AccessTokenPayload;
      salonId?: string;
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

// Ensures req.salonId is set — fetched from the user's owned salon if not in the token yet.
export const requireSalon: RequestHandler = async (req, _res, next) => {
  if (!req.auth) return next(Unauthorized());
  if (req.salonId) return next();

  try {
    const salon = await prisma.salon.findUnique({
      where: { ownerId: req.auth.sub },
      select: { id: true },
    });
    if (!salon) return next(Forbidden("No salon associated with this user"));
    req.salonId = salon.id;
    next();
  } catch (e) {
    next(e);
  }
};
