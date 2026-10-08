// src/modules/invoices/service.ts
// Invoice DRAFT domain (feature 04): createDraft / updateDraft (autosave) /
// getDraft / listDrafts / deleteDraft + prefill composition. The editor UI and
// the future issue flow (feature 05) share one truth:
//
//   • SERVER RECALCULATION (architecture invariant 2): every save recomputes
//     lineAmounts, itemsSubtotal, workValue, billingBase, tax and grandTotal
//     with `calculateInvoice` — the client's numbers are display-only and the
//     persisted Decimal columns always equal the calculation engine output.
//   • ORG SCOPING + IDOR: every read/write is scoped to the active
//     organization; a foreign id answers 404, never "exists elsewhere".
//   • DRAFT only: this module never allocates the final number (that is the
//     issue transaction, feature 05). Drafts carry a non-binding
//     `numberPreview` rendered from the profile pattern.
//   • previouslyBilled (SETTLEMENT) comes from the DATABASE: the sum of
//     ISSUED-and-later, non-CANCELLED/non-REVISED invoices linked to the same
//     project (invariant 6: drafts never count as billed). Feature 04 has no
//     issue flow yet, so this is honestly 0 — but the wiring is real.

import { log } from "@/modules/audit/service";
import Decimal from "decimal.js";
import { AppError } from "@/lib/errors";
import { parseCalendarDate, toCalendarInput, todayInJakarta } from "@/lib/date";
import { assertCan, requireOrgScope } from "@/modules/permissions/service";
import { buildNumberPreview, sequenceKeyFor } from "@/modules/invoices/numbering";
import {
  BILLED_STATUSES,
  sumBilledForProject,
} from "@/modules/invoices/billed";
import { calculateInvoice, type InvoiceCalcResult } from "@/modules/invoices/calculation";
import {
  MAX_INVOICE_ITEMS,
  isItemWorthSaving,
  type InvoiceDraftFormOutput,
  type InvoiceItemValues,
} from "@/modules/invoices/schema";
import { getCustomerForScope } from "@/modules/customers/service";
import { getProjectForScope } from "@/modules/projects/service";
import { listBankAccounts, type BankAccountView } from "@/modules/bank-accounts/service";
import { listSigners, type SignerView } from "@/modules/signers/service";
import { logger } from "@/server/logger";
import { db } from "@/server/db";
import type {
  Invoice,
  InvoiceItem,
  InvoiceType,
  OrganizationRole,
  Prisma,
  ReferenceType,
  SequenceResetPolicy,
  TaxMode,
} from "@prisma/client";

export { MAX_INVOICE_ITEMS } from "@/modules/invoices/schema";

// ─── Service context ──────────────────────────────────────────────────────

export interface InvoiceServiceContext {
  scope: { organizationId: string; role: OrganizationRole; userId: string };
  request?: Request | null;
}

// ─── Views (serializable — server action/page → client components) ────────

export interface DraftItemView {
  id: string;
  position: number;
  description: string;
  details: string | null;
  quantity: string;
  unit: string;
  unitPrice: string;
  discountAmount: string;
  lineAmount: string;
}

export interface DraftPartyView {
  id: string;
  companyName: string;
  address: string | null;
  city: string | null;
  province: string | null;
  postalCode: string | null;
  country: string | null;
  phone: string | null;
  email: string | null;
  taxId: string | null;
}

export interface DraftProfileView {
  id: string;
  name: string;
  legalName: string | null;
  code: string;
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
  numberPreview: string | null;
}

export interface InvoiceDraftView {
  id: string;
  status: "DRAFT";
  invoiceType: InvoiceType;
  number: string | null;
  numberPreview: string | null;
  profile: DraftProfileView;
  customer: DraftPartyView | null;
  customerContactId: string | null;
  contactName: string | null;
  projectReferenceId: string | null;
  projectTitle: string | null;

  invoiceDate: string;
  dueDate: string | null;
  referenceType: string | null;
  referenceNumber: string | null;
  referenceDate: string | null;
  paymentTerms: string | null;
  currency: string;

  billingMode: "PERCENT" | "MANUAL";
  billingPercent: string | null;
  billingAmount: string | null;
  termName: string | null;
  termNumber: number | null;
  customLabel: string | null;
  customReason: string | null;
  workValueOverride: boolean;
  workValueOverrideAmount: string | null;
  workValueReason: string | null;
  previouslyBilled: string;

  items: DraftItemView[];

  discountAmount: string;
  additionalAmount: string;
  taxMode: TaxMode;
  taxPercent: string | null;
  /** MANUAL tax mode: the stored nominal (taxAmount column). */
  taxAmountInput: string | null;
  roundingAmount: string;

  bankAccountId: string | null;
  stampMode: string;
  signerId: string | null;
  notes: string | null;
  footerText: string | null;

  /** Authoritative server calculation — the preview renders these numbers. */
  calc: InvoiceCalcResult;

  createdAt: string;
  updatedAt: string;
}

export interface InvoiceListItem {
  id: string;
  numberPreview: string | null;
  number: string | null;
  invoiceType: InvoiceType;
  customerName: string;
  grandTotal: string;
  currency: string;
  invoiceDate: string;
  updatedAt: string;
}

type InvoiceWithRelations = Invoice & {
  profile: {
    id: string;
    name: string;
    legalName: string | null;
    code: string;
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
  };
  customer: {
    id: string;
    companyName: string;
    address: string | null;
    city: string | null;
    province: string | null;
    postalCode: string | null;
    country: string | null;
    phone: string | null;
    email: string | null;
    taxId: string | null;
  } | null;
  customerContact: { id: string; name: string } | null;
  projectReference: { id: string; title: string } | null;
  items: InvoiceItem[];
};
export type { InvoiceWithRelations };

const draftInclude = {
  profile: true,
  customer: true,
  customerContact: { select: { id: true, name: true } },
  projectReference: { select: { id: true, title: true } },
  items: { orderBy: { position: "asc" as const } },
} satisfies Prisma.InvoiceInclude;

/** Re-run the calculation engine over persisted rows (Decimal → string).
 * `previouslyBilled` overrides the stored column — the issue flow passes the
 * freshly summed value (invariant 6) before it is persisted. */
export function calcFromRows(
  invoice: InvoiceWithRelations,
  previouslyBilled: string = invoice.previouslyBilled.toString(),
): InvoiceCalcResult {
  return calculateInvoice({
    invoiceType: invoice.invoiceType,
    items: invoice.items.map((item) => ({
      quantity: item.quantity.toString(),
      unitPrice: item.unitPrice.toString(),
      discountAmount: item.discountAmount.toString(),
    })),
    workValueOverride: invoice.workValueOverride,
    // When the override is on, the stored workValue IS the manual amount.
    workValueOverrideAmount: invoice.workValue.toString(),
    billingMode: invoice.billingMode,
    billingPercent: invoice.billingPercent?.toString(),
    billingAmount: invoice.billingAmount?.toString(),
    previouslyBilled,
    discountAmount: invoice.discountAmount.toString(),
    additionalAmount: invoice.additionalAmount.toString(),
    taxMode: invoice.taxMode,
    taxPercent: invoice.taxPercent?.toString(),
    taxAmountInput: invoice.taxMode === "MANUAL" ? invoice.taxAmount.toString() : null,
    roundingAmount: invoice.roundingAmount.toString(),
  });
}

export function toDraftView(invoice: InvoiceWithRelations): InvoiceDraftView {
  const workValueFromOverride = invoice.workValueOverride ? invoice.workValue.toString() : null;
  return {
    id: invoice.id,
    status: "DRAFT",
    invoiceType: invoice.invoiceType,
    number: invoice.number,
    numberPreview: invoice.numberPreview,
    profile: {
      id: invoice.profile.id,
      name: invoice.profile.name,
      legalName: invoice.profile.legalName,
      code: invoice.profile.code,
      logoPath: invoice.profile.logoPath,
      primaryColor: invoice.profile.primaryColor,
      address: invoice.profile.address,
      phone: invoice.profile.phone,
      whatsapp: invoice.profile.whatsapp,
      fax: invoice.profile.fax,
      email: invoice.profile.email,
      website: invoice.profile.website,
      taxId: invoice.profile.taxId,
      numberPattern: invoice.profile.numberPattern,
      numberPreview: invoice.numberPreview,
    },
    customer: invoice.customer
      ? {
          id: invoice.customer.id,
          companyName: invoice.customer.companyName,
          address: invoice.customer.address,
          city: invoice.customer.city,
          province: invoice.customer.province,
          postalCode: invoice.customer.postalCode,
          country: invoice.customer.country,
          phone: invoice.customer.phone,
          email: invoice.customer.email,
          taxId: invoice.customer.taxId,
        }
      : null,
    customerContactId: invoice.customerContactId,
    contactName: invoice.customerContact?.name ?? null,
    projectReferenceId: invoice.projectReferenceId,
    projectTitle: invoice.projectReference?.title ?? null,
    invoiceDate: toCalendarInput(invoice.invoiceDate.toISOString()),
    dueDate: invoice.dueDate ? toCalendarInput(invoice.dueDate.toISOString()) : null,
    referenceType: invoice.referenceType,
    referenceNumber: invoice.referenceNumber,
    referenceDate: invoice.referenceDate ? toCalendarInput(invoice.referenceDate.toISOString()) : null,
    paymentTerms: invoice.paymentTerms,
    currency: invoice.currency,
    billingMode: invoice.billingMode,
    billingPercent: invoice.billingPercent?.toString() ?? null,
    billingAmount: invoice.billingAmount?.toString() ?? null,
    termName: invoice.termName,
    termNumber: invoice.termNumber,
    customLabel: invoice.customLabel,
    customReason: invoice.customReason,
    workValueOverride: invoice.workValueOverride,
    workValueOverrideAmount: workValueFromOverride,
    workValueReason: invoice.workValueReason,
    previouslyBilled: invoice.previouslyBilled.toString(),
    items: invoice.items.map((item) => ({
      id: item.id,
      position: item.position,
      description: item.description,
      details: item.details,
      quantity: item.quantity.toString(),
      unit: item.unit,
      unitPrice: item.unitPrice.toString(),
      discountAmount: item.discountAmount.toString(),
      lineAmount: item.lineAmount.toString(),
    })),
    discountAmount: invoice.discountAmount.toString(),
    additionalAmount: invoice.additionalAmount.toString(),
    taxMode: invoice.taxMode,
    taxPercent: invoice.taxPercent?.toString() ?? null,
    taxAmountInput: invoice.taxMode === "MANUAL" ? invoice.taxAmount.toString() : null,
    roundingAmount: invoice.roundingAmount.toString(),
    bankAccountId: invoice.bankAccountId,
    stampMode: invoice.stampMode,
    signerId: invoice.signerId,
    notes: invoice.notes,
    footerText: invoice.footerText,
    calc: calcFromRows(invoice),
    createdAt: invoice.createdAt.toISOString(),
    updatedAt: invoice.updatedAt.toISOString(),
  };
}

// ─── Guards ────────────────────────────────────────────────────────────────

async function getDraftRow(invoiceId: string, ctx: InvoiceServiceContext): Promise<Invoice> {
  const invoice = await db.invoice.findUnique({ where: { id: invoiceId } });
  if (!invoice || invoice.organizationId !== ctx.scope.organizationId) {
    // Same answer as a missing row — no cross-tenant existence leak (IDOR).
    throw new AppError("NOT_FOUND", "Invoice tidak ditemukan.");
  }
  return invoice;
}

function assertDraftEditable(invoice: Invoice): void {
  if (invoice.status !== "DRAFT") {
    // Invariant 5: issued invoices are locked (edit path = feature 05 revision).
    throw new AppError("LOCKED", "Invoice yang sudah terbit tidak dapat diedit.");
  }
}

/**
 * The four id references on a draft must exist AND belong to the caller's
 * organization (forged ids answer 404). customerContactId is additionally
 * checked against the chosen customer.
 */
async function resolveRelations(
  values: InvoiceDraftFormOutput,
  ctx: InvoiceServiceContext,
): Promise<void> {
  // Profile: must belong to the org (feature 02's service exposes getProfileForScope
  // through db reads; inline scoped read keeps the cross-module surface small).
  const profile = await db.invoiceProfile.findUnique({ where: { id: values.profileId } });
  if (!profile || profile.organizationId !== ctx.scope.organizationId) {
    throw new AppError("NOT_FOUND", "Profil invoice tidak ditemukan.");
  }

  await getCustomerForScope(values.customerId, ctx);

  if (values.customerContactId) {
    const contact = await db.customerContact.findUnique({
      where: { id: values.customerContactId },
    });
    if (!contact || contact.customerId !== values.customerId) {
      throw new AppError("NOT_FOUND", "PIC tidak ditemukan untuk customer ini.");
    }
  }

  if (values.projectReferenceId) {
    await getProjectForScope(values.projectReferenceId, ctx);
  }

  if (values.bankAccountId) {
    const bank = await db.bankAccount.findUnique({ where: { id: values.bankAccountId } });
    if (!bank || bank.organizationId !== ctx.scope.organizationId) {
      throw new AppError("NOT_FOUND", "Rekening tidak ditemukan.");
    }
  }

  if (values.signerId) {
    const signer = await db.signer.findUnique({ where: { id: values.signerId } });
    if (!signer || signer.organizationId !== ctx.scope.organizationId) {
      throw new AppError("NOT_FOUND", "Penanda tangan tidak ditemukan.");
    }
  }
}

/**
 * previouslyBilled from the DATABASE (invariant 6): only ISSUED-and-later
 * invoices of the SAME project count; CANCELLED/REVISED never do. No project
 * link → 0 (there is nothing verifiable to bill against). The rule itself
 * lives in modules/invoices/billed.ts (shared with issue/lifecycle/projects).
 */
async function computePreviouslyBilled(
  ctx: InvoiceServiceContext,
  projectReferenceId: string | null,
  excludeInvoiceId?: string,
): Promise<string> {
  return sumBilledForProject(db, {
    organizationId: ctx.scope.organizationId,
    projectReferenceId,
    excludeInvoiceId,
  });
}

// ─── Save pipeline (shared by create + update) ────────────────────────────

type DraftScalarData = Partial<
  Omit<
    Prisma.InvoiceUncheckedCreateInput,
    | "id"
    | "organizationId"
    | "createdById"
    | "status"
    | "currency"
    | "number"
    | "numberPreview"
    | "amountPaid"
    | "items"
  >
> &
  // normalizeValues always produces these — keep them required so the object
  // spreads into InvoiceUncheckedCreateInput without an `undefined` widening.
  Pick<
    Prisma.InvoiceUncheckedCreateInput,
    "invoiceType" | "invoiceDate" | "workValue" | "itemsSubtotal" | "billingBase" | "grandTotal"
  >;

interface NormalizedDraft {
  /** Draft-owned scalar fields only, with plain value types (no relation
   * objects, no Prisma field-operation unions). The same object spreads
   * cleanly into both InvoiceUncheckedCreateInput (create) and
   * InvoiceUncheckedUpdateInput (autosave update). */
  data: DraftScalarData;
  items: Array<{
    description: string;
    details: string | null;
    quantity: string;
    unit: string;
    unitPrice: string;
    discountAmount: string;
    lineAmount: string;
    position: number;
  }>;
  calc: InvoiceCalcResult;
}

function normalizeValues(
  values: InvoiceDraftFormOutput,
  previouslyBilled: string,
): NormalizedDraft {
  const invoiceDate = parseCalendarDate(values.invoiceDate || todayInJakarta())!;
  const dueDate = parseCalendarDate(values.dueDate || null);
  const referenceDate = parseCalendarDate(values.referenceDate || null);

  const savedItems = values.items.filter(isItemWorthSaving);
  if (savedItems.length > MAX_INVOICE_ITEMS) {
    throw new AppError(
      "VALIDATION_ERROR",
      `Maksimal ${MAX_INVOICE_ITEMS} item pekerjaan.`,
    );
  }

  // Server recalculation — item rows keep ORIGINAL qty/price even for DP
  // (spec: DP shows 5 × Rp900.000, only billingBase changes).
  const calc = calculateInvoice({
    invoiceType: values.invoiceType,
    items: savedItems.map((item) => ({
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      discountAmount: item.discountAmount,
    })),
    workValueOverride: values.workValueOverride,
    workValueOverrideAmount: values.workValueOverrideAmount,
    billingMode: values.billingMode,
    billingPercent: values.billingPercent,
    billingAmount: values.billingAmount,
    previouslyBilled,
    discountAmount: values.discountAmount,
    additionalAmount: values.additionalAmount,
    taxMode: values.taxMode,
    taxPercent: values.taxPercent,
    taxAmountInput: values.taxAmountInput,
    roundingAmount: values.roundingAmount,
  });

  const workValue = values.workValueOverride
    ? calc.workValue
    : calc.itemsSubtotal;

  const data: DraftScalarData = {
    invoiceType: values.invoiceType,
    invoiceDate,
    dueDate,
    referenceType: (values.referenceType || null) as ReferenceType | null,
    referenceNumber: values.referenceNumber?.trim() || null,
    referenceDate,
    paymentTerms: values.paymentTerms?.trim() || null,
    workValue,
    workValueOverride: values.workValueOverride,
    workValueReason: values.workValueReason?.trim() || null,
    itemsSubtotal: calc.itemsSubtotal,
    previouslyBilled,
    billingMode: values.billingMode,
    billingPercent:
      values.billingMode === "PERCENT" &&
      (values.invoiceType === "DOWN_PAYMENT" || values.invoiceType === "TERM")
        ? values.billingPercent || null
        : null,
    billingAmount:
      values.billingMode === "MANUAL" || values.invoiceType === "CUSTOM"
        ? values.billingAmount || null
        : null,
    termName: values.invoiceType === "TERM" ? values.termName?.trim() || null : null,
    termNumber:
      values.invoiceType === "TERM" && values.termNumber ? Number(values.termNumber) : null,
    customLabel: values.invoiceType === "CUSTOM" ? values.customLabel?.trim() || null : null,
    customReason: values.invoiceType === "CUSTOM" ? values.customReason?.trim() || null : null,
    billingBase: calc.billingBase,
    discountAmount: calc.discountAmount,
    additionalAmount: calc.additionalAmount,
    taxMode: values.taxMode,
    taxPercent:
      values.taxMode === "EXCLUSIVE" || values.taxMode === "INCLUSIVE"
        ? values.taxPercent || null
        : null,
    taxAmount: calc.taxAmount,
    roundingAmount: calc.roundingAmount,
    grandTotal: calc.grandTotal,
    notes: values.notes?.trim() || null,
    footerText: values.footerText?.trim() || null,
    stampMode: values.stampMode,
    // profile / customer / project / bank / signer relations: connect below
  };

  const items = savedItems.map((item: InvoiceItemValues, index: number) => ({
    description: item.description.trim(),
    details: item.details?.trim() || null,
    quantity: item.quantity,
    unit: item.unit.trim(),
    unitPrice: item.unitPrice,
    discountAmount: item.discountAmount?.trim() || "0",
    lineAmount: calc.lineAmounts[index] ?? "0.00",
    position: index + 1,
  }));

  return { data, items, calc };
}

/**
 * Relation fields as plain scalar FKs (Unchecked inputs). The same object is
 * valid in InvoiceUncheckedCreateInput and InvoiceUncheckedUpdateInput — no
 * relation connect objects, no field-operation unions (typecheck contract).
 */
function relationScalars(values: InvoiceDraftFormOutput): {
  profileId: string;
  customerId: string;
  customerContactId: string | null;
  projectReferenceId: string | null;
  bankAccountId: string | null;
  signerId: string | null;
} {
  return {
    profileId: values.profileId,
    customerId: values.customerId,
    customerContactId: values.customerContactId?.trim() || null,
    projectReferenceId: values.projectReferenceId?.trim() || null,
    bankAccountId: values.bankAccountId?.trim() || null,
    signerId: values.signerId?.trim() || null,
  };
}

/**
 * Manual value decisions are gated by the draft.create/draft.update permission
 * (asserted by the caller) + a mandatory reason — the spec deliberately does
 * NOT introduce a separate "invoice.value.override" permission (toggle +
 * reason only; open question in progress-tracker).
 */
function assertOverridePermissions(values: InvoiceDraftFormOutput): void {
  const needsReason =
    (values.workValueOverride && !values.workValueReason?.trim()) ||
    (values.invoiceType === "CUSTOM" && !values.customReason?.trim());
  if (needsReason) {
    throw new AppError(
      "VALIDATION_ERROR",
      "Nilai manual wajib disertai alasan (toggle nilai pekerjaan / custom).",
    );
  }
}

async function loadDraftFull(invoiceId: string, ctx: InvoiceServiceContext): Promise<InvoiceDraftView> {
  // IDOR guard runs inside getDraftRow before the joined read is used.
  await getDraftRow(invoiceId, ctx);
  const invoice = (await db.invoice.findUnique({
    where: { id: invoiceId },
    include: draftInclude,
  })) as InvoiceWithRelations | null;
  if (!invoice) throw new AppError("NOT_FOUND", "Invoice tidak ditemukan.");
  return toDraftView(invoice);
}

// ─── Public service API ────────────────────────────────────────────────────

export interface EditorInitialValues {
  invoiceDate: string;
  profileId: string | null;
  referenceType: string;
}

/** Sensible first-open defaults for /invoices/new (no DB writes). */
export function editorDefaults(): EditorInitialValues {
  return { invoiceDate: todayInJakarta(), profileId: null, referenceType: "PURCHASE_ORDER" };
}

export async function createDraft(
  values: InvoiceDraftFormOutput,
  ctx: InvoiceServiceContext,
): Promise<InvoiceDraftView> {
  assertCan("invoice.draft.create", ctx.scope);
  requireOrgScope(ctx.scope);
  assertOverridePermissions(values);
  await resolveRelations(values, ctx);

  const previouslyBilled = await computePreviouslyBilled(ctx, values.projectReferenceId || null);
  const normalized = normalizeValues(values, previouslyBilled);

  const invoice = await db.$transaction(async (tx) => {
    const created = await tx.invoice.create({
      data: {
        organizationId: ctx.scope.organizationId,
        createdById: ctx.scope.userId,
        status: "DRAFT",
        currency: "IDR",
        ...normalized.data,
        ...relationScalars(values),
        items: {
          create: normalized.items.map((item) => ({
            ...item,
            metadata: undefined,
          })),
        },
      },
      select: { id: true },
    });

    const profile = await tx.invoiceProfile.findUniqueOrThrow({
      where: { id: values.profileId },
      select: { id: true, code: true, numberPattern: true, sequenceResetPolicy: true },
    });
    const numberPreview = await buildNumberPreview(profile, normalized.data.invoiceDate as Date, tx);
    await tx.invoice.update({ where: { id: created.id }, data: { numberPreview } });

    return created;
  });

  await log({
    actorUserId: ctx.scope.userId,
    organizationId: ctx.scope.organizationId,
    action: "INVOICE_DRAFT_CREATED",
    entityType: "invoice",
    entityId: invoice.id,
    metadata: { invoiceType: values.invoiceType, itemCount: normalized.items.length },
    request: ctx.request ?? null,
  });

  return loadDraftFull(invoice.id, ctx);
}

export async function updateDraft(
  invoiceId: string,
  values: InvoiceDraftFormOutput,
  ctx: InvoiceServiceContext,
): Promise<InvoiceDraftView> {
  assertCan("invoice.draft.update", ctx.scope);
  requireOrgScope(ctx.scope);
  const existing = await getDraftRow(invoiceId, ctx);
  assertDraftEditable(existing);
  assertOverridePermissions(values);
  await resolveRelations(values, ctx);

  const previouslyBilled = await computePreviouslyBilled(
    ctx,
    values.projectReferenceId || null,
    invoiceId,
  );
  const normalized = normalizeValues(values, previouslyBilled);

  await db.$transaction(async (tx) => {
    await tx.invoice.update({
      where: { id: invoiceId },
      data: {
        ...normalized.data,
        ...relationScalars(values),
      },
    });
    // Items are small and fully replaced on every autosave (position order
    // is the item array order — drag reorder is just an array move).
    await tx.invoiceItem.deleteMany({ where: { invoiceId } });
    if (normalized.items.length > 0) {
      await tx.invoiceItem.createMany({
        data: normalized.items.map((item) => ({ invoiceId, ...item })),
      });
    }

    const profile = await tx.invoiceProfile.findUniqueOrThrow({
      where: { id: values.profileId },
      select: { id: true, code: true, numberPattern: true, sequenceResetPolicy: true },
    });
    const numberPreview = await buildNumberPreview(profile, normalized.data.invoiceDate as Date, tx);
    await tx.invoice.update({ where: { id: invoiceId }, data: { numberPreview } });
  });

  // Audit the FIELDS that changed (names only — no customer PII, no amounts).
  const changed = changedFields(existing, values, normalized);
  if (changed.length > 0) {
    await log({
      actorUserId: ctx.scope.userId,
      organizationId: ctx.scope.organizationId,
      action: "INVOICE_UPDATED",
      entityType: "invoice",
      entityId: invoiceId,
      metadata: { change: "updated", fields: changed },
      request: ctx.request ?? null,
    });
  }

  return loadDraftFull(invoiceId, ctx);
}

function changedFields(
  before: Invoice,
  values: InvoiceDraftFormOutput,
  normalized: NormalizedDraft,
): string[] {
  const next: Record<string, unknown> = {
    invoiceType: values.invoiceType,
    profileId: values.profileId,
    customerId: values.customerId,
    customerContactId: values.customerContactId || null,
    projectReferenceId: values.projectReferenceId || null,
    bankAccountId: values.bankAccountId || null,
    signerId: values.signerId || null,
    referenceType: values.referenceType || null,
    referenceNumber: values.referenceNumber?.trim() || null,
    paymentTerms: values.paymentTerms?.trim() || null,
    notes: values.notes?.trim() || null,
    footerText: values.footerText?.trim() || null,
    taxMode: values.taxMode,
    stampMode: values.stampMode,
    dueDate: (normalized.data.dueDate as Date | null)?.getTime() ?? null,
    invoiceDate: (normalized.data.invoiceDate as Date).getTime(),
    referenceDate: (normalized.data.referenceDate as Date | null)?.getTime() ?? null,
    itemCount: normalized.items.length,
  };
  const changed: string[] = [];
  for (const [key, value] of Object.entries(next)) {
    const current = (before as unknown as Record<string, unknown>)[key];
    const currentComparable = current instanceof Date ? current.getTime() : current;
    if (String(currentComparable ?? "") !== String(value ?? "")) changed.push(key);
  }
  return changed;
}

export async function getDraft(invoiceId: string, ctx: InvoiceServiceContext): Promise<InvoiceDraftView> {
  assertCan("invoice.draft.read", ctx.scope);
  requireOrgScope(ctx.scope);
  // Feature 05: an ISSUED invoice is immutable (invariant 5). The editor's
  // load path answers LOCKED, which /invoices/[id]/edit turns into a redirect
  // to the detail page — an issued document can only be revised, never edited.
  const row = await getDraftRow(invoiceId, ctx);
  assertDraftEditable(row);
  return loadDraftFull(invoiceId, ctx);
}

export async function deleteDraft(invoiceId: string, ctx: InvoiceServiceContext): Promise<void> {
  assertCan("invoice.draft.delete", ctx.scope);
  requireOrgScope(ctx.scope);
  const invoice = await getDraftRow(invoiceId, ctx);
  assertDraftEditable(invoice);

  await db.invoice.delete({ where: { id: invoice.id } });
  await log({
    actorUserId: ctx.scope.userId,
    organizationId: ctx.scope.organizationId,
    action: "INVOICE_UPDATED",
    entityType: "invoice",
    entityId: invoice.id,
    // AuditAction has no INVOICE_DELETED yet (list finalized in feature 11) —
    // recorded as INVOICE_UPDATED change=deleted (same precedent as feature 03).
    metadata: { change: "deleted", invoiceType: invoice.invoiceType },
    request: ctx.request ?? null,
  });
}

/** Minimal draft list for navigation (feature 08 owns the full-featured list). */
export async function listDrafts(
  ctx: InvoiceServiceContext,
  query: { page?: number; pageSize?: number } = {},
): Promise<{ rows: InvoiceListItem[]; total: number; page: number; pageSize: number; totalPages: number }> {
  assertCan("invoice.draft.read", ctx.scope);
  requireOrgScope(ctx.scope);
  const pageSize = Math.min(Math.max(query.pageSize ?? 20, 1), 100);

  const where: Prisma.InvoiceWhereInput = {
    organizationId: ctx.scope.organizationId,
    status: "DRAFT",
  };
  const total = await db.invoice.count({ where });
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(Math.max(query.page ?? 1, 1), totalPages);
  const rows = await db.invoice.findMany({
    where,
    orderBy: { updatedAt: "desc" },
    skip: (page - 1) * pageSize,
    take: pageSize,
    include: { customer: { select: { companyName: true } } },
  });

  return {
    rows: rows.map((row) => ({
      id: row.id,
      numberPreview: row.numberPreview,
      number: row.number,
      invoiceType: row.invoiceType,
      customerName: row.customer?.companyName ?? "—",
      grandTotal: row.grandTotal.toString(),
      currency: row.currency,
      invoiceDate: toCalendarInput(row.invoiceDate.toISOString()),
      updatedAt: row.updatedAt.toISOString(),
    })),
    total,
    page,
    pageSize,
    totalPages,
  };
}

// ─── Editor data bundle (one round-trip for the editor page) ───────────────

export interface EditorProfileOption {
  id: string;
  name: string;
  code: string;
  numberPattern: string;
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
  /** Feature 02 defaults — applied by the editor when a profile is chosen. */
  defaultBankAccountId: string | null;
  defaultSignerId: string | null;
  defaultTaxMode: TaxMode;
  defaultTaxPercent: string | null;
  defaultStampMode: string;
  defaultNotes: string | null;
}

export interface EditorProjectOption {
  id: string;
  title: string;
  referenceType: string;
  referenceNumber: string;
  referenceDate: string | null;
  customerId: string;
  customerName: string;
  workValue: string;
  currency: string;
  /** Sum of ISSUED-and-later (non-CANCELLED/REVISED) invoices linked to the
   * project — the settlement view's "sudah ditagihkan" (invariant 6). */
  previouslyBilled: string;
}

export interface EditorOptions {
  profiles: EditorProfileOption[];
  banks: BankAccountView[];
  signers: SignerView[];
  projects: EditorProjectOption[];
  /** Customers of the org — the editor's customer dropdown. */
  customers: Array<{ id: string; companyName: string }>;
}

/** Current bucket value for a profile/date (non-allocating read; the draft
 * preview number is always currentValue + 1). Shared by getEditorOptions and
 * its action so client and server derive the same preview sequence. */
export async function nextSequenceHint(
  profile: { id: string; sequenceResetPolicy: SequenceResetPolicy },
  invoiceDate: Date,
): Promise<number> {
  const key = sequenceKeyFor(profile.sequenceResetPolicy, invoiceDate);
  const bucket = await db.invoiceSequence.findUnique({
    where: { invoiceProfileId_sequenceKey: { invoiceProfileId: profile.id, sequenceKey: key } },
    select: { currentValue: true },
  });
  return (bucket?.currentValue ?? 0) + 1;
}

export async function getEditorOptions(ctx: InvoiceServiceContext): Promise<EditorOptions> {
  requireOrgScope(ctx.scope);
  const profiles = await db.invoiceProfile.findMany({
    where: { organizationId: ctx.scope.organizationId, isActive: true },
    orderBy: { createdAt: "asc" },
  });
  const banks = await listBankAccounts(ctx.scope.organizationId);
  const signers = await listSigners(ctx.scope.organizationId);
  // Customer dropdown: active customers only (soft-deleted rows are hidden from
  // every read path — a draft can never point at a deleted customer).
  const customers = await db.customer.findMany({
    where: { organizationId: ctx.scope.organizationId, deletedAt: null },
    orderBy: { companyName: "asc" },
    take: 200,
    select: { id: true, companyName: true },
  });
  // Project dropdown + settlement context in one round-trip: every project of
  // the org with the sum of its ISSUED-and-later invoices (0 while feature 05
  // adds no issue flow — the wiring is real, the honest answer is 0).
  const projects = await db.projectReference.findMany({
    where: { organizationId: ctx.scope.organizationId },
    orderBy: { updatedAt: "desc" },
    take: 200,
    select: {
      id: true,
      title: true,
      referenceType: true,
      referenceNumber: true,
      referenceDate: true,
      customerId: true,
      currency: true,
      workValue: true,
      customer: { select: { companyName: true } },
      invoices: {
        where: { status: { in: [...BILLED_STATUSES] } },
        select: { grandTotal: true },
      },
    },
  });
  // Default bank/signer ride along from the active profile (feature 02) —
  // the editor applies them when the user picks a profile.
  return {
    profiles: profiles.map((profile) => ({
      id: profile.id,
      name: profile.name,
      code: profile.code,
      numberPattern: profile.numberPattern,
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
      defaultBankAccountId: profile.defaultBankAccountId,
      defaultSignerId: profile.defaultSignerId,
      defaultTaxMode: profile.defaultTaxMode,
      defaultTaxPercent:
        profile.defaultTaxPercent === null ? null : profile.defaultTaxPercent.toString(),
      defaultStampMode: profile.defaultStampMode,
      defaultNotes: profile.defaultNotes,
    })),
    banks,
    signers,
    customers: customers.map((customer) => ({
      id: customer.id,
      companyName: customer.companyName,
    })),
    projects: projects.map((project) => ({
      id: project.id,
      title: project.title,
      referenceType: project.referenceType,
      referenceNumber: project.referenceNumber,
      referenceDate: project.referenceDate ? toCalendarInput(project.referenceDate.toISOString()) : null,
      customerId: project.customerId,
      customerName: project.customer.companyName,
      workValue: project.workValue.toString(),
      currency: project.currency,
      previouslyBilled: project.invoices
        .reduce((sum, row) => sum.plus(row.grandTotal.toString()), new Decimal(0))
        .toFixed(2),
    })),
  };
}

/**
 * Non-binding draft preview number for the editor's live preview (feature 04):
 * the value `updateDraft` would persist for profile + invoice date — the active
 * bucket's currentValue + 1, never allocated, never written. Foreign or
 * missing profile answers 404 (IDOR guard), like every other scoped read.
 */
export async function getDraftNumberPreview(
  profileId: string,
  invoiceDate: string,
  ctx: InvoiceServiceContext,
): Promise<string | null> {
  assertCan("invoice.draft.read", ctx.scope);
  requireOrgScope(ctx.scope);
  const profile = await db.invoiceProfile.findUnique({
    where: { id: profileId },
    select: { id: true, organizationId: true, code: true, numberPattern: true, sequenceResetPolicy: true },
  });
  if (!profile || profile.organizationId !== ctx.scope.organizationId) {
    throw new AppError("NOT_FOUND", "Profil invoice tidak ditemukan.");
  }
  const date = parseCalendarDate(invoiceDate) ?? parseCalendarDate(todayInJakarta()) ?? new Date();
  return buildNumberPreview(profile, date);
}

/** PIC options for the chosen customer (editor dropdown). */
export async function listCustomerContacts(
  customerId: string,
  ctx: InvoiceServiceContext,
): Promise<Array<{ id: string; name: string; title: string | null; isPrimary: boolean }>> {
  requireOrgScope(ctx.scope);
  const customer = await getCustomerForScope(customerId, ctx);
  return customer.contacts.map((contact) => ({
    id: contact.id,
    name: contact.name,
    title: contact.title,
    isPrimary: contact.isPrimary,
  }));
}

/** Prefill composition for /invoices/new?project=<id> — feature 03's contract
 * (prefillFromProject: customer, reference, workValue, items copy) lifted into
 * editor form values. workValue rides in as an override (items arrive empty
 * because feature 03 stores no work items — honest, never fabricated). */
export async function prefillEditorFromProject(
  projectId: string,
  ctx: InvoiceServiceContext,
): Promise<{
  customerId: string;
  customerName: string;
  referenceType: string;
  referenceNumber: string;
  referenceDate: string;
  workValueOverrideAmount: string;
  workValueReason: string;
  items: InvoiceItemValues[];
}> {
  const project = await getProjectForScope(projectId, ctx);
  const customer = await getCustomerForScope(project.customerId, ctx);
  return {
    customerId: project.customerId,
    customerName: customer.companyName,
    referenceType: project.referenceType,
    referenceNumber: project.referenceNumber,
    referenceDate: toCalendarInput(project.referenceDate?.toISOString() ?? ""),
    workValueOverrideAmount: project.workValue.toString(),
    workValueReason: `Nilai pekerjaan dari project/PO ${project.referenceNumber}.`,
    // items copy — empty until feature 03's project carries work items.
    items: [],
  };
}

export function logPrefillFailure(error: unknown): void {
  logger.warn(
    { module: "invoices", err: error instanceof Error ? error.message : String(error) },
    "prefill project gagal — editor dibuka kosong",
  );
}
