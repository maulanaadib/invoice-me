// src/components/profiles/labels.ts
// Indonesian display labels for profile enums — shared by the onboarding
// wizard and /profiles/[id] so both surfaces say the same thing.

import type { ProfileView } from "@/modules/profiles/service";

export const TAX_MODE_LABELS: Record<ProfileView["defaultTaxMode"], string> = {
  NONE: "Tanpa pajak",
  INCLUSIVE: "PPN termasuk di harga (inclusive)",
  EXCLUSIVE: "PPN ditambahkan (exclusive)",
  MANUAL: "Pajak manual (nominal)",
};

export const STAMP_MODE_LABELS: Record<ProfileView["defaultStampMode"], string> = {
  NONE: "Tanpa meterai",
  E_METERAI: "E-meterai (placeholder)",
  PHYSICAL: "Materai fisik",
  BLANK_SPACE: "Sediakan ruang kosong",
};

export const RESET_POLICY_LABELS: Record<ProfileView["sequenceResetPolicy"], string> = {
  MONTHLY: "Reset tiap bulan",
  YEARLY: "Reset tiap tahun",
  NEVER: "Tidak pernah (nomor berkelanjutan)",
};

/** Spec: disclaimer wajib tampil di langkah meterai. */
export const STAMP_DISCLAIMER =
  "Aplikasi hanya mengatur layout placeholder, belum melakukan pembubuhan e-meterai resmi.";
