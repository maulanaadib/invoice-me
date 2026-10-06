// src/modules/projects/schema.ts
// Zod source of truth for ProjectReference input (PO / SPK / contract /
// quotation). Shared by server actions (boundary validation) and the React
// Hook Form form. Pure Zod only — calendar dates stay "YYYY-MM-DD" strings
// here and are converted to UTC-midnight Date values in the service layer.

import { z } from "zod";

export const REFERENCE_TYPES = [
  "PURCHASE_ORDER",
  "SPK",
  "CONTRACT",
  "QUOTATION",
  "OTHER",
  "NONE",
] as const;
export type ReferenceTypeValue = (typeof REFERENCE_TYPES)[number];

export const PROJECT_STATUSES = ["ACTIVE", "COMPLETED", "ON_HOLD", "CANCELLED"] as const;
export type ProjectStatusValue = (typeof PROJECT_STATUSES)[number];

export const REFERENCE_TYPE_LABELS: Record<ReferenceTypeValue, string> = {
  PURCHASE_ORDER: "Purchase Order (PO)",
  SPK: "Surat Perintah Kerja (SPK)",
  CONTRACT: "Kontrak",
  QUOTATION: "Penawaran / Quotation",
  OTHER: "Lainnya",
  NONE: "Tanpa referensi",
};

export const PROJECT_STATUS_LABELS: Record<ProjectStatusValue, string> = {
  ACTIVE: "Aktif",
  COMPLETED: "Selesai",
  ON_HOLD: "Ditunda",
  CANCELLED: "Dibatalkan",
};

const optionalText = (max: number) =>
  z.string().trim().max(max, `Maksimal ${max} karakter.`).optional();

/** "" (untouched date input) or a strict calendar date. */
const calendarDate = z
  .string()
  .trim()
  .refine(
    (value) => value === "" || /^\d{4}-\d{2}-\d{2}$/.test(value),
    "Format tanggal tidak valid.",
  )
  .optional();

export const projectFormSchema = z
  .object({
    customerId: z.string().min(1, "Customer wajib dipilih."),
    referenceType: z.enum(REFERENCE_TYPES),
    referenceNumber: z
      .string()
      .trim()
      .min(1, "Nomor referensi wajib diisi.")
      .max(60, "Maksimal 60 karakter."),
    referenceDate: calendarDate,
    title: z
      .string()
      .trim()
      .min(2, "Judul project wajib diisi.")
      .max(120, "Maksimal 120 karakter."),
    description: optionalText(2000),
    // Decimal string straight from the input — never a parsed float.
    workValue: z
      .string()
      .trim()
      .regex(/^\d{1,15}(\.\d{1,2})?$/, "Nilai pekerjaan harus angka, mis. 450000000 (maks 2 desimal)."),
    currency: z.enum(["IDR"]),
    startDate: calendarDate,
    endDate: calendarDate,
    status: z.enum(PROJECT_STATUSES).optional(),
    notes: optionalText(2000),
  })
  .superRefine((value, ctx) => {
    if (value.startDate && value.endDate && value.startDate > value.endDate) {
      ctx.addIssue({
        code: "custom",
        path: ["endDate"],
        message: "Tanggal selesai tidak boleh sebelum tanggal mulai.",
      });
    }
  });
export type ProjectFormValues = z.infer<typeof projectFormSchema>;
