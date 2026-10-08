// src/modules/profiles/service.ts
// InvoiceProfile domain: creation, updates, logo lifecycle, and the number
// pattern validator/preview re-exported for feature specs. Authorization runs
// through assertCan("org.settings.update") — OWNER/ADMIN only; every write
// lands an audit row with action PROFILE_CHANGED.

import { log } from "@/modules/audit/service";
import { AppError } from "@/lib/errors";
import { prepareImageUpload, IMAGE_MIME_TYPES } from "@/lib/image";
import { assertCan } from "@/modules/permissions/service";
import { getStorageService } from "@/modules/storage";
import { previewNumber, validateNumberPattern } from "@/modules/profiles/number-pattern";
import { logger } from "@/server/logger";
import { db } from "@/server/db";
import type { InvoiceProfile, OrganizationRole, Prisma, TaxMode } from "@prisma/client";
import { z } from "zod";

export { previewNumber, validateNumberPattern };
export type { NumberPreviewContext, PatternValidation } from "@/modules/profiles/number-pattern";

// ─── Input schemas (Zod = source of truth for action input) ───────────────

const requiredText = (max: number, message: string) =>
  z.string().trim().min(1, message).max(max, `Maksimal ${max} karakter.`);

/** "" / whitespace → null (clear the column); undefined → untouched. */
const optionalText = (max: number) =>
  z.preprocess(
    (value) =>
      typeof value === "string" && value.trim() === "" ? null : value,
    z.string().trim().max(max, `Maksimal ${max} karakter.`).nullable().optional(),
  );

export const primaryColorSchema = z
  .string()
  .trim()
  .regex(/^#[0-9a-fA-F]{6}$/, "Warna harus berformat #RRGGBB (mis. #2563eb).");

export const stampModeSchema = z.enum([
  "NONE",
  "E_METERAI",
  "PHYSICAL",
  "BLANK_SPACE",
]);

const numberPatternField = z
  .string()
  .trim()
  .superRefine((value, ctx) => {
    const result = validateNumberPattern(value);
    if (!result.ok) {
      ctx.addIssue({ code: "custom", message: result.message });
    }
  });

export const profileIdentitySchema = z.object({
  name: requiredText(80, "Nama profil wajib diisi."),
  code: z
    .string()
    .trim()
    .transform((value) => value.toUpperCase())
    .pipe(z.string().regex(/^[A-Z0-9]{2,8}$/, "Kode 2-8 karakter, huruf/angka (mis. SB).")),
});

export const companyProfileSchema = z.object({
  legalName: optionalText(120),
  address: optionalText(500),
  taxId: optionalText(30),
});

export const contactProfileSchema = z.object({
  phone: optionalText(30),
  whatsapp: optionalText(30),
  fax: optionalText(30),
  email: z.preprocess(
    (value) => (typeof value === "string" && value.trim() === "" ? null : value),
    z
      .string()
      .trim()
      .email("Format email tidak valid.")
      .max(120, "Maksimal 120 karakter.")
      .nullable()
      .optional(),
  ),
  website: z.preprocess(
    (value) => (typeof value === "string" && value.trim() === "" ? null : value),
    z
      .string()
      .trim()
      .url("Format website tidak valid (mis. https://example.com).")
      .max(200, "Maksimal 200 karakter.")
      .nullable()
      .optional(),
  ),
});

export const numberingSchema = z.object({
  numberPattern: numberPatternField,
  sequenceResetPolicy: z.enum(["MONTHLY", "YEARLY", "NEVER"]),
});

export const profileUpdateSchema = z.object({
  ...profileIdentitySchema.shape,
  ...companyProfileSchema.shape,
  ...contactProfileSchema.shape,
  primaryColor: primaryColorSchema,
  numberPattern: numberPatternField,
  sequenceResetPolicy: z.enum(["MONTHLY", "YEARLY", "NEVER"]),
  defaultTaxMode: z.enum(["NONE", "INCLUSIVE", "EXCLUSIVE", "MANUAL"]),
  // Percent arrives as form text: validate as text (Indonesian messages),
  // then hand the service a number. Empty → undefined (untouched); NONE mode
  // clears the stored value in updateProfile.
  defaultTaxPercent: z.preprocess(
    (value) =>
      value === "" || value === null || value === undefined ? undefined : String(value),
    z
      .string()
      .regex(/^\d{1,3}(\.\d{1,2})?$/, "Pajak harus angka, mis. 11 atau 11.5.")
      .refine((value) => Number(value) <= 100, "Pajak maksimal 100%.")
      .optional()
      .transform((value) => (value === undefined ? undefined : Number(value))),
  ),
  defaultStampMode: z.enum(["NONE", "E_METERAI", "PHYSICAL", "BLANK_SPACE"]),
  defaultNotes: optionalText(1000),
});

export type ProfileIdentityInput = z.infer<typeof profileIdentitySchema>;
export type CompanyProfileInput = z.infer<typeof companyProfileSchema>;
export type ContactProfileInput = z.infer<typeof contactProfileSchema>;
export type NumberingInput = z.infer<typeof numberingSchema>;
export type ProfileUpdateInput = z.infer<typeof profileUpdateSchema>;

// ─── Service context ──────────────────────────────────────────────────────

/** Active-org scope of the caller (resolveActiveOrgScope result shape). */
export interface ProfileServiceContext {
  scope: { organizationId: string; role: OrganizationRole; userId: string };
  request?: Request | null;
}

// ─── Views (serializable — server action → client components) ─────────────

// Document settings live in the pure leaf module (see its header: importing
// the service from client-reachable code would pull sharp/Prisma into the
// browser bundle); re-exported here so server callers can keep one import.
export {
  parseProfileSettings,
  type InvoiceProfileSettings,
} from "@/modules/profiles/settings";

import { parseProfileSettings, type InvoiceProfileSettings } from "@/modules/profiles/settings";

export interface ProfileView {
  id: string;
  organizationId: string;
  name: string;
  code: string;
  legalName: string | null;
  logoPath: string | null;
  primaryColor: string;
  address: string | null;
  phone: string | null;
  whatsapp: string | null;
  fax: string | null;
  email: string | null;
  website: string | null;
  taxId: string | null;
  numberPattern: string;
  sequenceResetPolicy: "MONTHLY" | "YEARLY" | "NEVER";
  defaultTaxMode: TaxMode;
  defaultTaxPercent: number | null;
  defaultStampMode: "NONE" | "E_METERAI" | "PHYSICAL" | "BLANK_SPACE";
  defaultNotes: string | null;
  templateKey: string;
  defaultBankAccountId: string | null;
  defaultSignerId: string | null;
  settings: InvoiceProfileSettings;
}

export function toProfileView(profile: InvoiceProfile): ProfileView {
  return {
    id: profile.id,
    organizationId: profile.organizationId,
    name: profile.name,
    code: profile.code,
    legalName: profile.legalName,
    logoPath: profile.logoPath,
    primaryColor: profile.primaryColor,
    address: profile.address,
    phone: profile.phone,
    whatsapp: profile.whatsapp,
    fax: profile.fax,
    email: profile.email,
    website: profile.website,
    taxId: profile.taxId,
    numberPattern: profile.numberPattern,
    sequenceResetPolicy: profile.sequenceResetPolicy,
    defaultTaxMode: profile.defaultTaxMode,
    defaultTaxPercent:
      profile.defaultTaxPercent === null ? null : Number(profile.defaultTaxPercent),
    defaultStampMode: profile.defaultStampMode,
    defaultNotes: profile.defaultNotes,
    templateKey: profile.templateKey,
    defaultBankAccountId: profile.defaultBankAccountId,
    defaultSignerId: profile.defaultSignerId,
    settings: parseProfileSettings(profile.settings),
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────

/** Short invoice code derived from an organization name: "Sigit Berkarya" → "SIGIT". */
export function deriveProfileCode(name: string): string {
  const cleaned = name
    .normalize("NFKD")
    .replace(/[^\p{Letter}\p{Number}]/gu, "")
    .toUpperCase()
    .slice(0, 6);
  return cleaned || "INV";
}

async function loadForUpdate(profileId: string, ctx: ProfileServiceContext): Promise<InvoiceProfile> {
  assertCan("org.settings.update", ctx.scope);
  const profile = await db.invoiceProfile.findUnique({ where: { id: profileId } });
  if (!profile || profile.organizationId !== ctx.scope.organizationId) {
    // Same answer as a missing row — no cross-tenant existence leak.
    throw new AppError("NOT_FOUND", "Profil invoice tidak ditemukan.");
  }
  return profile;
}

async function writeAudit(
  ctx: ProfileServiceContext,
  entityId: string,
  metadata: Record<string, unknown>,
): Promise<void> {
  await log({
    actorUserId: ctx.scope.userId,
    organizationId: ctx.scope.organizationId,
    action: "PROFILE_CHANGED",
    entityType: "invoiceProfile",
    entityId,
    metadata,
    request: ctx.request ?? null,
  });
}

// ─── Reads ────────────────────────────────────────────────────────────────

export async function getProfileByOrg(organizationId: string): Promise<InvoiceProfile | null> {
  return db.invoiceProfile.findFirst({ where: { organizationId, isActive: true } });
}

export async function getProfileById(profileId: string): Promise<InvoiceProfile | null> {
  return db.invoiceProfile.findUnique({ where: { id: profileId } });
}

/**
 * Read guard for /profiles/[id]: the profile must belong to the caller's
 * ACTIVE organization (IDOR check) — otherwise 404.
 */
export async function getProfileForScope(
  profileId: string,
  ctx: ProfileServiceContext,
): Promise<InvoiceProfile> {
  const profile = await db.invoiceProfile.findUnique({ where: { id: profileId } });
  if (!profile || profile.organizationId !== ctx.scope.organizationId) {
    throw new AppError("NOT_FOUND", "Profil invoice tidak ditemukan.");
  }
  return profile;
}

// ─── Writes ──────────────────────────────────────────────────────────────

/**
 * Creates the organization's invoice profile with sensible defaults derived
 * from the organization (name + short code) — used by onboarding step 2 and
 * the /profiles "create" entry when none exists yet. CONFLICT on a second
 * profile for the same org (unique [organizationId, code] and single-profile
 * product rule).
 */
export async function createProfile(
  ctx: ProfileServiceContext,
  input: { name?: string; code?: string } & Partial<ProfileUpdateInput>,
): Promise<InvoiceProfile> {
  assertCan("org.settings.update", ctx.scope);
  const organization = await db.organization.findUnique({
    where: { id: ctx.scope.organizationId },
    select: { name: true },
  });
  if (!organization) {
    throw new AppError("NOT_FOUND", "Organisasi tidak ditemukan.");
  }

  const existing = await getProfileByOrg(ctx.scope.organizationId);
  if (existing) {
    throw new AppError("CONFLICT", "Profil invoice untuk organisasi ini sudah ada.");
  }

  const profile = await db.invoiceProfile.create({
    data: {
      organizationId: ctx.scope.organizationId,
      name: (input.name ?? organization.name).trim(),
      code: (input.code ?? deriveProfileCode(organization.name)).toUpperCase(),
      legalName: input.legalName ?? null,
      address: input.address ?? null,
      taxId: input.taxId ?? null,
      phone: input.phone ?? null,
      whatsapp: input.whatsapp ?? null,
      fax: input.fax ?? null,
      email: input.email ?? null,
      website: input.website ?? null,
      primaryColor: input.primaryColor ?? undefined,
      numberPattern: input.numberPattern ?? undefined,
      sequenceResetPolicy: input.sequenceResetPolicy ?? undefined,
      defaultTaxMode: input.defaultTaxMode ?? undefined,
      defaultTaxPercent: input.defaultTaxPercent ?? undefined,
      defaultStampMode: input.defaultStampMode ?? undefined,
      defaultNotes: input.defaultNotes ?? undefined,
    },
  });
  await writeAudit(ctx, profile.id, { change: "created", name: profile.name, code: profile.code });
  return profile;
}

/** Returns the existing profile or creates the default one (idempotent). */
export async function ensureProfile(ctx: ProfileServiceContext): Promise<InvoiceProfile> {
  const existing = await getProfileByOrg(ctx.scope.organizationId);
  return existing ?? createProfile(ctx, {});
}

/**
 * Partial update: only keys present in `input` are written (undefined =
 * untouched, null = clear). Validates the number pattern through Zod at the
 * action layer; code uniqueness (P2002) maps to CONFLICT here. Writes a
 * PROFILE_CHANGED audit row listing the fields that actually changed.
 */
export async function updateProfile(
  profileId: string,
  input: Partial<ProfileUpdateInput>,
  ctx: ProfileServiceContext,
): Promise<InvoiceProfile> {
  const profile = await loadForUpdate(profileId, ctx);

  const changed: Array<keyof ProfileUpdateInput> = [];
  for (const key of Object.keys(input) as Array<keyof ProfileUpdateInput>) {
    const next = input[key];
    if (next === undefined) continue;
    const current = profile[key];
    const currentComparable = current instanceof Date ? current.toISOString() : current;
    if (String(currentComparable ?? "") !== String(next ?? "")) {
      changed.push(key);
    }
  }

  const mode = input.defaultTaxMode ?? profile.defaultTaxMode;
  const data: Prisma.InvoiceProfileUpdateInput = {};
  // changed[] only contains keys present in the typed input, and every
  // ProfileUpdateInput field maps to a scalar column — safe to write through
  // a Record view of Prisma's update input (escape hatch, commented per
  // code-standards). Tax percent is cleared whenever the mode settles on NONE.
  for (const key of changed) {
    const value = input[key];
    if (value === undefined) continue;
    // Every ProfileUpdateInput key maps to a same-named scalar column; the
    // Record view skips Prisma's relation-keyed union (commented per
    // code-standards escape-hatch rule).
    (data as Record<string, unknown>)[key] =
      key === "defaultTaxPercent" && mode === "NONE" ? null : value;
  }
  if (mode === "NONE" && changed.includes("defaultTaxMode")) {
    data.defaultTaxPercent = null;
  }

  let updated: InvoiceProfile;
  try {
    updated = await db.invoiceProfile.update({ where: { id: profileId }, data });
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code === "P2002") {
      throw new AppError("CONFLICT", "Kode profil invoice sudah dipakai di organisasi ini.");
    }
    throw error;
  }

  if (changed.length > 0) {
    await writeAudit(ctx, profileId, { change: "updated", fields: changed });
  }
  return updated;
}

// ─── Logo lifecycle (upload → resize/optimize → random-name store) ────────

export async function replaceLogo(
  profileId: string,
  file: File,
  ctx: ProfileServiceContext,
): Promise<InvoiceProfile> {
  const profile = await loadForUpdate(profileId, ctx);

  const { file: prepared } = await prepareImageUpload(file, { maxWidth: 800 });
  const stored = await getStorageService().upload(prepared, {
    orgId: ctx.scope.organizationId,
    kind: "logo",
    allowedMimeTypes: IMAGE_MIME_TYPES,
  });

  const updated = await db.invoiceProfile.update({
    where: { id: profile.id },
    data: { logoPath: stored.path },
  });

  if (profile.logoPath) {
    // Best-effort cleanup of the previous logo — never fails the save.
    await getStorageService()
      .delete(profile.logoPath)
      .catch((error: unknown) =>
        logger.warn(
          { module: "profiles", err: error instanceof Error ? error.message : String(error) },
          "logo lama gagal dihapus",
        ),
      );
  }

  await writeAudit(ctx, profile.id, { change: "logo", path: stored.path, sha256: stored.sha256 });
  return updated;
}

export async function removeLogo(profileId: string, ctx: ProfileServiceContext): Promise<InvoiceProfile> {
  const profile = await loadForUpdate(profileId, ctx);
  if (!profile.logoPath) return profile;

  const updated = await db.invoiceProfile.update({
    where: { id: profile.id },
    data: { logoPath: null },
  });
  await getStorageService()
    .delete(profile.logoPath)
    .catch((error: unknown) =>
      logger.warn(
        { module: "profiles", err: error instanceof Error ? error.message : String(error) },
        "logo gagal dihapus dari storage",
      ),
    );
  await writeAudit(ctx, profile.id, { change: "logo_removed" });
  return updated;
}
