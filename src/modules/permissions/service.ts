// src/modules/permissions/service.ts
// Central permission service — the single place organization role strings live.
// Feature services call can() / requireOrgScope(); no other module compares
// OWNER/ADMIN/STAFF/VIEWER literals.

import { AppError } from "@/lib/errors";
import type { OrganizationRole } from "@prisma/client";

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
  // payment
  | "payment.view"
  | "payment.record"
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
    "report.view",
  ],
  VIEWER: ["invoice.view", "invoice.download"],
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
}

/**
 * The one authorization decision: may `role` in this organization context
 * perform `action`? No session/org context → no permission (fail closed).
 */
export function can(action: PermissionAction, ctx: PermissionContext): boolean {
  const role = ctx.role;
  if (!role) return false;
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
  if (!can(action, ctx)) {
    throw new AppError("FORBIDDEN", "Anda tidak memiliki izin untuk melakukan aksi ini.");
  }
}
