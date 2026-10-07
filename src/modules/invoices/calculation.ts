// src/modules/invoices/calculation.ts
// Invoice calculation engine (feature 04) — pure decimal.js math over decimal
// STRINGS (code-standards: float never touches a rupiah value). The same
// module runs in the browser (live preview) and on the server (every draft
// save recalculates from items — architecture invariant 2 "server
// recalculation"; feature 05 issue flow calls it again before snapshotting).
//
// Formula (feature 04 spec):
//   lineAmount      = quantity × unitPrice − lineDiscount
//   itemsSubtotal   = Σ lineAmount
//   workValue       = itemsSubtotal (manual override only via toggle)
//   billingBase     = FULL → workValue
//                     DOWN_PAYMENT / TERM → workValue × pct / 100  (PERCENT)
//                                          or manual amount         (MANUAL)
//                     SETTLEMENT → max(workValue − previouslyBilled, 0)
//                     CUSTOM → manual amount
//   grandTotal      = billingBase − discountAmount + additionalAmount
//                     + taxAmount + roundingAmount
//
// Tax (spec formulas):
//   EXCLUSIVE: taxAmount = taxableBase × pct / 100   (tax added on top)
//   INCLUSIVE: taxAmount = gross × pct / (100 + pct), gross = billingBase
//              − discountAmount + additionalAmount; the total the customer
//              pays already includes the tax, so tax never re-enters
//              grandTotal. NOTE: the spec's worked example (base 2.250.000 →
//              tax 223.423) is arithmetically inconsistent with "11%
//              inclusive" — pct/(100+pct) is the Indonesian standard split
//              (PPN 11% → 11/111) and is what this implements.
//   MANUAL:    taxAmount = entered nominal, grandTotal adds it on top.
//   NONE:      taxAmount = 0.
//
// Rounding policy: money is stored/compared at 2 decimals — every derived
// amount is rounded HALF_UP to 2dp from the full-precision decimal value, so
// the saved 2dp columns always equal this function's output (integration
// tests assert consistency across create → update → reload).

import Decimal from "decimal.js";
import { roundMoney } from "@/lib/money";

export type InvoiceTypeValue = "FULL" | "DOWN_PAYMENT" | "SETTLEMENT" | "TERM" | "CUSTOM";
export type TaxModeValue = "NONE" | "EXCLUSIVE" | "INCLUSIVE" | "MANUAL";
export type BillingModeValue = "PERCENT" | "MANUAL";

export interface CalcItemInput {
  quantity: string;
  unitPrice: string;
  discountAmount?: string | null;
}

export interface InvoiceCalcInput {
  invoiceType: InvoiceTypeValue;
  items: CalcItemInput[];
  /** Manual workValue override — honored only when workValueOverride is true. */
  workValueOverride?: boolean;
  workValueOverrideAmount?: string | null;
  /** DOWN_PAYMENT / TERM basis. */
  billingMode?: BillingModeValue;
  billingPercent?: string | null;
  /** DOWN_PAYMENT/TERM (MANUAL mode) and CUSTOM billing base. */
  billingAmount?: string | null;
  /** SETTLEMENT only — invoices already billed (feature 05 allocates it). */
  previouslyBilled?: string | null;
  discountAmount?: string | null;
  additionalAmount?: string | null;
  taxMode: TaxModeValue;
  taxPercent?: string | null;
  /** MANUAL tax mode nominal. */
  taxAmountInput?: string | null;
  roundingAmount?: string | null;
}

export interface InvoiceCalcResult {
  /** Per-line amounts, same order as input items. */
  lineAmounts: string[];
  itemsSubtotal: string;
  workValue: string;
  previouslyBilled: string;
  billingBase: string;
  /** workValue − billingBase floored at 0 (DP/TERM/SETTLEMENT context). */
  remainingAfter: string;
  discountAmount: string;
  additionalAmount: string;
  taxMode: TaxModeValue;
  taxPercent: string;
  /** INCLUSIVE: portion of the billed total that is tax. Other modes: "0". */
  taxIncludedInTotal: string;
  taxAmount: string;
  roundingAmount: string;
  grandTotal: string;
}

/** Empty-string / null / undefined → 0; anything else → Decimal. */
function dec(value: string | null | undefined): Decimal {
  if (value === null || value === undefined) return new Decimal(0);
  const text = String(value).trim();
  if (text === "") return new Decimal(0);
  const parsed = new Decimal(text);
  if (parsed.isNaN() || !parsed.isFinite()) {
    throw new Error("Nilai numerik tidak valid");
  }
  return parsed;
}

/** Half-up to 2 decimals — the money contract for every derived amount. */
function money(value: Decimal): Decimal {
  return new Decimal(roundMoney(value));
}

export function calculateInvoice(input: InvoiceCalcInput): InvoiceCalcResult {
  const zero = new Decimal(0);

  // ─── Items ──────────────────────────────────────────────────────────────
  const lineDecimals = input.items.map((item) => {
    const amount = dec(item.quantity).mul(dec(item.unitPrice)).minus(dec(item.discountAmount));
    return money(amount);
  });
  const itemsSubtotal = lineDecimals.reduce((sum, value) => sum.plus(value), zero);

  // ─── Work value ─────────────────────────────────────────────────────────
  const workValue = input.workValueOverride
    ? money(dec(input.workValueOverrideAmount))
    : money(itemsSubtotal);

  // ─── Billing base per invoice type ──────────────────────────────────────
  const previouslyBilled = money(dec(input.previouslyBilled));
  let billingBase: Decimal;
  switch (input.invoiceType) {
    case "FULL":
      billingBase = workValue;
      break;
    case "DOWN_PAYMENT":
    case "TERM": {
      billingBase =
        input.billingMode === "MANUAL"
          ? money(dec(input.billingAmount))
          : money(workValue.mul(dec(input.billingPercent)).div(100));
      break;
    }
    case "SETTLEMENT": {
      const remaining = workValue.minus(previouslyBilled);
      billingBase = money(remaining.isNegative() ? zero : remaining);
      break;
    }
    case "CUSTOM":
      billingBase = money(dec(input.billingAmount));
      break;
  }

  // What is left of the work value AFTER this invoice (never negative):
  // SETTLEMENT shows this as "sisa" context; DP/TERM use it as the reminder
  // of what is still to be billed later.
  const remainingAfterRaw = workValue.minus(previouslyBilled).minus(billingBase);
  const remainingAfter = money(remainingAfterRaw.isNegative() ? zero : remainingAfterRaw);

  // ─── Invoice-level adjustments ──────────────────────────────────────────
  const discountAmount = money(dec(input.discountAmount));
  const additionalAmount = money(dec(input.additionalAmount));
  const roundingAmount = money(dec(input.roundingAmount));

  // ─── Tax ────────────────────────────────────────────────────────────────
  const taxPercent = dec(input.taxPercent);
  let taxAmount = zero;
  let taxIncludedInTotal = zero;
  if (input.taxMode === "EXCLUSIVE") {
    const taxableBase = billingBase.minus(discountAmount).plus(additionalAmount);
    taxAmount = money(taxableBase.mul(taxPercent).div(100));
  } else if (input.taxMode === "INCLUSIVE") {
    const gross = billingBase.minus(discountAmount).plus(additionalAmount);
    // tax = gross × pct / (100 + pct) — the standard Indonesian 11/111 split.
    taxIncludedInTotal = money(gross.mul(taxPercent).div(new Decimal(100).plus(taxPercent)));
  } else if (input.taxMode === "MANUAL") {
    taxAmount = money(dec(input.taxAmountInput));
  }

  // ─── Grand total ────────────────────────────────────────────────────────
  const grandTotal = money(
    billingBase.minus(discountAmount).plus(additionalAmount).plus(taxAmount).plus(roundingAmount),
  );

  return {
    lineAmounts: lineDecimals.map((value) => value.toFixed(2)),
    itemsSubtotal: money(itemsSubtotal).toFixed(2),
    workValue: workValue.toFixed(2),
    previouslyBilled: previouslyBilled.toFixed(2),
    billingBase: billingBase.toFixed(2),
    remainingAfter: remainingAfter.toFixed(2),
    discountAmount: discountAmount.toFixed(2),
    additionalAmount: additionalAmount.toFixed(2),
    taxMode: input.taxMode,
    taxPercent: taxPercent.toFixed(2),
    taxIncludedInTotal: taxIncludedInTotal.toFixed(2),
    taxAmount: taxAmount.toFixed(2),
    roundingAmount: roundingAmount.toFixed(2),
    grandTotal: grandTotal.toFixed(2),
  };
}
