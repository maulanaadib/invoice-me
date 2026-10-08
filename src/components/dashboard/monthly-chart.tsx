"use client";

// src/components/dashboard/monthly-chart.tsx
// Ringkas 12-bulan chart: tagihan vs pembayaran (feature 08 spec — bukan
// dashboard chart kustom). Data masuk sebagai decimal string dari server;
// format tampilan id-ID, sumbu memakai format ringkas (angka MURNI untuk
// tampilan saja — tidak pernah jadi input kalkulasi).

import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { formatIdr, groupDigits } from "@/lib/money";
import type { MonthlySeriesPoint } from "@/modules/dashboard/series";

const TAGIHAN_COLOR = "var(--color-primary)";
const BAYAR_COLOR = "var(--color-success)";

/** "2026-10" → "Okt 26" (kalender lokal, label chart saja). */
function monthLabel(month: string): string {
  const [year, monthNumber] = month.split("-");
  const date = new Date(Number(year), Number(monthNumber) - 1, 1);
  return date.toLocaleDateString("id-ID", { month: "short", year: "2-digit" });
}

/** Sumbu Y yang ringkas: 4500000 → "Rp 4,5 jt". Display-only. */
function shortAxis(value: number): string {
  const compact = new Intl.NumberFormat("id-ID", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value);
  return `Rp ${compact}`;
}

export interface MonthlyChartProps {
  points: MonthlySeriesPoint[];
}

export function MonthlyChart({ points }: MonthlyChartProps) {
  const data = points.map((point) => ({
    label: monthLabel(point.month),
    billed: Number(point.billed),
    paid: Number(point.paid),
  }));

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-sm" style={{ background: TAGIHAN_COLOR }} aria-hidden="true" />
          Tagihan
        </span>
        <span className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-sm" style={{ background: BAYAR_COLOR }} aria-hidden="true" />
          Pembayaran
        </span>
      </div>
      <div className="h-64 w-full" data-testid="dashboard-chart">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 8 }}>
            <CartesianGrid strokeDasharray="3 3" className="stroke-border" vertical={false} />
            <XAxis
              dataKey="label"
              tick={{ fontSize: 11, fill: "var(--color-muted-foreground)" }}
              tickLine={false}
              axisLine={{ stroke: "var(--color-border)" }}
              interval="preserveStartEnd"
              minTickGap={16}
            />
            <YAxis
              tickFormatter={shortAxis}
              tick={{ fontSize: 11, fill: "var(--color-muted-foreground)" }}
              tickLine={false}
              axisLine={false}
              width={72}
            />
            <Tooltip
              cursor={{ fill: "var(--color-muted)" }}
              formatter={(value, name) => {
                const text = groupDigits(Number(value).toFixed(2));
                return [
                  `Rp ${text}`,
                  name === "billed" ? "Tagihan" : "Pembayaran",
                ] as [string, string];
              }}
              labelFormatter={(label) => `Periode ${label}`}
            />
            <Bar dataKey="billed" name="billed" fill={TAGIHAN_COLOR} radius={[3, 3, 0, 0]} />
            <Bar dataKey="paid" name="paid" fill={BAYAR_COLOR} radius={[3, 3, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <table className="sr-only">
        <caption>Tagihan dan pembayaran 12 bulan terakhir</caption>
        <thead>
          <tr>
            <th scope="col">Bulan</th>
            <th scope="col">Tagihan</th>
            <th scope="col">Pembayaran</th>
          </tr>
        </thead>
        <tbody>
          {points.map((point) => (
            <tr key={point.month}>
              <td>{monthLabel(point.month)}</td>
              <td>{formatIdr(point.billed)}</td>
              <td>{formatIdr(point.paid)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
