// src/modules/permissions/service.ts
// Central permission service — the single place organization role strings live.
// Feature services call can() / requireOrgScope(); no other module compares
// OWNER/ADMIN/STAFF/VIEWER literals.

import { AppError } from "@/lib/errors";
import type { OrgStatus, OrganizationRole } from "@prisma/client";

/**
 * Every organization-scoped action in the product. Feature specs add actions
 * here; they never inline their own role comparisons.
 */
export type PermissionAction =
  // organization
  | "org.view"
  | "org.settings.update"
  | "org.member.invite"
  | "org.member.update"
  | "org.member.remove"
  | "org.audit.view"
  | "delete_org"
  | "transfer_ownership"
  // invoice
  | "invoice.view"
  | "invoice.download"
  | "invoice.preview"
  | "invoice.export"
  | "invoice.issue"
  // Feature 05: STAFF+ records the delivery step (ISSUED → SENT).
  | "invoice.markSent"
  | "invoice.cancel"
  | "invoice.revise"
  | "invoice.draft.create"
  | "invoice.draft.read"
  | "invoice.draft.update"
  | "invoice.draft.delete"
  // customer
  | "customer.view"
  | "customer.create"
  | "customer.update"
  | "customer.delete"
  // project / PO
  | "project.view"
  | "project.create"
  | "project.update"
  | "project.delete"
  // payment (feature 07): STAFF+ records, VIEWER reads, reversal and the
  // overpayment override are OWNER/ADMIN only.
  | "payment.view"
  | "payment.record"
  | "payment.delete"
  | "payment.override"
  // reporting
  | "report.view";

/**
 * The role matrix (feature 01 spec). Patterns: exact action, `*` (everything),
 * or a `prefix.*` wildcard. ADMIN is `*` minus ADMIN_EXCLUDED.
 */
const MATRIX: Record<OrganizationRole, readonly string[]> = {
  OWNER: ["*"],
  ADMIN: ["*"],
  STAFF: [
    "invoice.draft.*",
    "customer.*",
    "project.*",
    "invoice.preview",
    "invoice.export",
    "invoice.view",
    "invoice.download",
    // Feature 05 spec: STAFF+ may issue and mark an invoice sent; cancel and
    // revise stay OWNER/ADMIN only.
    "invoice.issue",
    "invoice.markSent",
    // Feature 07 spec: STAFF+ may record a payment (read included); the
    // reversal (payment.delete) and the overpayment override stay OWNER/ADMIN.
    "payment.view",
    "payment.record",
    "report.view",
  ],
  VIEWER: ["invoice.view", "invoice.download", "payment.view"],
};

/** OWNER-only actions: ADMIN is `* except` these (feature 01 spec). */
const ADMIN_EXCLUDED: readonly string[] = ["delete_org", "transfer_ownership"];

function matches(pattern: string, action: string): boolean {
  if (pattern === "*") return true;
  if (pattern === action) return true;
  if (pattern.endsWith(".*")) return action.startsWith(pattern.slice(0, -1));
  return false;
}

export interface PermissionContext {
  /** Organization id of the active workspace scope. */
  organizationId?: string | null;
  /** Organization role from the caller's active membership. */
  role?: OrganizationRole | null;
  /**
   * Feature 09: status of the active organization, loaded together with the
   * membership by `resolveActiveOrgScope` (the single scope source). A SUSPENDED
   * organization blocks NEW MUTATIONS only — reads and downloads stay open and
   * the data is retained (ratified decision, spec scope limits: no data freeze).
   * `null`/absent = not loaded → the suspension rule does not apply (permission
   * itself still fails closed without a role).
   */
  organizationStatus?: OrgStatus | null;
}

/**
 * Actions that only READ data — the only ones still allowed in a suspended
 * organization (ratified: "suspend blocks login and new mutations only;
 * reads/downloads remain allowed"). Everything not listed here is a mutation.
 */
export const READ_ACTIONS: readonly PermissionAction[] = [
  "org.view",
  "org.audit.view",
  "invoice.view",
  "invoice.download",
  "invoice.preview",
  "invoice.export",
  "invoice.draft.read",
  "customer.view",
  "project.view",
  "payment.view",
  "report.view",
];

export const ORG_SUSPENDED_MESSAGE =
  "Organisasi ini ditangguhkan oleh super admin. Aksi baru tidak diizinkan.";

/** True when the context belongs to a suspended organization. */
export function isOrgSuspended(ctx: PermissionContext): boolean {
  return ctx.organizationStatus === "SUSPENDED";
}

/**
 * The one authorization decision: may `role` in this organization context
 * perform `action`? No session/org context → no permission (fail closed).
 * A suspended organization grants read actions only (feature 09).
 */
export function can(action: PermissionAction, ctx: PermissionContext): boolean {
  const role = ctx.role;
  if (!role) return false;
  if (isOrgSuspended(ctx) && !READ_ACTIONS.includes(action)) return false;
  if (role === "ADMIN" && ADMIN_EXCLUDED.includes(action)) return false;
  return MATRIX[role].some((pattern) => matches(pattern, action));
}

export interface OrgScope extends PermissionContext {
  organizationId: string;
  role: OrganizationRole;
}

/**
 * Guard for org-scoped service functions: throws FORBIDDEN unless the context
 * carries both an active organization and a membership role.
 */
export function requireOrgScope(ctx: PermissionContext): asserts ctx is OrgScope {
  if (!ctx.organizationId) {
    throw new AppError(
      "FORBIDDEN",
      "Tidak ada organisasi aktif. Pilih organisasi terlebih dahulu.",
    );
  }
  if (!ctx.role) {
    throw new AppError("FORBIDDEN", "Anda bukan anggota organisasi ini.");
  }
}

/** Throwing variant of can() for mutation entry points. */
export function assertCan(action: PermissionAction, ctx: PermissionContext): void {
  requireOrgScope(ctx);
  if (can(action, ctx)) return;
  if (isOrgSuspended(ctx) && !READ_ACTIONS.includes(action)) {
    throw new AppError("FORBIDDEN", ORG_SUSPENDED_MESSAGE);
  }
  throw new AppError("FORBIDDEN", "Anda tidak memiliki izin untuk melakukan aksi ini.");
}
