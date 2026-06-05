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

  const { user, salon } = await prisma.$transaction(async (tx) => {
    const salon = await tx.salon.create({
      data: { name: input.salonName, slug: input.salonSlug },
    });
    const user = await tx.user.create({
      data: {
        email: input.email,
        name: input.name,
        passwordHash,
        role: "OWNER",
        salonId: salon.id,
      },
    });

    const pending = await tx.pendingActivation.findUnique({ where: { email: input.email.toLowerCase() } });

    if (pending) {
      const now = new Date();
      const sub = await tx.subscription.create({
        data: {
          salonId: salon.id,
          plan: pending.plan,
          status: "ACTIVE",
          currentPeriodEnd: new Date(now.getTime() + 30 * 86_400_000),
        },
      });
      await tx.subscriptionPayment.create({
        data: {
          subscriptionId: sub.id,
          amountCents: pending.amountCents,
          periodMonths: 1,
          status: "APPROVED",
          reference: pending.reference,
          reviewedAt: now,
          reviewedBy: "recurrente-webhook",
        },
      });
      await tx.pendingActivation.delete({ where: { email: input.email.toLowerCase() } });
    } else {
      const settings = await tx.platformSettings.findUnique({ where: { id: "default" } });
      const trialDays = settings?.trialDays ?? 14;
      const trialEndsAt = new Date(Date.now() + trialDays * 86_400_000);
      await tx.subscription.create({
        data: { salonId: salon.id, plan: "MONTHLY", status: "TRIAL", trialEndsAt },
      });
    }

    return { user, salon };
  });

  return issueTokens(user.id, user.email, user.role, salon.id, ctx);
}

export async function login(input: LoginInput, ctx: TokenContext) {
  const user = await prisma.user.findUnique({
    where: { email: input.email },
    include: { salon: { select: { id: true, slug: true, name: true } } },
  });
  if (!user) throw Unauthorized("Invalid email or password");

  const valid = await bcrypt.compare(input.password, user.passwordHash);
  if (!valid) throw Unauthorized("Invalid email or password");

  return issueTokens(user.id, user.email, user.role, user.salon?.id, ctx);
}

export async function refresh(rawToken: string, ctx: TokenContext) {
  const tokenHash = hashRefreshToken(rawToken);
  const existing = await prisma.refreshToken.findUnique({
    where: { tokenHash },
    include: {
      user: { include: { salon: { select: { id: true, slug: true, name: true } } } },
    },
  });

  if (!existing || existing.revokedAt || existing.expiresAt < new Date()) {
    throw Unauthorized("Refresh token invalid or expired");
  }

  await prisma.refreshToken.update({
    where: { id: existing.id },
    data: { revokedAt: new Date() },
  });

  return issueTokens(
    existing.user.id,
    existing.user.email,
    existing.user.role,
    existing.user.salon?.id,
    ctx
  );
}

// Change the authenticated user's password.
// Verifies the current password, rotates the hash, and revokes every other
// refresh token so any other logged-in device is forced to re-authenticate.
// The caller's current refresh token is kept alive so the request that just
// changed the password doesn't sign itself out.
export async function changePassword(
  userId: string,
  input: { currentPassword: string; newPassword: string },
  keepRefreshTokenHash?: string
) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, passwordHash: true },
  });
  if (!user) throw Unauthorized("User not found");

  const ok = await bcrypt.compare(input.currentPassword, user.passwordHash);
  if (!ok) throw Unauthorized("La contraseña actual no coincide.");

  const newHash = await bcrypt.hash(input.newPassword, 12);

  await prisma.$transaction([
    prisma.user.update({ where: { id: user.id }, data: { passwordHash: newHash } }),
    prisma.refreshToken.updateMany({
      where: {
        userId: user.id,
        revokedAt: null,
        ...(keepRefreshTokenHash ? { tokenHash: { not: keepRefreshTokenHash } } : {}),
      },
      data: { revokedAt: new Date() },
    }),
  ]);
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
      salon: {
        select: { id: true, name: true, slug: true, timezone: true, currency: true },
      },
      stylist: {
        select: { id: true, role: true, active: true },
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
