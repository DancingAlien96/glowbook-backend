// Timer that reconciles pending Recurrente checkouts against the gateway.
//
// The webhook already reconciles when an event arrives, but a common real-world
// flow gets NO webhook: the automatic charge fails (no funds on the card), the
// owner tops up and pays MANUALLY days later, and nothing notifies us. This timer
// closes that gap — it independently asks Recurrente about every pending checkout
// every few minutes, so a late manual payment is detected and the salon
// reactivated on its own, usually within minutes.

import cron from "node-cron";
import { reconcilePendingCheckouts } from "../lib/paymentReconcile.js";

let running = false;

export function startPaymentReconcileJob() {
  // Every 10 minutes
  cron.schedule("*/10 * * * *", () => {
    if (running) return; // skip if a previous sweep is still in flight
    running = true;
    reconcilePendingCheckouts()
      .then((n) => {
        if (n > 0) {
          console.log(`[payment-reconcile] activated ${n} salon(s) from pending checkouts`);
        }
      })
      .catch((err) => console.error("[payment-reconcile] tick failed", err))
      .finally(() => {
        running = false;
      });
  });

  console.log("✦ Payment reconcile job scheduled (every 10 min)");
}
