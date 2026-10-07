// src/lib/date.ts
// Calendar-date helpers shared by forms and services. Dates that describe a
// calendar day (reference date, start/end date) are stored as UTC midnight of
// that day — displaying them in Asia/Jakarta never crosses to a neighbours
// date, and no timezone-dependent `new Date("YYYY-MM-DD")` interpretation
// ever enters the domain.

/** "YYYY-MM-DD" → UTC midnight of that day; empty/absent → null. */
export function parseCalendarDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  return new Date(`${value}T00:00:00.000Z`);
}

/** ISO timestamp (or "YYYY-MM-DD") → "YYYY-MM-DD" for `<input type="date">`. */
export function toCalendarInput(value: string | null | undefined): string {
  if (!value) return "";
  return value.slice(0, 10);
}

/** "YYYY-MM-DD" calendar day in the business timezone (Asia/Jakarta) — the
 * date the user sees as "today" regardless of where the server runs. */
export function todayInJakarta(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Jakarta",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}
