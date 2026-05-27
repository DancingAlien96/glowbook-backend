import { Router } from "express";
import { asyncHandler } from "../../lib/asyncHandler.js";
import { validate } from "../../middleware/validate.js";
import { requireAuth, requireRole, requireSalon } from "../../middleware/auth.js";
import { prisma } from "../../lib/prisma.js";
import { NotFound } from "../../lib/errors.js";
import { serviceCreateSchema, serviceUpdateSchema } from "./services.schema.js";

export const servicesRoutes = Router();

servicesRoutes.use(requireAuth, requireRole("OWNER"), requireSalon);

servicesRoutes.get(
  "/",
  asyncHandler(async (req, res) => {
    const services = await prisma.service.findMany({
      where: { salonId: req.salonId! },
      orderBy: [{ active: "desc" }, { name: "asc" }],
      include: { stylists: { select: { stylistId: true } } },
    });
    res.json({ services });
  })
);

servicesRoutes.post(
  "/",
  validate(serviceCreateSchema),
  asyncHandler(async (req, res) => {
    const { stylistIds, ...data } = req.body as import("./services.schema.js").ServiceCreateInput;
    const service = await prisma.service.create({
      data: {
        ...data,
        salonId: req.salonId!,
        active: data.active ?? true,
        stylists: stylistIds?.length
          ? { create: stylistIds.map((stylistId) => ({ stylistId })) }
          : undefined,
      },
    });
    res.status(201).json({ service });
  })
);

servicesRoutes.patch(
  "/:id",
  validate(serviceUpdateSchema),
  asyncHandler(async (req, res) => {
    const id = req.params.id!;
    const { stylistIds, ...data } = req.body as import("./services.schema.js").ServiceUpdateInput;

    const existing = await prisma.service.findFirst({ where: { id, salonId: req.salonId! } });
    if (!existing) throw NotFound("Service not found");

    const service = await prisma.$transaction(async (tx) => {
      const updated = await tx.service.update({ where: { id }, data });
      if (stylistIds) {
        await tx.stylistService.deleteMany({ where: { serviceId: id } });
        if (stylistIds.length) {
          await tx.stylistService.createMany({
            data: stylistIds.map((stylistId) => ({ serviceId: id, stylistId })),
          });
        }
      }
      return updated;
    });

    res.json({ service });
  })
);

servicesRoutes.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    const id = req.params.id!;
    const existing = await prisma.service.findFirst({ where: { id, salonId: req.salonId! } });
    if (!existing) throw NotFound("Service not found");
    await prisma.service.delete({ where: { id } });
    res.status(204).end();
  })
);
