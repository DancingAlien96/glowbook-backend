import { z } from "zod";

// Shared by salon-wide BusinessHour and per-stylist StylistHour — both use
// the exact same shape and the exact same rules, now that a day can have
// more than one range (e.g. 09:00-13:00 and 15:00-19:00 for a lunch break).
export const hourRangeSchema = z.object({
  dayOfWeek: z.number().int().min(0).max(6),
  openMin: z.number().int().min(0).max(1440),
  closeMin: z.number().int().min(0).max(1440),
});

// Ceiling of 4 ranges/day × 7 days — generous for real-world schedules
// (lunch breaks, split shifts) without letting the payload grow unbounded.
export const hoursArraySchema = z
  .array(hourRangeSchema)
  .max(28)
  .refine((hours) => hours.every((h) => h.openMin < h.closeMin), {
    message: "Cada rango debe tener una hora de cierre después de la de apertura.",
  })
  .refine(
    (hours) => {
      const byDay = new Map<number, { openMin: number; closeMin: number }[]>();
      for (const h of hours) {
        const arr = byDay.get(h.dayOfWeek) ?? [];
        arr.push(h);
        byDay.set(h.dayOfWeek, arr);
      }
      for (const ranges of byDay.values()) {
        const sorted = [...ranges].sort((a, b) => a.openMin - b.openMin);
        for (let i = 1; i < sorted.length; i++) {
          if (sorted[i]!.openMin < sorted[i - 1]!.closeMin) return false;
        }
      }
      return true;
    },
    { message: "Los rangos de un mismo día no pueden traslaparse." }
  );
