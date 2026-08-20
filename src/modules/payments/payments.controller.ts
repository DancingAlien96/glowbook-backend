import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../../lib/asyncHandler.js";
import { validate } from "../../middleware/validate.js";
import { requireAuth, requireRole, requireSalon } from "../../middleware/auth.js";
import { prisma } from "../../lib/prisma.js";
import { NotFound } from "../../lib/errors.js";
import { sendEmail } from "../../lib/email.js";
import { receiptArrivedTemplate } from "../../lib/emails/receiptArrived.js";
import { bookingConfirmedTemplate } from "../../lib/emails/bookingConfirmed.js";
import { sendPushToSalonOwners } from "../../lib/webPush.js";
import { serviceNames } from "../appointments/appointments.service.js";

export const paymentsRoutes = Router();
paymentsRoutes.use(requireAuth, requireRole("OWNER"), requireSalon);

paymentsRoutes.get(
  "/",
  asyncHandler(async (req, res) => {
    const status = req.query.status as string | undefined;
    const payments = await prisma.payment.findMany({
      where: { salonId: req.salonId!, ...(status ? { status: status as never } : {}) },
      orderBy: { createdAt: "desc" },
      include: {
        appointment: {
          include: {
            client: { select: { id: true, name: true } },
            services: { include: { service: { select: { id: true, name: true } } } },
          },
        },
      },
    });
    res.json({ payments });
  })
);

const reviewSchema = z.object({
  rejectedReason: z.string().max(255).optional(),
});

paymentsRoutes.post(
  "/:id/approve",
  asyncHandler(async (req, res) => {
    const payment = await prisma.payment.findFirst({
      where: { id: req.params.id!, salonId: req.salonId! },
    });
    if (!payment) throw NotFound("Payment not found");

    const updated = await prisma.$transaction(async (tx) => {
      const p = await tx.payment.update({
        where: { id: payment.id },
        data: { status: "APPROVED", reviewedAt: new Date(), reviewedBy: req.auth!.sub },
      });
      await tx.appointment.update({
        where: { id: payment.appointmentId },
        data: { status: "CONFIRMED" },
      });
      return p;
    });

    // Notify the client her cita está confirmada.
    const appt = await prisma.appointment.findUnique({
      where: { id: payment.appointmentId },
      select: {
        startAt: true, durationMin: true,
        salon: { select: { name: true, slug: true } },
        services: { include: { service: { select: { name: true } } } },
        stylist: { select: { name: true } },
        client: { select: { name: true, email: true } },
      },
    });
    if (appt?.client.email) {
      const tpl = bookingConfirmedTemplate({
        clientName: appt.client.name,
        salonName: appt.salon.name,
        salonSlug: appt.salon.slug,
        serviceName: serviceNames(appt),
        stylistName: appt.stylist?.name ?? null,
        startAt: appt.startAt,
        durationMin: appt.durationMin,
      });
      sendEmail({ to: appt.client.email, subject: tpl.subject, html: tpl.html, text: tpl.text });
    }

    res.json({ payment: updated });
  })
);

paymentsRoutes.post(
  "/:id/reject",
  validate(reviewSchema),
  asyncHandler(async (req, res) => {
    const { rejectedReason } = req.body as z.infer<typeof reviewSchema>;
    const payment = await prisma.payment.findFirst({
      where: { id: req.params.id!, salonId: req.salonId! },
    });
    if (!payment) throw NotFound("Payment not found");
    const updated = await prisma.payment.update({
      where: { id: payment.id },
      data: {
        status: "REJECTED",
        reviewedAt: new Date(),
        reviewedBy: req.auth!.sub,
        rejectedReason: rejectedReason ?? null,
      },
    });
    res.json({ payment: updated });
  })
);

// =====================================================================
// Public receipt registration.
// The booking flow uploads the file directly to UploadThing from the browser;
// when UploadThing returns the URL, the frontend calls this endpoint with the
// URL so we can persist a Payment record linked to the appointment.
// =====================================================================
export const publicPaymentsRoutes = Router();

const receiptSchema = z.object({
  url: z.string().url().max(500),
  name: z.string().max(255).optional(),
  reference: z.string().max(128).optional(),
});

publicPaymentsRoutes.post(
  "/:appointmentId/receipt",
  validate(receiptSchema),
  asyncHandler(async (req, res) => {
    const appointmentId = req.params.appointmentId!;
    const body = req.body as z.infer<typeof receiptSchema>;

    const appointment = await prisma.appointment.findUnique({
      where: { id: appointmentId },
      select: {
        id: true, salonId: true, depositCents: true, startAt: true,
        salon: { select: { name: true, currency: true } },
        services: { include: { service: { select: { name: true } } } },
        client: { select: { name: true } },
      },
    });
    if (!appointment) throw NotFound("Appointment not found");

    const payment = await prisma.payment.create({
      data: {
        salonId: appointment.salonId,
        appointmentId: appointment.id,
        amountCents: appointment.depositCents,
        method: "TRANSFER",
        status: "PENDING_REVIEW",
        receiptUrl: body.url,
        receiptName: body.name ?? null,
        reference: body.reference ?? null,
      },
    });

    // Notify every OWNER of the salon that a new receipt is waiting for review.
    const owners = await prisma.user.findMany({
      where: { salonId: appointment.salonId, role: "OWNER" },
      select: { email: true, name: true },
    });
    for (const owner of owners) {
      const tpl = receiptArrivedTemplate({
        ownerName: owner.name,
        salonName: appointment.salon.name,
        clientName: appointment.client.name,
        serviceName: serviceNames(appointment),
        startAt: appointment.startAt,
        amountCents: appointment.depositCents,
        currency: appointment.salon.currency,
      });
      sendEmail({ to: owner.email, subject: tpl.subject, html: tpl.html, text: tpl.text });
    }

    // Push (fire-and-forget) — owner gets the receipt notification on their device.
    void sendPushToSalonOwners(appointment.salonId, {
      title: "Comprobante por revisar",
      body: `${appointment.client.name} subió el comprobante de ${serviceNames(appointment)}.`,
      url: "/dashboard/payments",
      tag: `receipt-${payment.id}`,
      requireInteraction: true,
    });

    res.status(201).json({ payment });
  })
);
