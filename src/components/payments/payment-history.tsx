"use client";

// src/components/payments/payment-history.tsx
// "Riwayat pembayaran" card on /invoices/[id] (feature 07): the payment rows
// (tanggal, nominal, metode, referensi, bukti, recorded by, catatan), the live
// Sudah dibayar / Sisa tagihan summary, the Record Payment dialog (STAFF+) and
// the per-row reversal (OWNER/ADMIN) behind a confirmation dialog. Nothing is
// rendered where the service would reject the action (no fake buttons).

import * as React from "react";
import { useRouter } from "next/navigation";
import { FileTextIcon, Trash2Icon } from "lucide-react";
import { toast } from "@/components/ui/toast";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ConfirmDialog } from "@/components/forms/confirm-dialog";
import { formatIdr } from "@/lib/money";
import { deletePaymentAction } from "@/modules/payments/actions";
import type { InvoicePaymentPanel, PayableInvoiceOption } from "@/modules/payments/service";
import { PAYMENT_METHOD_LABELS } from "@/modules/payments/schema";
import { PaymentRecordDialog } from "@/components/payments/payment-record-dialog";

function formatDate(value: string): string {
  const [year, month, day] = value.split("-");
  return year && month && day ? `${day}/${month}/${year}` : value;
}

function formatTimestamp(value: string): string {
  return new Date(value).toLocaleString("id-ID", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Jakarta",
  });
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-1 border-b border-border py-3 last:border-b-0 sm:flex-row sm:items-baseline sm:justify-between sm:gap-4">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="font-mono text-sm font-medium sm:text-right">{formatIdr(value)}</dd>
    </div>
  );
}

export interface PaymentHistoryProps {
  panel: InvoicePaymentPanel;
  /** Server-side proof size ceiling (env.UPLOAD_MAX_MB), mirrored client-side. */
  maxUploadMb: number;
}

export function PaymentHistory({ panel, maxUploadMb }: PaymentHistoryProps) {
  const router = useRouter();
  const [reversingId, setReversingId] = React.useState<string | null>(null);
  const [pending, setPending] = React.useState(false);

  const target: PayableInvoiceOption = {
    id: panel.invoiceId,
    label: panel.invoiceLabel,
    customerName: panel.customerName,
    status: panel.status,
    grandTotal: panel.grandTotal,
    amountPaid: panel.amountPaid,
    remaining: panel.remainingAfter,
  };

  async function confirmReverse() {
    if (!reversingId) return;
    setPending(true);
    try {
      const result = await deletePaymentAction({ paymentId: reversingId });
      if (!result.ok) {
        toast.add({ title: "Gagal menghapus pembayaran", description: result.error.message, type: "error" });
        return;
      }
      toast.add({
        title: "Pembayaran dihapus",
        description: `Status invoice kini ${result.data.status} — sisa ${formatIdr(result.data.remainingAfter)}.`,
        type: "success",
      });
      setReversingId(null);
      router.refresh();
    } finally {
      setPending(false);
    }
  }

  const reversingRow = panel.rows.find((row) => row.id === reversingId) ?? null;

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex flex-col gap-1">
            <CardTitle>Riwayat pembayaran</CardTitle>
            <CardDescription>
              {panel.rows.length > 0
                ? `${panel.rows.length} pembayaran tercatat — status invoice diperbarui otomatis.`
                : "Belum ada pembayaran tercatat untuk invoice ini."}
            </CardDescription>
          </div>
          {panel.permissions.record ? (
            <PaymentRecordDialog
              invoices={[target]}
              fixedInvoiceId={panel.invoiceId}
              canOverrideOverpayment={panel.permissions.override}
              maxUploadMb={maxUploadMb}
            />
          ) : null}
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <dl className="border-t border-border sm:grid sm:grid-cols-2 sm:gap-x-8">
          <SummaryRow label="Sudah dibayar" value={panel.amountPaid} />
          <SummaryRow label="Sisa tagihan" value={panel.remainingAfter} />
        </dl>

        {panel.rows.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border px-6 py-10 text-center text-sm text-muted-foreground">
            {panel.permissions.record
              ? "Belum ada pembayaran. Catat pembayaran pertama lewat tombol “Catat pembayaran”."
              : "Belum ada pembayaran tercatat untuk invoice ini."}
          </div>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Tanggal</TableHead>
                  <TableHead className="text-right">Nominal</TableHead>
                  <TableHead>Metode</TableHead>
                  <TableHead>Referensi</TableHead>
                  <TableHead>Bukti</TableHead>
                  <TableHead>Dicatat oleh</TableHead>
                  <TableHead>Catatan</TableHead>
                  {panel.permissions.reverse ? <TableHead className="text-right">Aksi</TableHead> : null}
                </TableRow>
              </TableHeader>
              <TableBody>
                {panel.rows.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="whitespace-nowrap text-sm">
                      {formatDate(row.paymentDate)}
                    </TableCell>
                    <TableCell className="text-right font-mono font-medium">
                      {formatIdr(row.amount)}
                      {row.overpaymentReason ? (
                        <span className="block text-xs font-normal text-warning">
                          Melebihi sisa
                        </span>
                      ) : null}
                    </TableCell>
                    <TableCell className="text-sm">{PAYMENT_METHOD_LABELS[row.method]}</TableCell>
                    <TableCell className="font-mono text-sm">
                      {row.referenceNumber ?? "—"}
                    </TableCell>
                    <TableCell>
                      {row.proofPath ? (
                        <a
                          href={`/api/storage/${row.proofPath}`}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1 text-sm hover:underline"
                        >
                          <FileTextIcon aria-hidden="true" className="size-4" />
                          Lihat bukti
                        </a>
                      ) : (
                        <span className="text-sm text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-sm">
                      {row.recordedByName}
                      <span className="block text-xs text-muted-foreground">
                        {formatTimestamp(row.createdAt)}
                      </span>
                    </TableCell>
                    <TableCell className="max-w-56 text-sm">
                      {row.notes ?? "—"}
                      {row.overpaymentReason ? (
                        <span className="block text-xs text-muted-foreground">
                          Alasan override: {row.overpaymentReason}
                        </span>
                      ) : null}
                    </TableCell>
                    {panel.permissions.reverse ? (
                      <TableCell className="text-right">
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => setReversingId(row.id)}
                          aria-label={`Hapus pembayaran ${formatDate(row.paymentDate)}`}
                        >
                          <Trash2Icon aria-hidden="true" />
                          Hapus
                        </Button>
                      </TableCell>
                    ) : null}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}

        {panel.truncated ? (
          <p className="text-xs text-muted-foreground">
            Menampilkan {panel.rows.length} pembayaran terbaru — ringkasan di atas tetap
            menghitung seluruh pembayaran.
          </p>
        ) : null}
        {panel.rows.some((row) => row.overpaymentReason) ? (
          <p className="flex items-center gap-2 text-xs text-muted-foreground">
            <Badge variant="outline">Melebihi sisa</Badge>
            Pembayaran berlabel tersebut dicatat di atas sisa tagihan — alasannya tercantum di
            barisnya.
          </p>
        ) : null}

        <ConfirmDialog
          open={reversingId !== null}
          onOpenChange={(next) => {
            if (!next && !pending) setReversingId(null);
          }}
          title="Hapus pembayaran ini?"
          description={
            reversingRow
              ? `Pembayaran ${formatIdr(reversingRow.amount)} pada ${formatDate(reversingRow.paymentDate)} akan dihapus dan perhitungan invoice dihitung ulang. Tindakan ini tercatat di audit log.`
              : "Pembayaran akan dihapus dan perhitungan invoice dihitung ulang."
          }
          confirmLabel="Hapus pembayaran"
          pending={pending}
          onConfirm={() => void confirmReverse()}
          trigger={<span className="hidden" aria-hidden="true" />}
        />
      </CardContent>
    </Card>
  );
}
