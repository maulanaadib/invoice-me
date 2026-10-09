// src/modules/bank-accounts/schema.ts
// Zod source of truth for bank account input (feature 10). Pure Zod only — no
// db, no server imports — so BOTH the server actions (boundary validation) and
// the React Hook Form form can import it. `bankAccountSchema` keeps the name
// the onboarding action has parsed since feature 02; the form adds the
// isDefault/isActive flags as OPTIONAL fields so that older callers (which
// never send them) still parse unchanged.
//
// Client-safe constants live here too (feature 07 rule): importing a page size
// from a "use client" module turns it into a client reference (NaN) on the
// server.

import { z } from "zod";

/** Rows per page on /bank-accounts (URL-driven ?page=, clamped server-side). */
export const BANK_ACCOUNTS_PAGE_SIZE = 20;

export const bankAccountSchema = z.object({
  bankName: z.string().trim().min(2, "Nama bank wajib diisi.").max(60, "Maksimal 60 karakter."),
  bankCode: z.preprocess(
    (value) => (typeof value === "string" && value.trim() === "" ? null : value),
    z.string().trim().max(12, "Maksimal 12 karakter.").nullable().optional(),
  ),
  // Empty is legitimate on edit (the stored ciphertext is kept — the plaintext
  // is never round-tripped to the client for VIEWER). Required on create, which
  // the service enforces (empty + no stored number → VALIDATION_ERROR).
  accountNumber: z.preprocess(
    (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
    z
      .string()
      .trim()
      .regex(/^[0-9\s.\-]{6,34}$/, "Nomor rekening 6–34 digit (boleh ada spasi/dash).")
      .optional(),
  ),
  accountHolder: z.string().trim().min(2, "Atas nama wajib diisi.").max(80, "Maksimal 80 karakter."),
  branch: z.preprocess(
    (value) => (typeof value === "string" && value.trim() === "" ? null : value),
    z.string().trim().max(80, "Maksimal 80 karakter.").nullable().optional(),
  ),
  /** "Jadikan rekening utama" — absent from onboarding callers (feature 02). */
  isDefault: z.boolean().optional(),
  /** "Rekening aktif" — absent from onboarding callers (feature 02). */
  isActive: z.boolean().optional(),
});
export type BankAccountFormValues = z.infer<typeof bankAccountSchema>;
export type BankAccountInput = BankAccountFormValues;
