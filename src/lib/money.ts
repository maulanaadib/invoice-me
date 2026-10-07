// src/lib/money.ts
// Decimal-string money helpers (feature 03: workValue, later invoice amounts).
// Values travel as strings end to end — grouping/parsing is pure string work,
// so a float never touches a rupiah value (code-standards: no float money).

import Decimal from "decimal.js";

/** Money rounding contract: 2 decimals, half-up, always plain notation. */
export function roundMoney(value: Decimal.Value): string {
  return new Decimal(value).toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toFixed(2);
}

/** "450000000" | "450000.5" → "450.000.000" | "450.000,5" (id-ID display). */
export function groupDigits(value: string): string {
  const [integer = "0", decimals] = value.split(".");
  const grouped = integer.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return decimals ? `${grouped},${decimals}` : grouped;
}

/** Display text → raw decimal string: a trailing "," is the decimal mark; a
 * trailing "." followed by 1–2 digits is decimal; every other separator is a
 * thousands grouping. "1.234.567" → "1234567", "450.000,50" → "450000.50". */
export function ungroupDigits(display: string): string {
  const text = display.replace(/\s/g, "");
  if (!text) return "";
  const lastComma = text.lastIndexOf(",");
  const lastDot = text.lastIndexOf(".");
  const digitsOnly = (input: string) => input.replace(/\D/g, "");

  if (lastComma > lastDot) {
    const head = digitsOnly(text.slice(0, lastComma));
    const decimals = digitsOnly(text.slice(lastComma + 1)).slice(0, 2);
    return decimals ? `${head}.${decimals}` : head;
  }
  if (lastDot > -1 && /^\.\d{1,2}$/.test(text.slice(lastDot))) {
    const head = digitsOnly(text.slice(0, lastDot));
    const decimals = digitsOnly(text.slice(lastDot + 1));
    return `${head}.${decimals}`;
  }
  return digitsOnly(text);
}

/** Raw decimal string → "Rp 450.000.000" for tables and summaries. */
export function formatIdr(value: string): string {
  return `Rp ${groupDigits(value)}`;
}
