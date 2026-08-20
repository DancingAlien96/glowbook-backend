import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../../lib/asyncHandler.js";
import { validate } from "../../middleware/validate.js";
import { requireAuth, requireRole, requireSalon } from "../../middleware/auth.js";
import * as svc from "./appointments.service.js";
import { sendEmail } from "../../lib/email.js";
import { appointmentConfirmedTemplate } from "../../lib/emails/appointmentConfirmed.js";
import { sendPushToStylist } from "../../lib/webPush.js";
import { serviceNames } from "./appointments.service.js";

export const appointmentsRoutes = Router();
appointmentsRoutes.use(requireAuth, requireRole("OWNER"), requireSalon);

const listQuerySchema = z.object({
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  status: z.enum(["PENDING", "CONFIRMED", "COMPLETED", "CANCELLED", "NO_SHOW"]).optional(),
  stylistId: z.string().cuid().optional(),
});

const createSchema = z.object({
  serviceIds: z.array(z.string().cuid()).min(1, "Selecciona al menos un servicio"),
  stylistId: z.string().cuid().optional().nullable(),
  startAt: z.coerce.date(),
  notes: z.string().max(1000).optional().nullable(),
  // Owner-created (walk-in): name + at least ONE of {email, phone}. Without
  // a stable identifier we can't dedup the client across visits, so the
  // dueña ends up with three "María García" rows. Either channel is fine.
  client: z
    .object({
      id: z.string().cuid().optional(),
      name: z.string().min(2).max(120),
      email: z.string().email().optional().nullable(),
      phone: z.string().min(5).max(40).optional().nullable(),
    })
    .refine((c) => !!c.id || !!c.email || !!c.phone, {
      message: "Necesitamos al menos un email o un teléfono para identificar a la clienta.",
      path: ["phone"],
    }),
});

const statusSchema = z.object({
  status: z.enum(["PENDING", "CONFIRMED", "COMPLETED", "CANCELLED", "NO_SHOW"]),
});

// All fields optional so the dueña can change just date, just stylist, etc.
// without sending the full record back.
const updateSchema = z
  .object({
    serviceIds: z.array(z.string().cuid()).min(1, "Selecciona al menos un servicio").optional(),
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

    // Send confirmation email to client
    if (appointment.client.email) {
      const tpl = appointmentConfirmedTemplate({
        clientName: appointment.client.name,
        salonName: appointment.salon.name,
        salonSlug: appointment.salon.slug,
        serviceName: serviceNames(appointment),
        stylistName: appointment.stylist?.name ?? null,
        startAt: appointment.startAt,
        durationMin: appointment.durationMin,
      });
      sendEmail({ to: appointment.client.email, subject: tpl.subject, html: tpl.html, text: tpl.text });
    }

    // If the owner picked a stylist, let her know on her device.
    if (appointment.stylist?.id) {
      const when = new Date(appointment.startAt).toLocaleString("es-EC", {
        day: "numeric", month: "short", hour: "2-digit", minute: "2-digit",
      });
      void sendPushToStylist(appointment.stylist.id, {
        title: "Nueva cita asignada",
        body: `${appointment.client.name} · ${serviceNames(appointment)} · ${when}`,
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
    if (appointment.stylist?.id && (body.startAt || body.serviceIds || body.stylistId !== undefined)) {
      const when = new Date(appointment.startAt).toLocaleString("es-EC", {
        day: "numeric", month: "short", hour: "2-digit", minute: "2-digit",
      });
      void sendPushToStylist(appointment.stylist.id, {
        title: "Cita reprogramada",
        body: `${appointment.client.name} · ${serviceNames(appointment)} · ${when}`,
        url: "/me/appointments",
        tag: `booking-${appointment.id}`,
      });
    }

    res.json({ appointment });
  })
);
