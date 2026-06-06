// Hourly job that sends trial expiration warning emails.
//
// Sends at three milestones (tracked per-subscription to avoid duplicates):
//   • 7 days before trialEndsAt  → trialEndingTemplate({ daysLeft: 7 })
//   • 2 days before trialEndsAt  → trialEndingTemplate({ daysLeft: 2 })
//   • after trialEndsAt          → trialExpiredTemplate()

import cron from "node-cron";
import { prisma } from "../lib/prisma.js";
import { sendEmail } from "../lib/email.js";
import { trialEndingTemplate } from "../lib/emails/trialEnding.js";
import { trialExpiredTemplate } from "../lib/emails/trialExpired.js";

export function startTrialReminderJob() {
  // Every hour at minute 0
  cron.schedule("0 * * * *", () => {
    runOnce().catch((err) => console.error("[trialReminders] tick failed", err));
  });

  console.log("✦ Trial reminder job scheduled (hourly)");
}

async function runOnce(): Promise<void> {
  const now = new Date();

  const owners = await prisma.user.findMany({
    where: {
      role: "OWNER",
      salon: { subscription: { status: "TRIAL", trialEndsAt: { not: null } } },
    },
    select: {
      name: true,
      email: true,
      salon: {
        select: {
          name: true,
          subscription: {
            select: {
              id: true,
              trialEndsAt: true,
              trial7DayEmailAt: true,
              trial2DayEmailAt: true,
              trialExpiredEmailAt: true,
            },
          },
        },
      },
    },
  });

  for (const owner of owners) {
    const sub = owner.salon?.subscription;
    if (!sub?.trialEndsAt) continue;

    const msLeft = sub.trialEndsAt.getTime() - now.getTime();
    const daysLeft = msLeft / 86_400_000;

    // ── Expired ──────────────────────────────────────────────────────────────
    if (daysLeft <= 0 && !sub.trialExpiredEmailAt) {
      await prisma.subscription.update({
        where: { id: sub.id },
        data: { trialExpiredEmailAt: now },
      });
      sendEmail({
        to: owner.email,
        ...trialExpiredTemplate({ ownerName: owner.name, salonName: owner.salon!.name }),
      });
      console.log(`[trialReminders] expired email → ${owner.email}`);
      continue;
    }

    // ── 2-day warning ────────────────────────────────────────────────────────
    if (daysLeft > 0 && daysLeft <= 2.5 && !sub.trial2DayEmailAt) {
      await prisma.subscription.update({
        where: { id: sub.id },
        data: { trial2DayEmailAt: now },
      });
      sendEmail({
        to: owner.email,
        ...trialEndingTemplate({
          ownerName: owner.name,
          salonName: owner.salon!.name,
          daysLeft: Math.ceil(daysLeft),
          trialEndsAt: sub.trialEndsAt,
        }),
      });
      console.log(`[trialReminders] 2-day warning → ${owner.email}`);
      continue;
    }

    // ── 7-day warning ────────────────────────────────────────────────────────
    if (daysLeft > 2.5 && daysLeft <= 7.5 && !sub.trial7DayEmailAt) {
      await prisma.subscription.update({
        where: { id: sub.id },
        data: { trial7DayEmailAt: now },
      });
      sendEmail({
        to: owner.email,
        ...trialEndingTemplate({
          ownerName: owner.name,
          salonName: owner.salon!.name,
          daysLeft: Math.ceil(daysLeft),
          trialEndsAt: sub.trialEndsAt,
        }),
      });
      console.log(`[trialReminders] 7-day warning → ${owner.email}`);
    }
  }
}
