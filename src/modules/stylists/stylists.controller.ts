import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../../lib/asyncHandler.js";
import { validate } from "../../middleware/validate.js";
import { requireAuth, requireRole, requireSalon } from "../../middleware/auth.js";
import { prisma } from "../../lib/prisma.js";
import { NotFound } from "../../lib/errors.js";

export const stylistsRoutes = Router();
stylistsRoutes.use(requireAuth, requireRole("OWNER"), requireSalon);

const createSchema = z.object({
  name: z.string().min(2).max(120),
  role: z.string().max(128).optional().nullable(),
  active: z.coerce.boolean().optional(),
  serviceIds: z.array(z.string().cuid()).optional(),
});

const updateSchema = createSchema.partial();

stylistsRoutes.get(
  "/",
  asyncHandler(async (req, res) => {
    const stylists = await prisma.stylist.findMany({
      where: { salonId: req.salonId! },
      orderBy: [{ active: "desc" }, { name: "asc" }],
      include: { services: { select: { serviceId: true } } },
    });
    res.json({ stylists });
  })
);

stylistsRoutes.post(
  "/",
  validate(createSchema),
  asyncHandler(async (req, res) => {
    const { serviceIds, ...data } = req.body as z.infer<typeof createSchema>;
    const stylist = await prisma.stylist.create({
      data: {
        ...data,
        salonId: req.salonId!,
        active: data.active ?? true,
        services: serviceIds?.length
          ? { create: serviceIds.map((serviceId) => ({ serviceId })) }
          : undefined,
      },
    });
    res.status(201).json({ stylist });
  })
);

stylistsRoutes.patch(
  "/:id",
  validate(updateSchema),
  asyncHandler(async (req, res) => {
    const id = req.params.id!;
    const { serviceIds, ...data } = req.body as z.infer<typeof updateSchema>;
    const existing = await prisma.stylist.findFirst({ where: { id, salonId: req.salonId! } });
    if (!existing) throw NotFound("Stylist not found");

    const stylist = await prisma.$transaction(async (tx) => {
      const updated = await tx.stylist.update({ where: { id }, data });
      if (serviceIds) {
        await tx.stylistService.deleteMany({ where: { stylistId: id } });
        if (serviceIds.length) {
          await tx.stylistService.createMany({
            data: serviceIds.map((serviceId) => ({ stylistId: id, serviceId })),
          });
        }
      }
      return updated;
    });

    res.json({ stylist });
  })
);

stylistsRoutes.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    const id = req.params.id!;
    const existing = await prisma.stylist.findFirst({ where: { id, salonId: req.salonId! } });
    if (!existing) throw NotFound("Stylist not found");
    await prisma.stylist.delete({ where: { id } });
    res.status(204).end();
  })
);
