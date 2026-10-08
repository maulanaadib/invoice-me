// src/modules/payments/schema.ts
// Zod source of truth for recording a payment (feature 07). Shared by the
// server action (boundary re-validation) and the React Hook Form client.
// Money travels as a DECIMAL STRING — a float never crosses the boundary
// (architecture invariant 1).

import { z } from "zod";
import Decimal from "decimal.js";

export const PAYMENT_METHODS = ["BANK_TRANSFER", "CASH", "QRIS", "OTHER"] as const;
export type PaymentMethodValue = (typeof PAYMENT_METHODS)[number];

export const PAYMENT_METHOD_LABELS: Record<PaymentMethodValue, string> = {
  BANK_TRANSFER: "Transfer bank",
  CASH: "Tunai",
  QRIS: "QRIS",
  OTHER: "Lainnya",
};

export const PAYMENT_REFERENCE_MAX = 100;
export const PAYMENT_NOTES_MAX = 500;
export const OVERPAYMENT_REASON_MAX = 500;

/**
 * Page size of the /payments list. Lives HERE (a client-safe module), never
 * in the "use client" table component: importing a plain constant from a
 * client module into a server component returns a client REFERENCE, not the
 * value — which turns pageSize into NaN and crashes the query.
 */
export const PAYMENTS_PAGE_SIZE = 20;

/** Unsigned money text: up to 15 int digits + 2 decimals ("4500000", "1250.5"). */
const MONEY_RE = /^\d{1,15}(\.\d{1,2})?$/;
/** Strict calendar day — also rejects impossible dates like 2026-13-45. */
const CALENDAR_RE = /^\d{4}-\d{2}-\d{2}$/;

function isCalendarDay(value: string): boolean {
  if (!CALENDAR_RE.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) return false;
  return parsed.toISOString().slice(0, 10) === value;
}

export const recordPaymentSchema = z.object({
  invoiceId: z.string().min(1, "Invoice wajib dipilih."),
  paymentDate: z
    .string()
    .trim()
    .refine(isCalendarDay, "Tanggal pembayaran wajib diisi."),
  amount: z
    .string()
    .trim()
    .regex(MONEY_RE, "Nominal harus angka (maks 2 desimal).")
    .refine((value) => new Decimal(value || "0").gt(0), "Nominal harus lebih dari 0."),
  method: z.enum(PAYMENT_METHODS, { message: "Metode pembayaran wajib dipilih." }),
  referenceNumber: z
    .string()
    .trim()
    .max(PAYMENT_REFERENCE_MAX, `Nomor referensi maksimal ${PAYMENT_REFERENCE_MAX} karakter.`)
    .optional(),
  notes: z
    .string()
    .trim()
    .max(PAYMENT_NOTES_MAX, `Catatan maksimal ${PAYMENT_NOTES_MAX} karakter.`)
    .optional(),
  /** Overpayment: STAFF confirms (client + server), OWNER/ADMIN give a reason. */
  confirmOverpayment: z.boolean().optional(),
  overpaymentReason: z
    .string()
    .trim()
    .max(OVERPAYMENT_REASON_MAX, `Alasan maksimal ${OVERPAYMENT_REASON_MAX} karakter.`)
    .optional(),
});
export type RecordPaymentValues = z.infer<typeof recordPaymentSchema>;

/** The service's payload: the action takes invoiceId out of the boundary
 * object and passes it as its own (scope-checked) argument. */
export const recordPaymentPayloadSchema = recordPaymentSchema.omit({ invoiceId: true });
export type RecordPaymentPayload = z.infer<typeof recordPaymentPayloadSchema>;

/** The dialog form: the same fields minus what the service derives
 * (invoiceId travels separately, the overpayment affirmation is validated
 * against the selected invoice's remaining amount). */
export const paymentFormSchema = recordPaymentSchema.omit({
  invoiceId: true,
  confirmOverpayment: true,
  overpaymentReason: true,
});
export type PaymentFormValues = z.infer<typeof paymentFormSchema>;
