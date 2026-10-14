// src/app/admin/pdf-jobs/page.tsx
// Feature 09 — the PDF job queue for support: invoice, status, attempt,
// duration and the worker's real errorMessage (never hidden). Failed rows
// carry a retry button that re-enqueues the job (attempt history preserved).

import type { Metadata } from "next";
import Link from "next/link";
import {
  AdminEmptyState,
  AdminPagination,
  adminPageContext,
  first,
  formatDateTime,
} from "@/app/admin/admin-ui";
import { RetryPdfJobButton } from "@/components/forms/retry-pdf-job-button";
import { Badge } from "@/components/ui/badge";
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
import { cn } from "cn";
import { ADMIN_PAGE_SIZE } from "@/modules/admin/schema";
import { listAdminPdfJobs } from "@/modules/admin/service";
import { PDF_STATUS_LABELS } from "@/modules/pdf/service";
import { PdfJobStatus } from "@prisma/client";

export const metadata: Metadata = {
  title: "Job PDF — Panel Admin — invoice-me",
};

export const dynamic = "force-dynamic";

const FIELD_CLASS =
  "h-9 rounded-md border border-input bg-background px-3 text-sm text-foreground";
const HEAD_CLASS = "h-10 px-3 text-xs font-medium tracking-wide text-muted-foreground";
const CELL_CLASS = "py-2.5 px-3";

const STATUS_VARIANTS: Record<
  PdfJobStatus,
  "secondary" | "destructive" | "outline" | "default"
> = {
  PENDING: "outline",
  RUNNING: "secondary",
  SUCCESS: "default",
  FAILED: "destructive",
};

function formatDuration(durationMs: number | null): string {
  if (durationMs === null) return "—";
  return `${(durationMs / 1000).toLocaleString("id-ID", { maximumFractionDigits: 1 })} dtk`;
}

export default async function AdminPdfJobsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const ctx = await adminPageContext();
  const params = await searchParams;
  const result = await listAdminPdfJobs(ctx, params);

  const invoice = first(params.invoice) ?? "";
  const status = first(params.status) ?? "";
  const hasFilter = Boolean(invoice || status);

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-1.5">
        <h1 className="text-2xl font-semibold tracking-tight">Job PDF</h1>
        <p className="text-sm text-muted-foreground">
          Antrean pembuatan PDF resmi. Job gagal bisa diulang — percobaan tidak
          dihapus, jadi riwayatnya tetap terlihat.
        </p>
      </div>

      <form
        method="get"
        className="flex flex-wrap items-end gap-3 rounded-lg border border-border bg-card p-4"
      >
        <div className="flex min-w-56 flex-col gap-1.5">
          <Label htmlFor="admin-pdf-invoice">Invoice</Label>
          <Input
            id="admin-pdf-invoice"
            name="invoice"
            defaultValue={invoice}
            placeholder="Nomor invoice"
            maxLength={100}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="admin-pdf-status">Status</Label>
          <select
            id="admin-pdf-status"
            name="status"
            defaultValue={status}
            className={FIELD_CLASS}
          >
            <option value="">Semua status</option>
            {Object.values(PdfJobStatus).map((value) => (
              <option key={value} value={value}>
                {PDF_STATUS_LABELS[value]}
              </option>
            ))}
          </select>
        </div>
        <div className="flex gap-2">
          <Button type="submit" size="sm">
            Terapkan
          </Button>
          <Link
            href="/admin/pdf-jobs"
            className={buttonVariants({ variant: "outline", size: "sm" })}
          >
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
                ? "Tidak ada job yang cocok"
                : "Belum ada job PDF"
          }
          description={
            result.total > 0
              ? "Kembali ke halaman pertama untuk melihat job lain."
              : hasFilter
                ? "Ubah atau hapus filter untuk melihat job lain."
                : "Job PDF dibuat saat invoice diterbitkan."
          }
          resetHref={result.total > 0 || hasFilter ? "/admin/pdf-jobs" : undefined}
        />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border bg-card shadow-xs">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className={HEAD_CLASS}>Dibuat</TableHead>
                <TableHead className={HEAD_CLASS}>Invoice</TableHead>
                <TableHead className={HEAD_CLASS}>Status</TableHead>
                <TableHead className={`${HEAD_CLASS} text-right`}>Percobaan</TableHead>
                <TableHead className={`${HEAD_CLASS} text-right`}>Durasi</TableHead>
                <TableHead className={HEAD_CLASS}>Selesai</TableHead>
                <TableHead className={HEAD_CLASS}>Pesan galat</TableHead>
                <TableHead className={`${HEAD_CLASS} text-right`}>Aksi</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {result.rows.map((row) => (
                <TableRow key={row.id}>
                  <TableCell
                    className={`${CELL_CLASS} whitespace-nowrap font-mono text-sm text-muted-foreground tabular-nums`}
                  >
                    {formatDateTime(row.createdAt)}
                  </TableCell>
                  <TableCell className={CELL_CLASS}>
                    <Link
                      href={`/admin/invoices/${row.invoiceId}`}
                      className="block max-w-56 truncate font-mono text-xs font-medium text-primary underline-offset-4 hover:underline"
                    >
                      {row.invoiceLabel}
                    </Link>
                    <span className="block max-w-56 truncate text-xs text-muted-foreground">
                      {row.organizationName}
                    </span>
                  </TableCell>
                  <TableCell className={CELL_CLASS}>
                    <Badge variant={STATUS_VARIANTS[row.status]}>
                      {PDF_STATUS_LABELS[row.status]}
                    </Badge>
                  </TableCell>
                  <TableCell className={`${CELL_CLASS} text-right font-mono tabular-nums`}>
                    {row.attempt}
                  </TableCell>
                  <TableCell className={`${CELL_CLASS} text-right font-mono tabular-nums`}>
                    {formatDuration(row.durationMs)}
                  </TableCell>
                  <TableCell
                    className={`${CELL_CLASS} whitespace-nowrap font-mono text-sm text-muted-foreground tabular-nums`}
                  >
                    {row.finishedAt ? formatDateTime(row.finishedAt) : "—"}
                  </TableCell>
                  <TableCell className={CELL_CLASS}>
                    {row.errorMessage ? (
                      <span
                        className="line-clamp-2 max-w-72 text-xs text-destructive"
                        title={row.errorMessage}
                      >
                        {row.errorMessage}
                      </span>
                    ) : (
                      <span className="text-sm text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell className={`${CELL_CLASS} text-right`}>
                    {row.status === "FAILED" ? (
                      <RetryPdfJobButton jobId={row.id} />
                    ) : (
                      <span className={cn("text-sm text-muted-foreground")}>—</span>
                    )}
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
