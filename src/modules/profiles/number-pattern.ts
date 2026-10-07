// src/modules/profiles/number-pattern.ts
// Number pattern token parser — the single source of truth for validating
// InvoiceProfile.numberPattern and rendering live previews. Pure module (no
// env/db), so both server actions and client preview components import it.
//
// Tokens: {CODE} {TYPE} {YYYY} {YY} {MM} {DD} {ROMAN_MONTH} {SEQ:n} — exactly
// one {SEQ:n} is required; unknown tokens are rejected with a message listing
// the valid ones (spec: "Pattern invalid ditolak dengan pesan jelas").

import { AppError } from "@/lib/errors";

export const NUMBER_PATTERN_TOKENS = [
  "{CODE}",
  "{TYPE}",
  "{YYYY}",
  "{YY}",
  "{MM}",
  "{DD}",
  "{ROMAN_MONTH}",
  "{SEQ:n}",
] as const;

export type PatternValidation = { ok: true } | { ok: false; message: string };

/** Fallback for {TYPE} when a pattern is rendered without an invoice context
 * (profile settings preview) — a valid InvoiceType value, never blank. */
export const DEFAULT_INVOICE_TYPE_TOKEN = "FULL";

export interface NumberPreviewContext {
  /** Short profile code, e.g. "SB". */
  code: string;
  /** Issue date the preview is rendered for. */
  date: Date;
  /** Sequence number to display (typically the next one to be issued). */
  nextSequence: number;
  /** Invoice type for {TYPE}, e.g. "DOWN_PAYMENT". Optional: previews that
   * are not tied to one invoice fall back to DEFAULT_INVOICE_TYPE_TOKEN. */
  invoiceType?: string | null;
}

const SIMPLE_TOKENS = new Set<string>([
  "{CODE}",
  "{TYPE}",
  "{YYYY}",
  "{YY}",
  "{MM}",
  "{DD}",
  "{ROMAN_MONTH}",
]);

const TOKEN_PATTERN = /\{[^{}]*\}/g;
const SEQ_PATTERN = /^\{SEQ:(\d+)\}$/;

function roman(num: number): string {
  if (num < 1 || num > 3999) {
    throw new AppError("VALIDATION_ERROR", "Angka romawi di luar jangkauan.");
  }
  const table: Array<[number, string]> = [
    [1000, "M"],
    [900, "CM"],
    [500, "D"],
    [400, "CD"],
    [100, "C"],
    [90, "XC"],
    [50, "L"],
    [40, "XL"],
    [10, "X"],
    [9, "IX"],
    [5, "V"],
    [4, "IV"],
    [1, "I"],
  ];
  let out = "";
  let rest = num;
  for (const [value, symbol] of table) {
    while (rest >= value) {
      out += symbol;
      rest -= value;
    }
  }
  return out;
}

export function validateNumberPattern(pattern: string): PatternValidation {
  const trimmed = pattern.trim();
  if (!trimmed) {
    return { ok: false, message: "Pola nomor invoice wajib diisi." };
  }
  if (trimmed.length > 100) {
    return { ok: false, message: "Pola nomor invoice maksimal 100 karakter." };
  }

  const stripped = trimmed.replace(TOKEN_PATTERN, "");
  if (stripped.includes("{") || stripped.includes("}")) {
    return {
      ok: false,
      message:
        "Pola nomor mengandung kurung buka/tutup yang tidak selesai. Contoh format yang benar: {SEQ:3}.",
    };
  }

  const tokens = Array.from(trimmed.matchAll(TOKEN_PATTERN), (m) => m[0]);
  const unknown = tokens.filter(
    (token) => !SIMPLE_TOKENS.has(token) && !SEQ_PATTERN.test(token),
  );
  if (unknown.length > 0) {
    return {
      ok: false,
      message: `Token tidak dikenal: ${unknown.join(", ")}. Token yang valid: ${NUMBER_PATTERN_TOKENS.join(", ")}.`,
    };
  }

  const seqTokens = tokens.filter((token) => token.startsWith("{SEQ:"));
  for (const token of seqTokens) {
    const digits = Number(token.match(SEQ_PATTERN)?.[1]);
    if (!Number.isInteger(digits) || digits < 1 || digits > 10) {
      return {
        ok: false,
        message: "Digit {SEQ:n} harus antara 1 dan 10 (mis. {SEQ:3}).",
      };
    }
  }
  if (seqTokens.length === 0) {
    return {
      ok: false,
      message: "Pola nomor harus memuat tepat satu token {SEQ:n} (mis. {SEQ:3}).",
    };
  }
  if (seqTokens.length > 1) {
    return {
      ok: false,
      message: "Pola nomor hanya boleh memuat satu token {SEQ:n}.",
    };
  }

  return { ok: true };
}

/**
 * Renders the pattern for the given context. Throws VALIDATION_ERROR when
 * the pattern is invalid — callers show/preview only after validate passes.
 */
export function previewNumber(
  pattern: string,
  ctx: NumberPreviewContext,
): string {
  const validation = validateNumberPattern(pattern);
  if (!validation.ok) {
    throw new AppError("VALIDATION_ERROR", validation.message);
  }
  const year = ctx.date.getFullYear();
  const month = ctx.date.getMonth() + 1;

  return pattern.trim().replace(TOKEN_PATTERN, (token) => {
    switch (token) {
      case "{CODE}":
        return ctx.code;
      case "{TYPE}":
        return ctx.invoiceType?.trim() || DEFAULT_INVOICE_TYPE_TOKEN;
      case "{YYYY}":
        return String(year);
      case "{YY}":
        return String(year % 100).padStart(2, "0");
      case "{MM}":
        return String(month).padStart(2, "0");
      case "{DD}":
        return String(ctx.date.getDate()).padStart(2, "0");
      case "{ROMAN_MONTH}":
        return roman(month);
      default: {
        const width = Number(token.match(SEQ_PATTERN)?.[1]);
        return String(ctx.nextSequence).padStart(width, "0");
      }
    }
  });
}
