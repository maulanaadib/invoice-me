// src/modules/bank-accounts/crypto.test.ts
// Spec: encryption roundtrip, ciphertext never resembles the digits, masking
// helper (**** **** 3449), normalization, GCM tamper detection.

import { describe, expect, it } from "vitest";
import {
  accountNumberLast4,
  decryptAccountNumber,
  encryptAccountNumber,
  maskAccountNumber,
  normalizeAccountNumber,
} from "@/modules/bank-accounts/crypto";

const DIGITS = "123456783449";

describe("encryptAccountNumber / decryptAccountNumber", () => {
  it("roundtrips to the original digits", () => {
    expect(decryptAccountNumber(encryptAccountNumber(DIGITS))).toBe(DIGITS);
  });

  it("stores iv:tag:ciphertext hex whose ciphertext bytes contain no plaintext", () => {
    const stored = encryptAccountNumber(DIGITS);
    expect(stored).toMatch(/^[0-9a-f]+:[0-9a-f]+:[0-9a-f]+$/);
    expect(stored).not.toContain(DIGITS);
    // The ciphertext body must not embed the plaintext anywhere. Assert on the
    // decoded bytes: the hex representation naturally contains hex digits, so
    // scanning it for arbitrary digit-runs (e.g. "5678") is a coin flip.
    const [, , dataHex] = stored.split(":");
    const ciphertext = Buffer.from(dataHex, "hex");
    expect(ciphertext.includes(Buffer.from(DIGITS, "utf8"))).toBe(false);
    expect(ciphertext.includes(Buffer.from("3449", "utf8"))).toBe(false);
  });

  it("produces a fresh ciphertext per call (random IV)", () => {
    expect(encryptAccountNumber(DIGITS)).not.toBe(encryptAccountNumber(DIGITS));
  });

  it("rejects tampered ciphertext (GCM auth)", () => {
    const stored = encryptAccountNumber(DIGITS);
    const [iv, tag, data] = stored.split(":");
    // Flip the last hex nibble of the ciphertext body.
    const flipped = data.slice(0, -1) + (data.endsWith("0") ? "1" : "0");
    expect(() => decryptAccountNumber([iv, tag, flipped].join(":"))).toThrow();
    // Wrong shape entirely: also rejected before crypto runs.
    expect(() => decryptAccountNumber("bukan-format")).toThrow(/iv:tag:ciphertext/);
  });
});

describe("maskAccountNumber", () => {
  it("masks every digit except the last four, grouped by four", () => {
    expect(maskAccountNumber(DIGITS)).toBe("**** **** 3449");
    expect(maskAccountNumber("9876543210")).toBe("**** ** 3210");
    // Four digits or fewer: nothing to mask, all visible.
    expect(maskAccountNumber("1234")).toBe("1234");
  });

  it("never exposes more than the last four digits", () => {
    const masked = maskAccountNumber("55555555555555551234");
    expect(masked.endsWith("1234")).toBe(true);
    // Stripping the visible last4 leaves only stars and separators.
    expect(masked.slice(0, -4).replace(/[*\s]/g, "")).toBe("");
  });
});

describe("helpers", () => {
  it("normalizeAccountNumber strips spaces, dashes and dots", () => {
    expect(normalizeAccountNumber("1234 5678-90.12")).toBe("123456789012");
    expect(normalizeAccountNumber(DIGITS)).toBe(DIGITS);
  });

  it("accountNumberLast4 returns exactly the last four digits", () => {
    expect(accountNumberLast4(DIGITS)).toBe("3449");
    expect(accountNumberLast4("12")).toBe("12");
  });
});
