// src/modules/profiles/number-pattern.test.ts
// Spec: number pattern preview (all tokens), the fixed checklist example
// INV/SB/VII/2026/001, and rejection of invalid patterns with a clear message.

import { describe, expect, it } from "vitest";
import {
  previewNumber,
  validateNumberPattern,
} from "@/modules/profiles/number-pattern";

const JULY_2026 = new Date(2026, 6, 1); // bulan indeks 6 → Juli
const ctx = { code: "SB", date: JULY_2026, nextSequence: 1 };

describe("previewNumber", () => {
  it("renders INV/SB/VII/2026/001 for the spec's default pattern in July 2026", () => {
    expect(previewNumber("INV/{CODE}/{ROMAN_MONTH}/{YYYY}/{SEQ:3}", ctx)).toBe(
      "INV/SB/VII/2026/001",
    );
  });

  it("renders every token", () => {
    expect(previewNumber("INV/{CODE}/{YY}/{MM}/{ROMAN_MONTH}/{YYYY}/{SEQ:3}", ctx)).toBe(
      "INV/SB/26/07/VII/2026/001",
    );
    expect(previewNumber("{CODE}-{YYYY}/{SEQ:2}", ctx)).toBe("SB-2026/01");
    expect(previewNumber("A/{YY}/x{MM}y/{SEQ:1}", ctx)).toBe("A/26/x07y/1");
  });

  it("renders {TYPE} from the invoice type and falls back to FULL without one", () => {
    const pattern = "INV/{CODE}/{TYPE}/{SEQ:3}";
    expect(previewNumber(pattern, { ...ctx, invoiceType: "DOWN_PAYMENT" })).toBe(
      "INV/SB/DOWN_PAYMENT/001",
    );
    expect(previewNumber(pattern, { ...ctx, invoiceType: "TERM" })).toBe("INV/SB/TERM/001");
    // Profile-settings previews carry no invoice context — a consistent
    // placeholder from the InvoiceType enum is rendered instead of a blank.
    expect(previewNumber(pattern, ctx)).toBe("INV/SB/FULL/001");
    expect(previewNumber(pattern, { ...ctx, invoiceType: "  " })).toBe("INV/SB/FULL/001");
  });

  it("pads {SEQ:n} to exactly n digits", () => {
    expect(previewNumber("N/{SEQ:1}", { ...ctx, nextSequence: 9 })).toBe("N/9");
    expect(previewNumber("N/{SEQ:3}", { ...ctx, nextSequence: 7 })).toBe("N/007");
    expect(previewNumber("N/{SEQ:5}", { ...ctx, nextSequence: 42 })).toBe("N/00042");
    expect(previewNumber("N/{SEQ:3}", { ...ctx, nextSequence: 1234 })).toBe("N/1234");
  });

  it("renders January as I (roman month edge)", () => {
    const jan = new Date(2026, 0, 15);
    expect(previewNumber("INV/{CODE}/{ROMAN_MONTH}/{YYYY}/{SEQ:2}", { ...ctx, date: jan })).toBe(
      "INV/SB/I/2026/01",
    );
  });

  it("throws a VALIDATION_ERROR for an invalid pattern", () => {
    expect(() => previewNumber("INV/{FOO}/{SEQ:3}", ctx)).toThrowError(/Token tidak dikenal/);
    expect(() => previewNumber("tanpa seq", ctx)).toThrowError(/\{SEQ:n\}/);
  });
});

describe("validateNumberPattern", () => {
  it("accepts the default pattern and free-form text around tokens", () => {
    expect(validateNumberPattern("INV/{CODE}/{ROMAN_MONTH}/{YYYY}/{SEQ:3}")).toEqual({ ok: true });
    expect(validateNumberPattern("Faktur {YYYY}/{SEQ:1} — lunas")).toEqual({ ok: true });
    expect(validateNumberPattern("INV/{CODE}/{TYPE}/{SEQ:3}")).toEqual({ ok: true });
    expect(validateNumberPattern("INV/{TYPE}/{YY}/{SEQ:2}")).toEqual({ ok: true });
  });

  it("rejects unknown tokens and lists the valid ones", () => {
    const result = validateNumberPattern("INV/{CODE}/{FOO}/{SEQ:3}");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain("{FOO}");
      expect(result.message).toContain("{ROMAN_MONTH}");
      expect(result.message).toContain("{SEQ:n}");
    }
  });

  it("rejects patterns without exactly one {SEQ:n}", () => {
    expect(validateNumberPattern("INV/{CODE}/{YYYY}").ok).toBe(false);
    const double = validateNumberPattern("{SEQ:3}/{SEQ:3}");
    expect(double.ok).toBe(false);
    if (!double.ok) expect(double.message).toContain("hanya boleh memuat satu");
  });

  it("rejects {SEQ:n} outside 1..10", () => {
    expect(validateNumberPattern("{SEQ:0}").ok).toBe(false);
    expect(validateNumberPattern("{SEQ:11}").ok).toBe(false);
    expect(validateNumberPattern("{SEQ:x}").ok).toBe(false);
  });

  it("rejects unbalanced braces, empty and oversized patterns", () => {
    const unbalanced = validateNumberPattern("INV/{CODE/{SEQ:3}");
    expect(unbalanced.ok).toBe(false);
    if (!unbalanced.ok) expect(unbalanced.message).toContain("kurung buka/tutup");

    expect(validateNumberPattern("   ").ok).toBe(false);
    expect(validateNumberPattern("x".repeat(101)).ok).toBe(false);
  });
});
