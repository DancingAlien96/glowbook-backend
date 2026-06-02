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
  // Public bookings are PENDING (awaiting deposit); owner-created walk-ins are CONFIRMED.
  status?: "PENDING" | "CONFIRMED";
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

  // Find or create client. Two-pass dedup:
  //   1. Email match on the (salonId, email) compound unique index.
  //   2. Fallback: digits-only phone match — covers walk-ins who only gave
  //      a phone, and clients who switched email but keep the same WhatsApp.
  // If both miss, we create a fresh client.
  const normalizedEmail = input.client.email?.trim().toLowerCase() ?? null;
  const phoneDigits = input.client.phone?.replace(/\D/g, "") ?? "";
  let clientId = input.client.id;
  if (!clientId) {
    if (normalizedEmail) {
      const existing = await prisma.client.findUnique({
        where: { salonId_email: { salonId: input.salonId, email: normalizedEmail } },
      });
      if (existing) clientId = existing.id;
    }
    if (!clientId && phoneDigits.length >= 5) {
      // Plain `endsWith` on the digits-only normalised phone catches numbers
      // saved with/without country code (593987654321 vs 0987654321).
      const candidates = await prisma.client.findMany({
        where: { salonId: input.salonId, phone: { not: null } },
        select: { id: true, phone: true },
      });
      const match = candidates.find((c) => {
        const d = (c.phone ?? "").replace(/\D/g, "");
        return d.length >= 5 && (d === phoneDigits || d.endsWith(phoneDigits) || phoneDigits.endsWith(d));
      });
      if (match) clientId = match.id;
    }
    if (!clientId) {
      const created = await prisma.client.create({
        data: {
          salonId: input.salonId,
          name: input.client.name,
          email: normalizedEmail,
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
      status: input.status ?? "PENDING",
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

export type UpdateAppointmentInput = {
  serviceId?: string;
  stylistId?: string | null;
  startAt?: Date;
  notes?: string | null;
};

/**
 * Owner-side edit of an existing appointment. Used when the dueña realised
 * she picked the wrong day, stylist, etc. Re-runs conflict checking against
 * the *new* slot but excludes the current appointment so the row never
 * collides with itself.
 *
 * If serviceId changes we also rotate durationMin + priceCents to the new
 * service's values. depositCents intentionally stays put — the deposit was
 * already collected (or not) based on the original service price and the
 * dueña shouldn't be able to retroactively change what the client paid.
 */
export async function updateAppointment(
  salonId: string,
  id: string,
  input: UpdateAppointmentInput
) {
  const existing = await prisma.appointment.findFirst({
    where: { id, salonId },
    include: { service: true },
  });
  if (!existing) throw NotFound("Appointment not found");

  // Resolve target service (existing or freshly fetched if it changed).
  let service = existing.service;
  if (input.serviceId && input.serviceId !== existing.serviceId) {
    const next = await prisma.service.findFirst({
      where: { id: input.serviceId, salonId, active: true },
    });
    if (!next) throw NotFound("Service not found");
    service = next;
  }

  const startAt = input.startAt ?? existing.startAt;
  const durationMin = service.durationMin;
  const endAt = new Date(startAt.getTime() + durationMin * 60_000);
  const stylistId =
    input.stylistId === undefined ? existing.stylistId : input.stylistId;

  // Slot may have moved or stylist may have changed — re-validate, excluding
  // this row so it doesn't think it conflicts with itself.
  await checkConflicts({
    salonId,
    stylistId,
    startAt,
    endAt,
    excludeId: id,
  });

  const updated = await prisma.appointment.update({
    where: { id },
    data: {
      serviceId: service.id,
      stylistId,
      startAt,
      endAt,
      durationMin,
      priceCents: service.priceCents,
      // Clearing the reminder flag so the 30-min push fires again at the
      // new startAt instead of being skipped because the old time already
      // got a reminder.
      reminderSentAt: null,
      ...(input.notes !== undefined ? { notes: input.notes } : {}),
    },
    include: { service: true, stylist: true, client: true },
  });

  return updated;
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
