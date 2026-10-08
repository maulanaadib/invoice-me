// src/app/api/admin/invoices/[id]/pdf/route.ts
// Feature 09 — admin-panel PDF download. Separate from the org-scoped route on
// purpose: that one answers 404 for any invoice outside the caller's
// organization (IDOR guard), and this one must never weaken it. Same session
// requirement, platform-role guard in the service, honest 404 when the file is
// missing, and PDF_DOWNLOADED written with admin metadata.

import { withErrorHandler } from "@/lib/api-response";
import { adminDownloadInvoicePdf } from "@/modules/admin/service";
import { getSession } from "@/server/session";

export const dynamic = "force-dynamic";

export const GET = withErrorHandler(
  async (request: Request, ctx: { params: Promise<{ id: string }> }) => {
    const { id } = await ctx.params;

    const session = await getSession();
    if (!session) {
      return Response.json(
        {
          ok: false,
          error: {
            code: "UNAUTHORIZED",
            message: "Sesi Anda sudah berakhir. Silakan masuk kembali.",
          },
        },
        { status: 401 },
      );
    }

    // AppError FORBIDDEN / NOT_FOUND / INTERNAL_ERROR are mapped by the shared
    // handler (403 / 404 / 500) with the standard failure body.
    const download = await adminDownloadInvoicePdf(
      {
        platformRole: session.user.platformRole,
        actorUserId: session.user.id,
        request,
      },
      id,
      request,
    );

    return new Response(new Uint8Array(download.bytes), {
      headers: {
        "content-type": "application/pdf",
        "content-length": String(download.sizeBytes),
        "content-disposition": `attachment; filename="${download.filename}"`,
        "cache-control": "private, no-store",
        "x-content-type-options": "nosniff",
      },
    });
  },
);
