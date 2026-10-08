// src/modules/dashboard/service.ts
// Feature 08 — dashboard reads: summary cards, the 12-month tagihan-vs-bayar
// series, and the recent-activity timeline. Everything is org-scoped and gated
// by `invoice.view` (every role has it — the dashboard is the app's home);
// per-metric cards never recompute money client-side (invariant 1/2: sums come
// from the database as decimal strings).
//
// Note on "overdue" in the timeline: OVERDUE is a READ-TIME status (feature
// 05) and writes no audit row — it is surfaced as a card count instead of a
// fabricated timeline entry.

import { todayInJakarta } from "@/lib/date";
import { roundMoney } from "@/lib/money";
import {
  assertCan,
  requireOrgScope,
  type PermissionContext,
} from "@/modules/permissions/service";
import { BILLED_STATUSES } from "@/modules/invoices/billed";
import { OVERDUE_ELIGIBLE_STATUSES } from "@/modules/invoices/lifecycle-service";
import {
  buildMonthlySeries,
  monthKeysBack,
  seriesIsEmpty,
  type MonthlySeriesPoint,
} from "@/modules/dashboard/series";
import { db } from "@/server/db";
import type { AuditAction, Prisma } from "@prisma/client";

export type DashboardContext = { scope: PermissionContext };

/** Chart window (spec: 12 bulan terakhir). */
export const DASHBOARD_MONTHS = 12;
/** Recent activity depth (spec: 5 event terbaru). */
export const DASHBOARD_ACTIVITY_LIMIT = 5;

// ─── Cards ────────────────────────────────────────────────────────────────

export interface DashboardCards {
  /** Invoice (any status) dated in the current calendar month. */
  invoicesThisMonth: number;
  /** Σ grandTotal of billed (issued-and-later) invoices. */
  totalBilled: string;
  /** Σ amountPaid of billed invoices. */
  totalPaid: string;
  /** Σ remainingAfter (floored at 0) of billed invoices. */
  outstanding: string;
  /** Read-time overdue count (eligible status, due date before today). */
  overdueCount: number;
  draftCount: number;
  /** Active (non soft-deleted) customers. */
  customerCount: number;
}

/**
 * One round of aggregate queries for the dashboard cards. Sums come straight
 * from Prisma `_sum` (Decimal) — never from numbers the browser touched.
 */
export async function getDashboardCards(ctx: DashboardContext): Promise<DashboardCards> {
  assertCan("invoice.view", ctx.scope);
  requireOrgScope(ctx.scope);
  const organizationId = ctx.scope.organizationId;

  const now = new Date();
  const [year = now.getUTCFullYear(), month = 1] = todayInJakarta(now)
    .split("-")
    .map(Number);
  const monthStart = new Date(Date.UTC(year, month - 1, 1));
  const monthEnd = new Date(Date.UTC(year, month, 1));
  const startOfToday = new Date(`${todayInJakarta(now)}T00:00:00.000Z`);

  const billedWhere: Prisma.InvoiceWhereInput = {
    organizationId,
    status: { in: [...BILLED_STATUSES] },
  };
  const overdueWhere: Prisma.InvoiceWhereInput = {
    organizationId,
    status: { in: [...OVERDUE_ELIGIBLE_STATUSES, "OVERDUE"] },
    dueDate: { not: null, lt: startOfToday },
  };

  const [invoicesThisMonth, billed, overdueCount, draftCount, customerCount] =
    await Promise.all([
      db.invoice.count({
        where: { organizationId, invoiceDate: { gte: monthStart, lt: monthEnd } },
      }),
      db.invoice.aggregate({
        where: billedWhere,
        _sum: { grandTotal: true, amountPaid: true, remainingAfter: true },
      }),
      db.invoice.count({ where: overdueWhere }),
      db.invoice.count({ where: { organizationId, status: "DRAFT" } }),
      db.customer.count({ where: { organizationId, deletedAt: null } }),
    ]);

  const money = (value: { toFixed: (dp: number) => string } | null): string =>
    value ? roundMoney(value.toFixed(2)) : "0.00";

  return {
    invoicesThisMonth,
    totalBilled: money(billed._sum.grandTotal),
    totalPaid: money(billed._sum.amountPaid),
    outstanding: money(billed._sum.remainingAfter),
    overdueCount,
    draftCount,
    customerCount,
  };
}

// ─── Chart: tagihan vs pembayaran per bulan ───────────────────────────────

export interface DashboardSeries {
  points: MonthlySeriesPoint[];
  /** True when nothing happened in the window — render the empty state. */
  empty: boolean;
}

export async function getMonthlySeries(
  ctx: DashboardContext,
  months: number = DASHBOARD_MONTHS,
): Promise<DashboardSeries> {
  assertCan("invoice.view", ctx.scope);
  requireOrgScope(ctx.scope);
  const organizationId = ctx.scope.organizationId;

  const keys = monthKeysBack(new Date(), months);
  const windowStart = new Date(`${keys[0]}-01T00:00:00.000Z`);

  const [invoices, payments] = await Promise.all([
    db.invoice.findMany({
      where: {
        organizationId,
        invoiceDate: { gte: windowStart },
        status: { in: [...BILLED_STATUSES] },
      },
      select: { invoiceDate: true, grandTotal: true },
    }),
    db.payment.findMany({
      where: { organizationId, paymentDate: { gte: windowStart } },
      select: { paymentDate: true, amount: true },
    }),
  ]);

  const points = buildMonthlySeries({
    months: keys,
    invoices: invoices.map((row) => ({
      date: row.invoiceDate,
      grandTotal: row.grandTotal.toString(),
    })),
    payments: payments.map((row) => ({
      date: row.paymentDate,
      amount: row.amount.toString(),
    })),
  });

  return { points, empty: seriesIsEmpty(points) };
}

// ─── Recent activity timeline ─────────────────────────────────────────────

/** Timeline copy per audit action. Actions absent here (INVOICE_UPDATED —
 * autosave noise; PDF_* — technical) are deliberately not surfaced. */
export const ACTIVITY_LABELS: Partial<Record<AuditAction, string>> = {
  INVOICE_DRAFT_CREATED: "Invoice baru dibuat",
  INVOICE_ISSUED: "Invoice diterbitkan",
  INVOICE_SENT: "Invoice ditandai terkirim",
  INVOICE_CANCELLED: "Invoice dibatalkan",
  INVOICE_REVISED: "Invoice direvisi",
  PAYMENT_RECORDED: "Pembayaran dicatat",
};

export const DASHBOARD_ACTIVITY_ACTIONS = Object.keys(
  ACTIVITY_LABELS,
) as AuditAction[];

export interface DashboardActivity {
  id: string;
  action: AuditAction;
  label: string;
  entityType: string;
  /** Actor display name, or "Sistem" when the row has no user. */
  actorName: string;
  createdAt: string;
}

/**
 * The newest `limit` invoice/payment events of the org (spec: timeline
 * invoice baru / issued / pembayaran / revisi). Reads AuditLog directly —
 * writes already go through `modules/audit` (feature 01 invariant).
 */
export async function getRecentActivity(
  ctx: DashboardContext,
  limit: number = DASHBOARD_ACTIVITY_LIMIT,
): Promise<DashboardActivity[]> {
  assertCan("invoice.view", ctx.scope);
  requireOrgScope(ctx.scope);

  const take = Math.min(Math.max(limit, 1), DASHBOARD_ACTIVITY_LIMIT);
  const rows = await db.auditLog.findMany({
    where: {
      organizationId: ctx.scope.organizationId,
      action: { in: DASHBOARD_ACTIVITY_ACTIONS },
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take,
    select: {
      id: true,
      action: true,
      entityType: true,
      metadata: true,
      createdAt: true,
      actor: { select: { name: true, username: true } },
    },
  });

  return rows.map((row) => {
    const base = ACTIVITY_LABELS[row.action] ?? row.action;
    const isReversal =
      row.action === "PAYMENT_RECORDED" &&
      typeof row.metadata === "object" &&
      row.metadata !== null &&
      (row.metadata as Prisma.JsonObject).reversed === true;
    return {
      id: row.id,
      action: row.action,
      label: isReversal ? "Pembayaran dibatalkan (reversal)" : base,
      entityType: row.entityType,
      actorName:
        row.actor?.name || row.actor?.username || "Sistem",
      createdAt: row.createdAt.toISOString(),
    };
  });
}
