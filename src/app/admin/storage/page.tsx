// src/app/admin/storage/page.tsx
// Feature 09 — storage usage per organization: Σ InvoicePdf + Σ UploadRecord.
// `getStorageUsage` reconciles the uploads folder first (idempotent, insert-
// only), so files that predate UploadRecord are counted too. Cleanup of orphan
// files is deliberately NOT here — it belongs to feature 11 (scope limit).

import type { Metadata } from "next";
import {
  AdminEmptyState,
  adminPageContext,
  formatBytes,
} from "@/app/admin/admin-ui";
import {
  Card,
  CardContent,
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
import { getStorageUsage } from "@/modules/admin/service";

export const metadata: Metadata = {
  title: "Penyimpanan — Panel Admin — invoice-me",
};

export const dynamic = "force-dynamic";

/** Shared table header / cell treatment (matches the invoice list). */
const HEAD_CLASS = "h-10 px-3 text-xs font-medium tracking-wide text-muted-foreground";
const CELL_CLASS = "py-2.5 px-3";

export default async function AdminStoragePage() {
  const ctx = await adminPageContext();
  const usage = await getStorageUsage(ctx);

  const summary = [
    {
      label: "Total terpakai",
      value: formatBytes(usage.totals.totalBytes),
      description: `${usage.totals.totalFiles} file seluruh organisasi`,
    },
    {
      label: "Upload (logo, PO, bukti)",
      value: formatBytes(usage.totals.uploadBytes),
      description: `${usage.totals.uploadFiles} file dari tabel UploadRecord`,
    },
    {
      label: "PDF resmi",
      value: formatBytes(usage.totals.pdfBytes),
      description: `${usage.totals.pdfFiles} file dari tabel InvoicePdf`,
    },
  ];

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-1.5">
        <h1 className="text-2xl font-semibold tracking-tight">Penyimpanan</h1>
        <p className="text-sm text-muted-foreground">
          Pemakaian disk per organisasi (upload + PDF resmi). File yang belum
          tercatat diselaraskan otomatis sebelum dijumlahkan; pembersihan file
          orphan adalah bagian dari fitur maintenance.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        {summary.map((card) => (
          <Card key={card.label} className="ring-border shadow-xs">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                {card.label}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-semibold tracking-tight tabular-nums">
                {card.value}
              </p>
              <CardDescription className="mt-1">{card.description}</CardDescription>
            </CardContent>
          </Card>
        ))}
      </div>

      {usage.rows.length === 0 ? (
        <AdminEmptyState
          title="Belum ada organisasi"
          description="Storage usage muncul setelah ada organisasi di instance ini."
        />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border bg-card shadow-xs">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className={HEAD_CLASS}>Organisasi</TableHead>
                <TableHead className={`${HEAD_CLASS} text-right`}>File upload</TableHead>
                <TableHead className={`${HEAD_CLASS} text-right`}>Ukuran upload</TableHead>
                <TableHead className={`${HEAD_CLASS} text-right`}>File PDF</TableHead>
                <TableHead className={`${HEAD_CLASS} text-right`}>Ukuran PDF</TableHead>
                <TableHead className={`${HEAD_CLASS} text-right`}>Total file</TableHead>
                <TableHead className={`${HEAD_CLASS} text-right`}>Total ukuran</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {usage.rows.map((row) => (
                <TableRow key={row.organizationId}>
                  <TableCell className={`${CELL_CLASS} font-medium`}>
                    <span className="block max-w-56 truncate">{row.organizationName}</span>
                  </TableCell>
                  <TableCell className={`${CELL_CLASS} text-right font-mono tabular-nums`}>
                    {row.uploadFiles}
                  </TableCell>
                  <TableCell className={`${CELL_CLASS} text-right font-mono tabular-nums`}>
                    {formatBytes(row.uploadBytes)}
                  </TableCell>
                  <TableCell className={`${CELL_CLASS} text-right font-mono tabular-nums`}>
                    {row.pdfFiles}
                  </TableCell>
                  <TableCell className={`${CELL_CLASS} text-right font-mono tabular-nums`}>
                    {formatBytes(row.pdfBytes)}
                  </TableCell>
                  <TableCell className={`${CELL_CLASS} text-right font-mono tabular-nums`}>
                    {row.totalFiles}
                  </TableCell>
                  <TableCell
                    className={`${CELL_CLASS} text-right font-mono font-medium tabular-nums`}
                  >
                    {formatBytes(row.totalBytes)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
