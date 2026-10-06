"use client";

// src/components/invoice/invoice-preview.tsx
// The sample-invoice preview used by onboarding (steps 4 and 11) and the
// /profiles/[id] edit page. This is NOT the full renderer (feature 06): it
// shows the saved profile data filled into a realistic invoice skeleton so
// accent color, logo, numbering, bank, stamp preference and signer are all
// visible before anything is issued. Always light (`.invoice-preview`).

import * as React from "react";
import { validateNumberPattern, previewNumber } from "@/modules/profiles/number-pattern";
import { useToday } from "@/lib/use-today";
import type { BankAccountView } from "@/modules/bank-accounts/service";
import type { SignerView } from "@/modules/signers/service";
import type { ProfileView } from "@/modules/profiles/service";
import { STAMP_MODE_LABELS, TAX_MODE_LABELS } from "@/components/profiles/labels";

export interface InvoicePreviewData {
  name: string | null;
  legalName: string | null;
  logoPath: string | null;
  address: string | null;
  phone: string | null;
  whatsapp: string | null;
  email: string | null;
  website: string | null;
  taxId: string | null;
  primaryColor: string;
  code: string;
  numberPattern: string;
  defaultTaxMode: ProfileView["defaultTaxMode"];
  defaultTaxPercent: number | null;
  defaultStampMode: ProfileView["defaultStampMode"];
  defaultNotes: string | null;
}

export function previewDataFromProfile(profile: ProfileView): InvoicePreviewData {
  return {
    name: profile.name,
    legalName: profile.legalName,
    logoPath: profile.logoPath,
    address: profile.address,
    phone: profile.phone,
    whatsapp: profile.whatsapp,
    email: profile.email,
    website: profile.website,
    taxId: profile.taxId,
    primaryColor: profile.primaryColor,
    code: profile.code,
    numberPattern: profile.numberPattern,
    defaultTaxMode: profile.defaultTaxMode,
    defaultTaxPercent: profile.defaultTaxPercent,
    defaultStampMode: profile.defaultStampMode,
    defaultNotes: profile.defaultNotes,
  };
}

const DEFAULT_DATA: InvoicePreviewData = {
  name: "Perusahaan Anda",
  legalName: null,
  logoPath: null,
  address: null,
  phone: null,
  whatsapp: null,
  email: null,
  website: null,
  taxId: null,
  primaryColor: "#2563eb",
  code: "INV",
  numberPattern: "INV/{CODE}/{ROMAN_MONTH}/{YYYY}/{SEQ:3}",
  defaultTaxMode: "EXCLUSIVE",
  defaultTaxPercent: 11,
  defaultStampMode: "NONE",
  defaultNotes: null,
};

const DUMMY_CUSTOMER = {
  name: "PT Contoh Pembeli Nusantara",
  address: "Jl. Contoh Raya No. 123, Jakarta Selatan 12940",
};

const DUMMY_ITEM = { description: "Jasa konsultasi (contoh)", qty: 1, price: 1_000_000 };

const idr = new Intl.NumberFormat("id-ID", {
  style: "currency",
  currency: "IDR",
  maximumFractionDigits: 0,
});

export interface InvoicePreviewProps {
  /** Partial data — anything missing falls back to the neutral defaults. */
  data?: Partial<InvoicePreviewData> | null;
  bank?: BankAccountView | null;
  signer?: SignerView | null;
  className?: string;
}

export function InvoicePreview({ data, bank, signer, className }: InvoicePreviewProps) {
  const preview: InvoicePreviewData = { ...DEFAULT_DATA, ...data };

  // "Today" only exists after mount — SSR/client dates can differ by
  // timezone, and a mismatch here would break hydration on every page
  // that embeds the preview.
  const today = useToday();

  const patternValid = validateNumberPattern(preview.numberPattern).ok;
  const invoiceNumber =
    today && patternValid
      ? previewNumber(preview.numberPattern, {
          code: preview.code || "INV",
          date: today,
          nextSequence: 1,
        })
      : "—";
  const dateLabel = today
    ? today.toLocaleDateString("id-ID", { day: "2-digit", month: "long", year: "numeric" })
    : "—";

  const sellerName = preview.legalName?.trim() || preview.name?.trim() || "Perusahaan Anda";
  const accent = preview.primaryColor;

  // Sample totals — real calculation is feature 04/06; here the shape matters.
  const subtotal = DUMMY_ITEM.qty * DUMMY_ITEM.price;
  const taxPercent = preview.defaultTaxMode === "NONE" ? 0 : preview.defaultTaxPercent ?? 0;
  let taxAmount = 0;
  let total = subtotal;
  if (preview.defaultTaxMode === "EXCLUSIVE") {
    taxAmount = Math.round((subtotal * taxPercent) / 100);
    total = subtotal + taxAmount;
  } else if (preview.defaultTaxMode === "INCLUSIVE") {
    taxAmount = Math.round(subtotal - subtotal / (1 + taxPercent / 100));
    total = subtotal;
  }

  const stampLabels: Record<ProfileView["defaultStampMode"], string> = STAMP_MODE_LABELS;

  return (
    <div
      className={`invoice-preview overflow-hidden rounded-xl border border-border bg-card text-foreground ${className ?? ""}`}
    >
      {/* Header band — the accent color the user picks in the wizard. */}
      <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4 text-white" style={{ backgroundColor: accent }}>
        <div className="flex items-center gap-3">
          <div>
            <p className="text-base font-semibold leading-tight">{sellerName}</p>
            <p className="text-xs opacity-90">Faktur Penjualan</p>
          </div>
        </div>
        <div className="text-right">
          <p className="text-sm font-semibold tracking-wide">INVOICE</p>
          <p className="text-xs tabular-nums opacity-90">{invoiceNumber}</p>
        </div>
      </div>

      <div className="flex flex-col gap-4 px-5 py-4">
        {/* Parties */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-1">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              Dari
            </p>
            {preview.logoPath ? (
              // eslint-disable-next-line @next/next/no-img-element -- auth-gated storage route; plain img avoids the optimizer's static-src assumption
              <img
                src={`/api/storage/${preview.logoPath}`}
                alt={`Logo ${sellerName}`}
                className="h-9 w-auto object-contain self-start"
              />
            ) : null}
            <p className="text-sm font-medium">{sellerName}</p>
            {preview.address ? (
              <p className="text-xs text-muted-foreground">{preview.address}</p>
            ) : null}
            <p className="text-xs text-muted-foreground">
              {[preview.phone, preview.email, preview.website].filter(Boolean).join(" · ") ||
                "—"}
            </p>
            {preview.taxId ? (
              <p className="text-xs text-muted-foreground">NPWP: {preview.taxId}</p>
            ) : null}
          </div>
          <div className="flex flex-col gap-1">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              Kepada
            </p>
            <p className="text-sm font-medium">{DUMMY_CUSTOMER.name}</p>
            <p className="text-xs text-muted-foreground">{DUMMY_CUSTOMER.address}</p>
            <p className="text-xs text-muted-foreground">Tanggal: {dateLabel}</p>
          </div>
        </div>

        {/* Line items */}
        <div className="overflow-hidden rounded-lg border border-border">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr style={{ backgroundColor: accent }} className="text-left text-xs text-white">
                <th className="px-3 py-2 font-medium">Uraian</th>
                <th className="px-3 py-2 text-right font-medium">Qty</th>
                <th className="px-3 py-2 text-right font-medium">Harga</th>
                <th className="px-3 py-2 text-right font-medium">Jumlah</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-t border-border">
                <td className="px-3 py-2">{DUMMY_ITEM.description}</td>
                <td className="px-3 py-2 text-right tabular-nums">{DUMMY_ITEM.qty}</td>
                <td className="px-3 py-2 text-right tabular-nums">{idr.format(DUMMY_ITEM.price)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{idr.format(subtotal)}</td>
              </tr>
            </tbody>
          </table>
        </div>

        {/* Totals + stamp + signer */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-2">
            {preview.defaultNotes ? (
              <div className="rounded-lg border border-dashed border-border p-3">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Catatan
                </p>
                <p className="whitespace-pre-wrap text-xs text-muted-foreground">
                  {preview.defaultNotes}
                </p>
              </div>
            ) : null}
            {bank ? (
              <div className="rounded-lg border border-border p-3 text-xs">
                <p className="font-medium">Pembayaran ke</p>
                <p className="text-muted-foreground">
                  {bank.bankName} a.n. {bank.accountHolder} —{" "}
                  <span className="tabular-nums">{bank.maskedNumber}</span>
                </p>
              </div>
            ) : null}
          </div>
          <div className="flex flex-col gap-2 text-sm">
            <div className="flex items-center justify-between gap-4">
              <span className="text-muted-foreground">Subtotal</span>
              <span className="tabular-nums">{idr.format(subtotal)}</span>
            </div>
            {preview.defaultTaxMode !== "NONE" ? (
              <div className="flex items-center justify-between gap-4">
                <span className="text-muted-foreground">
                  {TAX_MODE_LABELS[preview.defaultTaxMode]} {taxPercent}%
                  {preview.defaultTaxMode === "INCLUSIVE" ? " (termasuk)" : ""}
                </span>
                <span className="tabular-nums">{idr.format(taxAmount)}</span>
              </div>
            ) : null}
            <div
              className="flex items-center justify-between gap-4 rounded-lg px-3 py-2 font-semibold text-white"
              style={{ backgroundColor: accent }}
            >
              <span>Total</span>
              <span className="tabular-nums">{idr.format(total)}</span>
            </div>
          </div>
        </div>

        {/* Stamp placeholder — layout only, per the disclaimer in step 10. */}
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="flex flex-col gap-1 text-xs text-muted-foreground">
            {preview.defaultStampMode !== "NONE" ? (
              <div className="flex h-16 w-24 items-center justify-center rounded border border-dashed border-border text-center text-[10px] leading-tight">
                {preview.defaultStampMode === "BLANK_SPACE"
                  ? ""
                  : stampLabels[preview.defaultStampMode]}
              </div>
            ) : null}
            <p>
              {preview.defaultStampMode !== "NONE"
                ? "Placeholder — belum dibubuhi e-meterai resmi."
                : null}
            </p>
          </div>
          <div className="flex flex-col items-end text-xs">
            <p className="text-muted-foreground">Hormat kami,</p>
            <div className="flex h-14 w-40 items-end justify-center">
              {signer?.signaturePath ? (
                // eslint-disable-next-line @next/next/no-img-element -- auth-gated storage route; plain img avoids the optimizer's static-src assumption
                <img
                  src={`/api/storage/${signer.signaturePath}`}
                  alt={`Tanda tangan ${signer.name}`}
                  className="max-h-14 w-auto object-contain"
                />
              ) : null}
            </div>
            <p className="font-semibold">{signer?.name ?? "Penanda tangan"}</p>
            {signer?.title ? <p className="text-muted-foreground">{signer.title}</p> : null}
            {signer?.location ? <p className="text-muted-foreground">{signer.location}</p> : null}
          </div>
        </div>
      </div>
    </div>
  );
}
