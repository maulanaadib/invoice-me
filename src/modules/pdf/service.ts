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
import { logAudit } from "@/modules/audit/service";
import { assertCan, requireOrgScope } from "@/modules/permissions/service";
import { getStorageService } from "@/modules/storage";
import { safePdfFilename } from "@/modules/pdf/client";
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

/** The stored official PDF of an invoice (feature 06) — honest null when the
 *  file does not exist yet; never a placeholder link. */
export interface OfficialPdfView {
  filename: string;
  storagePath: string;
  sizeBytes: number;
  sha256: string;
  version: number;
  generatedAt: string;
}

/** Org-scoped (IDOR guard → 404). Read-only; no audit — downloads audit. */
export async function getOfficialPdf(
  invoiceId: string,
  ctx: PdfServiceContext,
): Promise<OfficialPdfView | null> {
  requireOrgScope(ctx.scope);
  const invoice = await db.invoice.findUnique({
    where: { id: invoiceId },
    select: { id: true, organizationId: true, pdfPath: true },
  });
  if (!invoice || invoice.organizationId !== ctx.scope.organizationId) {
    throw new AppError("NOT_FOUND", "Invoice tidak ditemukan.");
  }
  if (!invoice.pdfPath) return null;
  const pdf = await db.invoicePdf.findFirst({
    where: { invoiceId },
    orderBy: { version: "desc" },
    select: {
      storagePath: true,
      originalFilename: true,
      sizeBytes: true,
      sha256: true,
      version: true,
      generatedAt: true,
    },
  });
  if (!pdf) return null;
  return {
    filename: pdf.originalFilename,
    storagePath: pdf.storagePath,
    sizeBytes: Number(pdf.sizeBytes),
    sha256: pdf.sha256,
    version: pdf.version,
    generatedAt: pdf.generatedAt.toISOString(),
  };
}

export interface PdfDownload {
  bytes: Buffer;
  filename: string;
  sizeBytes: number;
}

/**
 * Secure download (feature 06 spec): session org scope + `invoice.download`
 * permission + org ownership (foreign id → 404) + the file must actually
 * exist (no PDF yet → 404, never a stub). Writes PDF_DOWNLOADED with the
 * requesting user as actor. The bytes are re-verified as a real PDF before
 * they leave the server.
 */
export async function downloadOfficialPdf(
  invoiceId: string,
  ctx: PdfServiceContext,
): Promise<PdfDownload> {
  assertCan("invoice.download", ctx.scope);
  requireOrgScope(ctx.scope);

  const invoice = await db.invoice.findUnique({
    where: { id: invoiceId },
    select: { id: true, organizationId: true, number: true, pdfPath: true },
  });
  if (!invoice || invoice.organizationId !== ctx.scope.organizationId) {
    throw new AppError("NOT_FOUND", "Invoice tidak ditemukan.");
  }
  if (!invoice.pdfPath) {
    throw new AppError("NOT_FOUND", "PDF invoice ini belum tersedia.");
  }

  const storage = getStorageService();
  const { data, mimeType } = await storage.read(invoice.pdfPath);
  if (mimeType !== "application/pdf" || data.subarray(0, 5).toString("latin1") !== "%PDF-") {
    throw new AppError("INTERNAL_ERROR", "File PDF tidak valid.");
  }

  const pdf = await db.invoicePdf.findFirst({
    where: { invoiceId },
    orderBy: { version: "desc" },
    select: { originalFilename: true, version: true },
  });
  const filename = pdf?.originalFilename ?? safePdfFilename(invoice.id, invoice.number);

  await logAudit({
    actorUserId: ctx.scope.userId,
    organizationId: invoice.organizationId,
    action: "PDF_DOWNLOADED",
    entityType: "InvoicePdf",
    entityId: invoiceId,
    metadata: {
      filename,
      sizeBytes: data.length,
      version: pdf?.version ?? null,
    },
    request: ctx.request ?? null,
  });

  return { bytes: data, filename, sizeBytes: data.length };
}
