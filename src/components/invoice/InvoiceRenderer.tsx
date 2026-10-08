// src/components/invoice/InvoiceRenderer.tsx
// The ONE invoice document component — live editor preview now, and the
// print/PDF route in feature 06 renders THE SAME component from the issued
// snapshot, so "what you preview is what gets printed" is structural, not a
// promise (spec: satu source komponen render).
//
// Layout: Corporate Blue, A4 portrait, always light palette (.invoice-preview
// forces light tokens; accent = profile primaryColor via inline style, per
// ui-context). Header left-right, bill-to block, item table, summary with
// breakdown for DP/TERM/SETTLEMENT, footer with bank/stamp/signer.
//
// Pure presentational: receives `InvoiceRendererData` (decimal strings),
// renders nothing but markup — no fetch, no store, no 'use client' state.

import * as React from "react";
import { groupDigits } from "@/lib/money";
import { terbilang } from "@/lib/terbilang";
import type { InvoiceRendererData } from "@/components/invoice/renderer-data";

/** Decimal string → "Rp 4.500.000" (cents shown only when present). */
export function fmtMoney(value: string | null | undefined): string {
  if (!value) return "Rp 0";
  const [int, dec] = value.split(".");
  const cents = dec ? dec.replace(/0+$/, "") : "";
  return `Rp ${groupDigits(int ?? "0")}${cents ? `,${dec}` : ""}`;
}

function formatDate(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("id-ID", { day: "2-digit", month: "long", year: "numeric" });
}

/** Kind badge: DOWN PAYMENT 50% / TERMIN 2 — 40% / PELUNASAN / custom label. */
export function invoiceKindBadge(data: InvoiceRendererData): string | null {
  switch (data.invoiceType) {
    case "DOWN_PAYMENT":
      return data.billingMode === "PERCENT" && data.billingPercent
        ? `DOWN PAYMENT ${groupDigits(data.billingPercent.replace(/\.00$/, ""))}%`
        : "DOWN PAYMENT";
    case "TERM": {
      const label = data.termName ? `TERMIN ${data.termName}` : data.termNumber ? `TERMIN ${data.termNumber}` : "TERMIN";
      const pct = data.billingMode === "PERCENT" && data.billingPercent ? ` — ${groupDigits(data.billingPercent.replace(/\.00$/, ""))}%` : "";
      return `${label}${pct}`;
    }
    case "SETTLEMENT":
      return "PELUNASAN";
    case "CUSTOM":
      return data.customLabel?.toUpperCase() ?? "CUSTOM";
    case "FULL":
      return null;
  }
}

export interface InvoiceRendererProps {
  data: InvoiceRendererData;
  className?: string;
}

export function InvoiceRenderer({ data, className }: InvoiceRendererProps) {
  const accent = data.primaryColor || "#2563eb";
  const badge = invoiceKindBadge(data);
  const number = data.number ?? data.numberPreview;
  const calc = data.calc;
  const isSettlement = data.invoiceType === "SETTLEMENT";
  const isPartial = data.invoiceType === "DOWN_PAYMENT" || data.invoiceType === "TERM";
  const taxLabel =
    data.calc.taxMode === "INCLUSIVE" || data.calc.taxMode === "EXCLUSIVE"
      ? `PPN ${groupDigits(calc.taxPercent.replace(/\.00$/, ""))}%`
      : "Pajak";
  const contactPerson = data.contactName ?? data.customer?.name ?? "—";
  const contactRole = data.contactDivision ?? data.contactTitle ?? null;
  // Document settings (InvoiceProfile.settings): zero-value summary rows are
  // hidden by default; `hideZeroRows: false` opts into showing them.
  const hideZero = data.settings?.hideZeroRows !== false;
  const showValue = (value: string) => !hideZero || value !== "0.00";
  // Signature block header: "Yogyakarta, 1 Juli 2026" (location when set).
  const signatureDateLine = [data.signer?.location ?? null, formatDate(data.invoiceDate)]
    .filter(Boolean)
    .join(", ");
  const issuerContact = [data.issuer.phone, data.issuer.whatsapp, data.issuer.fax]
    .filter(Boolean)
    .join(" · ");

  return (
    <article
      className={`invoice-preview font-sans text-foreground ${className ?? ""}`}
      style={{ width: "100%", maxWidth: 794 /* A4 @96dpi */, background: "white" }}
      aria-label="Pratinjau invoice"
    >
      {/* ── Header: issuer left, INVOICE + number right (Corporate Blue) ── */}
      <header className="flex items-start justify-between gap-6 px-10 pt-10 pb-6" style={{ borderBottom: `3px solid ${accent}` }}>
        <div className="flex min-w-0 flex-col gap-1">
          {data.issuer.logoPath ? (
            // eslint-disable-next-line @next/next/no-img-element -- auth-gated storage route; plain img avoids the optimizer's static-src assumption (same as feature 02 preview)
            <img
              src={`/api/storage/${data.issuer.logoPath}`}
              alt={`Logo ${data.issuer.name ?? ""}`}
              className="mb-1 h-12 w-auto max-w-44 object-contain object-left"
            />
          ) : null}
          <p className="text-lg leading-tight font-bold">{data.issuer.legalName || data.issuer.name || "—"}</p>
          {data.issuer.address ? <p className="max-w-64 text-[11px] leading-snug text-muted-foreground">{data.issuer.address}</p> : null}
          {issuerContact ? <p className="text-[11px] text-muted-foreground">{issuerContact}</p> : null}
          {data.issuer.email ? <p className="text-[11px] text-muted-foreground">{data.issuer.email}</p> : null}
          {data.issuer.taxId ? <p className="text-[11px] text-muted-foreground">NPWP: {data.issuer.taxId}</p> : null}
        </div>
        <div className="flex flex-col items-end gap-1 text-right">
          <p className="text-2xl font-extrabold tracking-widest" style={{ color: accent }}>
            INVOICE
          </p>
          <p className="font-mono text-sm font-semibold">{number ?? "—"}</p>
          {data.status === "DRAFT" ? (
            <p className="rounded-md border border-dashed px-2 py-0.5 text-[10px] font-semibold tracking-wide text-muted-foreground" style={{ borderColor: accent }}>
              DRAFT — BELUM DITERBITKAN
            </p>
          ) : null}
          {badge ? (
            <p
              data-testid="invoice-kind-badge"
              className="rounded-md px-2 py-1 text-[11px] font-bold tracking-wide text-white"
              style={{ backgroundColor: accent }}
            >
              {badge}
            </p>
          ) : null}
        </div>
      </header>

      <div className="flex flex-col gap-5 px-10 py-6">
        {/* ── Bill-to + meta ── */}
        <section className="grid grid-cols-2 gap-6">
          <div className="flex flex-col gap-0.5">
            <p className="text-[10px] font-bold tracking-widest uppercase" style={{ color: accent }}>
              Kepada
            </p>
            <p className="text-sm font-bold">{data.customer?.name ?? "—"}</p>
            <p className="text-[11px] text-muted-foreground">
              Atas perhatian:{" "}
              <span className="font-medium text-foreground">
                {[contactPerson, contactRole].filter(Boolean).join(" — ")}
              </span>
            </p>
            {data.customer?.address ? (
              <p className="text-[11px] leading-snug text-muted-foreground">{data.customer.address}</p>
            ) : null}
            {data.customer && (data.customer.phone || data.customer.email) ? (
              <p className="text-[11px] text-muted-foreground">
                {[data.customer.phone, data.customer.email].filter(Boolean).join(" · ")}
              </p>
            ) : null}
            {data.customer?.taxId ? <p className="text-[11px] text-muted-foreground">NPWP: {data.customer.taxId}</p> : null}
          </div>
          <dl className="flex flex-col gap-0.5 text-[11px]">
            <div className="flex justify-end gap-3">
              <dt className="text-muted-foreground">Tanggal invoice</dt>
              <dd className="min-w-32 text-right font-medium">{formatDate(data.invoiceDate)}</dd>
            </div>
            {data.dueDate ? (
              <div className="flex justify-end gap-3">
                <dt className="text-muted-foreground">Jatuh tempo</dt>
                <dd className="min-w-32 text-right font-medium">{formatDate(data.dueDate)}</dd>
              </div>
            ) : null}
            {data.referenceNumber ? (
              <div className="flex justify-end gap-3">
                <dt className="text-muted-foreground">
                  {data.referenceType === "PURCHASE_ORDER" ? "No. PO" : "Referensi"}
                </dt>
                <dd className="min-w-32 text-right font-medium">{data.referenceNumber}</dd>
              </div>
            ) : null}
            {data.referenceDate ? (
              <div className="flex justify-end gap-3">
                <dt className="text-muted-foreground">
                  {data.referenceType === "PURCHASE_ORDER" ? "Tanggal PO" : "Tanggal referensi"}
                </dt>
                <dd className="min-w-32 text-right font-medium">{formatDate(data.referenceDate)}</dd>
              </div>
            ) : null}
            {data.projectTitle ? (
              <div className="flex justify-end gap-3">
                <dt className="text-muted-foreground">Project</dt>
                <dd className="min-w-32 max-w-48 truncate text-right font-medium">{data.projectTitle}</dd>
              </div>
            ) : null}
            {data.paymentTerms ? (
              <div className="flex justify-end gap-3">
                <dt className="text-muted-foreground">Termin pembayaran</dt>
                <dd className="min-w-32 max-w-48 text-right font-medium">{data.paymentTerms}</dd>
              </div>
            ) : null}
          </dl>
        </section>

        {/* ── Item table ── */}
        <table className="w-full border-collapse text-[11px]">
          <thead>
            <tr style={{ backgroundColor: accent, color: "white" }}>
              <th className="w-8 px-2 py-2 text-left font-semibold">No</th>
              <th className="px-2 py-2 text-left font-semibold">Deskripsi</th>
              <th className="w-14 px-2 py-2 text-right font-semibold">Qty</th>
              <th className="w-14 px-2 py-2 text-left font-semibold">Unit</th>
              <th className="w-28 px-2 py-2 text-right font-semibold">Harga Satuan</th>
              <th className="w-28 px-2 py-2 text-right font-semibold">Jumlah</th>
            </tr>
          </thead>
          <tbody>
            {data.items.length === 0 ? (
              <tr className="border-b">
                <td colSpan={6} className="px-2 py-4 text-center text-muted-foreground" style={{ borderColor: "var(--border)" }}>
                  Belum ada item pekerjaan.
                </td>
              </tr>
            ) : (
              data.items.map((item) => (
                <tr key={item.position} className="border-b align-top" style={{ borderColor: "var(--border)" }}>
                  <td className="px-2 py-2 text-center tabular-nums">{item.position}</td>
                  <td className="px-2 py-2">
                    <p className="font-medium break-words">{item.description}</p>
                    {item.details ? <p className="mt-0.5 text-[10px] break-words text-muted-foreground">{item.details}</p> : null}
                  </td>
                  <td className="px-2 py-2 text-right font-mono tabular-nums">{groupDigits(item.quantity)}</td>
                  <td className="px-2 py-2">{item.unit}</td>
                  <td className="px-2 py-2 text-right font-mono tabular-nums">{groupDigits(item.unitPrice)}</td>
                  <td className="px-2 py-2 text-right font-mono tabular-nums">{groupDigits(item.lineAmount)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>

        {/* ── Summary ── */}
        <section className="flex justify-end avoid-break">
          <dl className="w-80 text-[11px]">
            {(isPartial || isSettlement) && (
              <>
                <Row label="Nilai pekerjaan" value={fmtMoney(calc.workValue)} />
                {isSettlement ? (
                  <>
                    <Row label="Sudah ditagihkan" value={`− ${fmtMoney(calc.previouslyBilled)}`} />
                    <Row label="Sisa / pelunasan" value={fmtMoney(calc.billingBase)} />
                  </>
                ) : (
                  <Row
                    label={data.invoiceType === "TERM" ? "Persentase termin" : "Persentase DP"}
                    value={
                      data.billingMode === "PERCENT" && data.billingPercent
                        ? `${groupDigits(data.billingPercent.replace(/\.00$/, ""))}%`
                        : "Nominal manual"
                    }
                  />
                )}
                <Divider />
                <Row label="Total ditagihkan sekarang" value={fmtMoney(calc.billingBase)} bold accent={accent} />
                {showValue(calc.remainingAfter) ? (
                  <Row label="Sisa tagihan" value={fmtMoney(calc.remainingAfter)} />
                ) : null}
              </>
            )}
            {!isPartial && !isSettlement && <Row label="Subtotal item" value={fmtMoney(calc.itemsSubtotal)} />}
            {showValue(calc.discountAmount) && <Row label="Diskon" value={`− ${fmtMoney(calc.discountAmount)}`} />}
            {showValue(calc.additionalAmount) && <Row label="Biaya tambahan" value={fmtMoney(calc.additionalAmount)} />}
            {calc.taxMode === "EXCLUSIVE" && showValue(calc.taxAmount) && (
              <Row label={taxLabel} value={fmtMoney(calc.taxAmount)} />
            )}
            {calc.taxMode === "INCLUSIVE" && showValue(calc.taxIncludedInTotal) && (
              <Row label={`${taxLabel} termasuk dalam total`} value={fmtMoney(data.taxIncludedInTotal)} />
            )}
            {calc.taxMode === "MANUAL" && showValue(calc.taxAmount) && (
              <Row label="Pajak (manual)" value={fmtMoney(calc.taxAmount)} />
            )}
            {showValue(calc.roundingAmount) && <Row label="Pembulatan" value={fmtMoney(calc.roundingAmount)} />}
            <Divider />
            <div className="mt-1 flex items-center justify-between gap-3 rounded-md px-3 py-2 text-white" style={{ backgroundColor: accent }}>
              <dt className="text-xs font-bold">TOTAL{data.currency === "IDR" ? " (IDR)" : ""}</dt>
              <dd className="font-mono text-sm font-bold tabular-nums">{fmtMoney(calc.grandTotal)}</dd>
            </div>
            <p className="mt-2 text-center text-[10px] text-muted-foreground italic">
              {terbilang(calc.grandTotal)}
            </p>
          </dl>
        </section>

        {/* ── Footer: notes + bank left, meterai + signature right ── */}
        <section className="grid grid-cols-2 items-start gap-6 pt-2 avoid-break">
          <div className="flex flex-col gap-3">
            {data.bank ? (
              <div className="rounded-lg border p-3 text-[11px]" style={{ borderColor: "var(--border)" }}>
                <p className="text-[10px] font-bold tracking-widest uppercase" style={{ color: accent }}>
                  Pembayaran
                </p>
                <p className="mt-1 font-medium">{data.bank.bankName} a.n. {data.bank.accountHolder}</p>
                <p className="font-mono tabular-nums">{data.bank.maskedNumber}</p>
                {data.bank.branch ? <p className="text-muted-foreground">{data.bank.branch}</p> : null}
              </div>
            ) : null}
            {data.notes ? (
              <div className="text-[11px]">
                <p className="text-[10px] font-bold tracking-widest uppercase text-muted-foreground">Catatan</p>
                <p className="mt-1 whitespace-pre-wrap text-muted-foreground">{data.notes}</p>
              </div>
            ) : null}
          </div>
          <div className="flex items-end justify-end gap-4">
            <StampSlot mode={data.stampMode} hideLabel={data.settings?.hideStampLabel === true} />
            <div className="flex flex-col items-end gap-1 text-[11px]">
              <p className="text-muted-foreground">{signatureDateLine}</p>
              <p className="text-muted-foreground">Hormat kami,</p>
              {data.signer?.signaturePath ? (
                // eslint-disable-next-line @next/next/no-img-element -- auth-gated storage route (feature 02 precedent)
                <img
                  src={`/api/storage/${data.signer.signaturePath}`}
                  alt={`Tanda tangan ${data.signer.name}`}
                  className="max-h-14 w-auto object-contain"
                />
              ) : (
                <div className="h-14" aria-hidden="true" />
              )}
              <p className="font-bold">{data.signer?.name ?? "（  ）"}</p>
              {data.signer?.title ? <p className="text-muted-foreground">{data.signer.title}</p> : null}
            </div>
          </div>
        </section>

        {data.footerText ? (
          <footer className="border-t pt-3 text-center text-[10px] text-muted-foreground" style={{ borderColor: "var(--border)" }}>
            {data.footerText}
          </footer>
        ) : null}
      </div>
    </article>
  );
}

/**
 * The meterai slot LEFT of the signature block (feature 06 spec):
 *   • E_METERAI — compact dashed slot, caption "Slot E-Meterai"; a layout
 *     placeholder only — NEVER a fake stamp image.
 *   • PHYSICAL  — soft guide box inside the signature area that prints with
 *     the document so the physical stamp lands in the right spot.
 *   • BLANK_SPACE — a neat reserved space, nothing drawn.
 *   • NONE — no slot at all; the signature block stays clean.
 * The caption is optional (`hideStampLabel` from InvoiceProfile.settings).
 */
function StampSlot({ mode, hideLabel }: { mode: string; hideLabel: boolean }) {
  const box =
    "flex h-16 w-28 flex-col items-center justify-center rounded text-center text-[9px] leading-tight text-muted-foreground";
  if (mode === "E_METERAI") {
    return (
      <div className={`${box} border border-dashed`} style={{ borderColor: "var(--border)" }} aria-label="Slot e-meterai">
        {hideLabel ? null : <span>Slot E-Meterai</span>}
      </div>
    );
  }
  if (mode === "PHYSICAL") {
    return (
      <div className={`${box} border`} style={{ borderColor: "var(--border)" }} aria-label="Area meterai fisik">
        {hideLabel ? null : <span>Meterai</span>}
      </div>
    );
  }
  if (mode === "BLANK_SPACE") {
    return <div className="h-16 w-28" aria-hidden="true" />;
  }
  return null;
}

function Row({ label, value, bold, accent }: { label: string; value: string; bold?: boolean; accent?: string }) {
  return (
    <div className="flex items-center justify-between gap-3 py-0.5">
      <dt className={bold ? "font-bold" : "text-muted-foreground"} style={bold && accent ? { color: accent } : undefined}>
        {label}
      </dt>
      <dd className={`font-mono tabular-nums ${bold ? "font-bold" : "font-medium"}`}>{value}</dd>
    </div>
  );
}

function Divider() {
  return <div aria-hidden="true" className="my-1 border-t" style={{ borderColor: "var(--border)" }} />;
}
