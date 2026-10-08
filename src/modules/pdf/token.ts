// src/modules/pdf/token.ts
// Signed short-lived tokens for the PDF pipeline (security-standards:
// "pdf-service request ditandatangani INTERNAL_PDF_SECRET dengan token
// berumur pendek"). Two token kinds share one wire format:
//
//   • PRINT token  — carried as ?token= on /print/invoices/[id]; minted by the
//     app, verified by the app (the print route), never accepted from cookies.
//   • RENDER token — carried as `Authorization: Bearer` to pdf-service
//     /render; minted by the app, verified by pdf-service. The payload holds
//     the WHOLE request (printUrl, storage path, filename, footer, metadata),
//     so pdf-service never trusts an unsigned body part.
//
// Wire format: `base64url(JSON).base64url(HMAC-SHA256(data))` — the same
// shape the feature 00 skeleton already verified. Verification is
// constant-time and fail-closed: bad signature, wrong purpose or past expiry
// all answer null (never "valid but weird").

import { createHmac, timingSafeEqual } from "node:crypto";

/** Minted tokens are consumed within seconds (fetch + render start). */
export const PDF_TOKEN_TTL_MS = 60_000;

export interface PrintTokenPayload {
  p: "print";
  invoiceId: string;
  /** Unix epoch milliseconds. */
  expiry: number;
}

export interface RenderTokenPayload {
  p: "render";
  /** Absolute internal URL of the print route pdf-service must fetch. */
  printUrl: string;
  /** Root-relative storage destination, e.g. invoices/organizations/.../INV-....pdf */
  storagePath: string;
  /** Safe download filename, e.g. INV-SB-VII-2026-001.pdf */
  filename: string;
  /** Reference line drawn by the Playwright footer on every page. */
  footer: string;
  /** PDF metadata: Title = invoice number, Author = profile name. */
  title: string;
  author: string;
  expiry: number;
}

export type PdfTokenPayload = PrintTokenPayload | RenderTokenPayload;

/** Signs a payload with `secret`. The payload must carry `p` and `expiry`. */
export function signPdfToken(payload: PdfTokenPayload, secret: string): string {
  const data = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const signature = createHmac("sha256", secret).update(data).digest("base64url");
  return `${data}.${signature}`;
}

/**
 * Verifies signature + purpose + expiry. Returns the typed payload, or null
 * for ANY failure — callers turn null into 401 without revealing which check
 * failed.
 */
export function verifyPdfToken<P extends PdfTokenPayload>(
  token: string | null | undefined,
  secret: string,
  purpose: P["p"],
): P | null {
  if (!token) return null;
  const dotIndex = token.lastIndexOf(".");
  if (dotIndex <= 0) return null;

  const data = token.slice(0, dotIndex);
  const signature = token.slice(dotIndex + 1);
  const expected = createHmac("sha256", secret).update(data).digest("base64url");

  const actualBytes = Buffer.from(signature, "utf8");
  const expectedBytes = Buffer.from(expected, "utf8");
  // timingSafeEqual THROWS on length mismatch — compare lengths first so a
  // malformed token is a plain null instead of an unhandled exception.
  if (actualBytes.length !== expectedBytes.length) return null;
  if (!timingSafeEqual(actualBytes, expectedBytes)) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(data, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;
  const candidate = parsed as Partial<P>;
  if (candidate.p !== purpose) return null;
  if (typeof candidate.expiry !== "number") return null;
  if (Date.now() > candidate.expiry) return null;
  return candidate as P;
}
