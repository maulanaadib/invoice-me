// src/app/(dashboard)/invoices/new/page.tsx
// /invoices/new — the draft editor for a brand-new invoice. The server
// component guards auth/org/permission and hands the editor its option bundle
// (one round trip); the client component owns the form, the autosave and the
// live preview. Prefill from a project comes through ?project=<id> (feature
// 03's contract), resolved server-side so nothing client-supplied is trusted.

import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";
import { can } from "@/modules/permissions/service";
import { resolveActiveOrgScope } from "@/modules/organizations/service";
import { getEditorOptions } from "@/modules/invoices/service";
import {
  getInvoiceDraftAction,
  getEditorOptionsAction,
  prefillInvoiceFromProjectAction,
} from "@/modules/invoices/actions";
import { getSession } from "@/server/session";
import { InvoiceEditor } from "@/components/invoice/invoice-editor";
import { logger } from "@/server/logger";

export const metadata: Metadata = {
  title: "Invoice baru — invoice-me",
};

export const dynamic = "force-dynamic";

export default async function NewInvoicePage({
  searchParams,
}: {
  searchParams: Promise<{ project?: string }>;
}) {
  const session = await getSession();
  if (!session) redirect("/login");

  const scope = await resolveActiveOrgScope(session);
  if (!scope) redirect("/invoices");
  if (!can("invoice.draft.create", scope)) redirect("/invoices");

  const optionsResult = await getEditorOptionsAction();
  if (!optionsResult.ok) {
    logger.warn(
      { module: "invoices", err: optionsResult.error.message },
      "editor options gagal dimuat",
    );
    notFound();
  }

  const { project } = await searchParams;
  const prefill = project
    ? await prefillInvoiceFromProjectAction({ projectId: project })
    : undefined;

  // A stale/foreign project id is not fatal — the editor opens empty (logged,
  // never silently forwarded to the client).
  if (prefill && !prefill.ok) {
    logger.warn(
      { module: "invoices", err: prefill.error.message },
      "prefill project gagal — editor dibuka kosong",
    );
  }

  return (
    <Suspense fallback={null}>
      <InvoiceEditor
        options={optionsResult.data}
        initialPrefill={
          prefill?.ok && project ? { projectId: project, data: prefill.data } : undefined
        }
      />
    </Suspense>
  );
}
