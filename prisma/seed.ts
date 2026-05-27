import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  console.log("✦ Seeding Glowbook...");

  const password = await bcrypt.hash("glowbook123", 10);

  // ---- Platform settings (singleton) ----
  await prisma.platformSettings.upsert({
    where: { id: "default" },
    create: {
      id: "default",
      bankDetails:
        "Banco Pichincha · Cta. Ahorros 2200-100-200\nGlowbook S.A.S. · RUC 0999999999001\nReferencia: nombre de tu salón",
      monthlyPriceCents: 2000,
      lifetimePriceCents: 66000,
      trialDays: 14,
      graceDays: 7,
      contactEmail: "hola@glowbook.app",
      contactWhatsapp: "+593999000111",
    },
    update: {},
  });

  // ---- Super-admin (platform owner) ----
  await prisma.user.upsert({
    where: { email: "admin@glowbook.app" },
    create: {
      email: "admin@glowbook.app",
      name: "Glowbook Admin",
      passwordHash: password,
      role: "ADMIN",
      salonId: null,
    },
    update: { role: "ADMIN", passwordHash: password },
  });
  console.log("  → ADMIN   admin@glowbook.app");

  // Create or fetch the salon by slug (idempotent).
  let salon = await prisma.salon.findUnique({ where: { slug: "maison-rose" } });
  if (!salon) {
    salon = await prisma.salon.create({
      data: {
        name: "Maison Rosé",
        slug: "maison-rose",
        description: "Salón de belleza premium en el corazón de Quito.",
        timezone: "America/Guayaquil",
        currency: "USD",
        depositMode: "PERCENTAGE",
        depositPercent: 30,
        approvalMode: "MANUAL",
        bankDetails:
          "Banco Pichincha · Cta. Ahorros 2200-548-921 · Maison Rosé · RUC 0991234567001",
      },
    });
  }
  const salonId = salon.id;

  // Reset child entities so seed is idempotent for demos.
  await prisma.subscriptionPayment.deleteMany({
    where: { subscription: { salonId } },
  });
  await prisma.subscription.deleteMany({ where: { salonId } });
  await prisma.payment.deleteMany({ where: { salonId } });
  await prisma.appointment.deleteMany({ where: { salonId } });
  await prisma.blockedSlot.deleteMany({ where: { salonId } });
  await prisma.client.deleteMany({ where: { salonId } });
  await prisma.stylistService.deleteMany({ where: { stylist: { salonId } } });
  await prisma.service.deleteMany({ where: { salonId } });
  await prisma.stylist.deleteMany({ where: { salonId } });
  await prisma.businessHour.deleteMany({ where: { salonId } });
  // Clear demo users (by salon membership OR by demo email) so the seed is idempotent
  // even across schema migrations where salonId might have been reset to NULL.
  const demoEmails = [
    "isabella@maisonrose.app",
    "valentina@maisonrose.app",
    "camila@maisonrose.app",
    "sofia@maisonrose.app",
  ];
  const usersToDelete = await prisma.user.findMany({
    where: { OR: [{ salonId }, { email: { in: demoEmails } }] },
    select: { id: true },
  });
  const userIds = usersToDelete.map((u) => u.id);
  if (userIds.length > 0) {
    await prisma.refreshToken.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  }

  // Owner.
  const owner = await prisma.user.create({
    data: {
      email: "isabella@maisonrose.app",
      name: "Isabella Rojas",
      passwordHash: password,
      role: "OWNER",
      salonId,
    },
  });
  console.log(`  → OWNER  ${owner.email}`);

  // Subscription for Maison Rosé — ACTIVE with one approved payment in history
  // and one pending receipt waiting for the admin to approve.
  const sub = await prisma.subscription.create({
    data: {
      salonId,
      plan: "MONTHLY",
      status: "ACTIVE",
      currentPeriodEnd: new Date(Date.now() + 18 * 86_400_000), // 18 days from now
      trialEndsAt: new Date(Date.now() - 12 * 86_400_000), // trial ended 12 days ago
    },
  });
  await prisma.subscriptionPayment.create({
    data: {
      subscriptionId: sub.id,
      amountCents: 2000,
      periodMonths: 1,
      status: "APPROVED",
      reviewedAt: new Date(Date.now() - 10 * 86_400_000),
      reference: "TX-DEMO-001",
    },
  });
  await prisma.subscriptionPayment.create({
    data: {
      subscriptionId: sub.id,
      amountCents: 2000,
      periodMonths: 1,
      status: "PENDING_REVIEW",
      receiptUrl: "/uploads/receipts/demo-platform.jpg",
      receiptName: "transferencia-mayo.jpg",
    },
  });
  console.log("  → SUB    Maison Rosé · ACTIVE · 1 pago aprobado + 1 pendiente");

  // Business hours: Mon-Sat 9-19, Sun closed.
  await prisma.businessHour.createMany({
    data: [1, 2, 3, 4, 5, 6].map((d) => ({
      salonId,
      dayOfWeek: d,
      openMin: 9 * 60,
      closeMin: 19 * 60,
    })),
  });

  // Stylist team — each with a User login + Stylist profile.
  const stylistTeam = [
    { email: "valentina@maisonrose.app", name: "Valentina Rojas", role: "Nail artist senior · Color" },
    { email: "camila@maisonrose.app", name: "Camila Pérez", role: "Estética · Cabello" },
    { email: "sofia@maisonrose.app", name: "Sofía López", role: "Mirada · Maquillaje" },
  ];

  const stylists: { id: string; key: "val" | "cam" | "sof" }[] = [];
  for (const t of stylistTeam) {
    const user = await prisma.user.create({
      data: {
        email: t.email,
        name: t.name,
        passwordHash: password,
        role: "STYLIST",
        salonId,
      },
    });
    const stylist = await prisma.stylist.create({
      data: { salonId, userId: user.id, name: t.name, role: t.role },
    });
    const key = t.email.startsWith("val") ? "val" : t.email.startsWith("cam") ? "cam" : "sof";
    stylists.push({ id: stylist.id, key });
    console.log(`  → STYLIST ${t.email}`);
  }
  const val = stylists.find((s) => s.key === "val")!;
  const cam = stylists.find((s) => s.key === "cam")!;
  const sof = stylists.find((s) => s.key === "sof")!;

  // Services.
  const services = await prisma.$transaction([
    prisma.service.create({ data: { salonId, name: "Manicure rusa", description: "Acabado impecable, cutícula trabajada y diseño base.", durationMin: 75, priceCents: 3500, category: "Uñas" } }),
    prisma.service.create({ data: { salonId, name: "Pedicure spa", description: "Exfoliación, mascarilla hidratante y esmaltado.", durationMin: 60, priceCents: 2800, category: "Uñas" } }),
    prisma.service.create({ data: { salonId, name: "Color premium + corte", description: "Color personalizado, lavado, corte y peinado.", durationMin: 150, priceCents: 9500, category: "Cabello" } }),
    prisma.service.create({ data: { salonId, name: "Tratamiento capilar nutritivo", description: "Restauración profunda con ampollas de queratina.", durationMin: 90, priceCents: 4800, category: "Cabello" } }),
    prisma.service.create({ data: { salonId, name: "Pestañas pelo a pelo", description: "Mirada elevada y natural, técnica clásica.", durationMin: 120, priceCents: 6500, category: "Mirada" } }),
    prisma.service.create({ data: { salonId, name: "Diseño cejas + tinte", description: "Mapeo, depilación con hilo y tinte.", durationMin: 45, priceCents: 2500, category: "Mirada" } }),
    prisma.service.create({ data: { salonId, name: "Maquillaje social", description: "Look duradero para evento.", durationMin: 60, priceCents: 6000, category: "Maquillaje" } }),
  ]);

  // Map services to stylists by category.
  const byCat: Record<string, string[]> = {
    Uñas: [val.id, cam.id],
    Cabello: [val.id, cam.id],
    Mirada: [sof.id],
    Maquillaje: [sof.id, val.id],
  };
  for (const s of services) {
    const ids = byCat[s.category ?? ""] ?? [val.id];
    await prisma.stylistService.createMany({
      data: ids.map((stylistId) => ({ serviceId: s.id, stylistId })),
    });
  }

  // Clients.
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

  // Demo appointments — today + next days.
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const at = (dayOffset: number, hour: number, minute = 0) => {
    const d = new Date(today);
    d.setDate(d.getDate() + dayOffset);
    d.setHours(hour, minute, 0, 0);
    return d;
  };

  type Svc = (typeof services)[number];
  const sBy = (name: string) => services.find((s) => s.name === name) as Svc;

  const apptInputs = [
    { svc: sBy("Pestañas pelo a pelo"),   stylistId: val.id, client: clients[0], start: at(0, 10, 30), status: "CONFIRMED" as const },
    { svc: sBy("Manicure rusa"),           stylistId: cam.id, client: clients[1], start: at(0, 12, 0),  status: "PENDING"   as const },
    { svc: sBy("Color premium + corte"),   stylistId: val.id, client: clients[2], start: at(0, 13, 30), status: "CONFIRMED" as const },
    { svc: sBy("Maquillaje social"),       stylistId: sof.id, client: clients[4], start: at(0, 15, 0),  status: "CONFIRMED" as const },
    { svc: sBy("Pedicure spa"),            stylistId: cam.id, client: clients[3], start: at(0, 17, 30), status: "PENDING"   as const },
    { svc: sBy("Diseño cejas + tinte"),    stylistId: sof.id, client: clients[1], start: at(1, 11, 0),  status: "CONFIRMED" as const },
    { svc: sBy("Tratamiento capilar nutritivo"), stylistId: cam.id, client: clients[2], start: at(2, 14, 0), status: "CONFIRMED" as const },
  ];

  for (const a of apptInputs) {
    if (!a.svc || !a.client) continue;
    const endAt = new Date(a.start.getTime() + a.svc.durationMin * 60_000);
    const deposit = Math.round(a.svc.priceCents * 0.3);
    const appt = await prisma.appointment.create({
      data: {
        salonId,
        serviceId: a.svc.id,
        stylistId: a.stylistId,
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
  console.log("  Logins (todos password: glowbook123):");
  console.log("    OWNER   isabella@maisonrose.app");
  console.log("    STYLIST valentina@maisonrose.app");
  console.log("    STYLIST camila@maisonrose.app");
  console.log("    STYLIST sofia@maisonrose.app");
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
