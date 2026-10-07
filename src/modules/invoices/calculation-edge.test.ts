// src/modules/invoices/calculation-edge.test.ts
// Independent edge-case pass over the calculation engine (feature 04) — the
// cases the feature-spec matrix does NOT spell out but a real invoice can hit:
//
//   • PPN INCLUSIVE precision when discount/additional also move the gross
//     (the taxable gross is billingBase − discount + additional, and the
//     11/111 split must be exact on that recomputed gross, not on the base)
//   • HALF_UP at the 2dp money boundary (x.xx5 must round AWAY from zero)
//   • a line discount / invoice discount LARGER than the amount it applies to
//     (lineAmount and grandTotal are NOT floored — only remainingAfter is)
//   • DP/TERM at the 0% and 100% boundaries, and above 100%
//   • SETTLEMENT where previouslyBilled sits exactly on, or above, workValue
//   • the grandTotal identity across all four tax modes
//
// Assertions are decimal STRINGS at 2 fraction digits — never floats.

import { describe, expect, it } from "vitest";
import Decimal from "decimal.js";
import { calculateInvoice, type InvoiceCalcInput } from "@/modules/invoices/calculation";

function input(overrides: Partial<InvoiceCalcInput> = {}): InvoiceCalcInput {
  return {
    invoiceType: "FULL",
    items: [{ quantity: "5", unitPrice: "900000" }],
    taxMode: "NONE",
    ...overrides,
  };
}

describe("PPN INCLUSIVE — precision on the recomputed gross", () => {
  it("splits the DISCOUNTED + ADDITIONAL gross, not the raw billing base", () => {
    // billingBase 3.000.000 − discount 500.000 + additional 200.000 = gross 2.700.000
    const result = calculateInvoice(
      input({
        items: [{ quantity: "3", unitPrice: "1000000" }],
        discountAmount: "500000",
        additionalAmount: "200000",
        taxMode: "INCLUSIVE",
        taxPercent: "11",
      }),
    );
    // gross 2.700.000 × 11/111 = 267.567,567… → 267.567,57 half-up
    expect(result.billingBase).toBe("3000000.00");
    expect(result.taxIncludedInTotal).toBe("267567.57");
    // net = gross − tax, exact in full precision
    expect(new Decimal("2700000").minus("267567.57").toFixed(2)).toBe("2432432.43");
    // The customer pays exactly the gross: tax never re-enters the total.
    expect(result.grandTotal).toBe("2700000.00");
    expect(result.taxAmount).toBe("0.00");
  });

  it("gross + tax split recombines to the gross (no rupiah is lost)", () => {
    const result = calculateInvoice(
      input({
        items: [{ quantity: "1", unitPrice: "1777001" }],
        taxMode: "INCLUSIVE",
        taxPercent: "11",
      }),
    );
    // gross 1.777.001 × 11/111 = 176.099,20 exactly → net 1.600.901,80
    expect(result.taxIncludedInTotal).toBe("176099.20");
    const net = new Decimal(result.grandTotal).minus(result.taxIncludedInTotal);
    expect(net.toFixed(2)).toBe("1600901.80");
    // net + tax recombines into the gross the customer pays.
    expect(net.plus(result.taxIncludedInTotal).toFixed(2)).toBe(result.grandTotal);
  });

  it("INCLUSIVE with an empty percent reads as 0%, never as a crash", () => {
    const result = calculateInvoice(input({ taxMode: "INCLUSIVE", taxPercent: "" }));
    expect(result.taxPercent).toBe("0.00");
    expect(result.taxIncludedInTotal).toBe("0.00");
    expect(result.taxAmount).toBe("0.00");
    expect(result.grandTotal).toBe("4500000.00");
  });

  it("INCLUSIVE on a zero billing base keeps every amount at zero", () => {
    const result = calculateInvoice(
      input({
        items: [],
        taxMode: "INCLUSIVE",
        taxPercent: "11",
      }),
    );
    expect(result.taxIncludedInTotal).toBe("0.00");
    expect(result.grandTotal).toBe("0.00");
  });
});

describe("HALF_UP at the 2-decimal money boundary", () => {
  it("a line amount ending in .xx5 rounds AWAY from zero", () => {
    // 3 × 33.335 = 100.005 → 100.01 (half-up, not banker's rounding)
    const result = calculateInvoice(
      input({ items: [{ quantity: "3", unitPrice: "33.335" }] }),
    );
    expect(result.lineAmounts).toEqual(["100.01"]);
    expect(result.itemsSubtotal).toBe("100.01");
  });

  it("the same boundary one cent lower stays flat", () => {
    const result = calculateInvoice(
      input({ items: [{ quantity: "3", unitPrice: "33.334" }] }),
    );
    // 3 × 33.334 = 100.002 → 100.00
    expect(result.lineAmounts).toEqual(["100.00"]);
  });

  it("the rounding adjustment applies the SAME half-up rule to the total", () => {
    const up = calculateInvoice(input({ roundingAmount: "0.005" }));
    // 4.500.000 + 0.005 → 4.500.000,01
    expect(up.grandTotal).toBe("4500000.01");

    const flat = calculateInvoice(input({ roundingAmount: "0.004" }));
    expect(flat.grandTotal).toBe("4500000.00");
  });

  it("a negative half-cent rounds away from zero too", () => {
    const result = calculateInvoice(input({ roundingAmount: "-0.005" }));
    expect(result.roundingAmount).toBe("-0.01");
    expect(result.grandTotal).toBe("4499999.99");
  });
});

describe("Discounts larger than the amount they apply to", () => {
  it("a line discount above the line amount produces a NEGATIVE line amount", () => {
    // lineAmount = qty × price − discount, with no floor (only remainingAfter is).
    const result = calculateInvoice(
      input({ items: [{ quantity: "1", unitPrice: "100000", discountAmount: "150000" }] }),
    );
    expect(result.lineAmounts).toEqual(["-50000.00"]);
    expect(result.itemsSubtotal).toBe("-50000.00");
    expect(result.grandTotal).toBe("-50000.00");
  });

  it("an invoice discount above the billing base drives the total negative", () => {
    const result = calculateInvoice(input({ discountAmount: "5000000" }));
    expect(result.billingBase).toBe("4500000.00");
    expect(result.grandTotal).toBe("-500000.00");
    // remainingAfter stays floored at 0 even here.
    expect(result.remainingAfter).toBe("0.00");
  });

  it("EXCLUSIVE tax follows the discounted base NEGATIVE as well", () => {
    // taxable = 1.000.000 − 1.200.000 + 0 = −200.000 → tax −22.000
    const result = calculateInvoice(
      input({
        items: [{ quantity: "1", unitPrice: "1000000" }],
        discountAmount: "1200000",
        taxMode: "EXCLUSIVE",
        taxPercent: "11",
      }),
    );
    expect(result.taxAmount).toBe("-22000.00");
    expect(result.grandTotal).toBe("-222000.00");
  });
});

describe("DOWN_PAYMENT / TERM boundaries", () => {
  it("DP 0% bills nothing and leaves the whole work value outstanding", () => {
    const result = calculateInvoice(
      input({ invoiceType: "DOWN_PAYMENT", billingMode: "PERCENT", billingPercent: "0" }),
    );
    expect(result.workValue).toBe("4500000.00");
    expect(result.billingBase).toBe("0.00");
    expect(result.grandTotal).toBe("0.00");
    expect(result.remainingAfter).toBe("4500000.00");
  });

  it("DP 100% bills the whole work value (remainingAfter 0)", () => {
    const result = calculateInvoice(
      input({ invoiceType: "DOWN_PAYMENT", billingMode: "PERCENT", billingPercent: "100" }),
    );
    expect(result.billingBase).toBe("4500000.00");
    expect(result.grandTotal).toBe("4500000.00");
    expect(result.remainingAfter).toBe("0.00");
  });

  it("a percent above 100% is not floored — remainingAfter absorbs the excess", () => {
    const result = calculateInvoice(
      input({ invoiceType: "DOWN_PAYMENT", billingMode: "PERCENT", billingPercent: "150" }),
    );
    expect(result.billingBase).toBe("6750000.00");
    expect(result.grandTotal).toBe("6750000.00");
    // workValue − previouslyBilled − billingBase = −2.250.000 → floored to 0.
    expect(result.remainingAfter).toBe("0.00");
  });

  it("DP with a fractional percent keeps full decimal precision", () => {
    // 4.500.000 × 12.345% = 555.525 exactly (float would drift on ÷100).
    const result = calculateInvoice(
      input({ invoiceType: "DOWN_PAYMENT", billingMode: "PERCENT", billingPercent: "12.345" }),
    );
    expect(result.billingBase).toBe("555525.00");
    expect(result.taxPercent).toBe("0.00");
  });

  it("FULL ignores a leftover MANUAL billing amount", () => {
    const withAmount = calculateInvoice(
      input({ billingMode: "MANUAL", billingAmount: "1000000" }),
    );
    expect(withAmount.billingBase).toBe("4500000.00");
  });
});

describe("SETTLEMENT boundaries", () => {
  it("previouslyBilled exactly equal to workValue settles at 0", () => {
    const result = calculateInvoice(
      input({ invoiceType: "SETTLEMENT", previouslyBilled: "4500000" }),
    );
    expect(result.billingBase).toBe("0.00");
    expect(result.grandTotal).toBe("0.00");
    expect(result.remainingAfter).toBe("0.00");
  });

  it("previouslyBilled above workValue settles at 0 (never negative)", () => {
    const result = calculateInvoice(
      input({ invoiceType: "SETTLEMENT", previouslyBilled: "4500000.99" }),
    );
    expect(result.previouslyBilled).toBe("4500000.99");
    expect(result.billingBase).toBe("0.00");
    expect(result.grandTotal).toBe("0.00");
    expect(result.remainingAfter).toBe("0.00");
  });

  it("settlement with an over-billing plus discount still totals 0", () => {
    const result = calculateInvoice(
      input({
        invoiceType: "SETTLEMENT",
        previouslyBilled: "6000000",
        discountAmount: "250000",
      }),
    );
    expect(result.billingBase).toBe("0.00");
    // 0 − 250.000 = −250.000 (the discount is not floored either)
    expect(result.grandTotal).toBe("-250000.00");
  });

  it("FULL keeps previouslyBilled visible for context without changing the base", () => {
    const result = calculateInvoice(input({ previouslyBilled: "3000000" }));
    expect(result.previouslyBilled).toBe("3000000.00");
    expect(result.billingBase).toBe("4500000.00");
    expect(result.grandTotal).toBe("4500000.00");
    // workValue − previouslyBilled − billingBase = −3.000.000 → 0
    expect(result.remainingAfter).toBe("0.00");
  });
});

describe("CUSTOM and work-value override edges", () => {
  it("CUSTOM subtracts previouslyBilled into remainingAfter", () => {
    const result = calculateInvoice(
      input({
        invoiceType: "CUSTOM",
        billingAmount: "2000000",
        previouslyBilled: "1000000",
      }),
    );
    expect(result.billingBase).toBe("2000000.00");
    // 4.500.000 − 1.000.000 − 2.000.000 = 1.500.000
    expect(result.remainingAfter).toBe("1500000.00");
  });

  it("an override toggle with a blank amount reads as 0 (dec('') → 0)", () => {
    const result = calculateInvoice(
      input({ workValueOverride: true, workValueOverrideAmount: "" }),
    );
    expect(result.workValue).toBe("0.00");
    expect(result.billingBase).toBe("0.00");
    expect(result.grandTotal).toBe("0.00");
  });

  it("a null override amount also reads as 0", () => {
    const result = calculateInvoice(
      input({ workValueOverride: true, workValueOverrideAmount: null }),
    );
    expect(result.workValue).toBe("0.00");
  });

  it("the override wins for a DP percentage basis too", () => {
    const result = calculateInvoice(
      input({
        invoiceType: "DOWN_PAYMENT",
        billingMode: "PERCENT",
        billingPercent: "30",
        workValueOverride: true,
        workValueOverrideAmount: "10000000",
      }),
    );
    expect(result.workValue).toBe("10000000.00");
    expect(result.billingBase).toBe("3000000.00");
  });
});

describe("Tax input handling", () => {
  it("MANUAL tax with a blank input is 0, not an error", () => {
    const result = calculateInvoice(input({ taxMode: "MANUAL", taxAmountInput: "" }));
    expect(result.taxAmount).toBe("0.00");
    expect(result.grandTotal).toBe("4500000.00");
  });

  it("NONE mode ignores a stray percent AND a stray manual nominal", () => {
    const result = calculateInvoice(
      input({ taxMode: "NONE", taxPercent: "11", taxAmountInput: "123456" }),
    );
    expect(result.taxAmount).toBe("0.00");
    expect(result.taxIncludedInTotal).toBe("0.00");
    expect(result.taxPercent).toBe("11.00");
    expect(result.grandTotal).toBe("4500000.00");
  });

  it("MANUAL tax is added on top of the discounted base", () => {
    const result = calculateInvoice(
      input({
        discountAmount: "500000",
        taxMode: "MANUAL",
        taxAmountInput: "55370",
      }),
    );
    // 4.500.000 − 500.000 + 55.370
    expect(result.grandTotal).toBe("4055370.00");
  });

  it("EXCLUSIVE ignores billingPercent entirely (DP percent stays on the base)", () => {
    const result = calculateInvoice(
      input({
        invoiceType: "DOWN_PAYMENT",
        billingMode: "PERCENT",
        billingPercent: "50",
        taxMode: "EXCLUSIVE",
        taxPercent: "11",
      }),
    );
    // taxable = billingBase 2.250.000 → tax 247.500
    expect(result.taxAmount).toBe("247500.00");
    expect(result.taxIncludedInTotal).toBe("0.00");
  });
});

describe("grandTotal identity across every tax mode", () => {
  const cases: Array<{ label: string; overrides: Partial<InvoiceCalcInput> }> = [
    { label: "NONE", overrides: { taxMode: "NONE" } },
    { label: "EXCLUSIVE", overrides: { taxMode: "EXCLUSIVE", taxPercent: "11" } },
    { label: "INCLUSIVE", overrides: { taxMode: "INCLUSIVE", taxPercent: "11" } },
    { label: "MANUAL", overrides: { taxMode: "MANUAL", taxAmountInput: "77777" } },
  ];

  for (const { label, overrides } of cases) {
    it(`${label}: grandTotal = billingBase − discount + additional + tax + rounding`, () => {
      const result = calculateInvoice(
        input({
          discountAmount: "120000",
          additionalAmount: "45000",
          roundingAmount: "-75",
          ...overrides,
        }),
      );
      const expected = new Decimal(result.billingBase)
        .minus(result.discountAmount)
        .plus(result.additionalAmount)
        .plus(result.taxAmount)
        .plus(result.roundingAmount)
        .toFixed(2);
      expect(result.grandTotal).toBe(expected);
    });
  }
});

describe("Input hardening", () => {
  it("rejects NaN / Infinity text (they parse, so the guard must catch them)", () => {
    // Decimal parses these three without throwing — only the isNaN/isFinite
    // guard in dec() keeps them out of the money columns.
    expect(() =>
      calculateInvoice(input({ items: [{ quantity: "1", unitPrice: "NaN" }] })),
    ).toThrowError(/Nilai numerik tidak valid/);
    expect(() =>
      calculateInvoice(input({ items: [{ quantity: "1", unitPrice: "Infinity" }] })),
    ).toThrowError(/Nilai numerik tidak valid/);
    expect(() =>
      calculateInvoice(input({ roundingAmount: "-Infinity" })),
    ).toThrowError(/Nilai numerik tidak valid/);
  });

  it("a non-numeric string surfaces Decimal's own error, not the guard's message", () => {
    // Documented behavior of `dec()`: a string Decimal refuses to PARSE
    // ("banyak") throws before the isNaN guard runs. The Zod schema rejects it
    // at the boundary first — this is the engine's raw behavior if it ever
    // gets there. Currently the message is Decimal's, not the guard's.
    expect(() =>
      calculateInvoice(input({ items: [{ quantity: "banyak", unitPrice: "1000" }] })),
    ).toThrowError(/Invalid argument: banyak/);
  });

  it("nulls and blank strings on optional money fields are 0", () => {
    const result = calculateInvoice(
      input({
        discountAmount: null,
        additionalAmount: "",
        roundingAmount: null,
        previouslyBilled: null,
      }),
    );
    expect(result.discountAmount).toBe("0.00");
    expect(result.additionalAmount).toBe("0.00");
    expect(result.roundingAmount).toBe("0.00");
    expect(result.previouslyBilled).toBe("0.00");
    expect(result.grandTotal).toBe("4500000.00");
  });

  it("lineAmounts stay index-aligned with the input items", () => {
    const result = calculateInvoice(
      input({
        items: [
          { quantity: "1", unitPrice: "0" },
          { quantity: "2.5", unitPrice: "100000" },
          { quantity: "0.5", unitPrice: "333333.33", discountAmount: "1" },
        ],
      }),
    );
    expect(result.lineAmounts).toHaveLength(3);
    // 0.5 × 333333.33 = 166666.665 → half-up 166666.67 − 1 → 166665.67
    expect(result.lineAmounts[2]).toBe("166665.67");
    expect(new Decimal(result.lineAmounts.reduce((a, b) => a.plus(b), new Decimal(0))).toFixed(2)).toBe(
      result.itemsSubtotal,
    );
  });
});
