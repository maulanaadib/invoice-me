// src/components/dashboard/activity-timeline.tsx
// Recent-activity timeline (feature 08): the 5 newest invoice/payment audit
// events of the org. Server-rendered (no client bundle) — timestamps use the
// business timezone, and every row states WHO did WHAT, never metadata.

import {
  FilePlus2Icon,
  SendIcon,
  StampIcon,
  WalletIcon,
  BanIcon,
  CopyIcon,
  Undo2Icon,
} from "lucide-react";
import type { DashboardActivity } from "@/modules/dashboard/service";

const ACTION_ICON: Record<string, typeof StampIcon> = {
  INVOICE_DRAFT_CREATED: FilePlus2Icon,
  INVOICE_ISSUED: StampIcon,
  INVOICE_SENT: SendIcon,
  INVOICE_CANCELLED: BanIcon,
  INVOICE_REVISED: CopyIcon,
  PAYMENT_RECORDED: WalletIcon,
};

export function formatActivityTime(iso: string): string {
  return new Date(iso).toLocaleString("id-ID", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Jakarta",
  });
}

export function ActivityTimeline({ items }: { items: DashboardActivity[] }) {
  if (items.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
        Belum ada aktivitas. Event muncul begitu invoice atau pembayaran pertama
        tercatat.
      </p>
    );
  }

  return (
    <ol className="flex flex-col">
      {items.map((item, index) => {
        const Icon = item.action === "PAYMENT_RECORDED" && item.label.includes("reversal")
          ? Undo2Icon
          : ACTION_ICON[item.action] ?? StampIcon;
        const isLast = index === items.length - 1;
        return (
          <li key={item.id} className="relative flex gap-3 pb-4 last:pb-0">
            {!isLast ? (
              <span
                className="absolute top-7 left-3 w-px bg-border"
                aria-hidden="true"
              />
            ) : null}
            <span className="relative z-10 flex size-6 shrink-0 items-center justify-center rounded-full border border-border bg-card">
              <Icon className="size-3.5 text-muted-foreground" aria-hidden="true" />
            </span>
            <div className="flex min-w-0 flex-col gap-0.5 pt-0.5">
              <span className="text-sm">
                <span className="font-medium">{item.label}</span>
              </span>
              <span className="text-xs text-muted-foreground">
                {item.actorName} · {formatActivityTime(item.createdAt)}
              </span>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
