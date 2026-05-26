import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../../lib/asyncHandler.js";
import { validate } from "../../middleware/validate.js";
import { requireAuth, requireSalon } from "../../middleware/auth.js";
import * as svc from "./appointments.service.js";

export const appointmentsRoutes = Router();
appointmentsRoutes.use(requireAuth, requireSalon);

const listQuerySchema = z.object({
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  status: z.enum(["PENDING", "CONFIRMED", "COMPLETED", "CANCELLED", "NO_SHOW"]).optional(),
  stylistId: z.string().cuid().optional(),
});

const createSchema = z.object({
  serviceId: z.string().cuid(),
  stylistId: z.string().cuid().optional().nullable(),
  startAt: z.coerce.date(),
  notes: z.string().max(1000).optional().nullable(),
  client: z.object({
    id: z.string().cuid().optional(),
    name: z.string().min(2).max(120),
    email: z.string().email().optional().nullable(),
    phone: z.string().max(40).optional().nullable(),
  }),
});

const statusSchema = z.object({
  status: z.enum(["PENDING", "CONFIRMED", "COMPLETED", "CANCELLED", "NO_SHOW"]),
});

appointmentsRoutes.get(
  "/",
  validate(listQuerySchema, "query"),
  asyncHandler(async (req, res) => {
    const q = req.query as unknown as z.infer<typeof listQuerySchema>;
    const appointments = await svc.listAppointments({ salonId: req.salonId!, ...q });
    res.json({ appointments });
  })
);

appointmentsRoutes.post(
  "/",
  validate(createSchema),
  asyncHandler(async (req, res) => {
    const data = req.body as z.infer<typeof createSchema>;
    const appointment = await svc.createAppointment({
      salonId: req.salonId!,
      ...data,
    });
    res.status(201).json({ appointment });
  })
);

appointmentsRoutes.patch(
  "/:id/status",
  validate(statusSchema),
  asyncHandler(async (req, res) => {
    const { status } = req.body as z.infer<typeof statusSchema>;
    const appointment = await svc.setStatus(req.salonId!, req.params.id!, status);
    res.json({ appointment });
  })
);
