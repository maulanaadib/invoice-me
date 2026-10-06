// src/modules/bank-accounts/crypto.ts
// Bank account number encryption at rest (feature 02 spec): AES-256-GCM with
// a key derived as SHA-256(BANK_ACCOUNT_ENCRYPTION_KEY). Stored format is
// `iv:tag:ciphertext` (all hex), so the DB value never resembles the digits.

import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";
import { env } from "@/server/env";

function encryptionKey(): Buffer {
  return createHash("sha256")
    .update(env.BANK_ACCOUNT_ENCRYPTION_KEY, "utf8")
    .digest();
}

/** Normalizes user input to bare digits (spaces, dashes, dots removed). */
export function normalizeAccountNumber(value: string): string {
  return value.replace(/[\s.\-]/g, "");
}

export function encryptAccountNumber(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("hex")}:${tag.toString("hex")}:${ciphertext.toString("hex")}`;
}

/** Roundtrip inverse; throws on tampered/wrong-key ciphertext (GCM auth). */
export function decryptAccountNumber(stored: string): string {
  const [ivHex, tagHex, dataHex] = stored.split(":");
  if (!ivHex || !tagHex || !dataHex) {
    throw new Error("Stored bank account value is not in iv:tag:ciphertext form");
  }
  const decipher = createDecipheriv(
    "aes-256-gcm",
    encryptionKey(),
    Buffer.from(ivHex, "hex"),
  );
  decipher.setAuthTag(Buffer.from(tagHex, "hex"));
  return Buffer.concat([
    decipher.update(Buffer.from(dataHex, "hex")),
    decipher.final(),
  ]).toString("utf8");
}

/**
 * Display mask: every digit except the last four becomes `*`, grouped in
 * fours with the last4 kept visible — e.g. 123456783449 → "**** **** 3449".
 * Never derive this from ciphertext length: use the decrypted value or
 * accountNumberLast4 server-side.
 */
export function maskAccountNumber(digits: string): string {
  const last4 = digits.slice(-4);
  const masked = "*".repeat(Math.max(0, digits.length - 4));
  const groups = masked.match(/.{1,4}/g) ?? [];
  return [...groups, last4].join(" ");
}

export function accountNumberLast4(digits: string): string {
  return digits.slice(-4);
}
