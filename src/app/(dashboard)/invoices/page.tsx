// src/app/(dashboard)/invoices/page.tsx
// Minimal draft invoice list (feature 04) — navigation only: a server-component
// call to listInvoiceDraftsAction, rows that open the editor at
// /invoices/[id]/edit, and the "Invoice Baru" entry. Filters, search and row
// actions belong to feature 08; issued invoices never appear here (the action
// lists status=DRAFT only, org-scoped and permission-checked server-side).

import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { PlusIcon } from "lucide-react";
import { formatIdr } from "@/lib/money";
import { listInvoiceDraftsAction } from "@/modules/invoices/actions";
import { can } from "@/modules/permissions/service";
import { resolveActiveOrgScope } from "@/modules/organizations/service";
import { getSession } from "@/server/session";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export const metadata: Metadata = {
  title: "Invoice — invoice-me",
};

export const dynamic = "force-dynamic";

/** "2026-10-07" → "07/10/2026" — calendar string only, no Date/timezone. */
function formatTanggal(value: string): string {
  const [year, month, day] = value.split("-");
  return year && month && day ? `${day}/${month}/${year}` : value;
}

export default async function InvoicesPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  const scope = await resolveActiveOrgScope(session);
  if (!scope) {
    return (
      <div className="flex flex-col gap-6">
        <h1 className="text-2xl font-semibold tracking-tight">Invoice</h1>
        <Card>
          <CardHeader>
            <CardTitle>Belum ada workspace aktif</CardTitle>
            <CardDescription>
              Pilih atau buat organisasi terlebih dahulu untuk melihat draft invoice.
            </CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  const mayCreate = can("invoice.draft.create", scope);
  const result = await listInvoiceDraftsAction();

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight">Invoice</h1>
          <p className="text-sm text-muted-foreground">
            Daftar draft invoice. Klik satu baris untuk membuka editornya — nomor yang
            tampil masih pratinjau sampai invoice diterbitkan.
          </p>
        </div>
        {mayCreate ? (
          <Button render={<Link href="/invoices/new" />}>
            <PlusIcon aria-hidden="true" />
            Invoice Baru
          </Button>
        ) : null}
      </div>

      {!result.ok ? (
        <Card>
          <CardHeader>
            <CardTitle>Gagal memuat draft invoice</CardTitle>
            <CardDescription>{result.error.message}</CardDescription>
          </CardHeader>
        </Card>
      ) : result.data.rows.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border px-6 py-12 text-center text-sm text-muted-foreground">
          Belum ada draft invoice. Buat yang pertama lewat tombol “Invoice Baru”.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nomor</TableHead>
                <TableHead>Customer</TableHead>
                <TableHead>Tanggal</TableHead>
                <TableHead className="text-right">Total</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {result.data.rows.map((row) => (
                // The link's ::after overlays the whole row (containing block:
                // this relative <tr>), so clicking anywhere opens the editor —
                // pure CSS navigation, no client component needed.
                <TableRow key={row.id} className="group relative">
                  <TableCell>
                    <Link
                      href={`/invoices/${row.id}/edit`}
                      className="font-mono font-medium after:absolute after:inset-0 after:content-[''] group-hover:underline"
                    >
                      {row.number ?? row.numberPreview ?? "—"}
                    </Link>
                  </TableCell>
                  <TableCell>{row.customerName}</TableCell>
                  <TableCell>{formatTanggal(row.invoiceDate)}</TableCell>
                  <TableCell className="text-right font-mono">
                    {formatIdr(row.grandTotal)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {result.data.total > result.data.rows.length ? (
            <p className="px-2 pt-3 text-sm text-muted-foreground">
              Menampilkan {result.data.rows.length} dari {result.data.total} draft terbaru.
            </p>
          ) : null}
        </div>
      )}
    </div>
  );
}
