// src/app/print/invoices/[id]/route.ts
// Internal print route (feature 06 / code-standards): renders the issued
// document as standalone HTML for pdf-service. Authentication is the SIGNED
// SHORT-LIVED TOKEN (`?token=`, HMAC INTERNAL_PDF_SECRET + 60s expiry) —
// never a session cookie, because the caller is pdf-service, not a browser.
// The proxy does not gate this path; the token check here is the gate and it
// fails closed (401 on missing/garbage/expired/wrong-invoice token).
//
// Authorization model: possessing a valid token for invoice X IS the
// credential — the app mints it per render request for a job whose invoice
// row it already scoped, so there is no session/org context to re-check and
// nothing to escalate. The route answers 404 for drafts and snapshot-less
// rows (never renders live relations of an un-issued invoice).

import { apiFailure } from "@/lib/api-response";
import { isAppError } from "@/lib/errors";
import { logger } from "@/server/logger";
import { env } from "@/server/env";
import { verifyPdfToken, type PrintTokenPayload } from "@/modules/pdf/token";
import { getPrintDocument } from "@/modules/invoices/print-document";
import { rendererDataFromIssued } from "@/components/invoice/renderer-data";
import { renderPrintHtml } from "@/components/invoice/print-render";

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await ctx.params;
  const token = new URL(request.url).searchParams.get("token");
  const payload = verifyPdfToken<PrintTokenPayload>(token, env.INTERNAL_PDF_SECRET, "print");

  if (!payload || payload.invoiceId !== id) {
    return Response.json(
      apiFailure("UNAUTHORIZED", "Token print tidak valid atau kedaluwarsa."),
      { status: 401 },
    );
  }

  try {
    const document = await getPrintDocument(id);
    const requestUrl = new URL(request.url);
    const html = await renderPrintHtml(rendererDataFromIssued(document), requestUrl.origin);
    return new Response(html, {
      headers: {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store",
        "x-robots-tag": "noindex, nofollow",
      },
    });
  } catch (error) {
    if (isAppError(error) && error.code === "NOT_FOUND") {
      return Response.json(apiFailure("NOT_FOUND", "Invoice tidak ditemukan."), {
        status: 404,
      });
    }
    logger.error(
      { module: "print", invoiceId: id, err: error instanceof Error ? error.message : String(error) },
      "print route gagal merender invoice",
    );
    return Response.json(
      apiFailure("INTERNAL_ERROR", "Terjadi kesalahan pada server. Coba lagi."),
      { status: 500 },
    );
  }
}
