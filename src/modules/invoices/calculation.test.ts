// src/modules/invoices/calculation.test.ts
// Feature 04 "Check When Done" calculation matrix — every assertion compares
// DECIMAL STRINGS (spec: no floating point error, ever). The worked example:
//   5 × 900.000 = 4.500.000; DP 50% → 2.250.000 with the item rows left at
//   5 × 900.000 (spec: DP never rewrites the quantities).

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

describe("FULL tanpa pajak", () => {
  it("5 × 900.000 → grandTotal 4.500.000", () => {
    const result = calculateInvoice(input());
    expect(result.lineAmounts).toEqual(["4500000.00"]);
    expect(result.itemsSubtotal).toBe("4500000.00");
    expect(result.workValue).toBe("4500000.00");
    expect(result.billingBase).toBe("4500000.00");
    expect(result.grandTotal).toBe("4500000.00");
    expect(result.remainingAfter).toBe("0.00");
  });

  it("keeps the DP example's item rows at the ORIGINAL 5 × 900.000", () => {
    // DP does not touch items — only billingBase changes (spec Design).
    const result = calculateInvoice(
      input({ invoiceType: "DOWN_PAYMENT", billingMode: "PERCENT", billingPercent: "50" }),
    );
    expect(result.lineAmounts).toEqual(["4500000.00"]);
    expect(result.itemsSubtotal).toBe("4500000.00");
  });
});

describe("DOWN_PAYMENT", () => {
  it("DP 50% → billingBase 2.250.000, grandTotal 2.250.000", () => {
    const result = calculateInvoice(
      input({ invoiceType: "DOWN_PAYMENT", billingMode: "PERCENT", billingPercent: "50" }),
    );
    expect(result.workValue).toBe("4500000.00");
    expect(result.billingBase).toBe("2250000.00");
    expect(result.grandTotal).toBe("2250000.00");
    expect(result.remainingAfter).toBe("2250000.00");
  });

  it("DP 10% → 450.000", () => {
    const result = calculateInvoice(
      input({ invoiceType: "DOWN_PAYMENT", billingMode: "PERCENT", billingPercent: "10" }),
    );
    expect(result.billingBase).toBe("450000.00");
    expect(result.grandTotal).toBe("450000.00");
    expect(result.remainingAfter).toBe("4050000.00");
  });

  it("DP with an awkward percent stays exact (no float drift): 33% of 1.000.000", () => {
    const result = calculateInvoice(
      input({
        invoiceType: "DOWN_PAYMENT",
        billingMode: "PERCENT",
        billingPercent: "33",
        items: [{ quantity: "1", unitPrice: "1000000" }],
      }),
    );
    expect(result.billingBase).toBe("330000.00");
    expect(result.grandTotal).toBe("330000.00");
  });

  it("fractional percent rounds half-up to 2dp: 12.5% of 333.333,33", () => {
    const result = calculateInvoice(
      input({
        invoiceType: "DOWN_PAYMENT",
        billingMode: "PERCENT",
        billingPercent: "12.5",
        items: [{ quantity: "1", unitPrice: "333333.33" }],
      }),
    );
    // 333333.33 × 0.125 = 41666.66625 → 41.666,67 half-up
    expect(result.billingBase).toBe("41666.67");
  });

  it("MANUAL nominal overrides the percentage", () => {
    const result = calculateInvoice(
      input({
        invoiceType: "DOWN_PAYMENT",
        billingMode: "MANUAL",
        billingAmount: "1234567.89",
      }),
    );
    expect(result.billingBase).toBe("1234567.89");
    expect(result.grandTotal).toBe("1234567.89");
  });
});

describe("SETTLEMENT (pelunasan)", () => {
  it("pelunasan setelah DP: previouslyBilled 2.250.000 → billingBase 2.250.000", () => {
    const result = calculateInvoice(input({ invoiceType: "SETTLEMENT", previouslyBilled: "2250000" }));
    expect(result.workValue).toBe("4500000.00");
    expect(result.previouslyBilled).toBe("2250000.00");
    expect(result.billingBase).toBe("2250000.00");
    expect(result.grandTotal).toBe("2250000.00");
    expect(result.remainingAfter).toBe("0.00"); // fully billed after this one
  });

  it("fully billed project → billingBase 0 (never negative)", () => {
    const result = calculateInvoice(input({ invoiceType: "SETTLEMENT", previouslyBilled: "5000000" }));
    expect(result.billingBase).toBe("0.00");
    expect(result.remainingAfter).toBe("0.00");
  });
});

describe("TERM", () => {
  it("termin 40% → 1.800.000", () => {
    const result = calculateInvoice(
      input({ invoiceType: "TERM", billingMode: "PERCENT", billingPercent: "40" }),
    );
    expect(result.billingBase).toBe("1800000.00");
    expect(result.grandTotal).toBe("1800000.00");
    expect(result.remainingAfter).toBe("2700000.00");
  });

  it("termin with manual amount", () => {
    const result = calculateInvoice(
      input({ invoiceType: "TERM", billingMode: "MANUAL", billingAmount: "1000000" }),
    );
    expect(result.billingBase).toBe("1000000.00");
  });
});

describe("CUSTOM", () => {
  it("uses the manual billing base", () => {
    const result = calculateInvoice(input({ invoiceType: "CUSTOM", billingAmount: "999999.99" }));
    expect(result.billingBase).toBe("999999.99");
    expect(result.grandTotal).toBe("999999.99");
  });
});

describe("Pajak", () => {
  it("PPN EXCLUSIVE 11%: taxAmount = base × 0.11, added on top", () => {
    const result = calculateInvoice(
      input({
        invoiceType: "DOWN_PAYMENT",
        billingMode: "PERCENT",
        billingPercent: "50",
        taxMode: "EXCLUSIVE",
        taxPercent: "11",
      }),
    );
    // base 2.250.000 → tax 247.500 → total 2.497.500
    expect(result.taxAmount).toBe("247500.00");
    expect(result.taxIncludedInTotal).toBe("0.00");
    expect(result.grandTotal).toBe("2497500.00");
  });

  it("PPN INCLUSIVE: standard 11/111 split — 2.250.000 → tax 222.972,97", () => {
    const result = calculateInvoice(
      input({
        invoiceType: "DOWN_PAYMENT",
        billingMode: "PERCENT",
        billingPercent: "50",
        taxMode: "INCLUSIVE",
        taxPercent: "11",
      }),
    );
    // gross 2.250.000 includes the tax: tax = gross × 11/111 (half-up 2dp)
    // = 222.972,97; net = 2.027.027,03; the payable total stays 2.250.000.
    expect(result.taxIncludedInTotal).toBe("222972.97");
    expect(result.taxAmount).toBe("0.00");
    expect(result.grandTotal).toBe("2250000.00");
    // The formula is exact in full precision: 2.250.000 − 222.972,97 = 2.027.027,03.
    const net = new Decimal(result.grandTotal).minus(result.taxIncludedInTotal);
    expect(net.toFixed(2)).toBe("2027027.03");
  });

  it("MANUAL tax: the entered nominal is used as-is", () => {
    const result = calculateInvoice(
      input({
        taxMode: "MANUAL",
        taxAmountInput: "55370",
      }),
    );
    expect(result.taxAmount).toBe("55370.00");
    expect(result.grandTotal).toBe("4555370.00");
  });

  it("NONE: no tax regardless of stray percent", () => {
    const result = calculateInvoice(input({ taxMode: "NONE", taxPercent: "11" }));
    expect(result.taxAmount).toBe("0.00");
    expect(result.taxIncludedInTotal).toBe("0.00");
    expect(result.grandTotal).toBe("4500000.00");
  });

  it("EXCLUSIVE tax follows the DISCOUNTED base (base − discount + additional)", () => {
    const result = calculateInvoice(
      input({
        items: [{ quantity: "1", unitPrice: "1000000" }],
        taxMode: "EXCLUSIVE",
        taxPercent: "11",
        discountAmount: "100000",
        additionalAmount: "50000",
      }),
    );
    // taxable = 1.000.000 − 100.000 + 50.000 = 950.000 → tax 104.500
    expect(result.taxAmount).toBe("104500.00");
    expect(result.grandTotal).toBe("1054500.00");
  });
});

describe("Discount, additional charge, rounding", () => {
  it("discount + additional + rounding combine into grandTotal", () => {
    const result = calculateInvoice(
      input({
        discountAmount: "500000",
        additionalAmount: "25000",
        roundingAmount: "-125",
      }),
    );
    // 4.500.000 − 500.000 + 25.000 + 0 + (−125) = 4.024.875
    expect(result.discountAmount).toBe("500000.00");
    expect(result.additionalAmount).toBe("25000.00");
    expect(result.roundingAmount).toBe("-125.00");
    expect(result.grandTotal).toBe("4024875.00");
  });

  it("per-item discount feeds itemsSubtotal", () => {
    const result = calculateInvoice(
      input({
        items: [
          { quantity: "2", unitPrice: "1500000", discountAmount: "250000" },
          { quantity: "3", unitPrice: "500000.50" },
        ],
      }),
    );
    expect(result.lineAmounts).toEqual(["2750000.00", "1500001.50"]);
    expect(result.itemsSubtotal).toBe("4250001.50");
    expect(result.grandTotal).toBe("4250001.50");
  });
});

describe("Work value override", () => {
  it("honored only when the toggle is on", () => {
    const off = calculateInvoice(input({ workValueOverrideAmount: "5000000" }));
    expect(off.workValue).toBe("4500000.00");

    const on = calculateInvoice(
      input({ workValueOverride: true, workValueOverrideAmount: "5000000" }),
    );
    expect(on.workValue).toBe("5000000.00");
    // FULL bills the (overridden) work value.
    expect(on.billingBase).toBe("5000000.00");
  });
});

describe("No floating point error", () => {
  it("the classic 0.1+0.2 style trap computes exactly", () => {
    const result = calculateInvoice(
      input({ items: [{ quantity: "3", unitPrice: "0.10" }] }),
    );
    expect(result.itemsSubtotal).toBe("0.30");
    expect(result.grandTotal).toBe("0.30");
  });

  it("large money stays exact (16-digit values)", () => {
    const result = calculateInvoice(
      input({ items: [{ quantity: "1234", unitPrice: "8123456.78" }] }),
    );
    // 1234 × 8123456.78 = 10024345666.52 — exact in decimal, lossy in float.
    expect(result.grandTotal).toBe("10024345666.52");
  });

  it("empty items array produces zeros", () => {
    const result = calculateInvoice(input({ items: [] }));
    expect(result.itemsSubtotal).toBe("0.00");
    expect(result.grandTotal).toBe("0.00");
  });
});
