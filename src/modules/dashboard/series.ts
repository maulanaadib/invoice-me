// src/modules/dashboard/series.ts
// Pure monthly-bucket math for the dashboard chart (feature 08). No db, no
// scope — unit tests drive it straight from input rows. Money stays a decimal
// string end to end (architecture invariant 1: a float never touches rupiah).

import Decimal from "decimal.js";
import { todayInJakarta } from "@/lib/date";

/** Bucket key for a calendar month: "YYYY-MM" (rows are stored as UTC
 * midnight of their calendar date, so the UTC month IS the business month). */
export function monthKeyOf(value: Date | string): string {
  const iso = value instanceof Date ? value.toISOString() : new Date(value).toISOString();
  return iso.slice(0, 7);
}

/**
 * The last `count` calendar months (ascending), ending with the month of
 * `now` in the business timezone (Asia/Jakarta).
 */
export function monthKeysBack(now: Date, count: number): string[] {
  const [year = now.getUTCFullYear(), month = 1] = todayInJakarta(now)
    .split("-")
    .map(Number);
  const keys: string[] = [];
  for (let offset = count - 1; offset >= 0; offset -= 1) {
    const date = new Date(Date.UTC(year, month - 1 - offset, 1));
    keys.push(monthKeyOf(date));
  }
  return keys;
}

export interface MonthlySeriesInput {
  /** Ascending bucket keys from `monthKeysBack`. */
  months: string[];
  invoices: Array<{ date: Date | string; grandTotal: Decimal.Value }>;
  payments: Array<{ date: Date | string; amount: Decimal.Value }>;
}

export interface MonthlySeriesPoint {
  /** "YYYY-MM". */
  month: string;
  /** Σ grandTotal of billed invoices dated in the month — decimal string. */
  billed: string;
  /** Σ payments dated in the month — decimal string. */
  paid: string;
}

/**
 * Tagihan vs pembayaran per bulan. Rows outside the requested window are
 * ignored (the caller may fetch a wider set); every value is a 2-dp decimal
 * string so the chart never sees a float.
 */
export function buildMonthlySeries(input: MonthlySeriesInput): MonthlySeriesPoint[] {
  const billedByMonth = new Map<string, Decimal>();
  const paidByMonth = new Map<string, Decimal>();

  for (const invoice of input.invoices) {
    const key = monthKeyOf(invoice.date);
    billedByMonth.set(key, (billedByMonth.get(key) ?? new Decimal(0)).plus(invoice.grandTotal));
  }
  for (const payment of input.payments) {
    const key = monthKeyOf(payment.date);
    paidByMonth.set(key, (paidByMonth.get(key) ?? new Decimal(0)).plus(payment.amount));
  }

  return input.months.map((month) => ({
    month,
    billed: (billedByMonth.get(month) ?? new Decimal(0)).toFixed(2),
    paid: (paidByMonth.get(month) ?? new Decimal(0)).toFixed(2),
  }));
}

/** True when every bucket is zero — the chart renders an empty state instead
 * of a flat line at 0. */
export function seriesIsEmpty(series: MonthlySeriesPoint[]): boolean {
  return series.every(
    (point) => new Decimal(point.billed).isZero() && new Decimal(point.paid).isZero(),
  );
}
