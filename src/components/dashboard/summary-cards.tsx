// src/components/dashboard/summary-cards.tsx
// Dashboard summary (feature 08) in the v4 bento layout (frame 01-dashboard):
// a full-width navy hero card (total ditagihkan + 12-bar sparkline + mini
// stats) above a bento grid of the remaining metric cards. Data contract is
// unchanged: cards arrive as org-scoped decimal strings from the server —
// the browser never recalculates a rupiah value.

import {
  FileTextIcon,
  HandCoinsIcon,
  WalletIcon,
  ClockAlertIcon,
  PencilLineIcon,
  UsersRoundIcon,
} from "lucide-react";
import { formatIdr } from "@/lib/money";
import type { DashboardCards } from "@/modules/dashboard/service";
import { cn } from "cn";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

interface Metric {
  key: string;
  label: string;
  value: string;
  hint?: string;
  icon: typeof FileTextIcon;
  tone?: "default" | "warning" | "success";
}

const TONE_CLASS: Record<NonNullable<Metric["tone"]>, string> = {
  default: "text-foreground",
  warning: "text-warning",
  // WCAG AA (BR-6): emerald on white ≈ 3.6:1 — allowed only for large bold
  // text; the value is text-2xl font-semibold, so emerald stays AA-large here.
  success: "text-success",
};

function maxOf(values: number[]): number {
  return values.reduce((max, value) => (value > max ? value : max), 0);
}

/** Hero sparkline — 12 white bars whose opacity ramps toward the newest month. */
function HeroSparkline({ billed }: { billed: number[] }) {
  const series = billed.length > 0 ? billed : Array.from({ length: 12 }, () => 0);
  const max = maxOf(series);
  return (
    <div className="flex h-10 items-end gap-1" aria-hidden="true">
      {series.map((value, index) => {
        const ratio = max > 0 ? Math.min(1, value / max) : 0;
        return (
          <span
            key={index}
            className="w-3 rounded-t-xs bg-white"
            style={{
              height: `${Math.max(4, Math.round(ratio * 40))}px`,
              opacity: 0.3 + (index / Math.max(1, series.length - 1)) * 0.7,
            }}
          />
        );
      })}
    </div>
  );
}

export function SummaryCards({
  cards,
  billedSeries = [],
}: {
  cards: DashboardCards;
  /** 12 monthly billed totals (server decimal strings → numbers, display only). */
  billedSeries?: number[];
}) {

  const metrics: Metric[] = [
    {
      key: "paid",
      label: "Total dibayar",
      value: formatIdr(cards.totalPaid),
      hint: "Dari riwayat pembayaran",
      icon: WalletIcon,
      tone: "success",
    },    {
      key: "outstanding",
      label: "Outstanding",
      value: formatIdr(cards.outstanding),
      hint: "Belum tertagih lunas",
      icon: HandCoinsIcon,
    },
    {
      key: "this-month",
      label: "Invoice bulan ini",
      value: String(cards.invoicesThisMonth),
      hint: "Menurut tanggal invoice",
      icon: FileTextIcon,
    },
    {
      key: "customers",
      label: "Customer",
      value: String(cards.customerCount),
      hint: "Aktif di organisasi ini",
      icon: UsersRoundIcon,
    },
    {
      key: "draft",
      label: "Draft",
      value: String(cards.draftCount),
      hint: "Belum diterbitkan",
      icon: PencilLineIcon,
    },
    {
      key: "overdue",
      label: "Jatuh tempo",
      value: String(cards.overdueCount),
      hint: "Lewat jatuh tempo",
      icon: ClockAlertIcon,
      tone: cards.overdueCount > 0 ? "warning" : "default",
    },
  ];
  return (
    <div className="flex flex-col gap-4" data-testid="dashboard-summary">
      {/* Hero — navy full-width, "the money moment" (frame 01 Row A) */}
      <section className="flex flex-col gap-6 rounded-xl bg-primary p-6 text-primary-foreground shadow-sm sm:p-7">
        <div className="flex flex-col gap-2">
          <p className="text-[11px] font-semibold uppercase tracking-[1.2px] text-white/70">
            Total ditagihkan
          </p>
          <p className="text-3xl font-bold tracking-tight text-white tabular-nums sm:text-4xl">
            {formatIdr(cards.totalBilled)}
          </p>
          <p className="max-w-xs text-[13px] text-white/75">
            Invoice terbit dan seterusnya · 12 bulan terakhir
          </p>
        </div>
        <div className="flex flex-wrap items-end justify-between gap-6">
          <HeroSparkline billed={billedSeries} />
          <dl className="grid grid-cols-2 gap-x-8 gap-y-3">
            <div className="flex flex-col items-end gap-0.5">
              <dt className="text-[11px] font-semibold uppercase tracking-[0.9px] text-white/65">
                Sudah dibayar
              </dt>
              <dd className="text-lg font-bold leading-5 tabular-nums text-white">
                {formatIdr(cards.totalPaid)}
              </dd>
            </div>
            <div className="flex flex-col items-end gap-0.5">
              <dt className="text-[11px] font-semibold uppercase tracking-[0.9px] text-white/65">
                Sisa tagihan
              </dt>
              <dd className="text-lg font-bold leading-5 tabular-nums text-white">
                {formatIdr(cards.outstanding)}
              </dd>
            </div>
            <div className="flex flex-col items-end gap-0.5">
              <dt className="text-[11px] font-semibold uppercase tracking-[0.9px] text-white/65">
                Overdue
              </dt>
              <dd
                className={cn(
                  "text-lg font-bold leading-5 tabular-nums",
                  // Frame 01: overdue goes red on navy — #FCA5A5 keeps 6.0:1.
                  cards.overdueCount > 0 ? "text-[#FCA5A5]" : "text-white",
                )}
              >
                {cards.overdueCount}
              </dd>
            </div>
            <div className="flex flex-col items-end gap-0.5">
              <dt className="text-[11px] font-semibold uppercase tracking-[0.9px] text-white/65">
                Belum diterbitkan
              </dt>
              <dd className="text-lg font-bold leading-5 tabular-nums text-white">
                {cards.draftCount}
              </dd>
            </div>
          </dl>
        </div>
      </section>

      {/* Bento metric grid (frame 01 Metrics Column + Row B) */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {metrics.map((metric) => {
          const Icon = metric.icon;
          return (
            <Card key={metric.key} className="ring-border shadow-xs">
              <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
                <CardTitle className="text-xs font-semibold uppercase tracking-[0.9px] text-muted-foreground">
                  {metric.label}
                </CardTitle>
                <Icon className="size-4 text-muted-foreground" aria-hidden="true" />
              </CardHeader>
              <CardContent className="flex flex-col gap-1">
                <span
                  className={`text-2xl font-semibold tracking-tight tabular-nums ${TONE_CLASS[metric.tone ?? "default"]}`}
                >
                  {metric.value}
                </span>
                {metric.hint ? (
                  <span className="text-xs text-muted-foreground">{metric.hint}</span>
                ) : null}
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
