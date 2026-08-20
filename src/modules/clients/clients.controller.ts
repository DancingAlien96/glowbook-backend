import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../../lib/asyncHandler.js";
import { validate } from "../../middleware/validate.js";
import { requireAuth, requireRole, requireSalon } from "../../middleware/auth.js";
import { prisma } from "../../lib/prisma.js";
import { NotFound } from "../../lib/errors.js";

export const clientsRoutes = Router();
clientsRoutes.use(requireAuth, requireRole("OWNER"), requireSalon);

const createSchema = z.object({
  name: z.string().min(2).max(120),
  email: z.string().email().optional().nullable(),
  phone: z.string().max(40).optional().nullable(),
  notes: z.string().max(2000).optional().nullable(),
  tag: z.enum(["NEW", "RETURNING", "VIP"]).optional(),
});

const querySchema = z.object({
  search: z.string().optional(),
  tag: z.enum(["NEW", "RETURNING", "VIP"]).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

clientsRoutes.get(
  "/",
  validate(querySchema, "query"),
  asyncHandler(async (req, res) => {
    const q = req.query as unknown as z.infer<typeof querySchema>;
    const where = {
      salonId: req.salonId!,
      ...(q.tag ? { tag: q.tag } : {}),
      ...(q.search
        ? {
            OR: [
              { name: { contains: q.search } },
              { email: { contains: q.search } },
              { phone: { contains: q.search } },
            ],
          }
        : {}),
    };

    const [items, total] = await Promise.all([
      prisma.client.findMany({
        where,
        orderBy: { updatedAt: "desc" },
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
        include: {
          _count: { select: { appointments: true } },
        },
      }),
      prisma.client.count({ where }),
    ]);

    res.json({
      clients: items,
      pagination: { page: q.page, pageSize: q.pageSize, total },
    });
  })
);

clientsRoutes.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const client = await prisma.client.findFirst({
      where: { id: req.params.id!, salonId: req.salonId! },
      include: {
        appointments: {
          orderBy: { startAt: "desc" },
          take: 20,
          include: { services: { include: { service: true } }, stylist: true },
        },
      },
    });
    if (!client) throw NotFound("Client not found");
    res.json({ client });
  })
);

clientsRoutes.post(
  "/",
  validate(createSchema),
  asyncHandler(async (req, res) => {
    const data = req.body as z.infer<typeof createSchema>;
    const client = await prisma.client.create({
      data: { ...data, salonId: req.salonId! },
    });
    res.status(201).json({ client });
  })
);

clientsRoutes.patch(
  "/:id",
  validate(createSchema.partial()),
  asyncHandler(async (req, res) => {
    const id = req.params.id!;
    const existing = await prisma.client.findFirst({ where: { id, salonId: req.salonId! } });
    if (!existing) throw NotFound("Client not found");
    const client = await prisma.client.update({
      where: { id },
      data: req.body as Partial<z.infer<typeof createSchema>>,
    });
    res.json({ client });
  })
);
