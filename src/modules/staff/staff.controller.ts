import { Router } from "express";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { asyncHandler } from "../../lib/asyncHandler.js";
import { validate } from "../../middleware/validate.js";
import { requireAuth, requireRole, requireSalon } from "../../middleware/auth.js";
import { prisma } from "../../lib/prisma.js";
import { Conflict, NotFound, BadRequest } from "../../lib/errors.js";

export const staffRoutes = Router();

// Owner only — manages STAFF/STYLIST users plus their linked Stylist record.
staffRoutes.use(requireAuth, requireRole("OWNER"), requireSalon);

const createSchema = z.object({
  name: z.string().min(2).max(120),
  email: z.string().email().toLowerCase(),
  password: z.string().min(8).max(128),
  role: z.enum(["STYLIST", "STAFF"]).default("STYLIST"),
  stylistRole: z.string().max(128).optional().nullable(),
  serviceIds: z.array(z.string().cuid()).optional(),
});

const updateSchema = z.object({
  name: z.string().min(2).max(120).optional(),
  stylistRole: z.string().max(128).optional().nullable(),
  active: z.boolean().optional(),
  serviceIds: z.array(z.string().cuid()).optional(),
});

const resetPasswordSchema = z.object({
  password: z.string().min(8).max(128),
});

// List all team members of this salon (excluding the owner herself).
staffRoutes.get(
  "/",
  asyncHandler(async (req, res) => {
    const members = await prisma.user.findMany({
      where: { salonId: req.salonId!, role: { in: ["STYLIST", "STAFF"] } },
      orderBy: [{ role: "asc" }, { createdAt: "asc" }],
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        createdAt: true,
        stylist: {
          select: {
            id: true,
            role: true,
            active: true,
            services: { select: { serviceId: true } },
            hours: { select: { dayOfWeek: true, openMin: true, closeMin: true }, orderBy: { dayOfWeek: "asc" } },
          },
        },
      },
    });
    res.json({ members });
  })
);

// Create a new staff/stylist user + optional Stylist profile.
staffRoutes.post(
  "/",
  validate(createSchema),
  asyncHandler(async (req, res) => {
    const input = req.body as z.infer<typeof createSchema>;

    const exists = await prisma.user.findUnique({ where: { email: input.email } });
    if (exists) throw Conflict("Email is already registered");

    const passwordHash = await bcrypt.hash(input.password, 12);

    const member = await prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          name: input.name,
          email: input.email,
          passwordHash,
          role: input.role,
          salonId: req.salonId!,
        },
      });

      if (input.role === "STYLIST") {
        await tx.stylist.create({
          data: {
            salonId: req.salonId!,
            userId: user.id,
            name: input.name,
            role: input.stylistRole ?? null,
            services: input.serviceIds?.length
              ? { create: input.serviceIds.map((serviceId) => ({ serviceId })) }
              : undefined,
          },
        });
      }

      return user;
    });

    res.status(201).json({
      member: {
        id: member.id,
        name: member.name,
        email: member.email,
        role: member.role,
      },
    });
  })
);

// Update name / stylist sub-profile / services / active flag.
staffRoutes.patch(
  "/:id",
  validate(updateSchema),
  asyncHandler(async (req, res) => {
    const id = req.params.id!;
    const input = req.body as z.infer<typeof updateSchema>;

    const target = await prisma.user.findFirst({
      where: { id, salonId: req.salonId!, role: { in: ["STYLIST", "STAFF"] } },
      include: { stylist: true },
    });
    if (!target) throw NotFound("Team member not found");

    await prisma.$transaction(async (tx) => {
      if (input.name !== undefined) {
        await tx.user.update({ where: { id }, data: { name: input.name } });
      }
      if (target.stylist) {
        const stylistData: Record<string, unknown> = {};
        if (input.name !== undefined) stylistData.name = input.name;
        if (input.stylistRole !== undefined) stylistData.role = input.stylistRole;
        if (input.active !== undefined) stylistData.active = input.active;
        if (Object.keys(stylistData).length > 0) {
          await tx.stylist.update({ where: { id: target.stylist.id }, data: stylistData });
        }
        if (input.serviceIds) {
          await tx.stylistService.deleteMany({ where: { stylistId: target.stylist.id } });
          if (input.serviceIds.length) {
            await tx.stylistService.createMany({
              data: input.serviceIds.map((serviceId) => ({
                stylistId: target.stylist!.id,
                serviceId,
              })),
            });
          }
        }
      }
    });

    res.json({ ok: true });
  })
);

// Reset the user's password (the owner sets a new temporary one).
staffRoutes.post(
  "/:id/password",
  validate(resetPasswordSchema),
  asyncHandler(async (req, res) => {
    const id = req.params.id!;
    const target = await prisma.user.findFirst({
      where: { id, salonId: req.salonId!, role: { in: ["STYLIST", "STAFF"] } },
    });
    if (!target) throw NotFound("Team member not found");

    const passwordHash = await bcrypt.hash(
      (req.body as z.infer<typeof resetPasswordSchema>).password,
      12
    );
    await prisma.$transaction([
      prisma.user.update({ where: { id }, data: { passwordHash } }),
      // Invalidate all existing sessions for this user.
      prisma.refreshToken.updateMany({
        where: { userId: id, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
    ]);

    res.status(204).end();
  })
);

// Remove a team member. Keeps the Stylist record (so historic appointments stay
// attributed) but unlinks the user account.
staffRoutes.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    const id = req.params.id!;
    const target = await prisma.user.findFirst({
      where: { id, salonId: req.salonId!, role: { in: ["STYLIST", "STAFF"] } },
    });
    if (!target) throw NotFound("Team member not found");
    if (target.id === req.auth!.sub) throw BadRequest("You cannot remove yourself");

    await prisma.user.delete({ where: { id } });
    res.status(204).end();
  })
);
