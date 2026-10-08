// src/modules/payments/service.ts
// Payment domain (feature 07): record a manual payment against an open
// invoice, reverse one (OWNER/ADMIN), and read the riwayat — org-scoped,
// permission-checked in the service, every money move inside ONE transaction
// that also recomputes the LIVE payment columns and writes the audit row.
//
//   • amountPaid        = SUM of the payment rows (recomputed server-side,
//                         never taken from the client — invariant 2)
//   • remainingAfter    = max(0, grandTotal − amountPaid)
//   • status            = recomputePaymentStatus(...) — PARTIALLY_PAID / PAID
//
// The seven snapshots are NEVER touched: payments are not part of the
// document (invariant 4/5), so the issued/PDF data stays frozen while
// amountPaid + remainingAfter move on the live row.

import Decimal from "decimal.js";
import { AppError } from "@/lib/errors";
import { db } from "@/server/db";
import { logger } from "@/server/logger";
import { firstZodMessage } from "@/lib/validation";
import { parseCalendarDate, toCalendarInput } from "@/lib/date";
import { log } from "@/modules/audit/service";
import { assertCan, can, requireOrgScope } from "@/modules/permissions/service";
import { getStorageService } from "@/modules/storage";
import {
  PAYABLE_STATUSES,
  assertPayable,
  isPayable,
  recomputePaymentStatus,
  remainingAfterPayment,
} from "@/modules/payments/status";
import {
  recordPaymentPayloadSchema,
  type PaymentMethodValue,
  type RecordPaymentPayload,
} from "@/modules/payments/schema";
import type { InvoiceStatus, OrganizationRole, Prisma } from "@prisma/client";

/** Storage sub-directory for payment proofs (architecture-context storage
 * model: uploads/organizations/{orgId}/payment-proofs/{uuid}.{ext}). */
export const PROOF_KIND = "payment-proofs";

/** Proof content types — decided by magic-byte sniffing in validateUpload,
 * never by the filename or the declared type. */
export const PROOF_MIME_TYPES = [
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/webp",
] as const;

/** Hard cap for the /payments + payable-invoice lists (pagination limit —
 * never an unbounded read). */
export const MAX_LIST_PAGE_SIZE = 100;
const PAYABLE_INVOICE_LIMIT = 100;

export interface PaymentServiceContext {
  scope: { organizationId: string; role: OrganizationRole; userId: string };
  request?: Request | null;
}

// ─── Views (serializable — server action → client components) ─────────────

export interface PaymentRowView {
  id: string;
  invoiceId: string;
  /** Invoice number (or the draft preview / honest fallback). */
  invoiceLabel: string;
  customerId: string;
  customerName: string;
  /** "YYYY-MM-DD" (calendar day, displayed in Asia/Jakarta). */
  paymentDate: string;
  /** Decimal string. */
  amount: string;
  method: PaymentMethodValue;
  referenceNumber: string | null;
  notes: string | null;
  overpaymentReason: string | null;
  proofPath: string | null;
  recordedByName: string;
  createdAt: string;
}

export interface PaymentListResult {
  rows: PaymentRowView[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface PaymentListQuery {
  page?: number;
  pageSize?: number;
  /** Invoice number / numberPreview fragment. */
  invoice?: string;
  /** Customer company-name fragment. */
  customer?: string;
  /** "YYYY-MM-DD" range on paymentDate (inclusive). */
  from?: string;
  to?: string;
}

export interface PaymentOutcome {
  paymentId: string;
  invoiceId: string;
  status: InvoiceStatus;
  /** Decimal string — recomputed SUM of the invoice's payments. */
  amountPaid: string;
  /** Decimal string — max(0, grandTotal − amountPaid). */
  remainingAfter: string;
}

export interface PaymentPanelPermissions {
  /** Record Payment button — STAFF+ and only where the service accepts it. */
  record: boolean;
  /** Reversal (delete) — OWNER/ADMIN only. */
  reverse: boolean;
  /** Overpayment override with a reason (else a plain confirmation). */
  override: boolean;
}

/** The invoice detail read model for the "Riwayat pembayaran" card. */
export interface InvoicePaymentPanel {
  invoiceId: string;
  invoiceLabel: string;
  customerName: string;
  status: InvoiceStatus;
  grandTotal: string;
  amountPaid: string;
  remainingAfter: string;
  rows: PaymentRowView[];
  /** True when more payments exist than the display cap returns. */
  truncated: boolean;
  permissions: PaymentPanelPermissions;
}

/** A payable invoice in the record-payment picker (/payments page). */
export interface PayableInvoiceOption {
  id: string;
  label: string;
  customerName: string;
  status: InvoiceStatus;
  grandTotal: string;
  amountPaid: string;
  /** max(0, grandTotal − amountPaid) — decimal string. */
  remaining: string;
}

type PaymentRow = Awaited<ReturnType<typeof loadRows>>[number];

const paymentInclude = {
  invoice: {
    select: {
      id: true,
      number: true,
      numberPreview: true,
      customerId: true,
      status: true,
      grandTotal: true,
      amountPaid: true,
      remainingAfter: true,
      customer: { select: { companyName: true } },
    },
  },
  createdBy: { select: { id: true, name: true, username: true } },
} satisfies Prisma.PaymentInclude;

/** Newest first, with `id` as the final tiebreaker so pagination is stable. */
const paymentOrderBy = [
  { paymentDate: "desc" },
  { createdAt: "desc" },
  { id: "desc" },
] satisfies Prisma.PaymentOrderByWithRelationInput[];

async function loadRows(where: Prisma.PaymentWhereInput, page?: { skip: number; take: number }) {
  return db.payment.findMany({
    where,
    orderBy: paymentOrderBy,
    ...(page ? { skip: page.skip, take: page.take } : {}),
    include: paymentInclude,
  });
}

function invoiceLabel(row: {
  number: string | null;
  numberPreview: string | null;
}): string {
  return row.number ?? row.numberPreview ?? "Draft";
}

function toPaymentRow(row: PaymentRow): PaymentRowView {
  const invoice = row.invoice;
  return {
    id: row.id,
    invoiceId: invoice.id,
    invoiceLabel: invoiceLabel(invoice),
    customerId: invoice.customerId,
    customerName: invoice.customer.companyName,
    paymentDate: toCalendarInput(row.paymentDate.toISOString()),
    amount: row.amount.toString(),
    method: row.method,
    referenceNumber: row.referenceNumber,
    notes: row.notes,
    overpaymentReason: row.overpaymentReason,
    proofPath: row.proofPath,
    recordedByName: row.createdBy.name ?? row.createdBy.username ?? row.createdBy.id,
    createdAt: row.createdAt.toISOString(),
  };
}

function money(value: Decimal | string): string {
  return new Decimal(value).toFixed(2);
}

// ─── Record payment (STAFF+, transactional) ──────────────────────────────

export async function recordPayment(
  invoiceId: string,
  input: RecordPaymentPayload,
  ctx: PaymentServiceContext,
  options: { proof?: File | null } = {},
): Promise<PaymentOutcome> {
  assertCan("payment.record", ctx.scope);
  requireOrgScope(ctx.scope);

  if (!invoiceId) {
    throw new AppError("VALIDATION_ERROR", "Invoice wajib dipilih.");
  }
  const parsed = recordPaymentPayloadSchema.safeParse(input);
  if (!parsed.success) {
    throw new AppError("VALIDATION_ERROR", firstZodMessage(parsed.error));
  }
  const values = parsed.data;
  const amount = new Decimal(values.amount);
  if (amount.lte(0)) {
    throw new AppError("VALIDATION_ERROR", "Nominal harus lebih dari 0.");
  }
  const paymentDate = parseCalendarDate(values.paymentDate);
  if (!paymentDate || Number.isNaN(paymentDate.getTime())) {
    throw new AppError("VALIDATION_ERROR", "Tanggal pembayaran tidak valid.");
  }

  // Proof upload BEFORE the transaction: a validation error (over 2 MB, fake
  // MIME) never opens a transaction, and a failed transaction cleans the
  // already-written file up below (best-effort — storage is not transactional).
  const proof = options.proof ?? null;
  const storedProof =
    proof && proof.size > 0
      ? await getStorageService().upload(proof, {
          orgId: ctx.scope.organizationId,
          kind: PROOF_KIND,
          allowedMimeTypes: PROOF_MIME_TYPES,
        })
      : null;

  try {
    return await db.$transaction(
      async (tx) => {
        // Row lock: two concurrent recordings on the same invoice serialize
        // here, so the SUM + status recompute can never race.
        await tx.$queryRaw`SELECT id FROM "Invoice" WHERE id = ${invoiceId} FOR UPDATE`;
        const invoice = await tx.invoice.findUnique({ where: { id: invoiceId } });
        if (!invoice || invoice.organizationId !== ctx.scope.organizationId) {
          // IDOR guard: a foreign invoice id answers 404, never 403.
          throw new AppError("NOT_FOUND", "Invoice tidak ditemukan.");
        }
        // DRAFT / CANCELLED / REVISED are rejected (spec) — checked on the
        // FRESH row inside the lock, not on a stale read from the page.
        assertPayable(invoice.status);

        const grandTotal = new Decimal(invoice.grandTotal.toString());
        const paidBefore = new Decimal(invoice.amountPaid.toString());
        const remaining = grandTotal.minus(paidBefore);
        const overpayment = amount.gt(remaining);
        if (overpayment) {
          // Spec: STAFF needs a confirmation, OWNER/ADMIN override with a
          // reason. Both are re-validated HERE — the client's checkbox or
          // textarea is never trusted on its own.
          const reason = (values.overpaymentReason ?? "").trim();
          if (can("payment.override", ctx.scope)) {
            if (reason.length === 0) {
              throw new AppError(
                "VALIDATION_ERROR",
                `Nominal melebihi sisa tagihan ${money(remaining)} — alasan override wajib diisi.`,
                { remaining: money(remaining) },
              );
            }
          } else if (!values.confirmOverpayment) {
            throw new AppError(
              "VALIDATION_ERROR",
              `Nominal melebihi sisa tagihan ${money(remaining)} — konfirmasi untuk melanjutkan.`,
              { remaining: money(remaining) },
            );
          }
        }

        const payment = await tx.payment.create({
          data: {
            organizationId: ctx.scope.organizationId,
            invoiceId,
            paymentDate,
            amount: money(amount),
            method: values.method,
            referenceNumber: values.referenceNumber?.trim() || null,
            notes: values.notes?.trim() || null,
            proofPath: storedProof?.path ?? null,
            overpaymentReason: overpayment ? (values.overpaymentReason ?? "").trim() || null : null,
            createdById: ctx.scope.userId,
          },
        });

        // The invoice's money comes from the ROWS, always.
        const sum = await tx.payment.aggregate({
          where: { invoiceId },
          _sum: { amount: true },
        });
        const amountPaid = new Decimal(sum._sum.amount?.toString() ?? "0");
        const status = recomputePaymentStatus({
          status: invoice.status,
          grandTotal: money(grandTotal),
          amountPaid: money(amountPaid),
        });

        await tx.invoice.update({
          where: { id: invoiceId },
          data: {
            amountPaid: money(amountPaid),
            remainingAfter: remainingAfterPayment(money(grandTotal), money(amountPaid)),
            status,
          },
        });

        // Metadata: ids, money and flags only — no free text beyond the
        // reason LENGTH, and never an account number (security-standards).
        await log(
          {
            actorUserId: ctx.scope.userId,
            organizationId: ctx.scope.organizationId,
            action: "PAYMENT_RECORDED",
            entityType: "payment",
            entityId: payment.id,
            metadata: {
              invoiceId,
              invoiceNumber: invoice.number ?? invoice.numberPreview ?? null,
              amount: money(amount),
              method: values.method,
              status,
              overpayment,
              ...(overpayment
                ? { reasonLength: (values.overpaymentReason ?? "").trim().length }
                : {}),
              hasProof: storedProof !== null,
            },
            request: ctx.request ?? null,
          },
          tx,
        );

        return {
          paymentId: payment.id,
          invoiceId,
          status,
          amountPaid: money(amountPaid),
          remainingAfter: remainingAfterPayment(money(grandTotal), money(amountPaid)),
        };
      },
      { timeout: 20_000 },
    );
  } catch (error) {
    if (storedProof) {
      await getStorageService()
        .delete(storedProof.path)
        .catch((err: unknown) =>
          logger.warn(
            { module: "payments", err: err instanceof Error ? err.message : String(err) },
            "bukti pembayaran gagal dibersihkan setelah transaksi gagal",
          ),
        );
    }
    throw error;
  }
}

// ─── Delete payment / reversal (OWNER/ADMIN) ─────────────────────────────

/**
 * Reversal: the row (and its proof file) is removed, the invoice's payment
 * columns are recomputed from the remaining rows, and the audit keeps the
 * fact with `metadata.reversed = true` (spec step 6). A CANCELLED/REVISED
 * invoice keeps its status — a reversal never resurrects a closed document.
 */
export async function deletePayment(
  paymentId: string,
  ctx: PaymentServiceContext,
): Promise<PaymentOutcome> {
  assertCan("payment.delete", ctx.scope);
  requireOrgScope(ctx.scope);

  if (!paymentId) {
    throw new AppError("VALIDATION_ERROR", "Pembayaran tidak valid.");
  }
  const existing = await db.payment.findUnique({ where: { id: paymentId } });
  if (!existing || existing.organizationId !== ctx.scope.organizationId) {
    // IDOR guard: a foreign payment id answers 404.
    throw new AppError("NOT_FOUND", "Pembayaran tidak ditemukan.");
  }

  const outcome = await db.$transaction(
    async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Invoice" WHERE id = ${existing.invoiceId} FOR UPDATE`;
      const invoice = await tx.invoice.findUnique({ where: { id: existing.invoiceId } });
      if (!invoice || invoice.organizationId !== ctx.scope.organizationId) {
        throw new AppError("NOT_FOUND", "Invoice tidak ditemukan.");
      }

      const deleted = await tx.payment.delete({ where: { id: paymentId } });

      const sum = await tx.payment.aggregate({
        where: { invoiceId: invoice.id },
        _sum: { amount: true },
      });
      const amountPaid = new Decimal(sum._sum.amount?.toString() ?? "0");
      const grandTotal = new Decimal(invoice.grandTotal.toString());
      const status = isPayable(invoice.status)
        ? recomputePaymentStatus({
            status: invoice.status,
            grandTotal: money(grandTotal),
            amountPaid: money(amountPaid),
          })
        : invoice.status;

      await tx.invoice.update({
        where: { id: invoice.id },
        data: {
          amountPaid: money(amountPaid),
          remainingAfter: remainingAfterPayment(money(grandTotal), money(amountPaid)),
          status,
        },
      });

      await log(
        {
          actorUserId: ctx.scope.userId,
          organizationId: ctx.scope.organizationId,
          action: "PAYMENT_RECORDED",
          entityType: "payment",
          entityId: paymentId,
          metadata: {
            reversed: true,
            invoiceId: invoice.id,
            invoiceNumber: invoice.number ?? invoice.numberPreview ?? null,
            amount: money(deleted.amount),
            method: deleted.method,
            status,
            hadProof: deleted.proofPath !== null,
          },
          request: ctx.request ?? null,
        },
        tx,
      );

      return {
        paymentId,
        invoiceId: invoice.id,
        status,
        amountPaid: money(amountPaid),
        remainingAfter: remainingAfterPayment(money(grandTotal), money(amountPaid)),
      };
    },
    { timeout: 20_000 },
  );

  // Proof file cleanup AFTER commit — best-effort, the row is already gone.
  if (existing.proofPath) {
    await getStorageService()
      .delete(existing.proofPath)
      .catch((err: unknown) =>
        logger.warn(
          { module: "payments", err: err instanceof Error ? err.message : String(err) },
          "bukti pembayaran gagal dihapus dari storage",
        ),
      );
  }

  return outcome;
}

// ─── Reads ───────────────────────────────────────────────────────────────

/** "YYYY-MM-DD" → Date range bounds; a present-but-malformed value is an
 * error (server validation — never silently ignored). */
function dateRange(
  from: string | undefined,
  to: string | undefined,
): { gte?: Date; lte?: Date } | null {
  const rawFrom = (from ?? "").trim();
  const rawTo = (to ?? "").trim();
  if (!rawFrom && !rawTo) return null;

  const parse = (value: string, label: string): Date => {
    const parsed = parseCalendarDate(value);
    if (!parsed || Number.isNaN(parsed.getTime()) || toCalendarInput(parsed.toISOString()) !== value) {
      throw new AppError("VALIDATION_ERROR", `Format tanggal ${label} tidak valid.`);
    }
    return parsed;
  };

  const range: { gte?: Date; lte?: Date } = {};
  if (rawFrom) range.gte = parse(rawFrom, "mulai");
  if (rawTo) {
    const end = parse(rawTo, "akhir");
    // paymentDate is stored as UTC midnight — include the whole "to" day.
    range.lte = new Date(end.getTime() + 24 * 60 * 60 * 1000 - 1);
  }
  if (range.gte && range.lte && range.gte.getTime() > range.lte.getTime()) {
    throw new AppError("VALIDATION_ERROR", "Rentang tanggal tidak valid.");
  }
  return range;
}

/**
 * Server-side list of an organization's payments: pagination + invoice /
 * customer / date filters, always org-scoped, pageSize capped (spec: halaman
 * `/payments`).
 */
export async function listPayments(
  ctx: PaymentServiceContext,
  query: PaymentListQuery = {},
): Promise<PaymentListResult> {
  assertCan("payment.view", ctx.scope);
  requireOrgScope(ctx.scope);

  const pageSize = Math.min(Math.max(query.pageSize ?? 20, 1), MAX_LIST_PAGE_SIZE);
  const invoice = (query.invoice ?? "").trim().slice(0, 100);
  const customer = (query.customer ?? "").trim().slice(0, 100);
  const range = dateRange(query.from, query.to);

  const where: Prisma.PaymentWhereInput = {
    organizationId: ctx.scope.organizationId,
  };
  const invoiceWhere: Prisma.InvoiceWhereInput = {};
  if (invoice) {
    // Payments only exist on issued invoices — always a final number. The
    // draft numberPreview is deliberately NOT searched: previews collide
    // between neighbours (invoice N's preview is invoice N+1's number).
    invoiceWhere.number = { contains: invoice, mode: "insensitive" as const };
  }
  if (customer) {
    invoiceWhere.customer = { companyName: { contains: customer, mode: "insensitive" as const } };
  }
  if (invoice || customer) where.invoice = invoiceWhere;
  if (range) where.paymentDate = range;

  const total = await db.payment.count({ where });
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(Math.max(query.page ?? 1, 1), totalPages);
  const rows = await loadRows(where, { skip: (page - 1) * pageSize, take: pageSize });

  return {
    rows: rows.map(toPaymentRow),
    total,
    page,
    pageSize,
    totalPages,
  };
}

/**
 * "Riwayat pembayaran" for one invoice (detail page). Org-scoped: a foreign
 * invoice id answers 404. VIEWER reads (payment.view), STAFF+ gets the
 * Record Payment flag, OWNER/ADMIN the reversal flag.
 */
export async function getInvoicePaymentPanel(
  invoiceId: string,
  ctx: PaymentServiceContext,
): Promise<InvoicePaymentPanel> {
  assertCan("payment.view", ctx.scope);
  requireOrgScope(ctx.scope);

  const invoice = await db.invoice.findUnique({
    where: { id: invoiceId },
    select: {
      id: true,
      organizationId: true,
      number: true,
      numberPreview: true,
      status: true,
      grandTotal: true,
      amountPaid: true,
      remainingAfter: true,
      customer: { select: { companyName: true } },
    },
  });
  if (!invoice || invoice.organizationId !== ctx.scope.organizationId) {
    throw new AppError("NOT_FOUND", "Invoice tidak ditemukan.");
  }

  const [rows, total] = await Promise.all([
    loadRows({ invoiceId }, { skip: 0, take: MAX_LIST_PAGE_SIZE }),
    db.payment.count({ where: { invoiceId } }),
  ]);
  return {
    invoiceId: invoice.id,
    invoiceLabel: invoiceLabel(invoice),
    customerName: invoice.customer.companyName,
    status: invoice.status,
    grandTotal: money(invoice.grandTotal.toString()),
    amountPaid: money(invoice.amountPaid.toString()),
    remainingAfter: money(invoice.remainingAfter.toString()),
    rows: rows.map(toPaymentRow),
    /** True when the riwayat hit the display cap (the sum still counts all rows). */
    truncated: total > rows.length,
    permissions: {
      // Buttons only exist where the SERVICE would accept the action
      // (non-negotiables: no fake buttons).
      record: can("payment.record", ctx.scope) && isPayable(invoice.status),
      reverse: can("payment.delete", ctx.scope),
      override: can("payment.override", ctx.scope),
    },
  };
}

/**
 * Payable invoices for the record-payment picker on `/payments` — capped,
 * org-scoped, permission-gated by payment.record (nobody else needs it).
 */
export async function listPayableInvoices(
  ctx: PaymentServiceContext,
): Promise<PayableInvoiceOption[]> {
  assertCan("payment.record", ctx.scope);
  requireOrgScope(ctx.scope);

  const rows = await db.invoice.findMany({
    where: {
      organizationId: ctx.scope.organizationId,
      status: { in: [...PAYABLE_STATUSES] },
    },
    orderBy: [{ invoiceDate: "desc" }, { createdAt: "desc" }],
    take: PAYABLE_INVOICE_LIMIT,
    select: {
      id: true,
      number: true,
      numberPreview: true,
      status: true,
      grandTotal: true,
      amountPaid: true,
      customer: { select: { companyName: true } },
    },
  });

  return rows.map((row) => {
    const grandTotal = money(row.grandTotal.toString());
    const amountPaid = money(row.amountPaid.toString());
    return {
      id: row.id,
      label: invoiceLabel(row),
      customerName: row.customer.companyName,
      status: row.status,
      grandTotal,
      amountPaid,
      remaining: remainingAfterPayment(grandTotal, amountPaid),
    };
  });
}
