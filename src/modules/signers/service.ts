// src/modules/signers/service.ts
// Signer domain. Feature 02 built the onboarding default signer; feature 10
// completes management CRUD (create/update/delete/set-default, paginated
// list). Optional signature images reuse the company-logo pipeline: resized,
// MIME-sniffed from content, random filename, recorded for storage usage.
//
// Placement note (ratified 2026-10-09, see context/.sdd-state.md): Signer
// stays in `modules/signers` per spec 10 item 3 — the architecture-standards
// row naming `modules/bank-accounts` as its owner is reported stale for a
// separate bundle sync; this builder does not edit context/standards files.

import { log } from "@/modules/audit/service";
import { AppError } from "@/lib/errors";
import { prepareImageUpload } from "@/lib/image";
import { assertCan } from "@/modules/permissions/service";
import { SIGNERS_PAGE_SIZE, type SignerInput } from "@/modules/signers/schema";
import { getStorageService } from "@/modules/storage";
import { logger } from "@/server/logger";
import { db } from "@/server/db";
import type { OrganizationRole, Prisma, Signer } from "@prisma/client";

export {
  signerSchema,
  type SignerFormValues,
  type SignerInput,
} from "@/modules/signers/schema";

export interface SignerServiceContext {
  scope: { organizationId: string; role: OrganizationRole; userId: string };
  request?: Request | null;
}

export interface SignerView {
  id: string;
  name: string;
  title: string | null;
  location: string | null;
  signaturePath: string | null;
  hasSignature: boolean;
  isDefault: boolean;
  isActive: boolean;
  /** ISO timestamp — management list column. */
  createdAt: string;
}

export function toSignerView(signer: Signer): SignerView {
  return {
    id: signer.id,
    name: signer.name,
    title: signer.title,
    location: signer.location,
    signaturePath: signer.signatureImagePath,
    hasSignature: Boolean(signer.signatureImagePath),
    isDefault: signer.isDefault,
    isActive: signer.isActive,
    createdAt: signer.createdAt.toISOString(),
  };
}

export async function getDefaultSigner(organizationId: string): Promise<Signer | null> {
  return db.signer.findFirst({
    where: { organizationId, isDefault: true, isActive: true },
    orderBy: { createdAt: "asc" },
  });
}

/** Active signers only — the invoice editor's dropdown. */
export async function listSigners(organizationId: string): Promise<SignerView[]> {
  const rows = await db.signer.findMany({
    where: { organizationId, isActive: true },
    orderBy: { createdAt: "asc" },
  });
  return rows.map(toSignerView);
}

/** Management list: paginated, every row (inactive included, badge honest). */
export async function listSignersPage(
  ctx: SignerServiceContext,
  options: { page?: number } = {},
): Promise<{
  rows: SignerView[];
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
}> {
  assertCan("signer.view", ctx.scope);
  const pageSize = SIGNERS_PAGE_SIZE;
  const where = { organizationId: ctx.scope.organizationId };
  const total = await db.signer.count({ where });
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(Math.max(1, options.page ?? 1), pageCount);
  const rows = await db.signer.findMany({
    where,
    orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }, { id: "asc" }],
    skip: (page - 1) * pageSize,
    take: pageSize,
  });
  return { rows: rows.map(toSignerView), total, page, pageSize, pageCount };
}

/** Org-scoped read for the detail page (IDOR → NOT_FOUND). Signer carries no
 * secret — VIEWER sees the same fields as an editor. */
export async function getSignerDetail(
  id: string,
  ctx: SignerServiceContext,
): Promise<SignerView> {
  assertCan("signer.view", ctx.scope);
  const row = await db.signer.findFirst({
    where: { id, organizationId: ctx.scope.organizationId },
  });
  if (!row) throw new AppError("NOT_FOUND", "Penanda tangan tidak ditemukan.");
  return toSignerView(row);
}

/** Storage pipeline for the optional image: undefined = "keep the stored
 * path" (never silently erased), null = explicitly none. */
async function uploadSignatureImage(
  file: File | null | undefined,
  organizationId: string,
): Promise<string | null | undefined> {
  if (!file || file.size === 0) return undefined;
  const { file: prepared } = await prepareImageUpload(file, { maxWidth: 600 });
  const stored = await getStorageService().upload(prepared, {
    orgId: organizationId,
    kind: "signature",
    allowedMimeTypes: ["image/png", "image/jpeg", "image/webp"],
  });
  return stored.path;
}

async function deleteStoredImage(path: string | null): Promise<void> {
  if (!path) return;
  await getStorageService()
    .delete(path)
    .catch((error: unknown) =>
      logger.warn(
        { module: "signers", err: error instanceof Error ? error.message : String(error) },
        "gambar tanda tangan lama gagal dihapus",
      ),
    );
}

/** Profile defaults follow the org default (feature 02 pattern: the editor
 * prefills from `InvoiceProfile.defaultSignerId`, and with one profile per
 * organisation — recorded feature-08 decision — the two must not drift). */
async function pointProfilesAtSigner(
  tx: Prisma.TransactionClient,
  organizationId: string,
  signerId: string | null,
  onlyProfilesPointingAt?: string,
): Promise<void> {
  await tx.invoiceProfile.updateMany({
    where: {
      organizationId,
      ...(onlyProfilesPointingAt ? { defaultSignerId: onlyProfilesPointingAt } : {}),
    },
    data: { defaultSignerId: signerId },
  });
}

async function clearOtherDefaults(
  tx: Prisma.TransactionClient,
  organizationId: string,
  keepId: string,
): Promise<void> {
  await tx.signer.updateMany({
    where: { organizationId, isDefault: true, id: { not: keepId } },
    data: { isDefault: false },
  });
}

export async function createSigner(
  input: SignerInput,
  ctx: SignerServiceContext,
  options: { signatureFile?: File | null } = {},
): Promise<Signer> {
  assertCan("signer.create", ctx.scope);
  const organizationId = ctx.scope.organizationId;

  const hasDefault = await db.signer.findFirst({
    where: { organizationId, isDefault: true },
    select: { id: true },
  });
  // First signer is always the default; afterwards the checkbox decides.
  const makeDefault = input.isDefault === true || hasDefault === null;

  // Upload before the transaction: storage is not transactional (feature 07
  // rule) — a failed tx leaves no orphan row, only a stray file we do not link.
  const signaturePath = (await uploadSignatureImage(options.signatureFile, organizationId)) ?? null;

  const signer = await db.$transaction(async (tx) => {
    if (makeDefault) {
      await tx.signer.updateMany({
        where: { organizationId, isDefault: true },
        data: { isDefault: false },
      });
    }
    const created = await tx.signer.create({
      data: {
        organizationId,
        name: input.name,
        title: input.title ?? null,
        location: input.location ?? null,
        signatureImagePath: signaturePath,
        isDefault: makeDefault,
        isActive: input.isActive ?? true,
      },
    });
    if (makeDefault) await pointProfilesAtSigner(tx, organizationId, created.id);
    return created;
  });

  await log({
    actorUserId: ctx.scope.userId,
    organizationId,
    action: "PROFILE_CHANGED",
    entityType: "signer",
    entityId: signer.id,
    metadata: {
      change: "created",
      name: signer.name,
      isDefault: makeDefault,
      hasSignature: Boolean(signer.signatureImagePath),
    },
    request: ctx.request ?? null,
  });
  return signer;
}

export async function updateSigner(
  id: string,
  input: SignerInput,
  ctx: SignerServiceContext,
  options: { signatureFile?: File | null } = {},
): Promise<Signer> {
  assertCan("signer.update", ctx.scope);
  const organizationId = ctx.scope.organizationId;
  const existing = await db.signer.findFirst({ where: { id, organizationId } });
  if (!existing) throw new AppError("NOT_FOUND", "Penanda tangan tidak ditemukan.");

  const wantDefault = input.isDefault ?? existing.isDefault;
  const becameDefault = wantDefault && !existing.isDefault;
  const unsetDefault = !wantDefault && existing.isDefault;

  const signaturePath = await uploadSignatureImage(options.signatureFile, organizationId);
  const nextSignature = signaturePath === undefined ? existing.signatureImagePath : signaturePath;
  const replacedSignature = signaturePath !== undefined && signaturePath !== existing.signatureImagePath;

  const signer = await db.$transaction(async (tx) => {
    if (becameDefault) await clearOtherDefaults(tx, organizationId, id);
    const updated = await tx.signer.update({
      where: { id: existing.id },
      data: {
        name: input.name,
        title: input.title ?? null,
        location: input.location ?? null,
        signatureImagePath: nextSignature,
        isActive: input.isActive ?? existing.isActive,
        isDefault: wantDefault,
      },
    });
    if (becameDefault) await pointProfilesAtSigner(tx, organizationId, id);
    if (unsetDefault) await pointProfilesAtSigner(tx, organizationId, null, id);
    return updated;
  });

  // The replaced file can only be removed once the row no longer points at it.
  if (replacedSignature) await deleteStoredImage(existing.signatureImagePath);

  await log({
    actorUserId: ctx.scope.userId,
    organizationId,
    action: "PROFILE_CHANGED",
    entityType: "signer",
    entityId: signer.id,
    metadata: {
      change: becameDefault || unsetDefault ? "defaultChanged" : "updated",
      name: signer.name,
      isDefault: signer.isDefault,
      hasSignature: Boolean(signer.signatureImagePath),
    },
    request: ctx.request ?? null,
  });
  return signer;
}

/** "Jadikan penanda tangan utama" — idempotent; also what the edit checkbox does. */
export async function setDefaultSigner(
  id: string,
  ctx: SignerServiceContext,
): Promise<Signer> {
  assertCan("signer.update", ctx.scope);
  const organizationId = ctx.scope.organizationId;
  const existing = await db.signer.findFirst({ where: { id, organizationId } });
  if (!existing) throw new AppError("NOT_FOUND", "Penanda tangan tidak ditemukan.");
  if (existing.isDefault) return existing;

  const signer = await db.$transaction(async (tx) => {
    await clearOtherDefaults(tx, organizationId, id);
    const updated = await tx.signer.update({
      where: { id: existing.id },
      data: { isDefault: true },
    });
    await pointProfilesAtSigner(tx, organizationId, id);
    return updated;
  });

  await log({
    actorUserId: ctx.scope.userId,
    organizationId,
    action: "PROFILE_CHANGED",
    entityType: "signer",
    entityId: signer.id,
    metadata: { change: "defaultChanged", name: signer.name, isDefault: true },
    request: ctx.request ?? null,
  });
  return signer;
}

/**
 * Hard delete (data-model: soft delete exists only for Customer). The FK on
 * InvoiceProfile.defaultSignerId is SetNull, so profile links clear on their
 * own; issued documents keep their frozen signerSnapshot. The stored image is
 * removed best-effort after the row is gone.
 */
export async function deleteSigner(
  id: string,
  ctx: SignerServiceContext,
): Promise<void> {
  assertCan("signer.delete", ctx.scope);
  const organizationId = ctx.scope.organizationId;
  const existing = await db.signer.findFirst({ where: { id, organizationId } });
  if (!existing) throw new AppError("NOT_FOUND", "Penanda tangan tidak ditemukan.");

  await db.signer.delete({ where: { id: existing.id } });
  await deleteStoredImage(existing.signatureImagePath);

  await log({
    actorUserId: ctx.scope.userId,
    organizationId,
    action: "PROFILE_CHANGED",
    entityType: "signer",
    entityId: existing.id,
    metadata: { change: "deleted", name: existing.name, wasDefault: existing.isDefault },
    request: ctx.request ?? null,
  });
}

/**
 * Creates the default signer or updates the existing default (onboarding
 * step 7 — feature 02 path, kept behaviorally intact). When `signatureFile` is
 * given it is MIME-sniffed, resized and stored first; a stored path is kept
 * when no new file is supplied (never silently erased).
 */
export async function saveSigner(
  input: SignerInput,
  ctx: SignerServiceContext,
  options: { signatureFile?: File | null } = {},
): Promise<Signer> {
  assertCan("org.settings.update", ctx.scope);

  const signaturePath = await uploadSignatureImage(options.signatureFile, ctx.scope.organizationId);

  const existing = await getDefaultSigner(ctx.scope.organizationId);

  let signer: Signer;
  if (existing) {
    signer = await db.signer.update({
      where: { id: existing.id },
      data: {
        name: input.name,
        title: input.title ?? null,
        location: input.location ?? null,
        ...(signaturePath ? { signatureImagePath: signaturePath } : {}),
      },
    });
    if (signaturePath && existing.signatureImagePath && signaturePath !== existing.signatureImagePath) {
      await deleteStoredImage(existing.signatureImagePath);
    }
  } else {
    signer = await db.signer.create({
      data: {
        organizationId: ctx.scope.organizationId,
        name: input.name,
        title: input.title ?? null,
        location: input.location ?? null,
        signatureImagePath: signaturePath ?? null,
        isDefault: true,
        isActive: true,
      },
    });
  }

  // Link as the profile's default signer when a profile exists yet (mirrors
  // saveBankAccount: feature 06 reads defaultSignerId when rendering).
  const profile = await db.invoiceProfile.findFirst({
    where: { organizationId: ctx.scope.organizationId, isActive: true },
    select: { id: true },
  });
  if (profile) {
    await db.invoiceProfile.update({
      where: { id: profile.id },
      data: { defaultSignerId: signer.id },
    });
  }

  await log({
    actorUserId: ctx.scope.userId,
    organizationId: ctx.scope.organizationId,
    action: "PROFILE_CHANGED",
    entityType: "signer",
    entityId: signer.id,
    metadata: {
      change: existing ? "updated" : "created",
      name: signer.name,
      hasSignature: Boolean(signer.signatureImagePath),
    },
    request: ctx.request ?? null,
  });
  return signer;
}

/** Guard used by callers that expect a signer to already exist. */
export function assertSigner(signer: Signer | null): Signer {
  if (!signer) {
    throw new AppError("NOT_FOUND", "Penanda tangan tidak ditemukan.");
  }
  return signer;
}
