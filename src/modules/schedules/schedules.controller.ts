import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../../lib/asyncHandler.js";
import { validate } from "../../middleware/validate.js";
import { requireAuth, requireSalon } from "../../middleware/auth.js";
import { prisma } from "../../lib/prisma.js";
import { NotFound } from "../../lib/errors.js";

export const schedulesRoutes = Router();
schedulesRoutes.use(requireAuth, requireSalon);

const blockSchema = z.object({
  stylistId: z.string().cuid().optional().nullable(),
  startAt: z.coerce.date(),
  endAt: z.coerce.date(),
  reason: z.string().max(255).optional().nullable(),
});

schedulesRoutes.get(
  "/blocks",
  validate(z.object({ from: z.coerce.date().optional(), to: z.coerce.date().optional() }), "query"),
  asyncHandler(async (req, res) => {
    const q = req.query as unknown as { from?: Date; to?: Date };
    const blocks = await prisma.blockedSlot.findMany({
      where: {
        salonId: req.salonId!,
        ...(q.from || q.to
          ? { startAt: { ...(q.from ? { gte: q.from } : {}), ...(q.to ? { lt: q.to } : {}) } }
          : {}),
      },
      orderBy: { startAt: "asc" },
    });
    res.json({ blocks });
  })
);

schedulesRoutes.post(
  "/blocks",
  validate(blockSchema),
  asyncHandler(async (req, res) => {
    const data = req.body as z.infer<typeof blockSchema>;
    const block = await prisma.blockedSlot.create({
      data: {
        salonId: req.salonId!,
        stylistId: data.stylistId ?? null,
        startAt: data.startAt,
        endAt: data.endAt,
        reason: data.reason ?? null,
      },
    });
    res.status(201).json({ block });
  })
);

schedulesRoutes.delete(
  "/blocks/:id",
  asyncHandler(async (req, res) => {
    const id = req.params.id!;
    const existing = await prisma.blockedSlot.findFirst({ where: { id, salonId: req.salonId! } });
    if (!existing) throw NotFound("Block not found");
    await prisma.blockedSlot.delete({ where: { id } });
    res.status(204).end();
  })
);
