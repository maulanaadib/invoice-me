// src/modules/bank-accounts/service.ts
// Bank account domain. Feature 02 built the onboarding default account;
// feature 10 completes multi-account CRUD (create/update/delete/set-default,
// paginated list, authorized reveal of the full number).
//
// Account numbers are encrypted at rest (AES-256-GCM, crypto.ts) and only ever
// leave this module MASKED — with exactly two exceptions, both named by spec 10:
//   • `getBankAccountDetail` reveals the plaintext when the caller holds
//     bankAccount.update ("halaman berizin — detail bank dengan permission";
//     VIEWER gets null),
//   • `fullAccountNumber` feeds the issue-time snapshot ("nomor lengkap hanya
//     di invoice (snapshot)") — never a client payload.

import { log } from "@/modules/audit/service";
import { AppError } from "@/lib/errors";
import { assertCan, can } from "@/modules/permissions/service";
import {
  accountNumberLast4,
  decryptAccountNumber,
  encryptAccountNumber,
  maskAccountNumber,
  normalizeAccountNumber,
} from "@/modules/bank-accounts/crypto";
import { BANK_ACCOUNTS_PAGE_SIZE, type BankAccountInput } from "@/modules/bank-accounts/schema";
import { db } from "@/server/db";
import type { BankAccount, OrganizationRole, Prisma } from "@prisma/client";

export { maskAccountNumber, normalizeAccountNumber } from "@/modules/bank-accounts/crypto";
// The schema lives in the client-safe module (feature 07 rule); re-exported
// here so the onboarding action's feature-02 import path keeps working.
export { bankAccountSchema, type BankAccountFormValues, type BankAccountInput } from "@/modules/bank-accounts/schema";

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
  isActive: boolean;
  /** ISO timestamp — management list column. */
  createdAt: string;
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
    isActive: account.isActive,
    createdAt: account.createdAt.toISOString(),
  };
}

/**
 * Full plaintext number — ISSUE-TIME SNAPSHOT ONLY (spec 10: the invoice
 * document is the one place the real number appears besides an authorized
 * detail page). Never put this in a list payload, log, or audit metadata.
 */
export function fullAccountNumber(account: BankAccount): string {
  return decryptAccountNumber(account.accountNumberEncrypted);
}

/** The organization's default account (onboarding scope). */
export async function getDefaultBankAccount(
  organizationId: string,
): Promise<BankAccount | null> {
  return db.bankAccount.findFirst({
    where: { organizationId, isDefault: true, isActive: true },
    orderBy: { createdAt: "asc" },
  });
}

/** Active accounts only — the invoice editor's dropdown (masked view). */
export async function listBankAccounts(organizationId: string): Promise<BankAccountView[]> {
  const rows = await db.bankAccount.findMany({
    where: { organizationId, isActive: true },
    orderBy: { createdAt: "asc" },
  });
  return rows.map(toBankAccountView);
}

/** Management list: paginated, every row (inactive included, badge honest). */
export async function listBankAccountsPage(
  ctx: BankAccountServiceContext,
  options: { page?: number } = {},
): Promise<{
  rows: BankAccountView[];
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
}> {
  assertCan("bankAccount.view", ctx.scope);
  const pageSize = BANK_ACCOUNTS_PAGE_SIZE;
  const where = { organizationId: ctx.scope.organizationId };
  const total = await db.bankAccount.count({ where });
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(Math.max(1, options.page ?? 1), pageCount);
  const rows = await db.bankAccount.findMany({
    where,
    orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }, { id: "asc" }],
    skip: (page - 1) * pageSize,
    take: pageSize,
  });
  return { rows: rows.map(toBankAccountView), total, page, pageSize, pageCount };
}

export interface BankAccountDetail extends BankAccountView {
  /** Plaintext number when the caller may manage (STAFF+); null for VIEWER. */
  accountNumber: string | null;
}

/** Detail for the edit/read page — org-scoped (IDOR → NOT_FOUND). */
export async function getBankAccountDetail(
  id: string,
  ctx: BankAccountServiceContext,
): Promise<BankAccountDetail> {
  assertCan("bankAccount.view", ctx.scope);
  const row = await db.bankAccount.findFirst({
    where: { id, organizationId: ctx.scope.organizationId },
  });
  if (!row) throw new AppError("NOT_FOUND", "Rekening bank tidak ditemukan.");
  const mayReveal = can("bankAccount.update", ctx.scope);
  return {
    ...toBankAccountView(row),
    accountNumber: mayReveal ? decryptAccountNumber(row.accountNumberEncrypted) : null,
  };
}

const ACCOUNT_NUMBER_FORMAT = "Nomor rekening harus 6–34 digit angka.";

function digitsOf(accountNumber: string | undefined): string {
  return accountNumber ? normalizeAccountNumber(accountNumber) : "";
}

function assertDigits(digits: string): void {
  if (digits && !/^\d{6,34}$/.test(digits)) {
    throw new AppError("VALIDATION_ERROR", ACCOUNT_NUMBER_FORMAT);
  }
}

/** Profile defaults follow the org default (feature 02 pattern: the editor
 * prefills from `InvoiceProfile.defaultBankAccountId`, and with one profile per
 * organisation — recorded feature-08 decision — the two must not drift). */
async function pointProfilesAtBank(
  tx: Prisma.TransactionClient,
  organizationId: string,
  bankAccountId: string | null,
  onlyProfilesPointingAt?: string,
): Promise<void> {
  await tx.invoiceProfile.updateMany({
    where: {
      organizationId,
      ...(onlyProfilesPointingAt ? { defaultBankAccountId: onlyProfilesPointingAt } : {}),
    },
    data: { defaultBankAccountId: bankAccountId },
  });
}

/** Becoming the default clears the flag on every other account of the org. */
async function clearOtherDefaults(
  tx: Prisma.TransactionClient,
  organizationId: string,
  keepId: string,
): Promise<void> {
  await tx.bankAccount.updateMany({
    where: { organizationId, isDefault: true, id: { not: keepId } },
    data: { isDefault: false },
  });
}

export async function createBankAccount(
  input: BankAccountInput,
  ctx: BankAccountServiceContext,
): Promise<BankAccount> {
  assertCan("bankAccount.create", ctx.scope);
  const digits = digitsOf(input.accountNumber);
  assertDigits(digits);
  if (!digits) {
    throw new AppError("VALIDATION_ERROR", "Nomor rekening wajib diisi.");
  }

  const organizationId = ctx.scope.organizationId;
  const hasDefault = await db.bankAccount.findFirst({
    where: { organizationId, isDefault: true },
    select: { id: true },
  });
  // First account is always the default; afterwards the checkbox decides.
  const makeDefault = input.isDefault === true || hasDefault === null;

  const account = await db.$transaction(async (tx) => {
    // Row does not exist yet, so clearing "the default" clears every row.
    if (makeDefault) {
      await tx.bankAccount.updateMany({
        where: { organizationId, isDefault: true },
        data: { isDefault: false },
      });
    }
    const created = await tx.bankAccount.create({
      data: {
        organizationId,
        bankName: input.bankName,
        bankCode: input.bankCode ?? null,
        accountNumberEncrypted: encryptAccountNumber(digits),
        accountNumberLast4: accountNumberLast4(digits),
        accountHolder: input.accountHolder,
        branch: input.branch ?? null,
        currency: "IDR",
        isDefault: makeDefault,
        isActive: input.isActive ?? true,
      },
    });
    if (makeDefault) await pointProfilesAtBank(tx, organizationId, created.id);
    return created;
  });

  // Audit metadata never carries the number — only non-sensitive identifiers.
  await log({
    actorUserId: ctx.scope.userId,
    organizationId,
    action: "PROFILE_CHANGED",
    entityType: "bankAccount",
    entityId: account.id,
    metadata: { change: "created", bankName: account.bankName, isDefault: makeDefault },
    request: ctx.request ?? null,
  });
  return account;
}

export async function updateBankAccount(
  id: string,
  input: BankAccountInput,
  ctx: BankAccountServiceContext,
): Promise<BankAccount> {
  assertCan("bankAccount.update", ctx.scope);
  const organizationId = ctx.scope.organizationId;
  const existing = await db.bankAccount.findFirst({ where: { id, organizationId } });
  if (!existing) throw new AppError("NOT_FOUND", "Rekening bank tidak ditemukan.");

  const digits = digitsOf(input.accountNumber);
  assertDigits(digits);

  // Absent flag = leave the current default state untouched (the form always
  // sends an explicit value; a bare service call must not silently un-default).
  const wantDefault = input.isDefault ?? existing.isDefault;
  const becameDefault = wantDefault && !existing.isDefault;
  const unsetDefault = !wantDefault && existing.isDefault;

  const account = await db.$transaction(async (tx) => {
    if (becameDefault) await clearOtherDefaults(tx, organizationId, id);
    const updated = await tx.bankAccount.update({
      where: { id: existing.id },
      data: {
        bankName: input.bankName,
        bankCode: input.bankCode ?? null,
        // Empty number on edit keeps the stored ciphertext: the plaintext is
        // never round-tripped through the client for this path.
        ...(digits
          ? {
              accountNumberEncrypted: encryptAccountNumber(digits),
              accountNumberLast4: accountNumberLast4(digits),
            }
          : {}),
        accountHolder: input.accountHolder,
        branch: input.branch ?? null,
        isActive: input.isActive ?? existing.isActive,
        isDefault: wantDefault,
      },
    });
    if (becameDefault) await pointProfilesAtBank(tx, organizationId, id);
    if (unsetDefault) {
      await pointProfilesAtBank(tx, organizationId, null, id);
    }
    return updated;
  });

  await log({
    actorUserId: ctx.scope.userId,
    organizationId,
    action: "PROFILE_CHANGED",
    entityType: "bankAccount",
    entityId: account.id,
    metadata: {
      change: becameDefault || unsetDefault ? "defaultChanged" : "updated",
      bankName: account.bankName,
      isDefault: account.isDefault,
    },
    request: ctx.request ?? null,
  });
  return account;
}

/** "Jadikan rekening utama" — idempotent; also what the edit checkbox does. */
export async function setDefaultBankAccount(
  id: string,
  ctx: BankAccountServiceContext,
): Promise<BankAccount> {
  assertCan("bankAccount.update", ctx.scope);
  const organizationId = ctx.scope.organizationId;
  const existing = await db.bankAccount.findFirst({ where: { id, organizationId } });
  if (!existing) throw new AppError("NOT_FOUND", "Rekening bank tidak ditemukan.");
  if (existing.isDefault) return existing;

  const account = await db.$transaction(async (tx) => {
    await clearOtherDefaults(tx, organizationId, id);
    const updated = await tx.bankAccount.update({
      where: { id: existing.id },
      data: { isDefault: true },
    });
    await pointProfilesAtBank(tx, organizationId, id);
    return updated;
  });

  await log({
    actorUserId: ctx.scope.userId,
    organizationId,
    action: "PROFILE_CHANGED",
    entityType: "bankAccount",
    entityId: account.id,
    metadata: { change: "defaultChanged", bankName: account.bankName, isDefault: true },
    request: ctx.request ?? null,
  });
  return account;
}

/**
 * Hard delete (data-model: soft delete exists only for Customer). The schema's
 * FKs are SetNull on Invoice.bankAccountId and InvoiceProfile.defaultBankAccountId,
 * so issued documents keep their frozen snapshot and the profile default simply
 * clears; if the org default was removed, the next create auto-claims it.
 */
export async function deleteBankAccount(
  id: string,
  ctx: BankAccountServiceContext,
): Promise<void> {
  assertCan("bankAccount.delete", ctx.scope);
  const organizationId = ctx.scope.organizationId;
  const existing = await db.bankAccount.findFirst({ where: { id, organizationId } });
  if (!existing) throw new AppError("NOT_FOUND", "Rekening bank tidak ditemukan.");

  await db.bankAccount.delete({ where: { id: existing.id } });

  await log({
    actorUserId: ctx.scope.userId,
    organizationId,
    action: "PROFILE_CHANGED",
    entityType: "bankAccount",
    entityId: existing.id,
    metadata: { change: "deleted", bankName: existing.bankName, wasDefault: existing.isDefault },
    request: ctx.request ?? null,
  });
}

/**
 * Creates the default account, or replaces the existing default's fields
 * (onboarding step 6 — feature 02 path, kept behaviorally intact). The
 * plaintext number never leaves this module: only ciphertext is stored,
 * only the last4 is kept in the clear for masking.
 */
export async function saveBankAccount(
  input: BankAccountInput,
  ctx: BankAccountServiceContext,
): Promise<BankAccount> {
  assertCan("org.settings.update", ctx.scope);

  const existing = await getDefaultBankAccount(ctx.scope.organizationId);

  const digits = digitsOf(input.accountNumber);
  assertDigits(digits);

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
