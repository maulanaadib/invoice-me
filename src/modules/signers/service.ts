// src/modules/signers/service.ts
// Signer domain (feature 02 creates the module with the onboarding default
// signer; feature 10 grows management). Optional signature images go through
// the same validation/optimization/storage pipeline as the company logo.

import { log } from "@/modules/audit/service";
import { AppError } from "@/lib/errors";
import { prepareImageUpload } from "@/lib/image";
import { assertCan } from "@/modules/permissions/service";
import { getStorageService } from "@/modules/storage";
import { logger } from "@/server/logger";
import { db } from "@/server/db";
import type { OrganizationRole, Signer } from "@prisma/client";
import { z } from "zod";

export const signerSchema = z.object({
  name: z.string().trim().min(2, "Nama penanda tangan wajib diisi.").max(80, "Maksimal 80 karakter."),
  title: z.preprocess(
    (value) => (typeof value === "string" && value.trim() === "" ? null : value),
    z.string().trim().max(80, "Maksimal 80 karakter.").nullable().optional(),
  ),
  location: z.preprocess(
    (value) => (typeof value === "string" && value.trim() === "" ? null : value),
    z.string().trim().max(80, "Maksimal 80 karakter.").nullable().optional(),
  ),
});
export type SignerInput = z.infer<typeof signerSchema>;

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
  };
}

export async function getDefaultSigner(organizationId: string): Promise<Signer | null> {
  return db.signer.findFirst({
    where: { organizationId, isDefault: true, isActive: true },
    orderBy: { createdAt: "asc" },
  });
}

export async function listSigners(organizationId: string): Promise<SignerView[]> {
  const rows = await db.signer.findMany({
    where: { organizationId, isActive: true },
    orderBy: { createdAt: "asc" },
  });
  return rows.map(toSignerView);
}

/**
 * Creates the default signer or updates the existing default. When
 * `signatureFile` is given it is MIME-sniffed, resized and stored first; a
 * stored path is kept when no new file is supplied (never silently erased).
 */
export async function saveSigner(
  input: SignerInput,
  ctx: SignerServiceContext,
  options: { signatureFile?: File | null } = {},
): Promise<Signer> {
  assertCan("org.settings.update", ctx.scope);

  let signaturePath: string | null | undefined;
  if (options.signatureFile && options.signatureFile.size > 0) {
    const { file: prepared } = await prepareImageUpload(options.signatureFile, {
      maxWidth: 600,
    });
    const stored = await getStorageService().upload(prepared, {
      orgId: ctx.scope.organizationId,
      kind: "signature",
      allowedMimeTypes: ["image/png", "image/jpeg", "image/webp"],
    });
    signaturePath = stored.path;
  }

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
    if (signaturePath && existing.signatureImagePath) {
      await getStorageService()
        .delete(existing.signatureImagePath)
        .catch((error: unknown) =>
          logger.warn(
            { module: "signers", err: error instanceof Error ? error.message : String(error) },
            "tanda tangan lama gagal dihapus",
          ),
        );
    }
  } else {
    if (!signaturePath) {
      // The signature image is optional per spec — absence is fine here.
      signaturePath = null;
    }
    signer = await db.signer.create({
      data: {
        organizationId: ctx.scope.organizationId,
        name: input.name,
        title: input.title ?? null,
        location: input.location ?? null,
        signatureImagePath: signaturePath,
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
