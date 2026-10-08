// src/modules/pdf/service.ts
// PdfJob queue, client side (feature 05 spec item 5). Feature 05 only
// ENQUEUES a PENDING job when an invoice is issued and reports its honest
// status in the UI — the worker that picks the job up, calls pdf-service and
// writes the InvoicePdf row is feature 06.
//
// Contract with the invoices module (architecture-standards "Cross Module
// Contracts"): issue flow calls `enqueuePdfJob()` INSIDE its transaction, so a
// job row exists exactly when an ISSUED row exists — no orphan jobs, no
// missing job after a rollback.

import { AppError } from "@/lib/errors";
import { requireOrgScope } from "@/modules/permissions/service";
import { db } from "@/server/db";
import type { OrganizationRole, PdfJob, PdfJobStatus, Prisma } from "@prisma/client";

export interface PdfServiceContext {
  scope: { organizationId: string; role: OrganizationRole; userId: string };
  request?: Request | null;
}

/** Latest job for an invoice (newest first) — used for the honest status UI. */
export interface PdfJobView {
  status: PdfJobStatus;
  attempt: number;
  errorMessage: string | null;
  createdAt: string;
}

export const PDF_STATUS_LABELS: Record<PdfJobStatus, string> = {
  PENDING: "PDF menunggu",
  RUNNING: "PDF sedang dibuat",
  SUCCESS: "PDF siap",
  FAILED: "PDF gagal dibuat",
};

/**
 * Enqueue the official-PDF job for an issued invoice. Pass `tx` to join the
 * issue transaction (feature 05 does — the job row commits atomically with
 * the issue). Org-scoped read first: a foreign invoice id answers 404.
 */
export async function enqueuePdfJob(
  invoiceId: string,
  ctx: PdfServiceContext,
  tx?: Prisma.TransactionClient,
): Promise<PdfJob> {
  requireOrgScope(ctx.scope);
  const client = tx ?? db;
  const invoice = await client.invoice.findUnique({
    where: { id: invoiceId },
    select: { id: true, organizationId: true },
  });
  if (!invoice || invoice.organizationId !== ctx.scope.organizationId) {
    throw new AppError("NOT_FOUND", "Invoice tidak ditemukan.");
  }
  return client.pdfJob.create({
    data: { invoiceId: invoice.id, status: "PENDING", attempt: 0 },
  });
}

/**
 * The invoice's newest PDF job, org-scoped (IDOR guard → 404). `null` means
 * no job was ever queued — the UI says so honestly instead of pretending a
 * file exists (feature 05 scope: no rendering, no fake download).
 */
export async function getPdfJob(
  invoiceId: string,
  ctx: PdfServiceContext,
  tx?: Prisma.TransactionClient,
): Promise<PdfJobView | null> {
  requireOrgScope(ctx.scope);
  const client = tx ?? db;
  const invoice = await client.invoice.findUnique({
    where: { id: invoiceId },
    select: { id: true, organizationId: true },
  });
  if (!invoice || invoice.organizationId !== ctx.scope.organizationId) {
    throw new AppError("NOT_FOUND", "Invoice tidak ditemukan.");
  }
  const job = await client.pdfJob.findFirst({
    where: { invoiceId },
    orderBy: { createdAt: "desc" },
    select: { status: true, attempt: true, errorMessage: true, createdAt: true },
  });
  if (!job) return null;
  return {
    status: job.status,
    attempt: job.attempt,
    errorMessage: job.errorMessage,
    createdAt: job.createdAt.toISOString(),
  };
}
