import jwt, { type SignOptions, type JwtPayload } from "jsonwebtoken";
import crypto from "node:crypto";
import { env } from "../config/env.js";

export type AccessTokenPayload = {
  sub: string; // user id
  email: string;
  role: string;
  salonId?: string;
};

export function signAccessToken(payload: AccessTokenPayload): string {
  return jwt.sign(payload, env.JWT_ACCESS_SECRET, {
    expiresIn: env.JWT_ACCESS_TTL,
  } as SignOptions);
}

export function verifyAccessToken(token: string): AccessTokenPayload {
  const decoded = jwt.verify(token, env.JWT_ACCESS_SECRET) as JwtPayload & AccessTokenPayload;
  return decoded;
}

// Refresh tokens are opaque random strings stored hashed in the DB.
export function generateRefreshToken(): { token: string; hash: string } {
  const token = crypto.randomBytes(48).toString("base64url");
  const hash = hashRefreshToken(token);
  return { token, hash };
}

export function hashRefreshToken(token: string): string {
  return crypto.createHmac("sha256", env.JWT_REFRESH_SECRET).update(token).digest("hex");
}

export function refreshExpiresAt(): Date {
  const ms = parseDuration(env.JWT_REFRESH_TTL);
  return new Date(Date.now() + ms);
}

// Tiny duration parser: supports "30d", "12h", "15m", "30s" or bare number (ms).
export function parseDuration(input: string): number {
  const m = /^(\d+)\s*(ms|s|m|h|d)?$/.exec(input.trim());
  if (!m) return Number(input);
  const n = Number(m[1]);
  switch (m[2]) {
    case "s": return n * 1000;
    case "m": return n * 60_000;
    case "h": return n * 3_600_000;
    case "d": return n * 86_400_000;
    case "ms":
    default: return n;
  }
}
