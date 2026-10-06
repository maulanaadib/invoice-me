// src/modules/bank-accounts/service.ts
// Bank account domain (feature 02 builds the module with the onboarding
// default account; feature 10 adds multi-account CRUD). Account numbers are
// encrypted at rest (AES-256-GCM) and only ever surface masked/last4.

import { log } from "@/modules/audit/service";
import { AppError } from "@/lib/errors";
import { assertCan } from "@/modules/permissions/service";
import {
  accountNumberLast4,
  decryptAccountNumber,
  encryptAccountNumber,
  maskAccountNumber,
  normalizeAccountNumber,
} from "@/modules/bank-accounts/crypto";
import { db } from "@/server/db";
import type { BankAccount, OrganizationRole } from "@prisma/client";
import { z } from "zod";

export { maskAccountNumber, normalizeAccountNumber } from "@/modules/bank-accounts/crypto";

export const bankAccountSchema = z.object({
  bankName: z.string().trim().min(2, "Nama bank wajib diisi.").max(60, "Maksimal 60 karakter."),
  bankCode: z.preprocess(
    (value) => (typeof value === "string" && value.trim() === "" ? null : value),
    z.string().trim().max(12, "Maksimal 12 karakter.").nullable().optional(),
  ),
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
});
export type BankAccountInput = z.infer<typeof bankAccountSchema>;

export interface BankAccountServiceContext {
  scope: { organizationId: string; role: OrganizationRole; userId: string };
  request?: Request | null;
}

export interface BankAccountView {
  id: string;
  bankName: string;
  bankCode: string | null;
  accountHolder: string;
  branch: string | null;
  /** e.g. "**** **** 3449" — decrypted server-side, masked before leaving. */
  maskedNumber: string;
  last4: string;
  currency: string;
  isDefault: boolean;
}

export function toBankAccountView(account: BankAccount): BankAccountView {
  return {
    id: account.id,
    bankName: account.bankName,
    bankCode: account.bankCode,
    accountHolder: account.accountHolder,
    branch: account.branch,
    maskedNumber: maskAccountNumber(
      decryptAccountNumber(account.accountNumberEncrypted),
    ),
    last4: account.accountNumberLast4,
    currency: account.currency,
    isDefault: account.isDefault,
  };
}

/** The organization's single default account (onboarding scope, feature 10 grows this). */
export async function getDefaultBankAccount(
  organizationId: string,
): Promise<BankAccount | null> {
  return db.bankAccount.findFirst({
    where: { organizationId, isDefault: true, isActive: true },
    orderBy: { createdAt: "asc" },
  });
}

export async function listBankAccounts(organizationId: string): Promise<BankAccountView[]> {
  const rows = await db.bankAccount.findMany({
    where: { organizationId, isActive: true },
    orderBy: { createdAt: "asc" },
  });
  return rows.map(toBankAccountView);
}

/**
 * Creates the default account, or replaces the existing default's fields.
 * The plaintext number never leaves this module: only ciphertext is stored,
 * only the last4 is kept in the clear for masking.
 */
export async function saveBankAccount(
  input: BankAccountInput,
  ctx: BankAccountServiceContext,
): Promise<BankAccount> {
  assertCan("org.settings.update", ctx.scope);

  const existing = await getDefaultBankAccount(ctx.scope.organizationId);

  // Empty number + existing account = keep the stored ciphertext (the plain
  // number is never retrievable from the client); empty + no account = error.
  const digits = input.accountNumber ? normalizeAccountNumber(input.accountNumber) : "";
  if (digits && !/^\d{6,34}$/.test(digits)) {
    throw new AppError("VALIDATION_ERROR", "Nomor rekening harus 6–34 digit angka.");
  }

  let encrypted: string;
  let last4: string;
  if (digits) {
    encrypted = encryptAccountNumber(digits);
    last4 = accountNumberLast4(digits);
  } else if (existing) {
    encrypted = existing.accountNumberEncrypted;
    last4 = existing.accountNumberLast4;
  } else {
    throw new AppError("VALIDATION_ERROR", "Nomor rekening wajib diisi.");
  }

  const account = existing
    ? await db.bankAccount.update({
        where: { id: existing.id },
        data: {
          bankName: input.bankName,
          bankCode: input.bankCode ?? null,
          accountNumberEncrypted: encrypted,
          accountNumberLast4: last4,
          accountHolder: input.accountHolder,
          branch: input.branch ?? null,
        },
      })
    : await db.bankAccount.create({
        data: {
          organizationId: ctx.scope.organizationId,
          bankName: input.bankName,
          bankCode: input.bankCode ?? null,
          accountNumberEncrypted: encrypted,
          accountNumberLast4: last4,
          accountHolder: input.accountHolder,
          branch: input.branch ?? null,
          currency: "IDR",
          isDefault: true,
          isActive: true,
        },
      });

  // Link as the profile's default payment account when a profile exists yet
  // (onboarding step 6 runs after step 2, so this normally holds).
  const profile = await db.invoiceProfile.findFirst({
    where: { organizationId: ctx.scope.organizationId, isActive: true },
    select: { id: true },
  });
  if (profile) {
    await db.invoiceProfile.update({
      where: { id: profile.id },
      data: { defaultBankAccountId: account.id },
    });
  }

  // Audit metadata never carries the number — only non-sensitive identifiers.
  await log({
    actorUserId: ctx.scope.userId,
    organizationId: ctx.scope.organizationId,
    action: "PROFILE_CHANGED",
    entityType: "bankAccount",
    entityId: account.id,
    metadata: {
      change: existing ? "updated" : "created",
      bankName: account.bankName,
      isDefault: true,
    },
    request: ctx.request ?? null,
  });
  return account;
}
