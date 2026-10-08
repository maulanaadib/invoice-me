// src/modules/pdf/token.test.ts
// Feature 06 unit: the signed short-lived tokens that gate BOTH the print
// route (app) and /render (pdf-service). Every failure mode must collapse to
// `null` — no crash, no "valid but weird", nothing that distinguishes which
// check failed.

import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  PDF_TOKEN_TTL_MS,
  signPdfToken,
  verifyPdfToken,
  type PrintTokenPayload,
  type RenderTokenPayload,
} from "@/modules/pdf/token";

const SECRET = "unit-test-secret-with-at-least-32-characters";
const OTHER_SECRET = "another-secret-with-at-least-32-characters-x";

function printPayload(expiry = Date.now() + PDF_TOKEN_TTL_MS): PrintTokenPayload {
  return { p: "print", invoiceId: "inv_123", expiry };
}

function renderPayload(expiry = Date.now() + PDF_TOKEN_TTL_MS): RenderTokenPayload {
  return {
    p: "render",
    printUrl: "http://app:3000/print/invoices/inv_123?token=abc",
    storagePath: "invoices/organizations/org_1/2026/INV-2026-001.pdf",
    filename: "INV-2026-001.pdf",
    footer: "Invoice ini diterbitkan oleh PT Uji.",
    title: "INV/2026/001",
    author: "PT Uji",
    expiry,
  };
}

describe("signPdfToken / verifyPdfToken", () => {
  it("round-trips a print token with the right purpose", () => {
    const token = signPdfToken(printPayload(), SECRET);
    const parsed = verifyPdfToken<PrintTokenPayload>(token, SECRET, "print");
    expect(parsed).not.toBeNull();
    expect(parsed?.invoiceId).toBe("inv_123");
    expect(parsed?.p).toBe("print");
  });

  it("round-trips a render token carrying the full request payload", () => {
    const token = signPdfToken(renderPayload(), SECRET);
    const parsed = verifyPdfToken<RenderTokenPayload>(token, SECRET, "render");
    expect(parsed).not.toBeNull();
    expect(parsed?.storagePath).toBe("invoices/organizations/org_1/2026/INV-2026-001.pdf");
    expect(parsed?.footer).toContain("Invoice ini diterbitkan oleh");
  });

  it("rejects a token signed with a different secret", () => {
    const token = signPdfToken(printPayload(), OTHER_SECRET);
    expect(verifyPdfToken(token, SECRET, "print")).toBeNull();
  });

  it("rejects a tampered payload (signature covers the data)", () => {
    const token = signPdfToken(printPayload(), SECRET);
    const [data, signature] = token.split(".");
    // Flip the first character of the base64url payload — the HMAC was
    // computed over the original bytes, so verification must fail.
    const forged = `${data!.at(0) === "A" ? "B" : "A"}${data!.slice(1)}`;
    expect(verifyPdfToken(`${forged}.${signature}`, SECRET, "print")).toBeNull();
  });

  it("rejects an expired token", () => {
    const token = signPdfToken(printPayload(Date.now() - 1), SECRET);
    expect(verifyPdfToken(token, SECRET, "print")).toBeNull();
  });

  it("rejects a token minted for the other purpose", () => {
    const renderToken = signPdfToken(renderPayload(), SECRET);
    expect(verifyPdfToken(renderToken, SECRET, "print")).toBeNull();
    const printToken = signPdfToken(printPayload(), SECRET);
    expect(verifyPdfToken(printToken, SECRET, "render")).toBeNull();
  });

  it("rejects garbage, missing and malformed tokens without throwing", () => {
    expect(verifyPdfToken(null, SECRET, "print")).toBeNull();
    expect(verifyPdfToken(undefined, SECRET, "print")).toBeNull();
    expect(verifyPdfToken("", SECRET, "print")).toBeNull();
    expect(verifyPdfToken("not-a-token", SECRET, "print")).toBeNull();
    // Signature length differs from the expected HMAC — timingSafeEqual must
    // not be reached with mismatched lengths (it throws).
    expect(verifyPdfToken("abc.different-length-signature", SECRET, "print")).toBeNull();
    // base64url of a non-object payload.
    const weird = Buffer.from("[1,2,3]", "utf8").toString("base64url");
    const sig = createHmac("sha256", SECRET).update(weird).digest("base64url");
    expect(verifyPdfToken(`${weird}.${sig}`, SECRET, "print")).toBeNull();
  });
});
