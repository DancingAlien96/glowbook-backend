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

const appointmentInclude = {
  services: { include: { service: true }, orderBy: { serviceId: "asc" } },
  stylist: true,
  client: true,
} as const;

// Dedup while preserving the caller's order (first pick order matters for
// nothing today, but it keeps behaviour predictable).
function dedupeIds(ids: string[]): string[] {
  return Array.from(new Set(ids));
}

export type CreateAppointmentInput = {
  salonId: string;
  serviceIds: string[];
  stylistId?: string | null;
  client: { id?: string; name: string; email?: string | null; phone?: string | null };
  startAt: Date;
  notes?: string | null;
  // Public bookings are PENDING (awaiting deposit); owner-created walk-ins are CONFIRMED.
  status?: "PENDING" | "CONFIRMED";
};

export async function createAppointment(input: CreateAppointmentInput) {
  const serviceIds = dedupeIds(input.serviceIds);
  if (serviceIds.length === 0) throw BadRequest("Select at least one service");

  const services = await prisma.service.findMany({
    where: { id: { in: serviceIds }, salonId: input.salonId, active: true },
  });
  if (services.length !== serviceIds.length) throw NotFound("Service not found");

  const durationMin = services.reduce((sum, s) => sum + s.durationMin, 0);
  const priceCents = services.reduce((sum, s) => sum + s.priceCents, 0);
  const endAt = new Date(input.startAt.getTime() + durationMin * 60_000);
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
      ? priceCents
      : salon.depositMode === "PERCENTAGE"
      ? Math.round((priceCents * salon.depositPercent) / 100)
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
    // Both sides need at least 8 digits before we trust a suffix match:
    // shorter numbers collide accidentally (a phone ending in "1234" would
    // attach the new booking to any client whose phone also ends there),
    // which is an IDOR-shaped bug — the wrong client gets credited and her
    // contact details leak into the booking confirmation.
    const MIN_MATCH_DIGITS = 8;
    if (!clientId && phoneDigits.length >= MIN_MATCH_DIGITS) {
      // `endsWith` (in either direction) covers numbers saved with/without
      // country code: 593987654321 vs 0987654321 vs 987654321.
      const candidates = await prisma.client.findMany({
        where: { salonId: input.salonId, phone: { not: null } },
        select: { id: true, phone: true },
      });
      const match = candidates.find((c) => {
        const d = (c.phone ?? "").replace(/\D/g, "");
        return (
          d.length >= MIN_MATCH_DIGITS &&
          (d === phoneDigits || d.endsWith(phoneDigits) || phoneDigits.endsWith(d))
        );
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
      stylistId: input.stylistId ?? null,
      clientId,
      startAt: input.startAt,
      endAt,
      durationMin,
      priceCents,
      depositCents,
      status: input.status ?? "PENDING",
      notes: input.notes ?? null,
      services: {
        create: services.map((s) => ({
          serviceId: s.id,
          priceCents: s.priceCents,
          durationMin: s.durationMin,
        })),
      },
    },
    include: { ...appointmentInclude, salon: { select: { name: true, slug: true } } },
  });

  return appointment;
}

export async function setStatus(salonId: string, id: string, status: AppointmentStatus) {
  const existing = await prisma.appointment.findFirst({ where: { id, salonId } });
  if (!existing) throw NotFound("Appointment not found");
  return prisma.appointment.update({ where: { id }, data: { status } });
}

export type UpdateAppointmentInput = {
  serviceIds?: string[];
  stylistId?: string | null;
  startAt?: Date;
  notes?: string | null;
};

/**
 * Owner-side edit of an existing appointment. Used when the dueña realised
 * she picked the wrong day, stylist, services, etc. Re-runs conflict checking
 * against the *new* slot but excludes the current appointment so the row
 * never collides with itself.
 *
 * If serviceIds changes we also rotate durationMin + priceCents to the sum
 * of the new services' values. depositCents intentionally stays put — the
 * deposit was already collected (or not) based on the original price and
 * the dueña shouldn't be able to retroactively change what the client paid.
 */
export async function updateAppointment(
  salonId: string,
  id: string,
  input: UpdateAppointmentInput
) {
  const existing = await prisma.appointment.findFirst({
    where: { id, salonId },
    include: appointmentInclude,
  });
  if (!existing) throw NotFound("Appointment not found");

  const existingServiceIds = existing.services.map((s) => s.serviceId).sort();
  const requestedServiceIds = input.serviceIds ? dedupeIds(input.serviceIds).sort() : null;
  const servicesChanged =
    requestedServiceIds !== null &&
    (requestedServiceIds.length !== existingServiceIds.length ||
      requestedServiceIds.some((id, i) => id !== existingServiceIds[i]));

  // Resolve target services (existing or freshly fetched if they changed).
  let services = existing.services.map((s) => s.service);
  if (servicesChanged) {
    if (requestedServiceIds!.length === 0) throw BadRequest("Select at least one service");
    const next = await prisma.service.findMany({
      where: { id: { in: requestedServiceIds! }, salonId, active: true },
    });
    if (next.length !== requestedServiceIds!.length) throw NotFound("Service not found");
    services = next;
  }

  const startAt = input.startAt ?? existing.startAt;
  const durationMin = services.reduce((sum, s) => sum + s.durationMin, 0);
  const priceCents = services.reduce((sum, s) => sum + s.priceCents, 0);
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
      stylistId,
      startAt,
      endAt,
      durationMin,
      priceCents,
      // Clearing the reminder flag so the 30-min push fires again at the
      // new startAt instead of being skipped because the old time already
      // got a reminder.
      reminderSentAt: null,
      ...(input.notes !== undefined ? { notes: input.notes } : {}),
      ...(servicesChanged
        ? {
            services: {
              deleteMany: {},
              create: services.map((s) => ({
                serviceId: s.id,
                priceCents: s.priceCents,
                durationMin: s.durationMin,
              })),
            },
          }
        : {}),
    },
    include: appointmentInclude,
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
      services: {
        include: { service: { select: { id: true, name: true, durationMin: true, priceCents: true } } },
        orderBy: { serviceId: "asc" },
      },
      stylist: { select: { id: true, name: true } },
      client: { select: { id: true, name: true, email: true, phone: true } },
      payments: { select: { id: true, status: true, amountCents: true, method: true } },
    },
  });
}

// Helper for callers (controllers, emails) that just want "Corte, Color" out
// of `appointment.services`.
export function serviceNames(appointment: { services: { service: { name: string } }[] }): string {
  return appointment.services.map((s) => s.service.name).join(", ");
}
