// src/components/dashboard/summary-cards.tsx
// Dashboard summary cards (feature 08): seven org-scoped numbers rendered
// server-side from database aggregates. Money uses the decimal strings the
// service returned — the browser never recalculates a rupiah value.

import {
  FileTextIcon,
  HandCoinsIcon,
  WalletIcon,
  ClockAlertIcon,
  PencilLineIcon,
  UsersRoundIcon,
  ArrowUpRightIcon,
} from "lucide-react";
import { formatIdr } from "@/lib/money";
import type { DashboardCards } from "@/modules/dashboard/service";
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
  success: "text-success",
};

export function SummaryCards({ cards }: { cards: DashboardCards }) {
  const metrics: Metric[] = [
    {
      key: "this-month",
      label: "Invoice bulan ini",
      value: String(cards.invoicesThisMonth),
      hint: "Menurut tanggal invoice",
      icon: FileTextIcon,
    },
    {
      key: "billed",
      label: "Total ditagihkan",
      value: formatIdr(cards.totalBilled),
      hint: "Invoice terbit dan seterusnya",
      icon: ArrowUpRightIcon,
    },
    {
      key: "paid",
      label: "Total dibayar",
      value: formatIdr(cards.totalPaid),
      hint: "Dari riwayat pembayaran",
      icon: WalletIcon,
      tone: "success",
    },
    {
      key: "outstanding",
      label: "Outstanding",
      value: formatIdr(cards.outstanding),
      hint: "Belum tertagih lunas",
      icon: HandCoinsIcon,
    },
    {
      key: "overdue",
      label: "Jatuh tempo",
      value: String(cards.overdueCount),
      hint: "Lewat tanggal jatuh tempo",
      icon: ClockAlertIcon,
      tone: cards.overdueCount > 0 ? "warning" : "default",
    },
    {
      key: "draft",
      label: "Draft",
      value: String(cards.draftCount),
      hint: "Belum diterbitkan",
      icon: PencilLineIcon,
    },
    {
      key: "customers",
      label: "Customer",
      value: String(cards.customerCount),
      hint: "Aktif di organisasi ini",
      icon: UsersRoundIcon,
    },
  ];

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {metrics.map((metric) => {
        const Icon = metric.icon;
        return (
          <Card key={metric.key}>
            <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                {metric.label}
              </CardTitle>
              <Icon className="size-4 text-muted-foreground" aria-hidden="true" />
            </CardHeader>
            <CardContent className="flex flex-col gap-1">
              <span
                className={`text-2xl font-semibold tracking-tight ${TONE_CLASS[metric.tone ?? "default"]}`}
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
  );
}
