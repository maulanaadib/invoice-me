// src/components/invoice/renderer-data.ts
// The ONE data contract for the invoice document renderer (preview now, print
// route in feature 06). Both the live editor (unsaved form values + client
// calculation) and the server (persisted draft view) map INTO this shape, so
// the renderer never knows where its data came from. All amounts are decimal
// STRINGS — the preview shows exactly what `calculateInvoice` produced, never
// a re-derived float (ui-context: "preview = hasil server").

import type { InvoiceDraftView } from "@/modules/invoices/service";
import {
  calculateInvoice,
  type InvoiceTypeValue,
  type InvoiceCalcInput,
  type InvoiceCalcResult,
} from "@/modules/invoices/calculation";
import {
  parseProfileSettings,
  type InvoiceProfileSettings,
} from "@/modules/profiles/settings";
import type { IssuedPrintSource } from "@/modules/invoices/print-document";
import type { CustomerSnapshot } from "@/modules/invoices/snapshots";
import type { BankAccountView } from "@/modules/bank-accounts/service";
import type { SignerView } from "@/modules/signers/service";
import type { InvoiceType } from "@prisma/client";

export interface RendererParty {
  name: string | null;
  legalName?: string | null;
  logoPath?: string | null;
  /** Brand color — only the issuer carries it; customers render neutrally. */
  primaryColor?: string | null;
  address?: string | null;
  phone?: string | null;
  whatsapp?: string | null;
  fax?: string | null;
  email?: string | null;
  website?: string | null;
  taxId?: string | null;
}

export interface RendererItem {
  position: number;
  description: string;
  details?: string | null;
  quantity: string;
  unit: string;
  unitPrice: string;
  discountAmount?: string;
  lineAmount: string;
}

export interface InvoiceRendererData {
  /** DRAFT = draft preview badge; feature 06 passes the issued number. */
  number: string | null;
  numberPreview: string | null;
  status: "DRAFT" | "ISSUED";
  invoiceType: InvoiceTypeValue | InvoiceType;
  invoiceDate: string;
  dueDate: string | null;
  referenceType?: string | null;
  referenceNumber?: string | null;
  referenceDate?: string | null;
  paymentTerms?: string | null;

  billingMode?: "PERCENT" | "MANUAL";
  billingPercent?: string | null;
  termName?: string | null;
  termNumber?: number | null;
  customLabel?: string | null;

  issuer: RendererParty;
  customer: RendererParty | null;
  contactName?: string | null;
  projectTitle?: string | null;

  items: RendererItem[];
  calc: InvoiceCalcResult;
  /** INCLUSIVE portion of the paid total that is tax (for the breakdown). */
  taxIncludedInTotal: string;

  bank: Pick<BankAccountView, "bankName" | "accountHolder" | "maskedNumber" | "branch"> | null;
  signer: Pick<SignerView, "name" | "title" | "location" | "signaturePath"> | null;
  stampMode: string;

  /** Bill-To: PIC jabatan/divisi (fitur 06 — absent in the draft view). */
  contactTitle?: string | null;
  contactDivision?: string | null;

  /** InvoiceProfile.settings honored by the document (feature 06):
   * hide-zero summary rows + stamp-slot label toggle. */
  settings?: InvoiceProfileSettings | null;

  notes?: string | null;
  footerText?: string | null;
  primaryColor: string;
  currency: string;
}

/** Draft view (server) → renderer data. Feature 06's print route maps the
 * immutable snapshot into the same shape. */
export function rendererDataFromDraft(
  draft: InvoiceDraftView,
  extras: { bank: BankAccountView | null; signer: SignerView | null },
): InvoiceRendererData {
  return {
    number: draft.number,
    numberPreview: draft.numberPreview,
    status: draft.status,
    invoiceType: draft.invoiceType,
    invoiceDate: draft.invoiceDate,
    dueDate: draft.dueDate,
    referenceType: draft.referenceType,
    referenceNumber: draft.referenceNumber,
    referenceDate: draft.referenceDate,
    paymentTerms: draft.paymentTerms,
    billingMode: draft.billingMode,
    billingPercent: draft.billingPercent,
    termName: draft.termName,
    termNumber: draft.termNumber,
    customLabel: draft.customLabel,
    issuer: {
      name: draft.profile.name,
      legalName: draft.profile.legalName,
      logoPath: draft.profile.logoPath,
      address: draft.profile.address,
      phone: draft.profile.phone,
      whatsapp: draft.profile.whatsapp,
      fax: draft.profile.fax,
      email: draft.profile.email,
      website: draft.profile.website,
      taxId: draft.profile.taxId,
    },
    customer: draft.customer
      ? {
          name: draft.customer.companyName,
          address: [
            draft.customer.address,
            [draft.customer.city, draft.customer.province, draft.customer.postalCode]
              .filter(Boolean)
              .join(", "),
            draft.customer.country,
          ]
            .filter(Boolean)
            .join(" · "),
          phone: draft.customer.phone,
          email: draft.customer.email,
          taxId: draft.customer.taxId,
        }
      : null,
    contactName: draft.contactName,
    projectTitle: draft.projectTitle,
    items: draft.items.map((item) => ({
      position: item.position,
      description: item.description,
      details: item.details,
      quantity: item.quantity,
      unit: item.unit,
      unitPrice: item.unitPrice,
      discountAmount: item.discountAmount,
      lineAmount: item.lineAmount,
    })),
    calc: draft.calc,
    taxIncludedInTotal: draft.calc.taxIncludedInTotal,
    bank: extras.bank,
    signer: extras.signer,
    stampMode: draft.stampMode,
    notes: draft.notes,
    footerText: draft.footerText,
    settings: draft.profile.settings,
    primaryColor: draft.profile.primaryColor,
    currency: draft.currency,
  };
}

// ─── Live editor preview (unsaved form state → renderer data) ──────────────

/** The subset of editor form values the document render needs. Kept separate
 * from the Zod schema so the client can build it from a debounce snapshot
 * without importing the server module graph. */
export interface RendererFormValues {
  invoiceType: InvoiceTypeValue;
  billingMode: "PERCENT" | "MANUAL";
  billingPercent: string;
  billingAmount: string;
  termName: string;
  termNumber: string;
  customLabel: string;
  workValueOverride: boolean;
  workValueOverrideAmount: string;
  invoiceDate: string;
  dueDate: string;
  referenceType: string;
  referenceNumber: string;
  referenceDate: string;
  paymentTerms: string;
  items: Array<{
    description: string;
    details: string;
    quantity: string;
    unit: string;
    unitPrice: string;
    discountAmount: string;
  }>;
  discountAmount: string;
  additionalAmount: string;
  taxMode: "NONE" | "EXCLUSIVE" | "INCLUSIVE" | "MANUAL";
  taxPercent: string;
  taxAmountInput: string;
  roundingAmount: string;
  stampMode: string;
  notes: string;
  footerText: string;
}

export interface RendererPreviewInput {
  values: RendererFormValues;
  numberPreview: string | null;
  profile: { name: string; legalName: string | null; logoPath: string | null; primaryColor: string; address: string | null; phone: string | null; whatsapp: string | null; fax: string | null; email: string | null; website: string | null; taxId: string | null; settings?: InvoiceProfileSettings | null };
  customer: RendererParty | null;
  contactName: string | null;
  projectTitle: string | null;
  bank: Pick<BankAccountView, "bankName" | "accountHolder" | "maskedNumber" | "branch"> | null;
  signer: Pick<SignerView, "name" | "title" | "location" | "signaturePath"> | null;
  previouslyBilled: string;
  currency: string;
}

/**
 * Client-side mirror of the server pipeline: rows worth saving are the ones
 * that reach the document; the calculation uses the exact same
 * `calculateInvoice` module the server runs (preview = hasil server).
 */
export function buildRendererPreviewData(input: RendererPreviewInput): InvoiceRendererData {
  const { values } = input;
  const { settings, ...issuerProfile } = input.profile;
  const savedItems = values.items.filter(
    (item) => item.description.trim() !== "" || item.quantity.trim() !== "" || item.unitPrice.trim() !== "",
  );

  const calcInput: InvoiceCalcInput = {
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
    previouslyBilled: input.previouslyBilled,
    discountAmount: values.discountAmount,
    additionalAmount: values.additionalAmount,
    taxMode: values.taxMode,
    taxPercent: values.taxPercent,
    taxAmountInput: values.taxAmountInput,
    roundingAmount: values.roundingAmount,
  };
  const calc = calculateInvoice(calcInput);

  return {
    number: null,
    numberPreview: input.numberPreview,
    status: "DRAFT",
    invoiceType: values.invoiceType,
    invoiceDate: values.invoiceDate,
    dueDate: values.dueDate || null,
    referenceType: values.referenceType || null,
    referenceNumber: values.referenceNumber || null,
    referenceDate: values.referenceDate || null,
    paymentTerms: values.paymentTerms || null,
    billingMode: values.billingMode,
    billingPercent: values.billingPercent || null,
    termName: values.termName || null,
    termNumber: values.termNumber ? Number(values.termNumber) : null,
    customLabel: values.customLabel || null,
    issuer: { ...issuerProfile },
    customer: input.customer,
    contactName: input.contactName,
    projectTitle: input.projectTitle,
    items: savedItems.map((item, index) => ({
      position: index + 1,
      description: item.description,
      details: item.details || null,
      quantity: item.quantity || "0",
      unit: item.unit,
      unitPrice: item.unitPrice || "0",
      discountAmount: item.discountAmount || "0",
      lineAmount: calc.lineAmounts[index] ?? "0.00",
    })),
    calc,
    taxIncludedInTotal: calc.taxIncludedInTotal,
    bank: input.bank,
    signer: input.signer,
    stampMode: values.stampMode,
    settings: settings ?? null,
    notes: values.notes || null,
    footerText: values.footerText || null,
    primaryColor: input.profile.primaryColor,
    currency: input.currency,
  };
}

// ─── Issued invoice (print route / PDF, feature 06) ─────────────────────────

/** Snapshot customer → RendererParty (address composed like the draft path). */
function customerPartyFromSnapshot(customer: CustomerSnapshot): RendererParty {
  return {
    name: customer.companyName,
    address: [
      customer.address,
      [customer.city, customer.province, customer.postalCode].filter(Boolean).join(", "),
      customer.country,
    ]
      .filter(Boolean)
      .join(" · "),
    phone: customer.phone,
    email: customer.email,
    taxId: customer.taxId,
  };
}

/**
 * The ISSUED document: seven immutable snapshots → renderer data. Nothing
 * reads the live profile/customer/bank here — that is what makes "edit
 * profil setelah terbit, PDF resmi lama tidak berubah" structural.
 */
export function rendererDataFromIssued(source: IssuedPrintSource): InvoiceRendererData {
  const { calculation, template } = source;
  return {
    number: source.number,
    numberPreview: source.number,
    status: "ISSUED",
    invoiceType: calculation.invoiceType,
    invoiceDate: source.invoiceDate,
    dueDate: source.dueDate,
    referenceType: source.referenceType,
    referenceNumber: source.referenceNumber,
    referenceDate: source.referenceDate,
    paymentTerms: source.paymentTerms,
    billingMode: calculation.billingMode,
    billingPercent: calculation.billingPercent,
    termName: source.termName,
    termNumber: source.termNumber,
    customLabel: source.customLabel,
    issuer: {
      name: source.issuer.name,
      legalName: source.issuer.legalName,
      logoPath: source.issuer.logoPath,
      primaryColor: source.issuer.primaryColor,
      address: source.issuer.address,
      phone: source.issuer.phone,
      whatsapp: source.issuer.whatsapp,
      fax: source.issuer.fax,
      email: source.issuer.email,
      website: source.issuer.website,
      taxId: source.issuer.taxId,
    },
    customer: source.customer ? customerPartyFromSnapshot(source.customer) : null,
    contactName: source.contact?.name ?? null,
    contactTitle: source.contact?.title ?? null,
    contactDivision: source.contact?.division ?? null,
    projectTitle: source.projectTitle,
    items: calculation.items.map((item) => ({
      position: item.position,
      description: item.description,
      details: item.details,
      quantity: item.quantity,
      unit: item.unit,
      unitPrice: item.unitPrice,
      discountAmount: item.discountAmount,
      lineAmount: item.lineAmount,
    })),
    calc: calculation.calc,
    taxIncludedInTotal: calculation.calc.taxIncludedInTotal,
    bank: source.bank
      ? {
          bankName: source.bank.bankName,
          accountHolder: source.bank.accountHolder,
          maskedNumber: source.bank.maskedNumber,
          branch: source.bank.branch,
        }
      : null,
    signer: source.signer
      ? {
          name: source.signer.name,
          title: source.signer.title,
          location: source.signer.location,
          signaturePath: source.signer.signaturePath,
        }
      : null,
    stampMode: template.stampMode,
    settings: parseProfileSettings(source.settings),
    notes: source.notes,
    footerText: source.footerText,
    primaryColor: template.primaryColor,
    currency: source.currency,
  };
}
