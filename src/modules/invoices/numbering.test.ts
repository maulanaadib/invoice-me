// src/modules/invoices/numbering.test.ts
// Feature 04 "Check When Done" numbering cases, pure-function level:
//   - pattern INV/{CODE}/{ROMAN_MONTH}/{YYYY}/{SEQ:3} → INV/SB/VII/2026/001
//   - {MM} {DD} {YY} and {SEQ:2|4|5} zero padding
//   - reset policy MONTHLY/YEARLY/NEVER → correct sequenceKey bucketing
// The token grammar itself (validation, unknown tokens, single-SEQ rule) is
// covered by modules/profiles/number-pattern.test.ts (feature 02) — this file
// tests the engine's rendering entry points and policy math.

import { describe, expect, it } from "vitest";
import { NEVER_RESET_KEY, renderNumberPreview, sequenceKeyFor } from "@/modules/invoices/numbering";

const SB = { code: "SB", numberPattern: "INV/{CODE}/{ROMAN_MONTH}/{YYYY}/{SEQ:3}" };

describe("renderNumberPreview — spec examples", () => {
  it("INV/{CODE}/{ROMAN_MONTH}/{YYYY}/{SEQ:3} → INV/SB/VII/2026/001", () => {
    const july = new Date(2026, 6, 15); // local July 2026 → month 7
    expect(renderNumberPreview(SB, july, 1)).toBe("INV/SB/VII/2026/001");
    expect(renderNumberPreview(SB, july, 42)).toBe("INV/SB/VII/2026/042");
  });

  it("{MM}, {DD} and {YY} render zero-padded calendar parts", () => {
    const early = new Date(2026, 0, 9); // 9 Jan 2026
    const preview = renderNumberPreview(
      { code: "ABC", numberPattern: "{CODE}-{YY}{MM}{DD}-{SEQ:2}" },
      early,
      7,
    );
    expect(preview).toBe("ABC-260109-07");
  });

  it("{SEQ:2}, {SEQ:4} and {SEQ:5} pad to their width", () => {
    const date = new Date(2026, 10, 3); // November 2026
    expect(
      renderNumberPreview({ code: "X", numberPattern: "N{SEQ:2}" }, date, 5),
    ).toBe("N05");
    expect(
      renderNumberPreview({ code: "X", numberPattern: "N{SEQ:4}" }, date, 123),
    ).toBe("N0123");
    expect(
      renderNumberPreview({ code: "X", numberPattern: "N{SEQ:5}" }, date, 1234),
    ).toBe("N01234");
    // Wider than the pad width: the full number survives (never truncated).
    expect(
      renderNumberPreview({ code: "X", numberPattern: "N{SEQ:2}" }, date, 1234),
    ).toBe("N1234");
  });

  it("returns null (never throws) for a broken pattern", () => {
    expect(
      renderNumberPreview({ code: "X", numberPattern: "INV/{CODE}/{BOGUS}/{SEQ:3}" }, new Date(), 1),
    ).toBeNull();
    expect(renderNumberPreview({ code: "X", numberPattern: "INV/{CODE}" }, new Date(), 1)).toBeNull();
  });
});

describe("sequenceKeyFor — reset policies", () => {
  const july2026 = new Date(2026, 6, 15);

  it("MONTHLY buckets per year+month", () => {
    expect(sequenceKeyFor("MONTHLY", july2026)).toBe("2026-07");
    expect(sequenceKeyFor("MONTHLY", new Date(2026, 11, 31))).toBe("2026-12");
    expect(sequenceKeyFor("MONTHLY", new Date(2027, 0, 1))).toBe("2027-01");
    // Different months of the same year are different buckets → restart.
    expect(sequenceKeyFor("MONTHLY", new Date(2026, 5, 30))).not.toBe(
      sequenceKeyFor("MONTHLY", july2026),
    );
  });

  it("YEARLY buckets per year", () => {
    expect(sequenceKeyFor("YEARLY", july2026)).toBe("2026");
    expect(sequenceKeyFor("YEARLY", new Date(2026, 0, 1))).toBe("2026");
    expect(sequenceKeyFor("YEARLY", new Date(2027, 5, 15))).toBe("2027");
  });

  it("NEVER uses one global bucket", () => {
    expect(sequenceKeyFor("NEVER", july2026)).toBe(NEVER_RESET_KEY);
    expect(sequenceKeyFor("NEVER", new Date(2030, 0, 1))).toBe(NEVER_RESET_KEY);
  });

  it("MONTHLY and YEARLY keys differ, NEVER is constant", () => {
    expect(sequenceKeyFor("MONTHLY", july2026)).not.toBe(sequenceKeyFor("YEARLY", july2026));
    expect(sequenceKeyFor("NEVER", july2026)).toBe(sequenceKeyFor("NEVER", july2026));
  });
});
