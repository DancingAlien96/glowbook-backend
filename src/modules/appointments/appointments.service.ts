import { prisma } from "../../lib/prisma.js";
import type { AppointmentStatus, Prisma } from "@prisma/client";
import { BadRequest, Conflict, NotFound } from "../../lib/errors.js";

export async function checkConflicts(params: {
  salonId: string;
  stylistId: string | null | undefined;
  startAt: Date;
  endAt: Date;
  excludeId?: string;
}) {
  const { salonId, stylistId, startAt, endAt, excludeId } = params;

  if (endAt <= startAt) throw BadRequest("End time must be after start time");

  // Stylist overlap (if a stylist is assigned)
  if (stylistId) {
    const overlapping = await prisma.appointment.findFirst({
      where: {
        salonId,
        stylistId,
        id: excludeId ? { not: excludeId } : undefined,
        status: { in: ["PENDING", "CONFIRMED"] },
        startAt: { lt: endAt },
        endAt: { gt: startAt },
      },
      select: { id: true },
    });
    if (overlapping) throw Conflict("Stylist is not available at that time");

    const blocked = await prisma.blockedSlot.findFirst({
      where: {
        salonId,
        OR: [{ stylistId }, { stylistId: null }],
        startAt: { lt: endAt },
        endAt: { gt: startAt },
      },
      select: { id: true },
    });
    if (blocked) throw Conflict("Slot is blocked");
  } else {
    const blocked = await prisma.blockedSlot.findFirst({
      where: {
        salonId,
        stylistId: null,
        startAt: { lt: endAt },
        endAt: { gt: startAt },
      },
      select: { id: true },
    });
    if (blocked) throw Conflict("Slot is blocked");
  }
}

export type CreateAppointmentInput = {
  salonId: string;
  serviceId: string;
  stylistId?: string | null;
  client: { id?: string; name: string; email?: string | null; phone?: string | null };
  startAt: Date;
  notes?: string | null;
};

export async function createAppointment(input: CreateAppointmentInput) {
  const service = await prisma.service.findFirst({
    where: { id: input.serviceId, salonId: input.salonId, active: true },
  });
  if (!service) throw NotFound("Service not found");

  const endAt = new Date(input.startAt.getTime() + service.durationMin * 60_000);
  await checkConflicts({
    salonId: input.salonId,
    stylistId: input.stylistId ?? null,
    startAt: input.startAt,
    endAt,
  });

  const salon = await prisma.salon.findUnique({
    where: { id: input.salonId },
    select: { depositMode: true, depositPercent: true },
  });
  if (!salon) throw NotFound("Salon not found");

  const depositCents =
    salon.depositMode === "FULL"
      ? service.priceCents
      : salon.depositMode === "PERCENTAGE"
      ? Math.round((service.priceCents * salon.depositPercent) / 100)
      : 0;

  // Find or create client
  let clientId = input.client.id;
  if (!clientId) {
    if (input.client.email) {
      const existing = await prisma.client.findUnique({
        where: { salonId_email: { salonId: input.salonId, email: input.client.email } },
      });
      if (existing) clientId = existing.id;
    }
    if (!clientId) {
      const created = await prisma.client.create({
        data: {
          salonId: input.salonId,
          name: input.client.name,
          email: input.client.email ?? null,
          phone: input.client.phone ?? null,
        },
      });
      clientId = created.id;
    }
  }

  const appointment = await prisma.appointment.create({
    data: {
      salonId: input.salonId,
      serviceId: input.serviceId,
      stylistId: input.stylistId ?? null,
      clientId,
      startAt: input.startAt,
      endAt,
      durationMin: service.durationMin,
      priceCents: service.priceCents,
      depositCents,
      status: "PENDING",
      notes: input.notes ?? null,
    },
    include: { service: true, stylist: true, client: true },
  });

  return appointment;
}

export async function setStatus(salonId: string, id: string, status: AppointmentStatus) {
  const existing = await prisma.appointment.findFirst({ where: { id, salonId } });
  if (!existing) throw NotFound("Appointment not found");
  return prisma.appointment.update({ where: { id }, data: { status } });
}

export async function listAppointments(params: {
  salonId: string;
  from?: Date;
  to?: Date;
  status?: AppointmentStatus;
  stylistId?: string;
}) {
  const where: Prisma.AppointmentWhereInput = {
    salonId: params.salonId,
    ...(params.status ? { status: params.status } : {}),
    ...(params.stylistId ? { stylistId: params.stylistId } : {}),
    ...(params.from || params.to
      ? { startAt: { ...(params.from ? { gte: params.from } : {}), ...(params.to ? { lt: params.to } : {}) } }
      : {}),
  };

  return prisma.appointment.findMany({
    where,
    orderBy: { startAt: "asc" },
    include: {
      service: { select: { id: true, name: true, durationMin: true, priceCents: true } },
      stylist: { select: { id: true, name: true } },
      client: { select: { id: true, name: true, email: true, phone: true } },
      payments: { select: { id: true, status: true, amountCents: true, method: true } },
    },
  });
}
