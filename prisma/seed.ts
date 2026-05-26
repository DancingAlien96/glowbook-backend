import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  console.log("✦ Seeding Glowbook...");

  // Owner + Salon
  const password = await bcrypt.hash("glowbook123", 10);

  const owner = await prisma.user.upsert({
    where: { email: "isabella@maisonrose.app" },
    update: {},
    create: {
      email: "isabella@maisonrose.app",
      name: "Isabella Rojas",
      passwordHash: password,
      role: "OWNER",
      ownedSalon: {
        create: {
          name: "Maison Rosé",
          slug: "maison-rose",
          description: "Salón de belleza premium en el corazón de Quito.",
          timezone: "America/Guayaquil",
          currency: "USD",
          depositMode: "PERCENTAGE",
          depositPercent: 30,
          approvalMode: "MANUAL",
          bankDetails: "Banco Pichincha · Cta. Ahorros 2200-548-921 · Maison Rosé · RUC 0991234567001",
        },
      },
    },
    include: { ownedSalon: true },
  });

  const salonId = owner.ownedSalon!.id;
  console.log(`  → Owner ${owner.email} | Salon ${owner.ownedSalon!.slug}`);

  // Reset child entities so seed is idempotent for demos
  await prisma.payment.deleteMany({ where: { salonId } });
  await prisma.appointment.deleteMany({ where: { salonId } });
  await prisma.blockedSlot.deleteMany({ where: { salonId } });
  await prisma.client.deleteMany({ where: { salonId } });
  await prisma.stylistService.deleteMany({ where: { stylist: { salonId } } });
  await prisma.service.deleteMany({ where: { salonId } });
  await prisma.stylist.deleteMany({ where: { salonId } });
  await prisma.businessHour.deleteMany({ where: { salonId } });

  // Business hours: Mon-Sat 9-19, Sun closed
  await prisma.businessHour.createMany({
    data: [1, 2, 3, 4, 5, 6].map((d) => ({
      salonId,
      dayOfWeek: d,
      openMin: 9 * 60,
      closeMin: 19 * 60,
    })),
  });

  // Stylists
  const stylists = await prisma.$transaction([
    prisma.stylist.create({ data: { salonId, name: "Valentina Rojas", role: "Nail artist senior · Color" } }),
    prisma.stylist.create({ data: { salonId, name: "Camila Pérez", role: "Estética · Cabello" } }),
    prisma.stylist.create({ data: { salonId, name: "Sofía López", role: "Mirada · Maquillaje" } }),
  ]);
  const [val, cam, sof] = stylists;

  // Services
  const services = await prisma.$transaction([
    prisma.service.create({ data: { salonId, name: "Manicure rusa", description: "Acabado impecable, cutícula trabajada y diseño base.", durationMin: 75, priceCents: 3500, category: "Uñas" } }),
    prisma.service.create({ data: { salonId, name: "Pedicure spa", description: "Exfoliación, mascarilla hidratante y esmaltado.", durationMin: 60, priceCents: 2800, category: "Uñas" } }),
    prisma.service.create({ data: { salonId, name: "Color premium + corte", description: "Color personalizado, lavado, corte y peinado.", durationMin: 150, priceCents: 9500, category: "Cabello" } }),
    prisma.service.create({ data: { salonId, name: "Tratamiento capilar nutritivo", description: "Restauración profunda con ampollas de queratina.", durationMin: 90, priceCents: 4800, category: "Cabello" } }),
    prisma.service.create({ data: { salonId, name: "Pestañas pelo a pelo", description: "Mirada elevada y natural, técnica clásica.", durationMin: 120, priceCents: 6500, category: "Mirada" } }),
    prisma.service.create({ data: { salonId, name: "Diseño cejas + tinte", description: "Mapeo, depilación con hilo y tinte.", durationMin: 45, priceCents: 2500, category: "Mirada" } }),
    prisma.service.create({ data: { salonId, name: "Maquillaje social", description: "Look duradero para evento.", durationMin: 60, priceCents: 6000, category: "Maquillaje" } }),
  ]);

  // Map services to stylists by category
  const byCat: Record<string, string[]> = { Uñas: [val!.id, cam!.id], Cabello: [val!.id, cam!.id], Mirada: [sof!.id], Maquillaje: [sof!.id, val!.id] };
  for (const s of services) {
    const ids = byCat[s.category ?? ""] ?? [val!.id];
    await prisma.stylistService.createMany({ data: ids.map((stylistId) => ({ serviceId: s.id, stylistId })) });
  }

  // Clients
  const clientData = [
    { name: "Mariana Sosa", email: "mariana@mail.com", phone: "+593991234567", tag: "VIP" as const },
    { name: "Lucía Bravo", email: "lucia.b@mail.com", phone: "+593987654321", tag: "RETURNING" as const },
    { name: "Bianca Reyes", email: "bianca.r@mail.com", phone: "+593974568910", tag: "VIP" as const },
    { name: "Daniela Vega", email: "dani.vega@mail.com", phone: "+593963211098", tag: "NEW" as const },
    { name: "Andrea Mendoza", email: "andrea.m@mail.com", phone: "+593956543210", tag: "RETURNING" as const },
  ];
  const clients = await prisma.$transaction(
    clientData.map((c) => prisma.client.create({ data: { ...c, salonId } }))
  );

  // Demo appointments — today + next days
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const at = (dayOffset: number, hour: number, minute = 0) => {
    const d = new Date(today);
    d.setDate(d.getDate() + dayOffset);
    d.setHours(hour, minute, 0, 0);
    return d;
  };

  type Mini = (typeof services)[number];
  const sBy = (name: string) => services.find((s) => s.name === name) as Mini;

  const apptInputs = [
    { svc: sBy("Pestañas pelo a pelo"), stylist: val, client: clients[0], start: at(0, 10, 30), status: "CONFIRMED" as const },
    { svc: sBy("Manicure rusa"), stylist: cam, client: clients[1], start: at(0, 12, 0), status: "PENDING" as const },
    { svc: sBy("Color premium + corte"), stylist: val, client: clients[2], start: at(0, 13, 30), status: "CONFIRMED" as const },
    { svc: sBy("Maquillaje social"), stylist: sof, client: clients[4], start: at(0, 15, 0), status: "CONFIRMED" as const },
    { svc: sBy("Pedicure spa"), stylist: cam, client: clients[3], start: at(0, 17, 30), status: "PENDING" as const },
    { svc: sBy("Diseño cejas + tinte"), stylist: sof, client: clients[1], start: at(1, 11, 0), status: "CONFIRMED" as const },
    { svc: sBy("Tratamiento capilar nutritivo"), stylist: cam, client: clients[2], start: at(2, 14, 0), status: "CONFIRMED" as const },
  ];

  for (const a of apptInputs) {
    if (!a.svc || !a.client) continue;
    const endAt = new Date(a.start.getTime() + a.svc.durationMin * 60_000);
    const deposit = Math.round(a.svc.priceCents * 0.3);
    const appt = await prisma.appointment.create({
      data: {
        salonId,
        serviceId: a.svc.id,
        stylistId: a.stylist?.id ?? null,
        clientId: a.client.id,
        startAt: a.start,
        endAt,
        durationMin: a.svc.durationMin,
        priceCents: a.svc.priceCents,
        depositCents: deposit,
        status: a.status,
      },
    });

    if (a.status === "CONFIRMED") {
      await prisma.payment.create({
        data: {
          salonId,
          appointmentId: appt.id,
          amountCents: deposit,
          method: "TRANSFER",
          status: "APPROVED",
          reviewedAt: new Date(),
        },
      });
    } else if (a.status === "PENDING") {
      await prisma.payment.create({
        data: {
          salonId,
          appointmentId: appt.id,
          amountCents: deposit,
          method: "TRANSFER",
          status: "PENDING_REVIEW",
          receiptUrl: "/uploads/receipts/demo-receipt.jpg",
          receiptName: "comprobante-demo.jpg",
        },
      });
    }
  }

  console.log("✦ Done.");
  console.log("  Login: isabella@maisonrose.app / glowbook123");
  console.log("  Public salon: /api/public/salons/maison-rose");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
