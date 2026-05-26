import bcrypt from "bcryptjs";
import { prisma } from "../../lib/prisma.js";
import {
  signAccessToken,
  generateRefreshToken,
  hashRefreshToken,
  refreshExpiresAt,
} from "../../lib/jwt.js";
import { Conflict, Unauthorized } from "../../lib/errors.js";
import type { LoginInput, RegisterInput } from "./auth.schema.js";

type TokenContext = { userAgent?: string; ipAddress?: string };

export async function register(input: RegisterInput, ctx: TokenContext) {
  const existingUser = await prisma.user.findUnique({ where: { email: input.email } });
  if (existingUser) throw Conflict("Email is already registered");

  const existingSlug = await prisma.salon.findUnique({ where: { slug: input.salonSlug } });
  if (existingSlug) throw Conflict("Salon slug is already taken");

  const passwordHash = await bcrypt.hash(input.password, 12);

  const user = await prisma.user.create({
    data: {
      email: input.email,
      name: input.name,
      passwordHash,
      role: "OWNER",
      ownedSalon: {
        create: {
          name: input.salonName,
          slug: input.salonSlug,
        },
      },
    },
    include: { ownedSalon: { select: { id: true, slug: true, name: true } } },
  });

  return issueTokens(user.id, user.email, user.role, user.ownedSalon?.id, ctx);
}

export async function login(input: LoginInput, ctx: TokenContext) {
  const user = await prisma.user.findUnique({
    where: { email: input.email },
    include: { ownedSalon: { select: { id: true, slug: true, name: true } } },
  });
  if (!user) throw Unauthorized("Invalid email or password");

  const valid = await bcrypt.compare(input.password, user.passwordHash);
  if (!valid) throw Unauthorized("Invalid email or password");

  return issueTokens(user.id, user.email, user.role, user.ownedSalon?.id, ctx);
}

export async function refresh(rawToken: string, ctx: TokenContext) {
  const tokenHash = hashRefreshToken(rawToken);
  const existing = await prisma.refreshToken.findUnique({
    where: { tokenHash },
    include: {
      user: { include: { ownedSalon: { select: { id: true, slug: true, name: true } } } },
    },
  });

  if (!existing || existing.revokedAt || existing.expiresAt < new Date()) {
    throw Unauthorized("Refresh token invalid or expired");
  }

  // Rotate: revoke the old, issue new ones
  await prisma.refreshToken.update({
    where: { id: existing.id },
    data: { revokedAt: new Date() },
  });

  return issueTokens(
    existing.user.id,
    existing.user.email,
    existing.user.role,
    existing.user.ownedSalon?.id,
    ctx
  );
}

export async function logout(rawToken: string) {
  if (!rawToken) return;
  const tokenHash = hashRefreshToken(rawToken);
  await prisma.refreshToken
    .update({ where: { tokenHash }, data: { revokedAt: new Date() } })
    .catch(() => undefined); // ignore unknown token
}

export async function me(userId: string) {
  return prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      createdAt: true,
      ownedSalon: {
        select: { id: true, name: true, slug: true, timezone: true, currency: true },
      },
    },
  });
}

async function issueTokens(
  userId: string,
  email: string,
  role: string,
  salonId: string | undefined,
  ctx: TokenContext
) {
  const accessToken = signAccessToken({ sub: userId, email, role, salonId });
  const { token: refreshToken, hash } = generateRefreshToken();

  await prisma.refreshToken.create({
    data: {
      userId,
      tokenHash: hash,
      userAgent: ctx.userAgent?.slice(0, 255),
      ipAddress: ctx.ipAddress?.slice(0, 64),
      expiresAt: refreshExpiresAt(),
    },
  });

  return { accessToken, refreshToken, user: { id: userId, email, role, salonId } };
}
