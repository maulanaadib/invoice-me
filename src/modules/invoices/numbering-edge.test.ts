// src/modules/invoices/numbering-edge.test.ts
// Independent edge-case pass over the numbering engine (feature 04) — pure
// level only. Gaps the feature-spec test file leaves open:
//
//   • the {TYPE} token through renderNumberPreview (the invoice-level token;
//     the engine does NOT carry the invoice type, so it must fall back to the
//     documented DEFAULT_INVOICE_TYPE_TOKEN and never render blank)
//   • {DD}/{MM}/{ROMAN_MONTH} at the true calendar edges (last day, single
//     digit day, December roman, year rollover) — a bucket key and its date
//     tokens must never disagree
//   • sequenceKeyFor consistency with the tokens rendered from the same date
//     (a MONTHLY key "2026-07" must always come with {ROMAN_MONTH} VII)
//   • {SEQ:1} and {SEQ:10} widths (spec names 2|3|4|5; the engine's grammar
//     is the shared one, so those must behave too)
//   • renderNumberPreview returning null (never throwing) for every broken
//     pattern shape, including multiple {SEQ:n} tokens
//   • a pattern that would produce a DUPLICATE rendered string under two
//     different sequence values (padding must not truncate)

import { describe, expect, it } from "vitest";
import {
  NEVER_RESET_KEY,
  renderNumberPreview,
  sequenceKeyFor,
} from "@/modules/invoices/numbering";

describe("{TYPE} token through the engine", () => {
  it("falls back to FULL (never blank) because the engine carries no invoice type", () => {
    // renderNumberPreview has no invoiceType parameter — the number-pattern
    // module supplies DEFAULT_INVOICE_TYPE_TOKEN so the document never shows
    // an empty segment.
    expect(
      renderNumberPreview({ code: "SB", numberPattern: "INV/{TYPE}/{YYYY}/{SEQ:3}" }, new Date(2026, 6, 1), 1),
    ).toBe("INV/FULL/2026/001");
  });

  it("renders the type alongside every other token", () => {
    expect(
      renderNumberPreview(
        { code: "AD", numberPattern: "{CODE}/{TYPE}/{YYYY}/{MM}/{SEQ:4}" },
        new Date(2026, 0, 5),
        42,
      ),
    ).toBe("AD/FULL/2026/01/0042");
  });
});

describe("Calendar edges — date tokens", () => {
  /** The roman numeral the engine must render for a month — asserted from an
   * independent table here so a regression in the engine's date reading cannot
   * hide behind a shared constant. */
  const ROMAN = [
    "I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X", "XI", "XII",
  ];

  it("renders the LAST day of a month without rolling into the next", () => {
    const newYear = new Date(2026, 11, 31, 23, 59, 59);
    expect(
      renderNumberPreview(
        { code: "X", numberPattern: "{YYYY}{MM}{DD}/{SEQ:3}" },
        newYear,
        7,
      ),
    ).toBe("20261231/007");
    expect(sequenceKeyFor("MONTHLY", newYear)).toBe("2026-12");
  });

  it("renders a single-digit day zero-padded", () => {
    expect(
      renderNumberPreview({ code: "X", numberPattern: "D{DD}/{SEQ:2}" }, new Date(2026, 1, 3), 4),
    ).toBe("D03/04");
  });

  it("renders December as XII and January as I", () => {
    expect(
      renderNumberPreview(
        { code: "X", numberPattern: "{ROMAN_MONTH}/{SEQ:1}" },
        new Date(2026, 11, 1),
        1,
      ),
    ).toBe("XII/1");
    expect(
      renderNumberPreview(
        { code: "X", numberPattern: "{ROMAN_MONTH}/{SEQ:1}" },
        new Date(2026, 0, 1),
        1,
      ),
    ).toBe("I/1");
  });

  it("{YY} pads a two-digit year and {YYYY} does not", () => {
    const early = new Date(2026, 0, 9);
    expect(
      renderNumberPreview({ code: "X", numberPattern: "{YY}/{SEQ:1}" }, early, 1),
    ).toBe("26/1");
    expect(
      renderNumberPreview({ code: "X", numberPattern: "{YYYY}/{SEQ:1}" }, early, 1),
    ).toBe("2026/1");
  });

  it("a MONTHLY bucket key always matches the rendered {ROMAN_MONTH}/{MM}", () => {
    // The invariant that keeps a bucket from being mislabeled: the policy key
    // and the date tokens are read from the same Date object.
    for (const zeroBasedMonth of [0, 5, 6, 11]) {
      const date = new Date(2027, zeroBasedMonth, 15);
      const preview = renderNumberPreview(
        { code: "X", numberPattern: "{ROMAN_MONTH}/{YYYY}-{MM}/{SEQ:1}" },
        date,
        1,
      )!;
      const key = sequenceKeyFor("MONTHLY", date); // "2027-01"
      const monthNumber = Number(key.slice(5)); // 1
      // pattern {ROMAN_MONTH}/{YYYY}-{MM}/{SEQ:1} → "I/2027-01/1": the roman
      // numeral and the "YYYY-MM" bucket must spell the same month.
      expect(preview).toBe(`${ROMAN[monthNumber - 1]}/${key}/1`);
    }
  });
});

describe("Sequence width edges", () => {
  it("{SEQ:1} renders a single digit without padding", () => {
    expect(renderNumberPreview({ code: "X", numberPattern: "N{SEQ:1}" }, new Date(), 7)).toBe("N7");
  });

  it("{SEQ:10} pads to the full ten-digit width", () => {
    expect(
      renderNumberPreview({ code: "X", numberPattern: "N{SEQ:10}" }, new Date(), 42),
    ).toBe("N0000000042");
  });

  it("a sequence BEYOND the pad width is never truncated (no duplicate numbers)", () => {
    // {SEQ:2} with 1000 must render "1000", not "00" — a truncation here would
    // silently produce a duplicate document number.
    expect(renderNumberPreview({ code: "X", numberPattern: "N{SEQ:2}" }, new Date(), 1000)).toBe(
      "N1000",
    );
  });

  it("two different sequence values always render different strings", () => {
    const pattern = "INV/{CODE}/{YYYY}/{SEQ:4}";
    const profile = { code: "SB", numberPattern: pattern };
    const a = renderNumberPreview(profile, new Date(2026, 6, 1), 123);
    const b = renderNumberPreview(profile, new Date(2026, 6, 1), 124);
    expect(a).toBe("INV/SB/2026/0123");
    expect(b).toBe("INV/SB/2026/0124");
    expect(a).not.toBe(b);
  });
});

describe("Broken patterns — null, never throw", () => {
  it("nulls a pattern with MORE THAN ONE {SEQ:n} token", () => {
    // Two sequence tokens would be ambiguous and are rejected by the shared
    // validator; the editor shows "—" instead of a wrong number.
    expect(
      renderNumberPreview({ code: "X", numberPattern: "INV/{SEQ:3}/{SEQ:4}" }, new Date(), 1),
    ).toBeNull();
  });

  it("nulls a pattern with an unfinished brace and with an empty pattern", () => {
    expect(
      renderNumberPreview({ code: "X", numberPattern: "INV/{CODE" }, new Date(), 1),
    ).toBeNull();
    expect(renderNumberPreview({ code: "X", numberPattern: "   " }, new Date(), 1)).toBeNull();
  });

  it("nulls an out-of-range {SEQ:0} / {SEQ:11} width", () => {
    expect(renderNumberPreview({ code: "X", numberPattern: "N{SEQ:0}" }, new Date(), 1)).toBeNull();
    expect(renderNumberPreview({ code: "X", numberPattern: "N{SEQ:11}" }, new Date(), 1)).toBeNull();
  });

  it("nulls an unknown token even when a valid {SEQ:n} is present", () => {
    expect(
      renderNumberPreview({ code: "X", numberPattern: "{CODE}/{BOGUS}/{SEQ:3}" }, new Date(), 1),
    ).toBeNull();
  });
});

describe("sequenceKeyFor — reset policy bucketing", () => {
  it("NEVER ignores the date entirely (one global counter across years)", () => {
    const a = new Date(2026, 0, 1);
    const b = new Date(2099, 11, 31);
    expect(sequenceKeyFor("NEVER", a)).toBe(NEVER_RESET_KEY);
    expect(sequenceKeyFor("NEVER", a)).toBe(sequenceKeyFor("NEVER", b));
  });

  it("MONTHLY restarts on the first day of the next month", () => {
    const june = new Date(2026, 5, 30);
    const july = new Date(2026, 6, 1);
    expect(sequenceKeyFor("MONTHLY", june)).toBe("2026-06");
    expect(sequenceKeyFor("MONTHLY", july)).toBe("2026-07");
    expect(sequenceKeyFor("MONTHLY", june)).not.toBe(sequenceKeyFor("MONTHLY", july));
  });

  it("YEARLY keeps every month of one year in ONE bucket", () => {
    expect(sequenceKeyFor("YEARLY", new Date(2026, 0, 1))).toBe("2026");
    expect(sequenceKeyFor("YEARLY", new Date(2026, 11, 31))).toBe("2026");
  });

  it("keys are zero-padded months so string sorting matches time ordering", () => {
    const keys = [1, 2, 3, 10, 11, 12].map((m) => sequenceKeyFor("MONTHLY", new Date(2026, m - 1, 1)));
    expect([...keys].sort()).toEqual(keys);
  });
});
