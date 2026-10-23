// Timezone-aware date helpers for reporting.
//
// The server runs in UTC (no TZ in the Docker image), but a salon's "month"
// is defined by its own wall clock — an appointment at 8pm on the 31st in
// Guayaquil (UTC-5) is 1am UTC on the 1st and must NOT leak into the next
// month's report. These helpers convert between the salon's local calendar
// and UTC instants using Intl, so no extra dependency is needed.

export type LocalParts = {
  year: number;
  month: number; // 1-12
  day: number; // 1-31
  weekday: number; // 0=Mon … 6=Sun (matches the dashboard's WEEKDAYS order)
};

const WEEKDAY_INDEX: Record<string, number> = {
  Mon: 0,
  Tue: 1,
  Wed: 2,
  Thu: 3,
  Fri: 4,
  Sat: 5,
  Sun: 6,
};

const formatterCache = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let f = formatterCache.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      weekday: "short",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    formatterCache.set(timeZone, f);
  }
  return f;
}

/** Validates an IANA timezone, falling back to the given default if invalid. */
export function safeTimeZone(tz: string | null | undefined, fallback = "America/Guayaquil"): string {
  if (!tz) return fallback;
  try {
    formatterFor(tz);
    return tz;
  } catch {
    return fallback;
  }
}

type FullParts = LocalParts & { hour: number; minute: number; second: number };

function fullParts(date: Date, timeZone: string): FullParts {
  const parts: Record<string, string> = {};
  for (const p of formatterFor(timeZone).formatToParts(date)) parts[p.type] = p.value;
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    // Some engines return "24" for midnight with hourCycle h23 quirks; clamp.
    hour: Number(parts.hour) % 24,
    minute: Number(parts.minute),
    second: Number(parts.second),
    weekday: WEEKDAY_INDEX[parts.weekday ?? ""] ?? 0,
  };
}

/** Calendar parts of an instant as seen on the salon's wall clock. */
export function localParts(date: Date, timeZone: string): LocalParts {
  const { year, month, day, weekday } = fullParts(date, timeZone);
  return { year, month, day, weekday };
}

/** Offset (ms) between the zone's wall clock and UTC at the given instant. */
function offsetMs(utcMs: number, timeZone: string): number {
  const p = fullParts(new Date(utcMs), timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - utcMs;
}

/**
 * UTC instant for local midnight on the given calendar day in the zone.
 * `month` is 1-12 and may overflow (13 → January next year, 0 → December
 * previous year), mirroring Date.UTC semantics so callers can do `month + 1`.
 */
export function zonedStartOfDay(year: number, month: number, day: number, timeZone: string): Date {
  const guess = Date.UTC(year, month - 1, day, 0, 0, 0);
  let result = guess - offsetMs(guess, timeZone);
  // Re-evaluate once around DST transitions, where the first guess may have
  // used the wrong offset.
  const second = guess - offsetMs(result, timeZone);
  if (second !== result) result = second;
  return new Date(result);
}

/** YYYY-MM-DD key for an instant in the zone — handy for daily buckets. */
export function localDateKey(date: Date, timeZone: string): string {
  const p = localParts(date, timeZone);
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}

/** YYYY-MM key for an instant in the zone — handy for monthly buckets. */
export function localMonthKey(date: Date, timeZone: string): string {
  const p = localParts(date, timeZone);
  return `${p.year}-${String(p.month).padStart(2, "0")}`;
}

/** Number of days in a calendar month (month 1-12). */
export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}
