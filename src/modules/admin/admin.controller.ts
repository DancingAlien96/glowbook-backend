import { Router } from "express";
import bcrypt from "bcryptjs";
import { randomBytes } from "node:crypto";
import { z } from "zod";
import { asyncHandler } from "../../lib/asyncHandler.js";
import { validate } from "../../middleware/validate.js";
import { requireAuth, requireRole } from "../../middleware/auth.js";
import { prisma } from "../../lib/prisma.js";
import { Conflict, NotFound } from "../../lib/errors.js";
import { applyApprovedPayment, refreshSubscriptionStatus } from "../../lib/billing.js";
import { sendEmail } from "../../lib/email.js";
import { subscriptionRenewedTemplate } from "../../lib/emails/subscriptionRenewed.js";
import { welcomeOwnerTemplate } from "../../lib/emails/welcomeOwner.js";

export const adminRoutes = Router();
adminRoutes.use(requireAuth, requireRole("ADMIN"));

// =========================
// Platform-wide settings
// =========================
adminRoutes.get(
  "/settings",
  asyncHandler(async (_req, res) => {
    const settings =
      (await prisma.platformSettings.findUnique({ where: { id: "default" } })) ??
      (await prisma.platformSettings.create({ data: { id: "default" } }));
    res.json({ settings });
  })
);

const settingsSchema = z.object({
  bankDetails: z.string().max(2000).optional().nullable(),
  monthlyPriceCents: z.coerce.number().int().min(0).optional(),
  lifetimePriceCents: z.coerce.number().int().min(0).optional(),
  trialDays: z.coerce.number().int().min(0).max(365).optional(),
  graceDays: z.coerce.number().int().min(0).max(60).optional(),
  contactEmail: z.string().email().max(160).optional().nullable(),
  contactWhatsapp: z.string().max(40).optional().nullable(),
});

adminRoutes.patch(
  "/settings",
  validate(settingsSchema),
  asyncHandler(async (req, res) => {
    const data = req.body as z.infer<typeof settingsSchema>;
    const settings = await prisma.platformSettings.upsert({
      where: { id: "default" },
      create: { id: "default", ...data },
      update: data,
    });
    res.json({ settings });
  })
);

// =========================
// Dashboard metrics
// =========================
adminRoutes.get(
  "/metrics",
  asyncHandler(async (_req, res) => {
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    const [totalSalons, activeSubs, lifetimeSubs, overdueSubs, pendingPaymentsCount, monthRevenueAgg, settings] =
      await Promise.all([
        prisma.salon.count(),
        prisma.subscription.count({ where: { status: { in: ["ACTIVE", "TRIAL"] } } }),
        prisma.subscription.count({ where: { status: "LIFETIME" } }),
        prisma.subscription.count({ where: { status: { in: ["OVERDUE", "SUSPENDED"] } } }),
        prisma.subscriptionPayment.count({ where: { status: "PENDING_REVIEW" } }),
        prisma.subscriptionPayment.aggregate({
          _sum: { amountCents: true },
          where: { status: "APPROVED", reviewedAt: { gte: startOfMonth } },
        }),
        prisma.platformSettings.findUnique({ where: { id: "default" } }),
      ]);

    const mrrCents =
      activeSubs * (settings?.monthlyPriceCents ?? 2000);

    res.json({
      metrics: {
        totalSalons,
        activeSubs,
        lifetimeSubs,
        overdueSubs,
        pendingPayments: pendingPaymentsCount,
        mrrCents,
        monthRevenueCents: monthRevenueAgg._sum.amountCents ?? 0,
      },
    });
  })
);

// =========================
// Salons (all tenants)
// =========================
adminRoutes.get(
  "/salons",
  validate(
    z.object({
      status: z.enum(["TRIAL", "ACTIVE", "OVERDUE", "SUSPENDED", "CANCELLED", "LIFETIME"]).optional(),
      search: z.string().optional(),
    }),
    "query"
  ),
  asyncHandler(async (req, res) => {
    const q = req.query as unknown as { status?: string; search?: string };
    const salons = await prisma.salon.findMany({
      where: {
        ...(q.search
          ? { OR: [{ name: { contains: q.search } }, { slug: { contains: q.search } }] }
          : {}),
        ...(q.status ? { subscription: { is: { status: q.status as never } } } : {}),
      },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        name: true,
        slug: true,
        createdAt: true,
        subscription: true,
        _count: { select: { members: true, appointments: true } },
      },
    });

    // Refresh statuses lazily on read.
    for (const s of salons) {
      if (s.subscription) s.subscription = await refreshSubscriptionStatus(s.subscription);
    }

    res.json({ salons });
  })
);

// Manual salon creation (off-platform sales, demos, in-person sign-ups).
// Creates Salon + OWNER user + Subscription in a single transaction, mirrors
// the public /auth/register logic but adds:
//   - plan choice: TRIAL (default, honours platform.trialDays) | LIFETIME
//   - optional fire-and-forget welcome email with the temp password
const slugRegex = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const createSalonSchema = z.object({
  ownerName: z.string().min(2).max(120),
  ownerEmail: z.string().email().toLowerCase(),
  ownerPassword: z.string().min(8).max(128),
  salonName: z.string().min(2).max(120),
  salonSlug: z.string().min(3).max(64).regex(slugRegex, "Slug debe ser minúsculas, números y guiones"),
  plan: z.enum(["TRIAL", "LIFETIME"]).default("TRIAL"),
  sendInvite: z.boolean().default(true),
});

adminRoutes.post(
  "/salons",
  validate(createSalonSchema),
  asyncHandler(async (req, res) => {
    const input = req.body as z.infer<typeof createSalonSchema>;

    const [existingEmail, existingSlug] = await Promise.all([
      prisma.user.findUnique({ where: { email: input.ownerEmail }, select: { id: true } }),
      prisma.salon.findUnique({ where: { slug: input.salonSlug }, select: { id: true } }),
    ]);
    if (existingEmail) throw Conflict("Ese email ya está registrado.");
    if (existingSlug) throw Conflict("Ese slug ya está en uso.");

    const passwordHash = await bcrypt.hash(input.ownerPassword, 12);

    const { salon, owner } = await prisma.$transaction(async (tx) => {
      const salon = await tx.salon.create({
        data: { name: input.salonName, slug: input.salonSlug },
      });
      const owner = await tx.user.create({
        data: {
          email: input.ownerEmail,
          name: input.ownerName,
          passwordHash,
          role: "OWNER",
          salonId: salon.id,
        },
      });

      if (input.plan === "LIFETIME") {
        await tx.subscription.create({
          data: {
            salonId: salon.id,
            plan: "LIFETIME",
            status: "LIFETIME",
            currentPeriodEnd: null,
            trialEndsAt: null,
          },
        });
      } else {
        const settings = await tx.platformSettings.findUnique({ where: { id: "default" } });
        const trialDays = settings?.trialDays ?? 14;
        const trialEndsAt = new Date(Date.now() + trialDays * 86_400_000);
        await tx.subscription.create({
          data: { salonId: salon.id, plan: "MONTHLY", status: "TRIAL", trialEndsAt },
        });
      }

      return { salon, owner };
    });

    // Welcome email — fire and forget. Skipped if RESEND_API_KEY is unset.
    if (input.sendInvite) {
      const tpl = welcomeOwnerTemplate({
        ownerName: owner.name,
        ownerEmail: owner.email,
        salonName: salon.name,
        salonSlug: salon.slug,
        tempPassword: input.ownerPassword,
        plan: input.plan,
      });
      sendEmail({ to: owner.email, subject: tpl.subject, html: tpl.html, text: tpl.text });
    }

    res.status(201).json({
      salon: {
        id: salon.id,
        name: salon.name,
        slug: salon.slug,
        createdAt: salon.createdAt,
      },
      owner: {
        id: owner.id,
        name: owner.name,
        email: owner.email,
      },
    });
  })
);

// Single salon detail — everything an admin might need at a glance:
// salon info, current subscription, member list (owners + stylists), counts.
adminRoutes.get(
  "/salons/:id",
  asyncHandler(async (req, res) => {
    const salon = await prisma.salon.findUnique({
      where: { id: req.params.id! },
      select: {
        id: true, name: true, slug: true, tagline: true,
        coverImageUrl: true, brandColor: true,
        timezone: true, currency: true,
        depositMode: true, depositPercent: true,
        bankDetails: true, createdAt: true,
        subscription: true,
        members: {
          orderBy: [{ role: "asc" }, { createdAt: "asc" }],
          select: {
            id: true, name: true, email: true, role: true, createdAt: true,
            stylist: { select: { id: true, active: true, role: true } },
          },
        },
        _count: {
          select: { appointments: true, services: true, stylists: true, clients: true },
        },
      },
    });
    if (!salon) throw NotFound("Salon not found");
    if (salon.subscription) {
      salon.subscription = await refreshSubscriptionStatus(salon.subscription);
    }
    res.json({ salon });
  })
);

// Resets a user's password. Returns the new plaintext password ONCE so the
// admin can pass it to the owner manually. The hash is rotated and every
// other refresh token for that user is revoked, forcing logout elsewhere.
// ADMIN cannot be reset through this endpoint to avoid lockouts.
function generateTempPassword(): string {
  // Ambiguous chars (0/O, 1/l/I) stripped so the dueña can read the
  // password aloud over the phone without confusion.
  const chars = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = randomBytes(14);
  let p = "";
  for (let i = 0; i < bytes.length; i++) p += chars[bytes[i]! % chars.length];
  return p + "!2";
}

adminRoutes.post(
  "/users/:id/reset-password",
  asyncHandler(async (req, res) => {
    const user = await prisma.user.findUnique({
      where: { id: req.params.id! },
      select: { id: true, email: true, name: true, role: true },
    });
    if (!user) throw NotFound("User not found");
    if (user.role === "ADMIN") throw new Error("Cannot reset another admin's password through this endpoint.");

    const newPassword = await generateTempPassword();
    const hash = await bcrypt.hash(newPassword, 12);

    await prisma.$transaction([
      prisma.user.update({ where: { id: user.id }, data: { passwordHash: hash } }),
      prisma.refreshToken.updateMany({
        where: { userId: user.id, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
    ]);

    res.json({
      newPassword,
      user: { id: user.id, email: user.email, name: user.name },
    });
  })
);

// =========================
// Subscription payments (pending receipts)
// =========================
adminRoutes.get(
  "/payments",
  validate(
    z.object({
      status: z.enum(["PENDING_REVIEW", "APPROVED", "REJECTED"]).optional(),
    }),
    "query"
  ),
  asyncHandler(async (req, res) => {
    const q = req.query as unknown as { status?: string };
    const payments = await prisma.subscriptionPayment.findMany({
      where: { ...(q.status ? { status: q.status as never } : {}) },
      orderBy: { createdAt: "desc" },
      include: {
        subscription: {
          include: {
            salon: { select: { id: true, name: true, slug: true } },
          },
        },
      },
    });
    res.json({ payments });
  })
);

adminRoutes.post(
  "/payments/:id/approve",
  asyncHandler(async (req, res) => {
    const payment = await prisma.subscriptionPayment.findUnique({
      where: { id: req.params.id! },
      include: { subscription: true },
    });
    if (!payment) throw NotFound("Payment not found");

    const updated = await prisma.$transaction(async (tx) => {
      const p = await tx.subscriptionPayment.update({
        where: { id: payment.id },
        data: { status: "APPROVED", reviewedAt: new Date(), reviewedBy: req.auth!.sub },
      });
      return p;
    });

    const refreshedSub = await applyApprovedPayment({
      subscriptionId: payment.subscriptionId,
      periodMonths: payment.periodMonths,
      plan: payment.periodMonths >= 999 ? "LIFETIME" : "MONTHLY",
    });

    // Notify every OWNER of that salon that their plan was renewed.
    const owners = await prisma.user.findMany({
      where: { salonId: payment.subscription.salonId, role: "OWNER" },
      select: { email: true, name: true },
    });
    const salon = await prisma.salon.findUnique({
      where: { id: payment.subscription.salonId },
      select: { name: true, currency: true },
    });
    for (const owner of owners) {
      const tpl = subscriptionRenewedTemplate({
        ownerName: owner.name,
        salonName: salon?.name ?? "tu salón",
        plan: payment.periodMonths >= 999 ? "LIFETIME" : "MONTHLY",
        periodMonths: payment.periodMonths,
        amountCents: payment.amountCents,
        currency: salon?.currency ?? "USD",
        newPeriodEnd: refreshedSub.currentPeriodEnd,
      });
      sendEmail({ to: owner.email, subject: tpl.subject, html: tpl.html, text: tpl.text });
    }

    res.json({ payment: updated });
  })
);

adminRoutes.post(
  "/payments/:id/reject",
  validate(z.object({ rejectedReason: z.string().max(255).optional() })),
  asyncHandler(async (req, res) => {
    const payment = await prisma.subscriptionPayment.findUnique({ where: { id: req.params.id! } });
    if (!payment) throw NotFound("Payment not found");

    const updated = await prisma.subscriptionPayment.update({
      where: { id: payment.id },
      data: {
        status: "REJECTED",
        reviewedAt: new Date(),
        reviewedBy: req.auth!.sub,
        rejectedReason: (req.body as { rejectedReason?: string }).rejectedReason ?? null,
      },
    });
    res.json({ payment: updated });
  })
);
