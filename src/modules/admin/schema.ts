// src/modules/admin/schema.ts
// Feature 09 — input contract for the super-admin list views. Kept OUT of any
// `"use client"` module (feature 07 lesson: constants imported from a client
// module become client references in a server page and turn into NaN).
//
// Validation policy mirrors feature 08's query-service: page numbers are
// clamped server-side, while malformed filter values (bad date, unknown
// status) raise VALIDATION_ERROR instead of being silently ignored.

import { z } from "zod";
import { AuditAction, InvoiceStatus, PdfJobStatus } from "@prisma/client";

/** Rows per admin list page (URL-driven `?page=`, clamped ≥ 1). */
export const ADMIN_PAGE_SIZE = 20;

/**
 * String field restricted to a value set, with an Indonesian message (zod's
 * default enum error text is English — UI errors are Bahasa Indonesia).
 * The type predicate narrows the output back to the union.
 */
function enumField<T extends string>(values: readonly T[], message: string) {
  return z
    .string()
    .refine((value): value is T => values.includes(value as T), { message });
}

const dateField = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Format tanggal harus YYYY-MM-DD.");

const pageField = z.coerce.number().int().min(1).max(100_000);

const INVOICE_STATUS_VALUES = Object.values(InvoiceStatus);
const PDF_JOB_STATUS_VALUES = Object.values(PdfJobStatus);
const AUDIT_ACTION_VALUES = Object.values(AuditAction);

export const adminInvoiceQuerySchema = z.object({
  page: pageField.optional(),
  q: z.string().trim().max(100).optional(),
  organizationId: z.string().trim().max(64).optional(),
  status: enumField(INVOICE_STATUS_VALUES, "Status filter tidak valid.").optional(),
  from: dateField.optional(),
  to: dateField.optional(),
});
export type AdminInvoiceQuery = z.input<typeof adminInvoiceQuerySchema>;
export type ParsedAdminInvoiceQuery = z.output<typeof adminInvoiceQuerySchema>;

export const adminAuditQuerySchema = z.object({
  page: pageField.optional(),
  action: enumField(AUDIT_ACTION_VALUES, "Filter aksi tidak valid.").optional(),
  actorUserId: z.string().trim().max(64).optional(),
  organizationId: z.string().trim().max(64).optional(),
  from: dateField.optional(),
  to: dateField.optional(),
});
export type AdminAuditQuery = z.input<typeof adminAuditQuerySchema>;
export type ParsedAdminAuditQuery = z.output<typeof adminAuditQuerySchema>;

export const adminPdfJobQuerySchema = z.object({
  page: pageField.optional(),
  status: enumField(PDF_JOB_STATUS_VALUES, "Filter status tidak valid.").optional(),
  invoice: z.string().trim().max(100).optional(),
});
export type AdminPdfJobQuery = z.input<typeof adminPdfJobQuerySchema>;
export type ParsedAdminPdfJobQuery = z.output<typeof adminPdfJobQuerySchema>;

export const setPlatformRoleSchema = z.object({
  userId: z.string().min(1, "User wajib dipilih."),
  platformRole: z.enum(["SUPER_ADMIN", "USER"], {
    message: "Platform role tidak valid.",
  }),
});
export type SetPlatformRoleInput = z.infer<typeof setPlatformRoleSchema>;

export const setOrganizationStatusSchema = z.object({
  organizationId: z.string().min(1, "Organisasi wajib dipilih."),
  status: z.enum(["ACTIVE", "SUSPENDED"], { message: "Status organisasi tidak valid." }),
});
export type SetOrganizationStatusInput = z.infer<typeof setOrganizationStatusSchema>;

export const retryPdfJobSchema = z.object({
  jobId: z.string().min(1, "Job PDF wajib dipilih."),
});
export type RetryPdfJobInput = z.infer<typeof retryPdfJobSchema>;
