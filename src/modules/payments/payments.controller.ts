import { Router } from "express";
import path from "node:path";
import fs from "node:fs";
import multer from "multer";
import { nanoid } from "nanoid";
import { z } from "zod";
import { asyncHandler } from "../../lib/asyncHandler.js";
import { validate } from "../../middleware/validate.js";
import { requireAuth, requireSalon } from "../../middleware/auth.js";
import { prisma } from "../../lib/prisma.js";
import { env } from "../../config/env.js";
import { BadRequest, NotFound } from "../../lib/errors.js";

const uploadDir = path.resolve(env.UPLOAD_DIR, "receipts");
fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadDir),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).slice(0, 10);
    cb(null, `${Date.now()}-${nanoid(10)}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: env.MAX_UPLOAD_MB * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (!/^(image\/.+|application\/pdf)$/.test(file.mimetype)) {
      cb(new Error("Only images and PDFs are allowed"));
      return;
    }
    cb(null, true);
  },
});

export const paymentsRoutes = Router();
paymentsRoutes.use(requireAuth, requireSalon);

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
            service: { select: { id: true, name: true } },
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

// Public receipt upload, used by booking flow. Auth is the appointment id (issued at create time).
export const publicPaymentsRoutes = Router();

publicPaymentsRoutes.post(
  "/:appointmentId/receipt",
  upload.single("receipt"),
  asyncHandler(async (req, res) => {
    const appointmentId = req.params.appointmentId!;
    const file = req.file;
    if (!file) throw BadRequest("Receipt file is required");

    const appointment = await prisma.appointment.findUnique({
      where: { id: appointmentId },
      select: { id: true, salonId: true, depositCents: true },
    });
    if (!appointment) throw NotFound("Appointment not found");

    const receiptUrl = `/uploads/receipts/${file.filename}`;

    const payment = await prisma.payment.create({
      data: {
        salonId: appointment.salonId,
        appointmentId: appointment.id,
        amountCents: appointment.depositCents,
        method: "TRANSFER",
        status: "PENDING_REVIEW",
        receiptUrl,
        receiptName: file.originalname.slice(0, 255),
      },
    });

    res.status(201).json({ payment });
  })
);
