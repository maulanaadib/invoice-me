// src/app/admin/invoices/page.tsx
// Feature 09 — cross-org invoice monitoring for support. Filters live in the
// URL (back/forward + shareable), validated server-side by listAdminInvoices,
// and the status badge/filter share the effective-status semantics of feature
// 08 so a row can never disagree with the filter that produced it.

import type { Metadata } from "next";
import Link from "next/link";
import {
  AdminEmptyState,
  AdminPagination,
  adminPageContext,
  first,
  formatDate,
} from "@/app/admin/admin-ui";
import { INVOICE_STATUS_LABELS, InvoiceStatusBadge } from "@/components/invoice/invoice-status-badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatIdr } from "@/lib/money";
import { listAdminFilterOptions, listAdminInvoices } from "@/modules/admin/service";
import { ADMIN_PAGE_SIZE } from "@/modules/admin/schema";
import { InvoiceStatus } from "@prisma/client";

export const metadata: Metadata = {
  title: "Monitoring Invoice — invoice-me",
};

export const dynamic = "force-dynamic";

const FIELD_CLASS =
  "h-9 rounded-md border border-input bg-background px-3 text-sm text-foreground";

export default async function AdminInvoicesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const ctx = await adminPageContext();
  const params = await searchParams;

  const [result, options] = await Promise.all([
    listAdminInvoices(ctx, params),
    listAdminFilterOptions(ctx),
  ]);

  const q = first(params.q) ?? "";
  const organizationId = first(params.organizationId) ?? "";
  const status = first(params.status) ?? "";
  const from = first(params.from) ?? "";
  const to = first(params.to) ?? "";
  const hasFilter = Boolean(q || organizationId || status || from || to);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">Monitoring invoice</h1>
        <p className="text-sm text-muted-foreground">
          Seluruh invoice lintas organisasi untuk keperluan support. Membuka detail
          tercatat di log audit sebagai aksi super admin.
        </p>
      </div>

      <form
        method="get"
        className="flex flex-wrap items-end gap-3 rounded-lg border border-border bg-card p-4"
      >
        <div className="flex min-w-56 flex-col gap-1">
          <Label htmlFor="admin-invoice-q">Cari</Label>
          <Input
            id="admin-invoice-q"
            name="q"
            defaultValue={q}
            placeholder="Nomor / customer"
            maxLength={100}
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="admin-invoice-org">Organisasi</Label>
          <select
            id="admin-invoice-org"
            name="organizationId"
            defaultValue={organizationId}
            className={FIELD_CLASS}
          >
            <option value="">Semua organisasi</option>
            {options.organizations.map((organization) => (
              <option key={organization.id} value={organization.id}>
                {organization.name}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="admin-invoice-status">Status</Label>
          <select
            id="admin-invoice-status"
            name="status"
            defaultValue={status}
            className={FIELD_CLASS}
          >
            <option value="">Semua status</option>
            {Object.values(InvoiceStatus).map((value) => (
              <option key={value} value={value}>
                {INVOICE_STATUS_LABELS[value]}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="admin-invoice-from">Tanggal mulai</Label>
          <input
            id="admin-invoice-from"
            type="date"
            name="from"
            defaultValue={from}
            className={FIELD_CLASS}
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="admin-invoice-to">Tanggal akhir</Label>
          <input
            id="admin-invoice-to"
            type="date"
            name="to"
            defaultValue={to}
            className={FIELD_CLASS}
          />
        </div>
        <div className="flex gap-2">
          <Button type="submit" size="sm">
            Terapkan
          </Button>
          <Link href="/admin/invoices" className={buttonVariants({ variant: "outline", size: "sm" })}>
            Reset
          </Link>
        </div>
      </form>

      {result.rows.length === 0 ? (
        <AdminEmptyState
          title={
            result.total > 0
              ? "Halaman di luar jangkauan"
              : hasFilter
                ? "Tidak ada invoice yang cocok"
                : "Belum ada invoice"
          }
          description={
            result.total > 0
              ? "Nomor halaman ini tidak berisi data. Kembali ke halaman pertama."
              : hasFilter
                ? "Ubah atau hapus filter untuk melihat invoice lain."
                : "Instance ini belum memiliki invoice sama sekali."
          }
          resetHref={result.total > 0 || hasFilter ? "/admin/invoices" : undefined}
        />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nomor</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Tanggal</TableHead>
                <TableHead>Customer</TableHead>
                <TableHead>Organisasi</TableHead>
                <TableHead className="text-right">Grand total</TableHead>
                <TableHead className="text-right">Aksi</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {result.rows.map((row) => (
                <TableRow key={row.id}>
                  <TableCell>
                    <span className="block max-w-56 truncate font-mono text-xs font-medium">
                      {row.number ?? row.numberPreview ?? "(tanpa nomor)"}
                    </span>
                  </TableCell>
                  <TableCell>
                    <InvoiceStatusBadge status={row.status} />
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                    {formatDate(row.invoiceDate)}
                  </TableCell>
                  <TableCell>
                    <span className="block max-w-48 truncate text-sm">
                      {row.customerName}
                    </span>
                  </TableCell>
                  <TableCell>
                    <span className="block max-w-40 truncate text-sm text-muted-foreground">
                      {row.organizationName}
                    </span>
                  </TableCell>
                  <TableCell className="text-right font-medium tabular-nums">
                    {formatIdr(row.grandTotal)}
                  </TableCell>
                  <TableCell className="text-right">
                    <Link
                      href={`/admin/invoices/${row.id}`}
                      className="text-sm font-medium text-primary underline-offset-4 hover:underline"
                    >
                      Detail
                    </Link>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <AdminPagination
        page={result.page}
        pageSize={ADMIN_PAGE_SIZE}
        total={result.total}
        params={params}
      />
    </div>
  );
}
