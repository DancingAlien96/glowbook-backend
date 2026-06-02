// One-shot script that pumps demo data into Maison Rose so the dashboard
// charts have something pretty to show. Idempotent in the sense that you
// can re-run it and it just appends more bookings — but it's intended as
// a one-time call after the base seed.
//
// Usage on the Pi:
//   docker exec glowbook-pi-api npx tsx prisma/seed-analytics.ts

import { PrismaClient, AppointmentStatus, PaymentStatus, ClientTag } from "@prisma/client";

const prisma = new PrismaClient();

const SALON_SLUG = "maison-rose";

// First/last name pools so we can fabricate a bunch of clients without
// repeating ourselves.
const FIRST_NAMES = [
  "Camila", "Andrea", "Daniela", "Mariana", "Lucía", "Sofía", "Valentina",
  "Catalina", "Isabella", "Antonella", "Renata", "Emilia", "Martina",
  "Paula", "Constanza", "Fernanda", "Gabriela", "Helena", "Ivana",
  "Julia", "Karina", "Laura", "Micaela", "Natalia", "Olivia", "Patricia",
  "Romina", "Sara", "Teresa", "Victoria",
];
const LAST_NAMES = [
  "Rojas", "Pérez", "Castro", "Vargas", "Mendoza", "Reyes", "Ortiz",
  "Salazar", "Cabrera", "Morales", "Bravo", "Sanhueza", "Soto",
  "Aguilar", "Núñez", "Herrera", "Cordero", "Espinoza",
];

const STATUSES: AppointmentStatus[] = [
  // Weighted: most completed/confirmed so the charts read well.
  "COMPLETED", "COMPLETED", "COMPLETED", "COMPLETED", "COMPLETED",
  "COMPLETED", "COMPLETED", "COMPLETED",
  "CONFIRMED", "CONFIRMED",
  "PENDING",
  "CANCELLED",
  "NO_SHOW",
];

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]!;
}

function randomBetween(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

async function main() {
  console.log("✦ Pumping demo data into", SALON_SLUG);

  const salon = await prisma.salon.findUnique({
    where: { slug: SALON_SLUG },
    include: {
      services: { where: { active: true } },
      stylists: { where: { active: true } },
    },
  });
  if (!salon) {
    console.error(`Salon "${SALON_SLUG}" not found — run base seed first.`);
    process.exit(1);
  }
  if (salon.services.length === 0 || salon.stylists.length === 0) {
    console.error("Salon needs at least one active service + stylist.");
    process.exit(1);
  }

  // Assign commission % to each stylist for the new commissions report.
  // Skip if the dueña already set one (commissionPercent > 0).
  for (let i = 0; i < salon.stylists.length; i++) {
    const s = salon.stylists[i]!;
    if (s.commissionPercent === 0) {
      const next = [40, 35, 45, 30][i % 4]!;
      await prisma.stylist.update({
        where: { id: s.id },
        data: { commissionPercent: next },
      });
      console.log(`  · ${s.name} → ${next}% comisión`);
    }
  }

  // ─── Create ~25 clients spread across the last 8 months ───────────────
  // Bucket per month so the "new vs returning" chart actually splits.
  const now = new Date();
  const NEW_CLIENTS_PER_MONTH = 3; // ~3 nuevas por mes
  const TARGET_TOTAL_CLIENTS = 25;

  const existingCount = await prisma.client.count({ where: { salonId: salon.id } });
  const toCreate = Math.max(0, TARGET_TOTAL_CLIENTS - existingCount);
  const createdClients: { id: string; createdAt: Date }[] = [];

  for (let i = 0; i < toCreate; i++) {
    const monthOffset = Math.floor(i / NEW_CLIENTS_PER_MONTH);
    const monthsAgo = Math.min(monthOffset, 7);
    const createdAt = new Date(
      now.getFullYear(),
      now.getMonth() - monthsAgo,
      randomBetween(1, 27)
    );
    const first = pick(FIRST_NAMES);
    const last = pick(LAST_NAMES);
    const c = await prisma.client.create({
      data: {
        salonId: salon.id,
        name: `${first} ${last}`,
        email: `${first.toLowerCase()}.${last.toLowerCase()}${randomBetween(10, 99)}@ejemplo.com`,
        phone: `+593 99 ${randomBetween(100, 999)} ${randomBetween(1000, 9999)}`,
        tag: i % 8 === 0 ? ClientTag.VIP : i % 3 === 0 ? ClientTag.RETURNING : ClientTag.NEW,
        createdAt,
      },
    });
    createdClients.push({ id: c.id, createdAt });
  }
  console.log(`  · ${createdClients.length} clientas creadas`);

  // Refresh full client list (existing + just-created) so we sample randomly.
  const allClients = await prisma.client.findMany({
    where: { salonId: salon.id },
    select: { id: true, name: true, createdAt: true },
  });

  // ─── ~80 appointments across the last 6 months ───────────────────────
  const APPTS_PER_MONTH = [12, 16, 18, 14, 17, 20]; // 6 months back → current
  let createdAppts = 0;

  for (let monthIdx = 0; monthIdx < 6; monthIdx++) {
    const monthDate = new Date(now.getFullYear(), now.getMonth() - (5 - monthIdx), 1);
    const targetCount = APPTS_PER_MONTH[monthIdx]!;
    for (let i = 0; i < targetCount; i++) {
      const service = pick(salon.services);
      const stylist = pick(salon.stylists);
      const day = randomBetween(1, 27);
      const hour = randomBetween(9, 18);
      const minute = pick([0, 15, 30, 45]);
      const startAt = new Date(monthDate.getFullYear(), monthDate.getMonth(), day, hour, minute);
      // Past months: status weighted as defined (mostly COMPLETED). Current
      // month: mix of COMPLETED for past dates + CONFIRMED for upcoming.
      const isCurrentMonth = monthIdx === 5;
      const isPast = startAt < now;
      const status: AppointmentStatus =
        isCurrentMonth && !isPast ? (pick(["CONFIRMED", "PENDING"]) as AppointmentStatus) : pick(STATUSES);

      const endAt = new Date(startAt.getTime() + service.durationMin * 60_000);
      const client = pick(allClients);
      // Bounded retry: services + stylists overlapping at the same slot
      // throw on the unique check. Skip and try the next loop iteration.
      try {
        const appt = await prisma.appointment.create({
          data: {
            salonId: salon.id,
            serviceId: service.id,
            stylistId: stylist.id,
            clientId: client.id,
            startAt,
            endAt,
            durationMin: service.durationMin,
            priceCents: service.priceCents,
            depositCents: Math.round((service.priceCents * (salon.depositPercent ?? 30)) / 100),
            status,
            createdAt: new Date(startAt.getTime() - 86_400_000), // booked the day before
          },
        });
        createdAppts++;

        // Approved payment for completed appointments — drives both the
        // 6-month revenue chart and the "pagos por revisar" KPI not budging.
        if (status === "COMPLETED" || status === "CONFIRMED") {
          await prisma.payment.create({
            data: {
              salonId: salon.id,
              appointmentId: appt.id,
              amountCents: appt.depositCents,
              method: "TRANSFER",
              status: PaymentStatus.APPROVED,
              reference: `TR${randomBetween(100000, 999999)}`,
              reviewedAt: appt.createdAt,
              createdAt: appt.createdAt,
            },
          });
        }
      } catch {
        // Slot collided — skip, the loop will try fresh values next iteration.
      }
    }
  }
  console.log(`  · ${createdAppts} citas creadas en 6 meses`);

  // A handful of PENDING_REVIEW payments so the "Pagos por revisar" KPI is
  // visible on the dashboard.
  for (let i = 0; i < 3; i++) {
    const recent = await prisma.appointment.findFirst({
      where: { salonId: salon.id, status: "PENDING" },
      skip: i,
      orderBy: { startAt: "desc" },
    });
    if (!recent) break;
    await prisma.payment.create({
      data: {
        salonId: salon.id,
        appointmentId: recent.id,
        amountCents: recent.depositCents,
        method: "TRANSFER",
        status: PaymentStatus.PENDING_REVIEW,
        reference: `TR${randomBetween(100000, 999999)}`,
      },
    });
  }

  console.log("✦ Done. Refresh /dashboard to see the charts come alive.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
