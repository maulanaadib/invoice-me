// src/modules/projects/service.ts
// ProjectReference (PO / SPK / contract / quotation) domain: org-scoped CRUD,
// server-side list with pagination/search, PO attachment lifecycle through
// StorageService, and prefillFromProject — the preparation hook feature 04's
// invoice editor calls to pre-fill a new draft from a project.
//
// billedToDate (sudah ditagihkan per project) is deliberately NOT computed
// here: the Invoice table arrives in feature 05. The project detail page
// shows an explicit "not yet available" placeholder instead of a fake 0
// (feature 03 spec, Scope Limits).

import { log } from "@/modules/audit/service";
import { AppError } from "@/lib/errors";
import { assertCan, requireOrgScope } from "@/modules/permissions/service";
import { getStorageService } from "@/modules/storage";
import { getCustomerForScope } from "@/modules/customers/service";
import { parseCalendarDate } from "@/lib/date";
import { logger } from "@/server/logger";
import { db } from "@/server/db";
import { projectFormSchema } from "@/modules/projects/schema";
import type { OrganizationRole, ProjectReference, Prisma } from "@prisma/client";
import type { z } from "zod";

export type ProjectFormInput = z.infer<typeof projectFormSchema>;

/** Only these content types can become a PO attachment (sniffed, not claimed). */
export const ATTACHMENT_MIME_TYPES = [
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/webp",
] as const;

/** Storage sub-directory for PO references (architecture-context storage model). */
const ATTACHMENT_KIND = "references";

// ─── Service context ──────────────────────────────────────────────────────

export interface ProjectServiceContext {
  scope: { organizationId: string; role: OrganizationRole; userId: string };
  request?: Request | null;
}

// ─── Views (serializable — server action → client components) ─────────────

export interface ProjectListItem {
  id: string;
  customerId: string;
  customerName: string;
  referenceType: ProjectReference["referenceType"];
  referenceNumber: string;
  referenceDate: string | null;
  title: string;
  workValue: string;
  currency: string;
  status: ProjectReference["status"];
  hasAttachment: boolean;
  createdAt: string;
}

export interface ProjectDetail extends ProjectListItem {
  description: string | null;
  startDate: string | null;
  endDate: string | null;
  attachmentPath: string | null;
  notes: string | null;
  updatedAt: string;
}

function isoOrNull(value: Date | null | undefined): string | null {
  return value ? value.toISOString() : null;
}

export function toProjectListItem(
  project: ProjectReference & { customer?: { companyName: string } },
): ProjectListItem {
  return {
    id: project.id,
    customerId: project.customerId,
    customerName: project.customer?.companyName ?? "",
    referenceType: project.referenceType,
    referenceNumber: project.referenceNumber,
    referenceDate: isoOrNull(project.referenceDate),
    title: project.title,
    // Decimal string as stored — no float ever crosses into the UI.
    workValue: project.workValue.toString(),
    currency: project.currency,
    status: project.status,
    hasAttachment: Boolean(project.attachmentPath),
    createdAt: project.createdAt.toISOString(),
  };
}

export function toProjectDetail(
  project: ProjectReference & { customer?: { companyName: string } },
): ProjectDetail {
  return {
    ...toProjectListItem(project),
    description: project.description,
    startDate: isoOrNull(project.startDate),
    endDate: isoOrNull(project.endDate),
    attachmentPath: project.attachmentPath,
    notes: project.notes,
    updatedAt: project.updatedAt.toISOString(),
  };
}

// ─── Audit (metadata: ids and field names — no customer PII) ──────────────

async function writeAudit(
  ctx: ProjectServiceContext,
  entityId: string,
  metadata: Record<string, unknown>,
): Promise<void> {
  await log({
    actorUserId: ctx.scope.userId,
    organizationId: ctx.scope.organizationId,
    action: metadata.change === "created" ? "PROJECT_CREATED" : "PROJECT_UPDATED",
    entityType: "projectReference",
    entityId,
    metadata,
    request: ctx.request ?? null,
  });
}

// ─── Reads ─────────────────────────────────────────────────────────────────

export interface ListProjectsQuery {
  page?: number;
  pageSize?: number;
  q?: string;
}

/** Server-side pagination + search over reference number, title and the
 * linked customer's company name. Always org-scoped, pageSize capped. */
export async function listProjects(ctx: ProjectServiceContext, query: ListProjectsQuery = {}) {
  requireOrgScope(ctx.scope);
  const pageSize = Math.min(Math.max(query.pageSize ?? 20, 1), 100);
  const q = (query.q ?? "").trim().slice(0, 100);

  const where: Prisma.ProjectReferenceWhereInput = {
    organizationId: ctx.scope.organizationId,
    ...(q
      ? {
          OR: [
            { referenceNumber: { contains: q, mode: "insensitive" as const } },
            { title: { contains: q, mode: "insensitive" as const } },
            { customer: { companyName: { contains: q, mode: "insensitive" as const } } },
          ],
        }
      : {}),
  };

  const total = await db.projectReference.count({ where });
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(Math.max(query.page ?? 1, 1), totalPages);
  const rows = await db.projectReference.findMany({
    where,
    orderBy: [{ createdAt: "desc" }],
    skip: (page - 1) * pageSize,
    take: pageSize,
    include: { customer: { select: { companyName: true } } },
  });

  return {
    rows: rows.map(toProjectListItem),
    total,
    page,
    pageSize,
    totalPages,
  };
}

/** Detail read with the IDOR guard: another org's id answers 404. */
export async function getProjectForScope(
  projectId: string,
  ctx: ProjectServiceContext,
): Promise<ProjectReference & { customer: { companyName: string } }> {
  requireOrgScope(ctx.scope);
  const project = await db.projectReference.findUnique({
    where: { id: projectId },
    include: { customer: { select: { companyName: true, id: true } } },
  });
  if (!project || project.organizationId !== ctx.scope.organizationId) {
    throw new AppError("NOT_FOUND", "Project tidak ditemukan.");
  }
  return project;
}

// ─── Writes ────────────────────────────────────────────────────────────────

/** The target customer must exist, be alive, and belong to the caller's org
 * — a forged cross-org id answers 404 (IDOR guard), never "exists elsewhere".
 * Cross-module call through the customers module's exported service function
 * (architecture-standards "Cross Module Contracts"). */
async function requireCustomerInScope(customerId: string, ctx: ProjectServiceContext) {
  return getCustomerForScope(customerId, ctx);
}

export async function createProject(
  input: ProjectFormInput,
  ctx: ProjectServiceContext,
): Promise<ProjectReference> {
  assertCan("project.create", ctx.scope);
  const customer = await requireCustomerInScope(input.customerId, ctx);

  const project = await db.projectReference.create({
    data: {
      organizationId: ctx.scope.organizationId,
      customerId: customer.id,
      referenceType: input.referenceType,
      referenceNumber: input.referenceNumber,
      referenceDate: parseCalendarDate(input.referenceDate),
      title: input.title,
      description: input.description?.trim() || null,
      // Decimal string straight into the Decimal column — never a float.
      workValue: input.workValue,
      currency: input.currency,
      startDate: parseCalendarDate(input.startDate),
      endDate: parseCalendarDate(input.endDate),
      status: input.status ?? "ACTIVE",
      notes: input.notes?.trim() || null,
    },
  });
  await writeAudit(ctx, project.id, {
    change: "created",
    referenceType: project.referenceType,
    customerId: project.customerId,
    status: project.status,
  });
  return project;
}

export async function updateProject(
  projectId: string,
  input: ProjectFormInput,
  ctx: ProjectServiceContext,
): Promise<ProjectReference> {
  assertCan("project.update", ctx.scope);
  const project = await getProjectForScope(projectId, ctx);

  const normalized: Record<string, unknown> = {
    referenceType: input.referenceType,
    referenceNumber: input.referenceNumber.trim(),
    referenceDate: parseCalendarDate(input.referenceDate),
    title: input.title.trim(),
    description: input.description?.trim() || null,
    workValue: input.workValue,
    currency: input.currency,
    startDate: parseCalendarDate(input.startDate),
    endDate: parseCalendarDate(input.endDate),
    notes: input.notes?.trim() || null,
  };
  // Status is optional input: absent means "leave the stored status alone".
  if (input.status !== undefined) normalized.status = input.status;
  if (input.customerId !== project.customerId) {
    await requireCustomerInScope(input.customerId, ctx);
    normalized.customerId = input.customerId;
  }

  const changed: string[] = [];
  for (const [key, next] of Object.entries(normalized)) {
    if (next === undefined) continue;
    const current = (project as unknown as Record<string, unknown>)[key];
    const currentComparable = current instanceof Date ? current.toISOString() : current;
    const nextComparable = next instanceof Date ? next.toISOString() : next;
    if (String(currentComparable ?? "") !== String(nextComparable ?? "")) changed.push(key);
  }
  if (changed.length === 0) return project;

  const data: Prisma.ProjectReferenceUpdateInput = {};
  for (const key of changed) {
    const value = normalized[key];
    if (value === undefined) continue;
    if (key === "customerId") data.customer = { connect: { id: String(value) } };
    else if (key === "referenceType") data.referenceType = value as ProjectReference["referenceType"];
    else if (key === "referenceNumber") data.referenceNumber = String(value);
    else if (key === "referenceDate") data.referenceDate = value as Date | null;
    else if (key === "title") data.title = String(value);
    else if (key === "description") data.description = value as string | null;
    else if (key === "workValue") data.workValue = String(value);
    else if (key === "currency") data.currency = String(value);
    else if (key === "startDate") data.startDate = value as Date | null;
    else if (key === "endDate") data.endDate = value as Date | null;
    else if (key === "status") data.status = value as ProjectReference["status"];
    else if (key === "notes") data.notes = value as string | null;
  }

  const updated = await db.projectReference.update({ where: { id: project.id }, data });
  await writeAudit(ctx, project.id, { change: "updated", fields: changed });
  return updated;
}

/**
 * Hard delete (data-model rule: only Customer soft-deletes; a project row is
 * history that the UI removes explicitly, with a confirm dialog). The AuditAction
 * enum has no PROJECT_DELETED yet — the canonical list is finalized in feature
 * 11 — so the removal is audited as PROJECT_UPDATED with `change: "deleted"`
 * (open question tracked in progress-tracker). The stored attachment file is
 * cleaned up best-effort; a storage hiccup never fails the save.
 */
export async function deleteProject(
  projectId: string,
  ctx: ProjectServiceContext,
): Promise<ProjectReference> {
  assertCan("project.delete", ctx.scope);
  const project = await getProjectForScope(projectId, ctx);

  const deleted = await db.projectReference.delete({ where: { id: project.id } });

  if (project.attachmentPath) {
    await getStorageService()
      .delete(project.attachmentPath)
      .catch((error: unknown) =>
        logger.warn(
          { module: "projects", err: error instanceof Error ? error.message : String(error) },
          "lampiran PO gagal dihapus saat project dihapus",
        ),
      );
  }

  await writeAudit(ctx, project.id, {
    change: "deleted",
    referenceType: project.referenceType,
    customerId: project.customerId,
  });
  return deleted;
}

// ─── PO attachment (PDF/image, MIME sniffed, random filename) ──────────────

export async function uploadProjectAttachment(
  projectId: string,
  file: File,
  ctx: ProjectServiceContext,
): Promise<ProjectReference> {
  assertCan("project.update", ctx.scope);
  const project = await getProjectForScope(projectId, ctx);

  // validateUpload inside StorageService decides by content: over-limit and
  // fake-MIME files are rejected there with clear Indonesian messages.
  const stored = await getStorageService().upload(file, {
    orgId: ctx.scope.organizationId,
    kind: ATTACHMENT_KIND,
    allowedMimeTypes: ATTACHMENT_MIME_TYPES,
  });

  const updated = await db.projectReference.update({
    where: { id: project.id },
    data: { attachmentPath: stored.path },
  });

  if (project.attachmentPath) {
    // Best-effort cleanup of the replaced file — never fails the save.
    await getStorageService()
      .delete(project.attachmentPath)
      .catch((error: unknown) =>
        logger.warn(
          { module: "projects", err: error instanceof Error ? error.message : String(error) },
          "lampiran PO lama gagal dihapus",
        ),
      );
  }

  await writeAudit(ctx, project.id, {
    change: "attachment",
    path: stored.path,
    mimeType: stored.mimeType,
    sha256: stored.sha256,
  });
  return updated;
}

export async function removeProjectAttachment(
  projectId: string,
  ctx: ProjectServiceContext,
): Promise<ProjectReference> {
  assertCan("project.update", ctx.scope);
  const project = await getProjectForScope(projectId, ctx);
  if (!project.attachmentPath) return project;

  const updated = await db.projectReference.update({
    where: { id: project.id },
    data: { attachmentPath: null },
  });
  await getStorageService()
    .delete(project.attachmentPath)
    .catch((error: unknown) =>
      logger.warn(
        { module: "projects", err: error instanceof Error ? error.message : String(error) },
        "lampiran PO gagal dihapus dari storage",
      ),
    );
  await writeAudit(ctx, project.id, { change: "attachment_removed" });
  return updated;
}

// ─── Invoice prefill (preparation for feature 04) ──────────────────────────

/**
 * Proposed editor line item. Projects carry no work-item table in feature 03
 * (spec Scope Limits — deferred), so prefill hands the feature-04 editor an
 * EMPTY item list: honest, never a fabricated row.
 */
export interface ProjectPrefillItem {
  description: string;
  quantity: string;
  unit: string;
  unitPrice: string;
}

export interface ProjectPrefill {
  customerId: string;
  referenceNumber: string;
  referenceDate: Date | null;
  /** Decimal string of the project's work value (never a float). */
  workValue: string;
  items: ProjectPrefillItem[];
}

/**
 * Feature 03 exposes ONLY this service (the calling UI lives in feature 04,
 * per the spec). Org-scoped: a foreign project id answers 404.
 */
export async function prefillFromProject(
  projectId: string,
  ctx: ProjectServiceContext,
): Promise<ProjectPrefill> {
  const project = await getProjectForScope(projectId, ctx);
  return {
    customerId: project.customerId,
    referenceNumber: project.referenceNumber,
    referenceDate: project.referenceDate,
    workValue: project.workValue.toString(),
    items: [],
  };
}
