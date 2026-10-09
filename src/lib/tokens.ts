// src/lib/tokens.ts
// Notes token resolver (feature 10, master prompt bagian 14). Default notes on
// an invoice profile (and on an invoice) may carry placeholders that resolve
// when the document renders — editor preview AND print/PDF, from the same
// values, so preview === print stays true.
//
// Rules (spec 10 + ratified decisions in context/.sdd-state.md):
//   • known token, value present      → formatted id-ID value ("Rp4.500.000")
//   • known token, value absent       → EMPTY STRING (a sent document never
//                                       prints a literal {…} for a known token)
//   • unknown token ({FOOBAR})        → left literal, collected in
//                                       `unknownTokens` so the preview can warn
//
// Pure and dependency-light (money formatting only) so it runs on both sides
// of the RSC boundary — the live client preview and the server print route
// resolve identically.

import { groupDigits } from "@/lib/money";

/** The complete grammar — nothing else resolves (spec lists exactly these). */
export const NOTES_TOKENS = [
  "INVOICE_NUMBER",
  "REFERENCE_NUMBER",
  "CUSTOMER_NAME",
  "WORK_VALUE",
  "BILLING_PERCENT",
  "GRAND_TOTAL",
] as const;

export type NotesToken = (typeof NOTES_TOKENS)[number];

export interface NotesTokenValues {
  /** Final number, or the draft preview number. */
  invoiceNumber?: string | null;
  referenceNumber?: string | null;
  customerName?: string | null;
  /** Decimal strings (money/percent travel as strings — no float). */
  workValue?: string | null;
  billingPercent?: string | null;
  grandTotal?: string | null;
}

export interface ResolvedNotes {
  text: string;
  /** Unknown placeholders (e.g. FOOBAR) left literal — preview warns about them. */
  unknownTokens: string[];
}

/**
 * "4500000" | "4500000.00" | "4500000.50" → "Rp4.500.000" | "Rp4.500.000" |
 * "Rp4.500.000,50". No space after Rp (spec examples: `Rp4.500.000`);
 * zero decimals are noise and are dropped, per id-ID display habit.
 */
export function formatRupiahToken(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";
  const [integer = "0", decimals] = trimmed.split(".");
  const keepDecimals = Boolean(decimals) && !/^0+$/.test(decimals);
  return `Rp${groupDigits(keepDecimals ? `${integer}.${decimals}` : integer)}`;
}

/**
 * "50.00" → "50%", "50.5" → "50,5%". Same ".00 tail is noise" rule the
 * renderer uses for the percent row, then id-ID grouping.
 */
export function formatPercentToken(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";
  return `${groupDigits(trimmed.replace(/\.00$/, ""))}%`;
}

const TOKEN_PATTERN = /\{([A-Za-z0-9_]+)\}/g;

function valueOf(raw: string | null | undefined): string | null {
  const trimmed = raw?.trim();
  return trimmed ? trimmed : null;
}

/**
 * Replaces every known placeholder in `template`; a known token whose value is
 * missing becomes "" (ratified), an unknown one stays literal and is reported.
 * Non-token text passes through untouched.
 */
export function resolveNotesTokens(
  template: string | null | undefined,
  values: NotesTokenValues,
): ResolvedNotes {
  if (!template) return { text: "", unknownTokens: [] };

  const unknown = new Set<string>();
  const text = template.replace(TOKEN_PATTERN, (raw, name: string) => {
    switch (name) {
      case "INVOICE_NUMBER":
        return valueOf(values.invoiceNumber) ?? "";
      case "REFERENCE_NUMBER":
        return valueOf(values.referenceNumber) ?? "";
      case "CUSTOMER_NAME":
        return valueOf(values.customerName) ?? "";
      case "WORK_VALUE": {
        const value = valueOf(values.workValue);
        return value ? formatRupiahToken(value) : "";
      }
      case "BILLING_PERCENT": {
        const value = valueOf(values.billingPercent);
        return value ? formatPercentToken(value) : "";
      }
      case "GRAND_TOTAL": {
        const value = valueOf(values.grandTotal);
        return value ? formatRupiahToken(value) : "";
      }
      default:
        // Unknown token: never silently rewritten (spec Check When Done).
        unknown.add(name);
        return raw;
    }
  });

  return { text, unknownTokens: [...unknown] };
}
