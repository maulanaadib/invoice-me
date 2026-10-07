// src/lib/terbilang.test.ts
// Unit tests per feature 04 spec "Check When Done" — the exact strings from
// the master prompt plus the classic corner cases (nol, satu, sepuluh,
// sebelas, belas, belas-ratus-ribu, miliar). Assertion style: full strings.

import { describe, expect, it } from "vitest";
import { terbilang } from "@/lib/terbilang";

describe("terbilang — spec examples", () => {
  it("spells zero as 'Nol rupiah'", () => {
    expect(terbilang("0")).toBe("Nol rupiah");
    expect(terbilang("0.00")).toBe("Nol rupiah");
  });

  it("2.250.000 → Dua juta dua ratus lima puluh ribu rupiah", () => {
    expect(terbilang("2250000")).toBe("Dua juta dua ratus lima puluh ribu rupiah");
  });

  it("4.500.000 → Empat juta lima ratus ribu rupiah", () => {
    expect(terbilang("4500000")).toBe("Empat juta lima ratus ribu rupiah");
  });

  it("100.000 → Seratus ribu rupiah", () => {
    expect(terbilang("100000")).toBe("Seratus ribu rupiah");
  });

  it("1.000.000 → Satu juta rupiah (no 'satu' before juta? spec fixes this form)", () => {
    expect(terbilang("1000000")).toBe("Satu juta rupiah");
  });

  it("1.001.000 → Satu juta seribu rupiah", () => {
    expect(terbilang("1001000")).toBe("Satu juta seribu rupiah");
  });

  it("1.500.000.000 → Satu miliar lima ratus juta rupiah", () => {
    expect(terbilang("1500000000")).toBe("Satu miliar lima ratus juta rupiah");
  });
});

describe("terbilang — basic numbers", () => {
  it("spells 1..19 with the natural contractions", () => {
    expect(terbilang("1")).toBe("Satu rupiah");
    expect(terbilang("5")).toBe("Lima rupiah");
    expect(terbilang("9")).toBe("Sembilan rupiah");
    expect(terbilang("10")).toBe("Sepuluh rupiah");
    expect(terbilang("11")).toBe("Sebelas rupiah");
    expect(terbilang("12")).toBe("Dua belas rupiah");
    expect(terbilang("13")).toBe("Tiga belas rupiah");
    expect(terbilang("19")).toBe("Sembilan belas rupiah");
  });

  it("spells tens, hundreds and mixed hundreds", () => {
    expect(terbilang("20")).toBe("Dua puluh rupiah");
    expect(terbilang("21")).toBe("Dua puluh satu rupiah");
    expect(terbilang("99")).toBe("Sembilan puluh sembilan rupiah");
    expect(terbilang("100")).toBe("Seratus rupiah");
    expect(terbilang("111")).toBe("Seratus sebelas rupiah");
    expect(terbilang("123")).toBe("Seratus dua puluh tiga rupiah");
    expect(terbilang("500")).toBe("Lima ratus rupiah");
    expect(terbilang("999")).toBe("Sembilan ratus sembilan puluh sembilan rupiah");
  });

  it("spells thousands with 'seribu' (never 'satu ribu')", () => {
    expect(terbilang("1000")).toBe("Seribu rupiah");
    expect(terbilang("1100")).toBe("Seribu seratus rupiah");
    expect(terbilang("1111")).toBe("Seribu seratus sebelas rupiah");
    expect(terbilang("2000")).toBe("Dua ribu rupiah");
    expect(terbilang("12345")).toBe("Dua belas ribu tiga ratus empat puluh lima rupiah");
  });

  it("skips empty scale groups (1.000.001 has no ribu part)", () => {
    expect(terbilang("1000001")).toBe("Satu juta satu rupiah");
    expect(terbilang("1010000")).toBe("Satu juta sepuluh ribu rupiah");
    expect(terbilang("1000010")).toBe("Satu juta sepuluh rupiah");
  });

  it("spells millions and miliar with the working example 519.802.118 scenario", () => {
    expect(terbilang("450000000")).toBe("Empat ratus lima puluh juta rupiah");
    expect(terbilang("725000000")).toBe("Tujuh ratus dua puluh lima juta rupiah");
    expect(terbilang("1000000000")).toBe("Satu miliar rupiah");
    expect(terbilang("1234567890")).toBe(
      "Satu miliar dua ratus tiga puluh empat juta lima ratus enam puluh tujuh ribu delapan ratus sembilan puluh rupiah",
    );
  });

  it("handles trillion-scale amounts (Decimal(18,2) headroom)", () => {
    expect(terbilang("1000000000000")).toBe("Satu triliun rupiah");
    expect(terbilang("9999999999999999")).toBe(
      "Sembilan kuadriliun sembilan ratus sembilan puluh sembilan triliun sembilan ratus sembilan puluh sembilan miliar sembilan ratus sembilan puluh sembilan juta sembilan ratus sembilan puluh sembilan ribu sembilan ratus sembilan puluh sembilan rupiah",
    );
  });
});

describe("terbilang — input handling", () => {
  it("accepts decimal strings (fraction rounded away)", () => {
    expect(terbilang("2250000.00")).toBe("Dua juta dua ratus lima puluh ribu rupiah");
    expect(terbilang("1500.5")).toBe("Seribu lima ratus satu rupiah"); // half-up
    expect(terbilang("1999.5")).toBe("Dua ribu rupiah"); // half-up across a scale
    expect(terbilang("1500.4")).toBe("Seribu lima ratus rupiah");
  });

  it("treats invalid input as zero instead of crashing", () => {
    expect(terbilang("")).toBe("Nol rupiah");
    expect(terbilang("abc")).toBe("Nol rupiah");
  });

  it("supports a custom suffix", () => {
    expect(terbilang("1000", "dollar")).toBe("Seribu dollar");
  });
});
