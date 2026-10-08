// src/app/admin/invoices/[id]/page.tsx
// Feature 09 — cross-org invoice detail for support. Reading it runs
// `adminViewInvoice`, which writes ADMIN_VIEWED_INVOICE BEFORE returning the
// data (spec: every sensitive view is recorded). Downloading uses the admin
// route, which writes PDF_DOWNLOADED with admin metadata.

import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { headers } from "next/headers";
import { ArrowLeftIcon, DownloadIcon } from "lucide-react";
import { adminPageContext, formatDateTime, formatDate } from "@/app/admin/admin-ui";
import { INVOICE_STATUS_LABELS, InvoiceStatusBadge } from "@/components/invoice/invoice-status-badge";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
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
import { isAppError } from "@/lib/errors";
import { formatIdr } from "@/lib/money";
import {
  BILLING_MODE_LABELS,
  INVOICE_TYPE_LABELS,
  INVOICE_TAX_MODE_LABELS,
} from "@/modules/invoices/schema";
import { adminViewInvoice, type AdminInvoiceDetail } from "@/modules/admin/service";

export const metadata: Metadata = {
  title: "Detail Invoice — Panel Admin — invoice-me",
};

export const dynamic = "force-dynamic";

function MoneyRow({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd
        className={
          strong
            ? "font-semibold tabular-nums text-base"
            : "font-medium tabular-nums text-sm"
        }
      >
        {formatIdr(value)}
      </dd>
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="truncate text-right text-sm font-medium">{value}</dd>
    </div>
  );
}

export default async function AdminInvoiceDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const ctx = await adminPageContext();
  const { id } = await params;
  const request = new Request("http://admin.local", { headers: await headers() });

  let detail: AdminInvoiceDetail;
  try {
    detail = await adminViewInvoice(ctx, id, request);
  } catch (error) {
    if (isAppError(error) && error.code === "NOT_FOUND") notFound();
    throw error;
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3">
        <Link
          href="/admin/invoices"
          className={buttonVariants({ variant: "ghost", size: "sm" })}
        >
          <ArrowLeftIcon aria-hidden="true" />
          Kembali ke monitoring invoice
        </Link>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="font-mono text-xl font-semibold tracking-tight">
            {detail.number ?? detail.numberPreview ?? "(tanpa nomor)"}
          </h1>
          <InvoiceStatusBadge status={detail.status} />
          <Badge variant="outline">{INVOICE_TYPE_LABELS[detail.invoiceType]}</Badge>
          <Badge variant="secondary">{detail.organizationName}</Badge>
          {detail.status !== detail.storedStatus ? (
            <span className="text-xs text-muted-foreground">
              Tersimpan: {INVOICE_STATUS_LABELS[detail.storedStatus]} (status efektif
              dihitung saat dibaca)
            </span>
          ) : null}
        </div>
        <p className="text-sm text-muted-foreground">
          {detail.customerName} · profil {detail.profileName} · mata uang{" "}
          {detail.currency}
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        {detail.pdfReady ? (
          <a
            href={`/api/admin/invoices/${detail.id}/pdf`}
            className={buttonVariants({ variant: "default", size: "sm" })}
          >
            <DownloadIcon aria-hidden="true" />
            Unduh PDF resmi
          </a>
        ) : (
          <span className="text-sm text-muted-foreground">
            PDF resmi belum tersedia untuk invoice ini.
          </span>
        )}
        {detail.replacedById ? (
          <Link
            href={`/admin/invoices/${detail.replacedById}`}
            className={buttonVariants({ variant: "outline", size: "sm" })}
          >
            Lihat invoice pengganti
          </Link>
        ) : null}
        {detail.revisedFromId ? (
          <Link
            href={`/admin/invoices/${detail.revisedFromId}`}
            className={buttonVariants({ variant: "outline", size: "sm" })}
          >
            Lihat invoice asal
          </Link>
        ) : null}
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Informasi dokumen</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            <InfoRow label="Tanggal invoice" value={formatDate(detail.invoiceDate)} />
            <InfoRow
              label="Jatuh tempo"
              value={detail.dueDate ? formatDate(detail.dueDate) : "—"}
            />
            <InfoRow
              label="Referensi"
              value={
                detail.referenceNumber
                  ? `${detail.referenceType ?? ""} ${detail.referenceNumber}`.trim()
                  : "—"
              }
            />
            <InfoRow
              label="Termin pembayaran"
              value={detail.paymentTerms || "—"}
            />
            <InfoRow
              label="Mode penagihan"
              value={BILLING_MODE_LABELS[detail.billingMode]}
            />
            <InfoRow
              label="Pajak"
              value={
                detail.taxMode === "NONE"
                  ? INVOICE_TAX_MODE_LABELS[detail.taxMode]
                  : `${INVOICE_TAX_MODE_LABELS[detail.taxMode]}${
                      detail.taxPercent ? ` — ${Number(detail.taxPercent)}%` : ""
                    }`
              }
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Riwayat dokumen</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            <InfoRow label="Dibuat oleh" value={detail.createdByName} />
            <InfoRow
              label="Diterbitkan oleh"
              value={detail.issuedByName ?? "—"}
            />
            <InfoRow
              label="Diterbitkan"
              value={detail.issuedAt ? formatDateTime(detail.issuedAt) : "—"}
            />
            <InfoRow
              label="Dibatalkan"
              value={detail.cancelledAt ? formatDateTime(detail.cancelledAt) : "—"}
            />
            <InfoRow label="Alasan pembatalan" value={detail.cancellationReason || "—"} />
            <InfoRow
              label="Pembayaran"
              value={`${detail.paymentCount} catatan · ${formatIdr(detail.paymentTotal)}`}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Nilai</CardTitle>
            <CardDescription>Dibaca langsung dari baris invoice.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            <MoneyRow label="Nilai pekerjaan" value={detail.workValue} />
            <MoneyRow label="Subtotal item" value={detail.itemsSubtotal} />
            <MoneyRow label="Sudah ditagihkan sebelumnya" value={detail.previouslyBilled} />
            <MoneyRow label="Diskon" value={detail.discountAmount} />
            <MoneyRow label="Tambahan" value={detail.additionalAmount} />
            <MoneyRow label="Pajak" value={detail.taxAmount} />
            <MoneyRow label="Pembulatan" value={detail.roundingAmount} />
            <MoneyRow label="Grand total" value={detail.grandTotal} strong />
            <MoneyRow label="Sudah dibayar" value={detail.amountPaid} />
            <MoneyRow label="Sisa tagihan" value={detail.remainingAfter} />
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Item pekerjaan</CardTitle>
          <CardDescription>{detail.items.length} baris</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto rounded-lg border border-border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10">No</TableHead>
                  <TableHead>Deskripsi</TableHead>
                  <TableHead className="text-right">Qty</TableHead>
                  <TableHead>Unit</TableHead>
                  <TableHead className="text-right">Harga satuan</TableHead>
                  <TableHead className="text-right">Diskon</TableHead>
                  <TableHead className="text-right">Jumlah</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {detail.items.map((item, index) => (
                  <TableRow key={item.id}>
                    <TableCell className="text-muted-foreground">{index + 1}</TableCell>
                    <TableCell>
                      <span className="block max-w-96 whitespace-pre-wrap text-sm">
                        {item.description}
                      </span>
                      {item.details ? (
                        <span className="block max-w-96 text-xs text-muted-foreground">
                          {item.details}
                        </span>
                      ) : null}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {Number(item.quantity).toLocaleString("id-ID")}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {item.unit}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatIdr(item.unitPrice)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatIdr(item.discountAmount)}
                    </TableCell>
                    <TableCell className="text-right font-medium tabular-nums">
                      {formatIdr(item.lineAmount)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <p className="text-xs text-muted-foreground">
        Membuka halaman ini tercatat sebagai <strong>ADMIN_VIEWED_INVOICE</strong> di
        log audit dengan actor Anda.
      </p>
    </div>
  );
}
