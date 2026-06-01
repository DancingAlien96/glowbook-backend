import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../../lib/asyncHandler.js";
import { validate } from "../../middleware/validate.js";
import { requireAuth, requireRole, requireSalon } from "../../middleware/auth.js";
import * as svc from "./appointments.service.js";
import { sendPushToStylist } from "../../lib/webPush.js";

export const appointmentsRoutes = Router();
appointmentsRoutes.use(requireAuth, requireRole("OWNER"), requireSalon);

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

// All fields optional so the dueña can change just date, just stylist, etc.
// without sending the full record back.
const updateSchema = z
  .object({
    serviceId: z.string().cuid().optional(),
    stylistId: z.string().cuid().optional().nullable(),
    startAt: z.coerce.date().optional(),
    notes: z.string().max(1000).optional().nullable(),
  })
  .refine((d) => Object.keys(d).length > 0, {
    message: "Debes enviar al menos un campo para editar.",
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
    // Owner-created bookings (walk-in / phone) are confirmed immediately —
    // the client pays in person, so no online deposit is required.
    const appointment = await svc.createAppointment({
      salonId: req.salonId!,
      ...data,
      status: "CONFIRMED",
    });

    // If the owner picked a stylist, let her know on her device.
    if (appointment.stylist?.id) {
      const when = new Date(appointment.startAt).toLocaleString("es-EC", {
        day: "numeric", month: "short", hour: "2-digit", minute: "2-digit",
      });
      void sendPushToStylist(appointment.stylist.id, {
        title: "Nueva cita asignada",
        body: `${appointment.client.name} · ${appointment.service.name} · ${when}`,
        url: "/me/appointments",
        tag: `booking-${appointment.id}`,
      });
    }

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

// Edit a confirmed/pending appointment — fix wrong date, swap stylist,
// change service. Conflict checking is re-run server-side so the dueña
// can't accidentally overlap with another booking.
appointmentsRoutes.patch(
  "/:id",
  validate(updateSchema),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof updateSchema>;
    const appointment = await svc.updateAppointment(
      req.salonId!,
      req.params.id!,
      body
    );

    // If a stylist is now (or still) assigned and the time/service changed,
    // give her a heads-up push so her own calendar lines up.
    if (appointment.stylist?.id && (body.startAt || body.serviceId || body.stylistId !== undefined)) {
      const when = new Date(appointment.startAt).toLocaleString("es-EC", {
        day: "numeric", month: "short", hour: "2-digit", minute: "2-digit",
      });
      void sendPushToStylist(appointment.stylist.id, {
        title: "Cita reprogramada",
        body: `${appointment.client.name} · ${appointment.service.name} · ${when}`,
        url: "/me/appointments",
        tag: `booking-${appointment.id}`,
      });
    }

    res.json({ appointment });
  })
);
