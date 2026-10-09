// src/modules/signers/schema.ts
// Zod source of truth for signer input (feature 10). Pure Zod only — no db, no
// server imports — so the server actions and the React Hook Form form share one
// schema. `signerSchema` keeps the name the onboarding action has parsed since
// feature 02; isDefault/isActive are optional so older callers parse unchanged.
// The signature image is NOT part of this schema: it travels as a separate
// File argument and is MIME-sniffed by the storage pipeline.

import { z } from "zod";

/** Rows per page on /signers (URL-driven ?page=, clamped server-side). */
export const SIGNERS_PAGE_SIZE = 20;

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
  /** "Jadikan penanda tangan utama" — absent from onboarding callers. */
  isDefault: z.boolean().optional(),
  /** "Penanda tangan aktif" — absent from onboarding callers. */
  isActive: z.boolean().optional(),
});
export type SignerFormValues = z.infer<typeof signerSchema>;
export type SignerInput = SignerFormValues;
