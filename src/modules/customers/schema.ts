// src/modules/customers/schema.ts
// Zod source of truth for customer + PIC input. Imported by BOTH the server
// actions (boundary validation — the client is never trusted) and the React
// Hook Form forms (instant field feedback). Pure Zod only: no db, no server
// imports, and NO transforms, so input and output types stay identical across
// the RSC boundary. Empty strings become null in the service layer.

import { z } from "zod";

/** Optional text: present-but-empty is allowed, trimmed, length-capped. */
export const optionalText = (max: number) =>
  z.string().trim().max(max, `Maksimal ${max} karakter.`).optional();

/**
 * Email stays optional: "" (untouched form field) passes, anything non-empty
 * must look like an address.
 */
const emailField = z
  .string()
  .trim()
  .max(120, "Maksimal 120 karakter.")
  .refine(
    (value) => value === "" || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value),
    "Format email tidak valid.",
  )
  .optional();

export const customerFormSchema = z.object({
  companyName: z
    .string()
    .trim()
    .min(2, "Nama perusahaan wajib diisi.")
    .max(120, "Maksimal 120 karakter."),
  legalName: optionalText(120),
  businessType: optionalText(80),
  // NPWP (PII): digits/spaces/dots/dashes only, never logged (service rule).
  taxId: z
    .string()
    .trim()
    .max(30, "Maksimal 30 karakter.")
    .regex(/^[\d\s.\-]*$/, "NPWP hanya boleh berisi angka, titik, tanda minus, dan spasi.")
    .optional(),
  address: optionalText(500),
  city: optionalText(80),
  province: optionalText(80),
  postalCode: z
    .string()
    .trim()
    .max(10, "Maksimal 10 karakter.")
    .regex(/^\d*$/, "Kode pos hanya boleh berisi angka.")
    .optional(),
  country: optionalText(80),
  phone: optionalText(30),
  whatsapp: optionalText(30),
  email: emailField,
  notes: optionalText(1000),
  isActive: z.boolean().optional(),
});
export type CustomerFormValues = z.infer<typeof customerFormSchema>;

export const contactFormSchema = z.object({
  name: z
    .string()
    .trim()
    .min(2, "Nama PIC wajib diisi.")
    .max(80, "Maksimal 80 karakter."),
  title: optionalText(80),
  division: optionalText(80),
  email: emailField,
  phone: optionalText(30),
  whatsapp: optionalText(30),
  isPrimary: z.boolean().optional(),
});
export type ContactFormValues = z.infer<typeof contactFormSchema>;
