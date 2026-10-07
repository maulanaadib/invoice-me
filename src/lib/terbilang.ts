// src/lib/terbilang.ts
// Terbilang (amount in Indonesian words) — feature 04. Input is the grand
// total as a decimal string (never a float); the fractional part is rounded
// away (rupiah invoices carry no cents in their terbilang) and the integer
// value is spelled out.
//
// Source of truth: master prompt examples —
//   2.250.000 → "Dua juta dua ratus lima puluh ribu rupiah"
//   4.500.000 → "Empat juta lima ratus ribu rupiah"
//     100.000 → "Seratus ribu rupiah"
//   1.000.000 → "Satu juta rupiah" (spec fixes this exact form: natural
//              reading, no "se-" contraction for juta)
//   1.001.000 → "Satu juta seribu rupiah"
//           0 → "Nol rupiah"

import Decimal from "decimal.js";

const ONES = [
  "",
  "satu",
  "dua",
  "tiga",
  "empat",
  "lima",
  "enam",
  "tujuh",
  "delapan",
  "sembilan",
] as const;

/** Scale names indexed by group-of-three position: (10^3)^i. */
const SCALES = ["", "ribu", "juta", "miliar", "triliun", "kuadriliun"] as const;

/** Spelled words for 1..999 (empty array for 0). */
function threeDigits(value: number): string[] {
  const out: string[] = [];
  let rest = value;

  const hundreds = Math.floor(rest / 100);
  rest %= 100;
  if (hundreds > 0) {
    // 100..199 read "seratus …" (natural Indonesian), never "satu ratus".
    if (hundreds === 1) {
      out.push("seratus");
    } else {
      out.push(ONES[hundreds]!, "ratus");
    }
  }

  if (rest >= 20) {
    out.push(ONES[Math.floor(rest / 10)]!, "puluh");
    rest %= 10;
  } else if (rest === 10) {
    out.push("sepuluh");
    rest = 0;
  } else if (rest === 11) {
    out.push("sebelas");
    rest = 0;
  }

  if (rest > 0) {
    if (rest < 10) {
      out.push(ONES[rest]!);
    } else {
      // 12..19 → "<ones> belas"
      out.push(ONES[rest - 10]!, "belas");
    }
  }

  return out;
}

/** Spelled words for a non-negative integer given as a plain digit string. */
function integerWords(digits: string): string[] {
  const groups: number[] = [];
  for (let end = digits.length; end > 0; end -= 3) {
    groups.push(Number(digits.slice(Math.max(0, end - 3), end)));
  }
  // groups[i] is the value at scale i (0 = units, 1 = ribu, 2 = juta, ...).

  if (groups.every((group) => group === 0)) return [];

  const out: string[] = [];
  for (let i = groups.length - 1; i >= 0; i -= 1) {
    const group = groups[i]!;
    if (group === 0) continue;

    // 1.000 reads "seribu", never "satu ribu". (1.000.000 stays "satu juta"
    // per the spec — only ribu takes the "se-" contraction.)
    if (i === 1 && group === 1) {
      out.push("seribu");
      continue;
    }

    out.push(...threeDigits(group));
    const scale = SCALES[i] ?? "";
    if (scale) out.push(scale);
  }
  return out;
}

/**
 * Spell an amount in Indonesian words with a currency suffix.
 * Accepts a decimal string (or Decimal); invalid/empty input reads as zero.
 */
export function terbilang(value: string | Decimal, suffix = "rupiah"): string {
  let amount: Decimal;
  try {
    amount = new Decimal(value);
  } catch {
    return `Nol ${suffix}`;
  }
  if (amount.isNaN() || !amount.isFinite()) return `Nol ${suffix}`;

  const rounded = amount.toDecimalPlaces(0, Decimal.ROUND_HALF_UP);
  const negative = rounded.isNegative();
  const digits = rounded.abs().toFixed(0);
  const words = integerWords(digits);

  const phrase = words.length === 0 ? "nol" : words.join(" ");
  const capitalized = phrase.charAt(0).toUpperCase() + phrase.slice(1);
  return `${negative ? "minus " : ""}${capitalized} ${suffix}`;
}
