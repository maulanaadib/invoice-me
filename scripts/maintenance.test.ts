// scripts/maintenance.test.ts — feature 11A unit tests for the overdue
// recompute selection rule (Check When Done: "Unit test overdue recompute —
// invoice tepat due_date boundary tetap ISSUED, invoice lewat jadi OVERDUE,
// invoice PAID/CANCELLED tidak tersentuh").
//
// Pure: no database, no file system — the sweep's SQL predicate is built from
// exactly these functions, so the boundary/status rules proven here are the
// rules the batch job executes.

import { describe, expect, it } from "vitest";
import { todayInJakarta } from "@/lib/date";
import {
  OVERDUE_ELIGIBLE_STATUSES,
  isOverdueCandidate,
  nextStoredStatus,
  startOfTodayJakarta,
} from "./maintenance.mjs";

// Stored dueDate is UTC midnight of the business day (same convention as the
// app: parseCalendarDate). Jakarta wall-clock hour of `now` is stated per case.
function utcDay(day: string): Date {
  return new Date(`${day}T00:00:00.000Z`);
}

// Exact Jakarta wall-clock time (Jakarta = UTC+7).
function jkt(day: string, hour: number): Date {
  const utcHour = hour - 7;
  if (utcHour >= 0) return new Date(`${day}T${String(utcHour).padStart(2, "0")}:00:00.000Z`);
  const prev = new Date(`${day}T00:00:00.000Z`);
  prev.setUTCHours(utcHour);
  return prev;
}

describe("startOfTodayJakarta", () => {
  it("agrees with the app's todayInJakarta (same calendar-day boundary)", () => {
    const now = new Date();
    expect(startOfTodayJakarta(now).toISOString().slice(0, 10)).toBe(todayInJakarta(now));
    expect(startOfTodayJakarta(now).getTime()).toBe(
      new Date(`${todayInJakarta(now)}T00:00:00.000Z`).getTime(),
    );
  });

  it("rolls the UTC midnight across the Jakarta day boundary (17:00 UTC)", () => {
    // Jakarta 2026-07-14 23:59 == UTC 2026-07-14 16:59 → still the 14th.
    expect(startOfTodayJakarta(new Date("2026-07-14T16:59:00.000Z")).toISOString()).toBe(
      "2026-07-14T00:00:00.000Z",
    );
    // Jakarta 2026-07-15 00:00 == UTC 2026-07-14 17:00 → the 15th begins.
    expect(startOfTodayJakarta(new Date("2026-07-14T17:00:00.000Z")).toISOString()).toBe(
      "2026-07-15T00:00:00.000Z",
    );
    // Early Jakarta morning is already the new day, despite the previous UTC day.
    expect(startOfTodayJakarta(jkt("2026-07-15", 6)).toISOString()).toBe(
      "2026-07-15T00:00:00.000Z",
    );
  });
});

describe("isOverdueCandidate — status filter", () => {
  const now = jkt("2026-07-15", 15);
  const past = utcDay("2026-07-14");

  it.each(OVERDUE_ELIGIBLE_STATUSES)("%s past due is a candidate", (status) => {
    expect(isOverdueCandidate({ status, dueDate: past }, now)).toBe(true);
  });

  // Spec: "invoice PAID/CANCELLED tidak tersentuh" — settled, unpublished and
  // superseded documents are never selected, however overdue their date is.
  it.each(["PAID", "CANCELLED", "DRAFT", "REVISED", "OVERDUE"])(
    "%s is never selected, even past due",
    (status) => {
      expect(isOverdueCandidate({ status, dueDate: past }, now)).toBe(false);
    },
  );

  it("an eligible status without a dueDate is not a candidate", () => {
    expect(isOverdueCandidate({ status: "ISSUED", dueDate: null }, now)).toBe(false);
  });
});

describe("isOverdueCandidate — due_date boundary", () => {
  const now = jkt("2026-07-15", 15);

  it("a due date one day before today in Jakarta IS a candidate", () => {
    expect(isOverdueCandidate({ status: "ISSUED", dueDate: utcDay("2026-07-14") }, now)).toBe(true);
  });

  it("a due date equal to today in Jakarta is NOT a candidate (stays ISSUED)", () => {
    expect(isOverdueCandidate({ status: "ISSUED", dueDate: utcDay("2026-07-15") }, now)).toBe(false);
  });

  it("a due date after today in Jakarta is NOT a candidate", () => {
    expect(isOverdueCandidate({ status: "ISSUED", dueDate: utcDay("2026-07-16") }, now)).toBe(false);
  });

  it("the comparison is strict across the whole Jakarta day", () => {
    const due = utcDay("2026-07-15");
    // First and last Jakarta instant of the due day — never overdue.
    expect(isOverdueCandidate({ status: "ISSUED", dueDate: due }, jkt("2026-07-15", 0))).toBe(false);
    expect(isOverdueCandidate({ status: "ISSUED", dueDate: due }, jkt("2026-07-15", 23))).toBe(false);
    // First instant of the next Jakarta day — overdue.
    expect(
      isOverdueCandidate({ status: "ISSUED", dueDate: due }, jkt("2026-07-16", 0)),
    ).toBe(true);
  });
});

describe("nextStoredStatus — what the sweep writes", () => {
  const now = jkt("2026-07-15", 15);
  const past = utcDay("2026-07-14");
  const today = utcDay("2026-07-15");

  it("an eligible invoice past its due date becomes OVERDUE", () => {
    expect(nextStoredStatus({ status: "ISSUED", dueDate: past }, now)).toBe("OVERDUE");
    expect(nextStoredStatus({ status: "SENT", dueDate: past }, now)).toBe("OVERDUE");
    expect(nextStoredStatus({ status: "PARTIALLY_PAID", dueDate: past }, now)).toBe("OVERDUE");
  });

  it("an invoice due today keeps its stored status (boundary stays ISSUED)", () => {
    expect(nextStoredStatus({ status: "ISSUED", dueDate: today }, now)).toBe("ISSUED");
    expect(nextStoredStatus({ status: "SENT", dueDate: today }, now)).toBe("SENT");
  });

  it("never rewrites PAID or CANCELLED (also idempotent for OVERDUE itself)", () => {
    expect(nextStoredStatus({ status: "PAID", dueDate: past }, now)).toBe("PAID");
    expect(nextStoredStatus({ status: "CANCELLED", dueDate: past }, now)).toBe("CANCELLED");
    expect(nextStoredStatus({ status: "OVERDUE", dueDate: past }, now)).toBe("OVERDUE");
  });

  it("a second application is a no-op (idempotent)", () => {
    const once = nextStoredStatus({ status: "ISSUED", dueDate: past }, now);
    expect(nextStoredStatus({ status: once, dueDate: past }, now)).toBe(once);
  });
});
