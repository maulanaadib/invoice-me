// src/modules/dashboard/series.test.ts
// Pure monthly-bucket math for the dashboard chart (feature 08): window
// keys, per-month sums as decimal strings, empty detection. No DB — this file
// runs in the unit tier.

import { describe, expect, it } from "vitest";
import Decimal from "decimal.js";
import {
  buildMonthlySeries,
  monthKeyOf,
  monthKeysBack,
  seriesIsEmpty,
} from "@/modules/dashboard/series";

describe("monthKeysBack", () => {
  it("returns the last N calendar months ending with the current month", () => {
    const keys = monthKeysBack(new Date("2026-10-08T09:00:00.000Z"), 12);
    expect(keys).toHaveLength(12);
    expect(keys[0]).toBe("2025-11");
    expect(keys[11]).toBe("2026-10");
  });

  it("uses the business timezone (Asia/Jakarta) at a month boundary", () => {
    // 2026-10-31 18:00 UTC is already 2026-11-01 01:00 in Jakarta.
    const keys = monthKeysBack(new Date("2026-10-31T18:00:00.000Z"), 3);
    expect(keys).toEqual(["2026-09", "2026-10", "2026-11"]);
  });

  it("crosses a year boundary", () => {
    expect(monthKeysBack(new Date("2026-01-15T04:00:00.000Z"), 3)).toEqual([
      "2025-11",
      "2025-12",
      "2026-01",
    ]);
  });
});

describe("monthKeyOf", () => {
  it("buckets a stored UTC-midnight date by its calendar month", () => {
    expect(monthKeyOf(new Date("2026-10-01T00:00:00.000Z"))).toBe("2026-10");
    expect(monthKeyOf("2026-09-30T00:00:00.000Z")).toBe("2026-09");
  });
});

describe("buildMonthlySeries", () => {
  const months = ["2026-08", "2026-09", "2026-10"];

  it("sums tagihan and pembayaran per month as 2-dp decimal strings", () => {
    const series = buildMonthlySeries({
      months,
      invoices: [
        { date: "2026-08-15T00:00:00.000Z", grandTotal: "1000000.50" },
        { date: "2026-08-20T00:00:00.000Z", grandTotal: "2500000" },
        { date: "2026-10-02T00:00:00.000Z", grandTotal: "750000" },
      ],
      payments: [
        { date: "2026-08-16T00:00:00.000Z", amount: "500000" },
        { date: "2026-09-01T00:00:00.000Z", amount: "1250000.25" },
      ],
    });

    expect(series.map((point) => point.month)).toEqual(months);
    expect(series[0]).toEqual({ month: "2026-08", billed: "3500000.50", paid: "500000.00" });
    expect(series[1]).toEqual({ month: "2026-09", billed: "0.00", paid: "1250000.25" });
    expect(series[2]).toEqual({ month: "2026-10", billed: "750000.00", paid: "0.00" });
    // Every value is a string — a float never carries a rupiah value.
    for (const point of series) {
      expect(typeof point.billed).toBe("string");
      expect(new Decimal(point.billed).toFixed(2)).toBe(point.billed);
    }
  });

  it("ignores rows outside the requested window", () => {
    const series = buildMonthlySeries({
      months,
      invoices: [{ date: "2026-01-05T00:00:00.000Z", grandTotal: "999999" }],
      payments: [{ date: "2025-12-31T00:00:00.000Z", amount: "999999" }],
    });
    expect(series.every((point) => point.billed === "0.00" && point.paid === "0.00")).toBe(true);
  });
});

describe("seriesIsEmpty", () => {
  it("is empty only when every bucket is zero", () => {
    const months = ["2026-09", "2026-10"];
    expect(
      seriesIsEmpty(buildMonthlySeries({ months, invoices: [], payments: [] })),
    ).toBe(true);
    expect(
      seriesIsEmpty(
        buildMonthlySeries({
          months,
          invoices: [{ date: "2026-10-01T00:00:00.000Z", grandTotal: "0.00" }],
          payments: [],
        }),
      ),
    ).toBe(true);
    expect(
      seriesIsEmpty(
        buildMonthlySeries({
          months,
          invoices: [],
          payments: [{ date: "2026-10-03T00:00:00.000Z", amount: "1" }],
        }),
      ),
    ).toBe(false);
  });
});
