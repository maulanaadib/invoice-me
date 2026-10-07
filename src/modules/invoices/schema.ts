// src/modules/invoices/schema.ts
// Zod source of truth for the invoice DRAFT editor (feature 04). Shared by the
// server actions (boundary re-validation on every autosave) and the React
// Hook Form client. Money and percent fields travel as STRINGS (decimal /
// percent regex) — a float never crosses the boundary (architecture invariant 1).
//
// Draft leniency: a draft may be incomplete (no customer yet, blank optional
// text). What is NEVER lenient: money shape, item rules (qty > 0,
// price >= 0, discount >= 0, max items) and the org scoping — an invalid
// value is rejected (VALIDATION_ERROR), not silently stored.

import { z } from "zod";
import { REFERENCE_TYPES } from "@/modules/projects/schema";

export const INVOICE_TYPES = ["FULL", "DOWN_PAYMENT", "SETTLEMENT", "TERM", "CUSTOM"] as const;
export type InvoiceTypeValue = (typeof INVOICE_TYPES)[number];

export const BILLING_MODES = ["PERCENT", "MANUAL"] as const;
export type BillingModeValue = (typeof BILLING_MODES)[number];

export const TAX_MODES = ["NONE", "EXCLUSIVE", "INCLUSIVE", "MANUAL"] as const;
export type TaxModeValue = (typeof TAX_MODES)[number];

export const STAMP_MODES = ["NONE", "E_METERAI", "PHYSICAL", "BLANK_SPACE"] as const;
export type StampModeValue = (typeof STAMP_MODES)[number];

/** Max line items per invoice (spec: default 50, configurable). Env override
 * would land here; there is none yet — raise the constant, not a magic number
 * scattered through the code (open question in progress-tracker). */
export const MAX_INVOICE_ITEMS = 50;

export const INVOICE_TYPE_LABELS: Record<InvoiceTypeValue, string> = {
  FULL: "Full — tagih penuh",
  DOWN_PAYMENT: "Down Payment (DP)",
  SETTLEMENT: "Pelunasan",
  TERM: "Termin",
  CUSTOM: "Custom",
};

export const INVOICE_TAX_MODE_LABELS: Record<TaxModeValue, string> = {
  NONE: "Tanpa pajak",
  EXCLUSIVE: "PPN ditambahkan (exclusive)",
  INCLUSIVE: "PPN termasuk di harga (inclusive)",
  MANUAL: "Pajak manual (nominal)",
};

export const BILLING_MODE_LABELS: Record<BillingModeValue, string> = {
  PERCENT: "Persentase",
  MANUAL: "Nominal manual",
};

/** Unsigned money text: up to 15 int digits + 2 decimals ("4500000.5"). */
const MONEY_RE = /^\d{1,15}(\.\d{1,2})?$/;
/** Signed money text (rounding adjustment may be negative). */
const SIGNED_MONEY_RE = /^-?\d{1,15}(\.\d{1,2})?$/;
/** Percent text: 0–100 with up to 2 decimals ("50", "12.5"). */
const PERCENT_RE = /^\d{1,3}(\.\d{1,2})?$/;

const moneyField = (label: string) =>
  z
    .string()
    .trim()
    .refine((v) => v === "" || MONEY_RE.test(v), `${label} harus angka (maks 2 desimal).`);

const percentField = (label: string) =>
  z
    .string()
    .trim()
    .refine((v) => v === "" || (PERCENT_RE.test(v) && Number(v) <= 100), `${label} harus 0–100.`);

/** "" / whitespace → null (clear); undefined → untouched is NOT used here:
 * the editor always submits the full draft object. */
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Maksimal ${max} karakter.`)
    .optional();

/** "" (not a date) or a strict calendar date. */
const calendarDate = z
  .string()
  .trim()
  .refine((v) => v === "" || /^\d{4}-\d{2}-\d{2}$/.test(v), "Format tanggal tidak valid.")
  .optional();

export const invoiceItemSchema = z.object({
  id: z.string().optional(),
  description: z.string().trim().max(500, "Maksimal 500 karakter."),
  details: z.string().trim().max(1000, "Maksimal 1.000 karakter.").optional(),
  quantity: z
    .string()
    .trim()
    .regex(MONEY_RE, "Jumlah harus angka.")
    .refine((v) => Number(v) > 0, "Jumlah harus lebih dari 0."),
  unit: z.string().trim().min(1, "Unit wajib diisi.").max(20, "Maksimal 20 karakter."),
  // Boundary normalization: an empty price field means "not priced yet" and
  // travels as "" — the new-item template row (and a cleared currency input)
  // must validate as 0 (spec: price >= 0), never as an error that kills the
  // first autosave with "Harga harus angka".
  unitPrice: z
    .string()
    .trim()
    .transform((value) => (value === "" ? "0" : value))
    .pipe(z.string().regex(MONEY_RE, "Harga harus angka, minimal 0.")),
  discountAmount: moneyField("Diskon item").optional(),
});
export type InvoiceItemValues = z.infer<typeof invoiceItemSchema>;

export const invoiceDraftFormSchema = z
  .object({
    profileId: z.string().min(1, "Profil invoice wajib dipilih."),
    invoiceType: z.enum(INVOICE_TYPES),
    customerId: z.string().min(1, "Customer wajib dipilih."),
    customerContactId: optionalText(60),
    projectReferenceId: optionalText(60),

    // Jenis penagihan
    billingMode: z.enum(BILLING_MODES).default("PERCENT"),
    billingPercent: percentField("Persentase tagihan"),
    billingAmount: moneyField("Nominal tagihan"),
    termName: optionalText(60),
    termNumber: z
      .string()
      .trim()
      .regex(/^\d{1,2}$/, "Nomor termin harus angka 1–99.")
      .optional()
      .or(z.literal("")),
    customLabel: optionalText(60),
    customReason: optionalText(500),

    // Nilai pekerjaan override (toggle + alasan — open question tracker)
    workValueOverride: z.boolean().default(false),
    workValueOverrideAmount: moneyField("Nilai pekerjaan"),
    workValueReason: optionalText(500),

    // Informasi invoice
    invoiceDate: calendarDate,
    dueDate: calendarDate,
    referenceType: z.enum(REFERENCE_TYPES).optional().or(z.literal("")),
    referenceNumber: optionalText(60),
    referenceDate: calendarDate,
    paymentTerms: optionalText(120),

    items: z
      .array(invoiceItemSchema)
      .max(MAX_INVOICE_ITEMS, `Maksimal ${MAX_INVOICE_ITEMS} item pekerjaan.`),

    // Pajak dan ringkasan
    discountAmount: moneyField("Diskon invoice").optional(),
    additionalAmount: moneyField("Biaya tambahan").optional(),
    taxMode: z.enum(TAX_MODES).default("NONE"),
    taxPercent: percentField("Persentase pajak"),
    taxAmountInput: moneyField("Nominal pajak"),
    roundingAmount: z
      .string()
      .trim()
      .refine((v) => v === "" || SIGNED_MONEY_RE.test(v), "Pembulatan harus angka."),

    // Pembayaran / meterai / tanda tangan / catatan
    bankAccountId: optionalText(60),
    stampMode: z.enum(STAMP_MODES).default("NONE"),
    signerId: optionalText(60),
    notes: optionalText(2000),
    footerText: optionalText(500),
  })
  .superRefine((value, ctx) => {
    if (value.dueDate && value.invoiceDate && value.dueDate < value.invoiceDate) {
      ctx.addIssue({
        code: "custom",
        path: ["dueDate"],
        message: "Jatuh tempo tidak boleh sebelum tanggal invoice.",
      });
    }
    const needsPercent =
      (value.invoiceType === "DOWN_PAYMENT" || value.invoiceType === "TERM") &&
      value.billingMode === "PERCENT";
    if (needsPercent && value.billingPercent !== "" && Number(value.billingPercent) <= 0) {
      ctx.addIssue({ code: "custom", path: ["billingPercent"], message: "Persentase harus lebih dari 0." });
    }
    if (value.invoiceType === "CUSTOM" && value.billingAmount !== "" && Number(value.billingAmount) <= 0) {
      ctx.addIssue({ code: "custom", path: ["billingAmount"], message: "Nominal tagihan harus lebih dari 0." });
    }
    if (value.taxMode === "EXCLUSIVE" || value.taxMode === "INCLUSIVE") {
      if (value.taxPercent !== "" && Number(value.taxPercent) <= 0) {
        ctx.addIssue({ code: "custom", path: ["taxPercent"], message: "Persentase pajak harus lebih dari 0." });
      }
    }
    if (value.taxMode === "MANUAL" && value.taxAmountInput !== "") {
      if (!MONEY_RE.test(value.taxAmountInput)) {
        ctx.addIssue({ code: "custom", path: ["taxAmountInput"], message: "Nominal pajak tidak valid." });
      }
    }
  });
export type InvoiceDraftFormValues = z.input<typeof invoiceDraftFormSchema>;
export type InvoiceDraftFormOutput = z.output<typeof invoiceDraftFormSchema>;

/** Row is worth persisting only when the user filled it in (autosave fires on
 * every keystroke — blank template rows are skipped, never rejected). */
export function isItemWorthSaving(item: InvoiceItemValues): boolean {
  return item.description.trim() !== "" || item.quantity.trim() !== "" || item.unitPrice.trim() !== "";
}
