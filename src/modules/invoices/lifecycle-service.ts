// src/modules/invoices/lifecycle-service.ts
// Invoice lifecycle AFTER issue (feature 05): mark sent, cancel with a
// mandatory reason, create a revision, and the on-read OVERDUE evaluation.
//
//   ISSUED → SENT            (STAFF+, audit INVOICE_SENT)
//   ISSUED/SENT/PARTIALLY_PAID → CANCELLED (OWNER/ADMIN, reason required,
//                                 audit INVOICE_CANCELLED, excluded from
//                                 previouslyBilled)
//   issued family → REVISED  (OWNER/ADMIN: old row keeps its history with
//                                 replacedById, a NEW draft copies the data,
//                                 audit INVOICE_REVISED)
//   OVERDUE                  — on-read only in this feature (due date passed
//                                 while still ISSUED/SENT/PARTIALLY_PAID);
//                                 the scheduled sweep is feature 11.
//
// Nothing here ever edits a financial column of an issued invoice: cancellation
// and revision change STATUS + LINKS only (invariant 5 — edit = new draft).

import { AppError } from "@/lib/errors";
import { db } from "@/server/db";
import { todayInJakarta, toCalendarInput } from "@/lib/date";
import { log } from "@/modules/audit/service";
import { assertCan, requireOrgScope } from "@/modules/permissions/service";
import { buildNumberPreview } from "@/modules/invoices/numbering";
import { sumBilledForProject } from "@/modules/invoices/billed";
import { calcFromRows, type InvoiceServiceContext } from "@/modules/invoices/service";
import type { Invoice, InvoiceStatus } from "@prisma/client";

// ─── OVERDUE (on-read; scheduled sweep belongs to feature 11) ─────────────

/** Stored statuses that can still become overdue. PAID is settled, DRAFT is
 * not a bill, CANCELLED/REVISED are excluded by definition. */
export const OVERDUE_ELIGIBLE_STATUSES: readonly InvoiceStatus[] = [
  "ISSUED",
  "SENT",
  "PARTIALLY_PAID",
];

/** dueDate is a stored calendar day (UTC midnight). Overdue = that day is
 * strictly BEFORE today in the business timezone (Asia/Jakarta). */
export function isPastDue(dueDate: Date | null, now: Date = new Date()): boolean {
  if (!dueDate) return false;
  return toCalendarInput(dueDate.toISOString()) < todayInJakarta(now);
}

export function isOverdue(
  invoice: Pick<Invoice, "status" | "dueDate">,
  now: Date = new Date(),
): boolean {
  return OVERDUE_ELIGIBLE_STATUSES.includes(invoice.status) && isPastDue(invoice.dueDate, now);
}

/**
 * The status the UI must SHOW for an invoice (spec: recomputeOverdue — on-read
 * variant). The stored column is untouched: an invoice past its due date keeps
 * ISSUED/SENT/PARTIALLY_PAID in the database and only the read path reports
 * OVERDUE until the feature-11 scheduled job persists it.
 */
export function recomputeOverdue(
  invoice: Pick<Invoice, "status" | "dueDate">,
  now: Date = new Date(),
): InvoiceStatus {
  return isOverdue(invoice, now) ? "OVERDUE" : invoice.status;
}

// ─── Cancel reason ────────────────────────────────────────────────────────

export const CANCEL_REASON_MAX = 500;

/** Mandatory reason (spec): trimmed, never empty, bounded length. */
export function validateCancelReason(reason: string | null | undefined): string {
  const trimmed = (reason ?? "").trim();
  if (trimmed.length === 0) {
    throw new AppError("VALIDATION_ERROR", "Alasan pembatalan wajib diisi.");
  }
  if (trimmed.length > CANCEL_REASON_MAX) {
    throw new AppError(
      "VALIDATION_ERROR",
      `Alasan pembatalan maksimal ${CANCEL_REASON_MAX} karakter.`,
    );
  }
  return trimmed;
}

// ─── Shared guards ────────────────────────────────────────────────────────

async function getScopedInvoice(invoiceId: string, ctx: InvoiceServiceContext): Promise<Invoice> {
  const invoice = await db.invoice.findUnique({ where: { id: invoiceId } });
  if (!invoice || invoice.organizationId !== ctx.scope.organizationId) {
    // IDOR guard: a foreign invoice id answers 404, never "exists elsewhere".
    throw new AppError("NOT_FOUND", "Invoice tidak ditemukan.");
  }
  return invoice;
}

/** Statuses a cancellation is allowed to touch (spec: issued documents).
 * Feature 11A adds OVERDUE — the sweep persists it, and a late invoice must
 * stay cancellable (e.g. settled out of band, or written off). */
export const CANCELABLE_STATUSES: readonly InvoiceStatus[] = [
  "ISSUED",
  "SENT",
  "PARTIALLY_PAID",
  "OVERDUE",
];

/** Statuses a revision is allowed to touch (unpaid issued documents — a
 * settled or cancelled document is not rewritten, it is what the books say).
 * Feature 11A adds OVERDUE — same reasoning as cancellation. */
export const REVISABLE_STATUSES: readonly InvoiceStatus[] = [
  "ISSUED",
  "SENT",
  "PARTIALLY_PAID",
  "OVERDUE",
];

function assertCancellable(invoice: Invoice): void {
  if (CANCELABLE_STATUSES.includes(invoice.status)) return;
  if (invoice.status === "DRAFT") {
    throw new AppError("LOCKED", "Invoice masih draft — hapus draft, bukan membatalkan.");
  }
  if (invoice.status === "PAID") {
    throw new AppError("LOCKED", "Invoice sudah lunas dan tidak dapat dibatalkan.");
  }
  if (invoice.status === "CANCELLED") {
    throw new AppError("LOCKED", "Invoice sudah pernah dibatalkan.");
  }
  if (invoice.status === "REVISED") {
    throw new AppError("LOCKED", "Invoice sudah digantikan revisi dan tidak dapat dibatalkan.");
  }
  throw new AppError("LOCKED", "Status invoice tidak mengizinkan pembatalan.");
}

function assertRevisable(invoice: Invoice): void {
  if (REVISABLE_STATUSES.includes(invoice.status)) return;
  if (invoice.status === "DRAFT") {
    throw new AppError("LOCKED", "Draft belum terbit — edit draft langsung, bukan revisi.");
  }
  if (invoice.status === "PAID") {
    throw new AppError("LOCKED", "Invoice sudah lunas — buat invoice baru, bukan revisi.");
  }
  if (invoice.status === "CANCELLED") {
    throw new AppError("LOCKED", "Invoice dibatalkan — buat invoice baru, bukan revisi.");
  }
  if (invoice.status === "REVISED") {
    throw new AppError("CONFLICT", "Invoice sudah direvisi — revisi hanya bisa dibuat sekali.");
  }
  throw new AppError("LOCKED", "Status invoice tidak mengizinkan revisi.");
}

// ─── Mark sent (STAFF+) ───────────────────────────────────────────────────

export interface MarkSentOutcome {
  invoiceId: string;
  status: InvoiceStatus;
}

export async function markSent(
  invoiceId: string,
  ctx: InvoiceServiceContext,
): Promise<MarkSentOutcome> {
  assertCan("invoice.markSent", ctx.scope);
  requireOrgScope(ctx.scope);

  const invoice = await getScopedInvoice(invoiceId, ctx);
  if (invoice.status !== "ISSUED") {
    if (invoice.status === "DRAFT") {
      throw new AppError("LOCKED", "Invoice belum diterbitkan — terbitkan dulu.");
    }
    if (invoice.status === "SENT") {
      throw new AppError("LOCKED", "Invoice sudah ditandai terkirim.");
    }
    throw new AppError("LOCKED", "Hanya invoice terbit yang bisa ditandai terkirim.");
  }

  await db.$transaction(async (tx) => {
    const updated = await tx.invoice.updateMany({
      where: { id: invoiceId, status: "ISSUED" },
      data: { status: "SENT" },
    });
    if (updated.count !== 1) {
      throw new AppError("LOCKED", "Status invoice berubah — muat ulang halaman.");
    }
    await log(
      {
        actorUserId: ctx.scope.userId,
        organizationId: ctx.scope.organizationId,
        action: "INVOICE_SENT",
        entityType: "invoice",
        entityId: invoiceId,
        metadata: { number: invoice.number },
        request: ctx.request ?? null,
      },
      tx,
    );
  });

  return { invoiceId, status: "SENT" };
}

// ─── Cancel (OWNER/ADMIN, reason mandatory) ───────────────────────────────

export interface CancelOutcome {
  invoiceId: string;
  status: InvoiceStatus;
  cancellationReason: string;
}

export async function cancelInvoice(
  invoiceId: string,
  reason: string | null | undefined,
  ctx: InvoiceServiceContext,
): Promise<CancelOutcome> {
  assertCan("invoice.cancel", ctx.scope);
  requireOrgScope(ctx.scope);
  const cancellationReason = validateCancelReason(reason);

  const invoice = await getScopedInvoice(invoiceId, ctx);
  assertCancellable(invoice);

  const cancelledAt = new Date();
  await db.$transaction(async (tx) => {
    const updated = await tx.invoice.updateMany({
      where: { id: invoiceId, status: { in: [...CANCELABLE_STATUSES] } },
      data: { status: "CANCELLED", cancelledAt, cancellationReason },
    });
    if (updated.count !== 1) {
      throw new AppError("LOCKED", "Status invoice berubah — muat ulang halaman.");
    }
    // Reason is stored on the invoice row; the audit metadata keeps only the
    // fact (no free text → no customer PII leaking into the audit table).
    await log(
      {
        actorUserId: ctx.scope.userId,
        organizationId: ctx.scope.organizationId,
        action: "INVOICE_CANCELLED",
        entityType: "invoice",
        entityId: invoiceId,
        metadata: { number: invoice.number, reasonLength: cancellationReason.length },
        request: ctx.request ?? null,
      },
      tx,
    );
  });

  // CANCELLED drops out of BILLED_STATUSES → later drafts/settlements no
  // longer count it (invariant 6, enforced in modules/invoices/billed.ts).
  return { invoiceId, status: "CANCELLED", cancellationReason };
}

// ─── Create revision (OWNER/ADMIN) ────────────────────────────────────────

export interface RevisionOutcome {
  originalId: string;
  draftId: string;
}

/**
 * Old invoice → REVISED (replacedById set), new DRAFT copied from it with
 * revisedFromId set. The copy is a normal draft: editable, deletable, and
 * issueable — issuing it allocates its OWN number later.
 *
 * previouslyBilled of the copy is recomputed with the ORIGINAL excluded, so
 * the superseded invoice stops counting and the work is never billed twice
 * (invariant 6: REVISED is excluded).
 */
export async function createRevision(
  invoiceId: string,
  ctx: InvoiceServiceContext,
): Promise<RevisionOutcome> {
  assertCan("invoice.revise", ctx.scope);
  requireOrgScope(ctx.scope);

  const original = await getScopedInvoice(invoiceId, ctx);
  assertRevisable(original);

  return db.$transaction(
    async (tx) => {
      // Row lock: a concurrent "Create revisi" click waits here, then reads
      // REVISED and is rejected — exactly one revision per invoice.
      await tx.$queryRaw`SELECT id FROM "Invoice" WHERE id = ${invoiceId} FOR UPDATE`;

      const fresh = await tx.invoice.findUnique({ where: { id: invoiceId } });
      if (!fresh || fresh.organizationId !== ctx.scope.organizationId) {
        throw new AppError("NOT_FOUND", "Invoice tidak ditemukan.");
      }
      assertRevisable(fresh);

      // Recompute the copy's billed context WITHOUT the original (it is about
      // to become REVISED anyway — the sum must not double-count the pair).
      const previouslyBilled = await sumBilledForProject(tx, {
        organizationId: ctx.scope.organizationId,
        projectReferenceId: fresh.projectReferenceId,
        excludeInvoiceId: fresh.id,
      });

      const created = await tx.invoice.create({
        data: {
          organizationId: fresh.organizationId,
          createdById: ctx.scope.userId,
          profileId: fresh.profileId,
          customerId: fresh.customerId,
          customerContactId: fresh.customerContactId,
          projectReferenceId: fresh.projectReferenceId,
          invoiceType: fresh.invoiceType,
          status: "DRAFT",
          number: null,
          numberPreview: null,
          invoiceDate: fresh.invoiceDate,
          dueDate: fresh.dueDate,
          referenceType: fresh.referenceType,
          referenceNumber: fresh.referenceNumber,
          referenceDate: fresh.referenceDate,
          paymentTerms: fresh.paymentTerms,
          currency: fresh.currency,
          workValue: fresh.workValue,
          workValueOverride: fresh.workValueOverride,
          workValueReason: fresh.workValueReason,
          itemsSubtotal: fresh.itemsSubtotal,
          previouslyBilled,
          billingPercent: fresh.billingPercent,
          billingMode: fresh.billingMode,
          billingAmount: fresh.billingAmount,
          termName: fresh.termName,
          termNumber: fresh.termNumber,
          customLabel: fresh.customLabel,
          customReason: fresh.customReason,
          billingBase: fresh.billingBase,
          discountAmount: fresh.discountAmount,
          additionalAmount: fresh.additionalAmount,
          taxMode: fresh.taxMode,
          taxPercent: fresh.taxPercent,
          taxAmount: fresh.taxAmount,
          roundingAmount: fresh.roundingAmount,
          grandTotal: fresh.grandTotal,
          notes: fresh.notes,
          footerText: fresh.footerText,
          stampMode: fresh.stampMode,
          signerId: fresh.signerId,
          bankAccountId: fresh.bankAccountId,
          revisedFromId: fresh.id,
          // amountPaid/remainingAfter start fresh: the copy is a NEW document
          // (payments of the original stay with the original — feature 07).
        },
        select: { id: true },
      });

      const originalItems = await tx.invoiceItem.findMany({
        where: { invoiceId },
        orderBy: { position: "asc" },
      });
      if (originalItems.length > 0) {
        await tx.invoiceItem.createMany({
          data: originalItems.map((item) => ({
            invoiceId: created.id,
            position: item.position,
            description: item.description,
            details: item.details,
            quantity: item.quantity,
            unit: item.unit,
            unitPrice: item.unitPrice,
            discountAmount: item.discountAmount,
            lineAmount: item.lineAmount,
            metadata: item.metadata ?? undefined,
          })),
        });
      }

      // Old invoice keeps every value — status + link only (invariant 5).
      const updatedOriginal = await tx.invoice.updateMany({
        where: { id: invoiceId, status: { in: [...REVISABLE_STATUSES] } },
        data: { status: "REVISED", replacedById: created.id },
      });
      if (updatedOriginal.count !== 1) {
        throw new AppError("CONFLICT", "Invoice berubah — muat ulang halaman.");
      }

      // Recalculate the copy against the fresh billed context and give it a
      // non-binding draft number preview (feature 04 behaviour).
      const copyRow = await tx.invoice.findUnique({
        where: { id: created.id },
        include: {
          profile: true,
          customer: true,
          customerContact: { select: { id: true, name: true } },
          projectReference: { select: { id: true, title: true } },
          items: { orderBy: { position: "asc" as const } },
        },
      });
      if (!copyRow) throw new AppError("INTERNAL_ERROR", "Gagal membuat revisi invoice.");
      const calc = calcFromRows(copyRow, previouslyBilled);
      const numberPreview = await buildNumberPreview(copyRow.profile, copyRow.invoiceDate, tx);
      await tx.invoice.update({
        where: { id: created.id },
        data: {
          workValue: calc.workValue,
          itemsSubtotal: calc.itemsSubtotal,
          previouslyBilled: calc.previouslyBilled,
          billingBase: calc.billingBase,
          discountAmount: calc.discountAmount,
          additionalAmount: calc.additionalAmount,
          taxAmount: calc.taxAmount,
          roundingAmount: calc.roundingAmount,
          grandTotal: calc.grandTotal,
          numberPreview,
        },
      });

      await log(
        {
          actorUserId: ctx.scope.userId,
          organizationId: ctx.scope.organizationId,
          action: "INVOICE_REVISED",
          entityType: "invoice",
          entityId: invoiceId,
          metadata: {
            number: fresh.number,
            revisedInvoiceId: created.id,
            grandTotal: calc.grandTotal,
          },
          request: ctx.request ?? null,
        },
        tx,
      );

      return { originalId: invoiceId, draftId: created.id };
    },
    { timeout: 20_000 },
  );
}
