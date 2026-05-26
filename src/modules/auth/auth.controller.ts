import type { Request, Response } from "express";
import { asyncHandler } from "../../lib/asyncHandler.js";
import { validate } from "../../middleware/validate.js";
import { Unauthorized } from "../../lib/errors.js";
import { loginSchema, registerSchema } from "./auth.schema.js";
import * as auth from "./auth.service.js";
import { env } from "../../config/env.js";
import { parseDuration } from "../../lib/jwt.js";

const REFRESH_COOKIE = "gb_refresh";
const refreshCookieOptions = () => ({
  httpOnly: true,
  secure: env.NODE_ENV === "production",
  sameSite: "lax" as const,
  path: "/api/auth",
  maxAge: parseDuration(env.JWT_REFRESH_TTL),
});

function ctx(req: Request) {
  return {
    userAgent: req.headers["user-agent"]?.toString(),
    ipAddress: req.ip ?? undefined,
  };
}

function setRefreshCookie(res: Response, token: string) {
  res.cookie(REFRESH_COOKIE, token, refreshCookieOptions());
}

export const register = [
  validate(registerSchema),
  asyncHandler(async (req, res) => {
    const result = await auth.register(req.body as import("./auth.schema.js").RegisterInput, ctx(req));
    setRefreshCookie(res, result.refreshToken);
    res.status(201).json({ accessToken: result.accessToken, user: result.user });
  }),
];

export const login = [
  validate(loginSchema),
  asyncHandler(async (req, res) => {
    const result = await auth.login(req.body as import("./auth.schema.js").LoginInput, ctx(req));
    setRefreshCookie(res, result.refreshToken);
    res.json({ accessToken: result.accessToken, user: result.user });
  }),
];

export const refresh = asyncHandler(async (req, res) => {
  const cookieToken = (req.cookies?.[REFRESH_COOKIE] as string | undefined) ?? undefined;
  const body = (req.body ?? {}) as { refreshToken?: string };
  const token = cookieToken ?? body.refreshToken;
  if (!token) throw Unauthorized("Missing refresh token");

  const result = await auth.refresh(token, ctx(req));
  setRefreshCookie(res, result.refreshToken);
  res.json({ accessToken: result.accessToken, user: result.user });
});

export const logout = asyncHandler(async (req, res) => {
  const token = (req.cookies?.[REFRESH_COOKIE] as string | undefined) ?? "";
  await auth.logout(token);
  res.clearCookie(REFRESH_COOKIE, { path: "/api/auth" });
  res.status(204).end();
});

export const me = asyncHandler(async (req, res) => {
  if (!req.auth) throw Unauthorized();
  const user = await auth.me(req.auth.sub);
  res.json({ user });
});
