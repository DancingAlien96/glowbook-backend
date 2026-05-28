// 30-minute pre-appointment push reminder.
// Runs every 5 minutes. Picks up CONFIRMED appointments whose start is between
// "now+25min" and "now+35min" and whose `reminderSentAt` is still null. Marks
// them as reminded inside a single update query so the next tick can't double-fire.
import cron from "node-cron";
import { prisma } from "../lib/prisma.js";
import { sendPushToSalonOwners, sendPushToStylist, isPushConfigured } from "../lib/webPush.js";

const WINDOW_BEFORE_MS = 25 * 60_000;
const WINDOW_AFTER_MS = 35 * 60_000;

export function startReminderJob() {
  if (!isPushConfigured()) {
    console.warn("[reminders] VAPID not configured — reminder job disabled.");
    return;
  }

  // Every 5 minutes: */5 * * * *
  cron.schedule("*/5 * * * *", () => {
    runOnce().catch((err) => console.error("[reminders] tick failed", err));
  });

  console.log("✦ Reminder job scheduled (every 5 min, 30-min look-ahead)");
}

async function runOnce(): Promise<void> {
  const now = Date.now();
  const from = new Date(now + WINDOW_BEFORE_MS);
  const to = new Date(now + WINDOW_AFTER_MS);

  const due = await prisma.appointment.findMany({
    where: {
      status: "CONFIRMED",
      reminderSentAt: null,
      startAt: { gte: from, lt: to },
    },
    select: {
      id: true,
      salonId: true,
      stylistId: true,
      startAt: true,
      client: { select: { name: true } },
      service: { select: { name: true } },
    },
  });

  if (due.length === 0) return;

  for (const a of due) {
    // Mark first so a slow push doesn't race with the next tick.
    const claimed = await prisma.appointment.updateMany({
      where: { id: a.id, reminderSentAt: null },
      data: { reminderSentAt: new Date() },
    });
    if (claimed.count === 0) continue; // another tick beat us — skip.

    const when = new Date(a.startAt).toLocaleTimeString("es-EC", {
      hour: "2-digit", minute: "2-digit",
    });
    const body = `${a.client.name} · ${a.service.name} · ${when}`;

    void sendPushToSalonOwners(a.salonId, {
      title: "Cita en 30 minutos ⏰",
      body,
      url: "/dashboard/appointments",
      tag: `reminder-${a.id}`,
    });
    if (a.stylistId) {
      void sendPushToStylist(a.stylistId, {
        title: "Tu próxima cita es en 30 min ⏰",
        body,
        url: "/me/appointments",
        tag: `reminder-${a.id}`,
      });
    }
  }
}
