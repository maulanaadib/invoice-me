// src/modules/invoices/lifecycle-boundaries.test.ts
// Pure unit tests for the lifecycle status boundaries and the mandatory
// cancellation reason (feature 05).
//
// No database — these are constants and a validator shared by
// `markSent`, `cancelInvoice` and `createRevision`, so their rules must hold
// even if the callers change.
//
// Coverage gap: the existing integration files exercise these boundaries
// through the service methods (one message per test), which means the shape of
// the status arrays and the reason validator are only covered as side effects.

import { AppError } from "@/lib/errors";
import type { InvoiceStatus } from "@prisma/client";
import { describe, expect, it } from "vitest";
import {
  BILLED_STATUSES,
  countsTowardPreviouslyBilled,
} from "@/modules/invoices/billed";
import {
  CANCELABLE_STATUSES,
  CANCEL_REASON_MAX,
  OVERDUE_ELIGIBLE_STATUSES,
  REVISABLE_STATUSES,
  validateCancelReason,
} from "@/modules/invoices/lifecycle-service";

// The spec's three issued-but-unpaid statuses must stay identical across every
// gate that guards them — otherwise an invoice can be cancelled but not
// revised, or vice versa.
const UNPAID_ISSUED = ["ISSUED", "SENT", "PARTIALLY_PAID"] as const;

describe("status boundaries", () => {
  it("CANCELABLE_STATUSES are the unpaid issued statuses", () => {
    expect(CANCELABLE_STATUSES).toEqual([...UNPAID_ISSUED]);
    expect(CANCELABLE_STATUSES).toHaveLength(3);
    expect(CANCELABLE_STATUSES[0]).toBe("ISSUED");
  });

  it("REVISABLE_STATUSES are the unpaid issued statuses", () => {
    expect(REVISABLE_STATUSES).toEqual([...UNPAID_ISSUED]);
    expect(REVISABLE_STATUSES).toEqual(CANCELABLE_STATUSES);
  });

  it("OVERDUE_ELIGIBLE_STATUSES are the unpaid issued statuses", () => {
    expect(OVERDUE_ELIGIBLE_STATUSES).toEqual([...UNPAID_ISSUED]);
    expect(OVERDUE_ELIGIBLE_STATUSES).toEqual(CANCELABLE_STATUSES);
  });

  // A document that is cancelled, superseded or never issued is not a bill;
  // PAID and OVERDUE are (the work was done and the money is owed).
  it("BILLED_STATUSES count settled and unpaid issued invoices", () => {
    expect(BILLED_STATUSES).toEqual([
      "ISSUED",
      "SENT",
      "PARTIALLY_PAID",
      "PAID",
      "OVERDUE",
    ]);
    expect(BILLED_STATUSES).toHaveLength(5);
  });

  it("countsTowardPreviouslyBilled agrees with BILLED_STATUSES", () => {
    for (const status of BILLED_STATUSES) {
      expect(countsTowardPreviouslyBilled(status), status).toBe(true);
    }
    for (const status of ["DRAFT", "CANCELLED", "REVISED"] as const) {
      expect(countsTowardPreviouslyBilled(status), status).toBe(false);
    }
  });

  it("BILLED_STATUSES = the overdue-eligible statuses plus PAID (OVERDUE is already eligible)", () => {
    const billed = new Set(BILLED_STATUSES);
    for (const status of OVERDUE_ELIGIBLE_STATUSES) {
      expect(billed.has(status), status).toBe(true);
    }
    expect(billed.has("PAID")).toBe(true);
    expect(billed.has("OVERDUE")).toBe(true);
  });

  it("only DRAFT/CANCELLED/REVISED never count as billed", () => {
    const billed = new Set(BILLED_STATUSES);
    const all: InvoiceStatus[] = [
      "DRAFT",
      "ISSUED",
      "SENT",
      "PARTIALLY_PAID",
      "PAID",
      "OVERDUE",
      "CANCELLED",
      "REVISED",
    ];
    for (const status of all) {
      expect(countsTowardPreviouslyBilled(status), status).toBe(billed.has(status));
    }
    const neverBilled: InvoiceStatus[] = ["DRAFT", "CANCELLED", "REVISED"];
    expect(neverBilled.filter((s) => !billed.has(s))).toEqual([
      "DRAFT",
      "CANCELLED",
      "REVISED",
    ]);
  });

  it("the three gating arrays are identical and contain only unpaid issued statuses", () => {
    const gating = [CANCELABLE_STATUSES, REVISABLE_STATUSES, OVERDUE_ELIGIBLE_STATUSES];
    for (const list of gating) {
      expect(list).toEqual(["ISSUED", "SENT", "PARTIALLY_PAID"]);
    }
  });

  it("no status is missing from every gate (DRAFT/CANCELLED/REVISED are the only intentionally excluded ones)", () => {
    const gated = new Set([...CANCELABLE_STATUSES, ...REVISABLE_STATUSES, ...OVERDUE_ELIGIBLE_STATUSES]);
    expect([...gated].sort()).toEqual(["ISSUED", "PARTIALLY_PAID", "SENT"]);
    const neverGated: InvoiceStatus[] = ["DRAFT", "CANCELLED", "REVISED"];
    expect(neverGated.every((s) => !gated.has(s))).toBe(true);
  });
});

describe("validateCancelReason", () => {
  // The reason is mandatory: reason validation runs BEFORE the status gate, so
  // an invalid reason fails with VALIDATION_ERROR no matter the invoice state.
  it("rejects a missing reason", () => {
    expect(() => validateCancelReason(null)).toThrowError(AppError);
    expect(() => validateCancelReason(undefined)).toThrowError(AppError);
    expect(() => validateCancelReason("")).toThrowError(AppError);
  });

  it("rejects whitespace-only reasons", () => {
    for (const reason of [" ", "  ", "\t", "\n", " \t \n "]) {
      expect(() => validateCancelReason(reason)).toThrowError(
        "Alasan pembatalan wajib diisi.",
      );
    }
  });

  it("reports VALIDATION_ERROR for an empty reason", () => {
    let error: unknown;
    try {
      validateCancelReason("");
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe("VALIDATION_ERROR");
    expect((error as AppError).message).toBe("Alasan pembatalan wajib diisi.");
  });

  it("trims leading and trailing whitespace", () => {
    expect(validateCancelReason("  Saldo tidak cukup  ")).toBe("Saldo tidak cukup");
    expect(validateCancelReason("\tTerlambat kirim\t")).toBe("Terlambat kirim");
  });

  it("rejects a reason longer than CANCEL_REASON_MAX", () => {
    const tooLong = "x".repeat(CANCEL_REASON_MAX + 1);
    expect(() => validateCancelReason(tooLong)).toThrowError(
      `Alasan pembatalan maksimal ${CANCEL_REASON_MAX} karakter.`,
    );
    expect(() => validateCancelReason("  " + tooLong + "  ")).toThrowError(
      `Alasan pembatalan maksimal ${CANCEL_REASON_MAX} karakter.`,
    );
  });

  it("accepts a reason exactly at CANCEL_REASON_MAX", () => {
    const exact = "x".repeat(CANCEL_REASON_MAX);
    expect(validateCancelReason(exact)).toBe(exact);
    expect(validateCancelReason(exact).length).toBe(CANCEL_REASON_MAX);
  });

  it("returns the trimmed reason for valid input", () => {
    expect(validateCancelReason("Proyek dibatalkan")).toBe("Proyek dibatalkan");
    expect(validateCancelReason(" a ")).toBe("a");
  });

  it("preserves internal whitespace (only the ends are trimmed)", () => {
    expect(validateCancelReason("Proyek   dibatalkan")).toBe("Proyek   dibatalkan");
    expect(validateCancelReason("Proyek\tdibatalkan")).toBe("Proyek\tdibatalkan");
  });
});