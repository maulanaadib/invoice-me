// src/modules/admin/audit-labels.ts
// Feature 09 — Bahasa Indonesia label for every AuditAction, used by the
// audit-log viewer, the organization "last activity" line and admin tables.
// Typed as `Record<AuditAction, string>` so a future enum value cannot be
// added without a label (typecheck fails until it is written).

import type { AuditAction } from "@prisma/client";

export const AUDIT_ACTION_LABELS: Record<AuditAction, string> = {
  LOGIN_SUCCESS: "Login berhasil",
  LOGIN_FAILED: "Login gagal",
  LOGOUT: "Logout",
  USER_CREATED: "User dibuat",
  USER_SUSPENDED: "User ditangguhkan",
  USER_ACTIVATED: "User diaktifkan",
  PASSWORD_RESET: "Kata sandi direset",
  PASSWORD_CHANGED: "Kata sandi diubah",
  SESSION_REVOKED: "Sesi dicabut",
  ORGANIZATION_CREATED: "Organisasi dibuat",
  MEMBERSHIP_CHANGED: "Keanggotaan diubah",
  PROFILE_CHANGED: "Profil invoice diubah",
  CUSTOMER_CREATED: "Customer dibuat",
  CUSTOMER_UPDATED: "Customer diperbarui",
  CUSTOMER_DELETED: "Customer dihapus",
  PROJECT_CREATED: "Project/PO dibuat",
  PROJECT_UPDATED: "Project/PO diperbarui",
  INVOICE_DRAFT_CREATED: "Draft invoice dibuat",
  INVOICE_UPDATED: "Invoice diperbarui",
  INVOICE_ISSUED: "Invoice diterbitkan",
  PDF_GENERATED: "PDF dibuat",
  PDF_DOWNLOADED: "PDF diunduh",
  INVOICE_SENT: "Invoice ditandai terkirim",
  INVOICE_CANCELLED: "Invoice dibatalkan",
  INVOICE_REVISED: "Invoice direvisi",
  PAYMENT_RECORDED: "Pembayaran dicatat",
  ADMIN_VIEWED_INVOICE: "Super admin membaca invoice",
  USER_ROLE_CHANGED: "Platform role diubah",
  ORGANIZATION_STATUS_CHANGED: "Status organisasi diubah",
  PDF_JOB_RETRIED: "Job PDF diulang",
};

/** Label for an action, falling back to the raw enum value if unknown. */
export function auditActionLabel(action: AuditAction | string): string {
  return AUDIT_ACTION_LABELS[action as AuditAction] ?? action;
}
