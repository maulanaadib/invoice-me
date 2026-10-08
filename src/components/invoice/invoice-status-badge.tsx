// src/components/invoice/invoice-status-badge.tsx
// The one invoice status badge (ui-context): ALWAYS text + colour + icon —
// never colour alone. Overdue is a READ-TIME status (feature 05: the stored
// column stays ISSUED/SENT/PARTIALLY_PAID until the feature-11 sweep), so
// pass `status` = the view's displayStatus.

import type { InvoiceStatus } from "@prisma/client";
import {
  CircleCheckIcon,
  ClockIcon,
  CopyIcon,
  PencilIcon,
  SendIcon,
  StampIcon,
  TriangleAlertIcon,
  XIcon,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "cn";

export const INVOICE_STATUS_LABELS: Record<InvoiceStatus, string> = {
  DRAFT: "Draft",
  ISSUED: "Terbit",
  SENT: "Terkirim",
  PARTIALLY_PAID: "Dibayar sebagian",
  PAID: "Lunas",
  OVERDUE: "Jatuh tempo",
  CANCELLED: "Dibatalkan",
  REVISED: "Direvisi",
};

type BadgeVariant = "default" | "secondary" | "outline" | "destructive";

const STATUS_STYLE: Record<
  InvoiceStatus,
  { variant: BadgeVariant; className?: string; icon: typeof StampIcon }
> = {
  // netral
  DRAFT: { variant: "outline", icon: PencilIcon },
  // primary
  ISSUED: { variant: "default", icon: StampIcon },
  // info
  SENT: { variant: "secondary", icon: SendIcon },
  // warning
  PARTIALLY_PAID: {
    variant: "secondary",
    className: "bg-warning/10 text-warning dark:bg-warning/20",
    icon: TriangleAlertIcon,
  },
  // success
  PAID: {
    variant: "secondary",
    className: "bg-success/10 text-success dark:bg-success/20",
    icon: CircleCheckIcon,
  },
  // destructive
  OVERDUE: { variant: "destructive", icon: ClockIcon },
  // muted
  CANCELLED: { variant: "outline", className: "text-muted-foreground", icon: XIcon },
  // muted + strikethrough (ui-context)
  REVISED: {
    variant: "outline",
    className: "text-muted-foreground line-through decoration-1",
    icon: CopyIcon,
  },
};

export interface InvoiceStatusBadgeProps {
  status: InvoiceStatus;
  className?: string;
}

export function InvoiceStatusBadge({ status, className }: InvoiceStatusBadgeProps) {
  const style = STATUS_STYLE[status];
  const Icon = style.icon;
  return (
    <Badge variant={style.variant} className={cn(style.className, className)}>
      <Icon data-icon="inline-start" aria-hidden="true" />
      {INVOICE_STATUS_LABELS[status]}
    </Badge>
  );
}
