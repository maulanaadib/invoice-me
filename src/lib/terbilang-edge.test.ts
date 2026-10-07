// src/lib/terbilang-edge.test.ts
// Independent edge-case pass over terbilang (feature 04) — the values the
// feature-spec test file does NOT pin down:
//
//   • 1001 → "Seribu satu" (the thousand boundary just past seribu)
//   • 21.000 → "Dua puluh satu ribu" (a tens group at the ribu scale)
//   • 10.000.000.000 and 999.999.999.999 (the document's stated upper bound)
//   • the "se-" contractions at the scale boundary: seribu but satu juta /
//     satu milyar — juta must NEVER become "sejuta"
//   • fraction rounding at the .5 boundary in BOTH directions
//   • non-decimal / sentinel input (Decimal accepts exponent notation and
//     the words NaN/Infinity, which must not leak into the document)
//   • negative amounts and a custom suffix with a capitalized result

import { describe, expect, it } from "vitest";
import Decimal from "decimal.js";
import { terbilang } from "@/lib/terbilang";

describe("thousand and tens boundaries", () => {
  it("1001 → Seribu satu rupiah", () => {
    expect(terbilang("1001")).toBe("Seribu satu rupiah");
  });

  it("1000..1009 spell out each trailing unit", () => {
    expect(terbilang("1002")).toBe("Seribu dua rupiah");
    expect(terbilang("1009")).toBe("Seribu sembilan rupiah");
    expect(terbilang("1011")).toBe("Seribu sebelas rupiah");
    expect(terbilang("1020")).toBe("Seribu dua puluh rupiah");
  });

  it("21.000 → Dua puluh satu ribu rupiah (tens carried at the ribu scale)", () => {
    expect(terbilang("21000")).toBe("Dua puluh satu ribu rupiah");
    expect(terbilang("99000")).toBe("Sembilan puluh sembilan ribu rupiah");
  });

  it("a hundreds group inside the ribu scale", () => {
    expect(terbilang("120000")).toBe("Seratus dua puluh ribu rupiah");
    expect(terbilang("999000")).toBe("Sembilan ratus sembilan puluh sembilan ribu rupiah");
  });
});

describe("scale contractions — seribu, but satu juta / satu miliar", () => {
  it("1.000 reads seribu, 1.000.000 reads SATU juta (never sejuta)", () => {
    expect(terbilang("1000")).toBe("Seribu rupiah");
    expect(terbilang("1000000")).toBe("Satu juta rupiah");
    expect(terbilang("1000000000")).toBe("Satu miliar rupiah");
    expect(terbilang("1000000000000")).toBe("Satu triliun rupiah");
  });

  it("seribu appears again inside a larger scale (1.100.000)", () => {
    // 1.100.000 → "Satu juta seratus ribu" — the se- contraction belongs to
    // the 1.000 at the RIBU position, not to a leading 100.
    expect(terbilang("1100000")).toBe("Satu juta seratus ribu rupiah");
    expect(terbilang("2001000")).toBe("Dua juta seribu rupiah");
  });

  it("an empty scale group is skipped without leaving a double space", () => {
    expect(terbilang("1000001")).toBe("Satu juta satu rupiah");
    expect(terbilang("1001000000")).toBe("Satu miliar satu juta rupiah");
    // 1.000.000.100 = 1 miliar + 100 (the juta and ribu groups are empty).
    expect(terbilang("1000000100")).toBe("Satu miliar seratus rupiah");
  });
});

describe("upper bounds the document names explicitly", () => {
  it("1.500.000.000 → Satu miliar lima ratus juta rupiah", () => {
    expect(terbilang("1500000000")).toBe("Satu miliar lima ratus juta rupiah");
  });

  it("999.999.999.999 — the stated maximum", () => {
    expect(terbilang("999999999999")).toBe(
      "Sembilan ratus sembilan puluh sembilan miliar sembilan ratus sembilan puluh sembilan juta sembilan ratus sembilan puluh sembilan ribu sembilan ratus sembilan puluh sembilan rupiah",
    );
  });

  it("10.000.000.000 (sepuluh miliar) and 999.999 spelled out", () => {
    expect(terbilang("10000000000")).toBe("Sepuluh miliar rupiah");
    expect(terbilang("999999")).toBe(
      "Sembilan ratus sembilan puluh sembilan ribu sembilan ratus sembilan puluh sembilan rupiah",
    );
  });
});

describe("fraction rounding", () => {
  it("0 → Nol rupiah (spec case)", () => {
    expect(terbilang("0")).toBe("Nol rupiah");
    expect(terbilang("0.00")).toBe("Nol rupiah");
    expect(terbilang("0.4")).toBe("Nol rupiah");
  });

  it("a .4 fraction rounds down, a .5 fraction rounds up", () => {
    expect(terbilang("1500.4")).toBe("Seribu lima ratus rupiah");
    expect(terbilang("1500.5")).toBe("Seribu lima ratus satu rupiah");
  });

  it("rounding carries across a scale boundary (1999.5 → 2.000)", () => {
    expect(terbilang("1999.5")).toBe("Dua ribu rupiah");
    expect(terbilang("999999.5")).toBe("Satu juta rupiah");
  });

  it("the fractional part rounds away rather than surviving into the words", () => {
    expect(terbilang("4500000.00")).toBe("Empat juta lima ratus ribu rupiah");
    // .999 rounds half-up to the next whole rupiah: …tinggal satu rupiah.
    expect(terbilang("4500000.999")).toBe("Empat juta lima ratus ribu satu rupiah");
    expect(terbilang("4500000.5")).toBe("Empat juta lima ratus ribu satu rupiah");
  });
});

describe("input hardening", () => {
  it("accepts a Decimal instance (the renderer's own type)", () => {
    expect(terbilang(new Decimal("2250000"))).toBe("Dua juta dua ratus lima puluh ribu rupiah");
  });

  it("accepts exponent notation Decimal understands", () => {
    expect(terbilang("1.5e6")).toBe("Satu juta lima ratus ribu rupiah");
  });

  it("NaN and Infinity read as zero, never as words", () => {
    expect(terbilang("NaN")).toBe("Nol rupiah");
    expect(terbilang("Infinity")).toBe("Nol rupiah");
  });

  it("a garbage string still reads as zero", () => {
    expect(terbilang("")).toBe("Nol rupiah");
    expect(terbilang("bukan angka")).toBe("Nol rupiah");
  });

  it("a negative amount is prefixed with minus and capitalized", () => {
    expect(terbilang("-2250000")).toBe("minus Dua juta dua ratus lima puluh ribu rupiah");
  });

  it("a custom suffix keeps capitalization and zero handling", () => {
    expect(terbilang("0", "dolar")).toBe("Nol dolar");
    expect(terbilang("1001", "dolar")).toBe("Seribu satu dolar");
  });
});
