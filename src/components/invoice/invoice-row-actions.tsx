"use client";

// src/components/invoice/invoice-row-actions.tsx
// Feature 08 row action dropdown: preview, edit, duplicate, issue, download
// PDF, create settlement, mark sent, record payment, cancel, revise, delete.
// Every item is gated by the SERVER-computed `row.permissions` flags (the same
// permission ∧ status guards the services enforce — no fake buttons), and the
// destructive ones (cancel, delete draft) open a confirmation dialog with a
// mandatory reason where the service demands one. Actions reuse the existing
// feature 04/05/06/07 server actions — no new service is created here.

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  BanIcon,
  CopyIcon,
  DownloadIcon,
  EyeIcon,
  FileCheck2Icon,
  MoreHorizontalIcon,
  PencilIcon,
  ReceiptTextIcon,
  SendIcon,
  Trash2Icon,
  WalletIcon,
} from "lucide-react";
import { toast } from "@/components/ui/toast";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { PaymentRecordDialog } from "@/components/payments/payment-record-dialog";
import {
  cancelInvoiceAction,
  createInvoiceDraftAction,
  deleteInvoiceDraftAction,
  getInvoiceDraftAction,
  issueInvoiceAction,
  markSentInvoiceAction,
  reviseInvoiceAction,
} from "@/modules/invoices/actions";
import {
  editorValuesFromDraft,
  toDraftPayload,
} from "@/components/invoice/editor-state";
import type { InvoiceListRow } from "@/modules/invoices/query-service";

type DialogKind = "issue" | "markSent" | "cancel" | "revise" | "delete";

const DIALOG_COPY: Record<
  DialogKind,
  {
    title: string;
    description: string;
    confirmLabel: string;
    pendingLabel: string;
    variant: "default" | "destructive";
    withReason: boolean;
    toastTitle: string;
  }
> = {
  issue: {
    title: "Terbitkan invoice ini?",
    description:
      "Nomor final dialokasikan dan seluruh data keuangan dikunci. Setelah terbit, invoice hanya bisa diubah lewat revisi. PDF resmi masuk antrean pembuatan.",
    confirmLabel: "Terbitkan invoice",
    pendingLabel: "Menerbitkan...",
    variant: "default",
    withReason: false,
    toastTitle: "Invoice diterbitkan",
  },
  markSent: {
    title: "Tandai invoice terkirim?",
    description:
      "Status berubah dari Terbit ke Terkirim. Tindakan ini tercatat di audit log.",
    confirmLabel: "Tandai terkirim",
    pendingLabel: "Menyimpan...",
    variant: "default",
    withReason: false,
    toastTitle: "Invoice ditandai terkirim",
  },
  cancel: {
    title: "Batalkan invoice?",
    description:
      "Invoice tetap tersimpan sebagai riwayat, tidak bisa diedit, dan tidak dihitung sebagai tagihan aktif. Alasan pembatalan wajib diisi.",
    confirmLabel: "Batalkan invoice",
    pendingLabel: "Membatalkan...",
    variant: "destructive",
    withReason: true,
    toastTitle: "Invoice dibatalkan",
  },
  revise: {
    title: "Buat revisi?",
    description:
      "Invoice ini ditandai Diganti (REVISED) dan sebuah salinan draft baru dibuat untuk diedit. Angka dan isi dokumen asli tidak berubah.",
    confirmLabel: "Buat revisi",
    pendingLabel: "Membuat revisi...",
    variant: "default",
    withReason: false,
    toastTitle: "Draft revisi dibuat",
  },
  delete: {
    title: "Hapus draft ini?",
    description:
      "Draft dihapus permanen beserta isinya. Tindakan ini tidak bisa dibatalkan dan tercatat di audit log.",
    confirmLabel: "Hapus draft",
    pendingLabel: "Menghapus...",
    variant: "destructive",
    withReason: false,
    toastTitle: "Draft dihapus",
  },
};

export interface InvoiceRowActionsProps {
  row: InvoiceListRow;
  /** OWNER/ADMIN: an overpayment needs a reason; STAFF confirms instead. */
  canOverrideOverpayment: boolean;
  /** Server-side upload ceiling for the payment proof. */
  uploadMaxMb: number;
}

export function InvoiceRowActions({
  row,
  canOverrideOverpayment,
  uploadMaxMb,
}: InvoiceRowActionsProps) {
  const router = useRouter();
  const permissions = row.permissions;
  const [kind, setKind] = React.useState<DialogKind | null>(null);
  const [reason, setReason] = React.useState("");
  const [reasonError, setReasonError] = React.useState<string | null>(null);
  const [pending, setPending] = React.useState(false);
  const [paying, setPaying] = React.useState(false);

  const anyAction =
    permissions.view ||
    permissions.edit ||
    permissions.issue ||
    permissions.markSent ||
    permissions.cancel ||
    permissions.revise ||
    permissions.remove ||
    permissions.duplicate ||
    permissions.downloadPdf ||
    permissions.recordPayment ||
    permissions.createSettlement;

  if (!anyAction) return null;

  function open(kindToOpen: DialogKind) {
    setReason("");
    setReasonError(null);
    setKind(kindToOpen);
  }

  async function confirm() {
    if (!kind) return;
    if (kind === "cancel" && reason.trim() === "") {
      setReasonError("Alasan pembatalan wajib diisi.");
      return;
    }
    const copy = DIALOG_COPY[kind];
    setPending(true);
    try {
      if (kind === "issue") {
        const result = await issueInvoiceAction({ invoiceId: row.id });
        if (!result.ok) {
          toast.add({
            title: "Gagal menerbitkan invoice",
            description: result.error.message,
            type: "error",
          });
          return;
        }
        toast.add({
          title: copy.toastTitle,
          description: `Nomor ${result.data.number}`,
          type: "success",
        });
        setKind(null);
        router.refresh();
        return;
      }

      if (kind === "markSent") {
        const result = await markSentInvoiceAction({ invoiceId: row.id });
        if (!result.ok) {
          toast.add({
            title: "Gagal menandai terkirim",
            description: result.error.message,
            type: "error",
          });
          return;
        }
        toast.add({ title: copy.toastTitle, type: "success" });
        setKind(null);
        router.refresh();
        return;
      }

      if (kind === "cancel") {
        const result = await cancelInvoiceAction({
          invoiceId: row.id,
          reason: reason.trim(),
        });
        if (!result.ok) {
          toast.add({
            title: "Gagal membatalkan invoice",
            description: result.error.message,
            type: "error",
          });
          return;
        }
        toast.add({ title: copy.toastTitle, type: "success" });
        setKind(null);
        router.refresh();
        return;
      }

      if (kind === "delete") {
        const result = await deleteInvoiceDraftAction({ invoiceId: row.id });
        if (!result.ok) {
          toast.add({
            title: "Gagal menghapus draft",
            description: result.error.message,
            type: "error",
          });
          return;
        }
        toast.add({ title: copy.toastTitle, type: "success" });
        setKind(null);
        router.refresh();
        return;
      }

      const result = await reviseInvoiceAction({ invoiceId: row.id });
      if (!result.ok) {
        toast.add({
          title: "Gagal membuat revisi",
          description: result.error.message,
          type: "error",
        });
        return;
      }
      toast.add({
        title: copy.toastTitle,
        description: "Draft baru siap diedit — invoice asli kini berstatus Direvisi.",
        type: "success",
      });
      setKind(null);
      router.push(`/invoices/${result.data.draftId}`);
      router.refresh();
    } finally {
      setPending(false);
    }
  }

  /** Duplicate = read the draft through the existing service, then create a
   * NEW draft with the same values (feature 04 services, no new one). */
  async function duplicate() {
    setPending(true);
    try {
      const view = await getInvoiceDraftAction({ invoiceId: row.id });
      if (!view.ok) {
        toast.add({
          title: "Gagal menduplikat draft",
          description: view.error.message,
          type: "error",
        });
        return;
      }
      const created = await createInvoiceDraftAction(
        toDraftPayload(editorValuesFromDraft(view.data)),
      );
      if (!created.ok) {
        toast.add({
          title: "Gagal menduplikat draft",
          description: created.error.message,
          type: "error",
        });
        return;
      }
      toast.add({
        title: "Draft diduplikat",
        description: "Salinan baru siap diedit.",
        type: "success",
      });
      router.push(`/invoices/${created.data.id}/edit`);
      router.refresh();
    } finally {
      setPending(false);
    }
  }

  const copy = kind ? DIALOG_COPY[kind] : null;

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          aria-label={`Aksi invoice ${row.label}`}
          className="inline-flex size-8 items-center justify-center rounded-md text-muted-foreground outline-none hover:bg-accent hover:text-accent-foreground focus-visible:ring-2 focus-visible:ring-ring"
        >
          <MoreHorizontalIcon aria-hidden="true" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-56">
          {/* Base UI: a GroupLabel must live inside a Menu.Group — without it
              the popup throws and the row menu would never render. */}
          <DropdownMenuGroup>
            <DropdownMenuLabel className="truncate font-mono">
              {row.label} — {row.customerName}
            </DropdownMenuLabel>
          </DropdownMenuGroup>
          <DropdownMenuSeparator />

          {permissions.view ? (
            <DropdownMenuItem onClick={() => router.push(`/invoices/${row.id}`)}>
              <EyeIcon aria-hidden="true" />
              Preview invoice
            </DropdownMenuItem>
          ) : null}

          {permissions.edit ? (
            <DropdownMenuItem onClick={() => router.push(`/invoices/${row.id}/edit`)}>
              <PencilIcon aria-hidden="true" />
              Edit draft
            </DropdownMenuItem>
          ) : null}

          {permissions.duplicate ? (
            <DropdownMenuItem disabled={pending} onClick={() => void duplicate()}>
              <CopyIcon aria-hidden="true" />
              Duplikat draft
            </DropdownMenuItem>
          ) : null}

          {permissions.issue ? (
            <DropdownMenuItem onClick={() => open("issue")}>
              <FileCheck2Icon aria-hidden="true" />
              Terbitkan
            </DropdownMenuItem>
          ) : null}

          {permissions.createSettlement && row.projectId ? (
            <DropdownMenuItem
              onClick={() =>
                router.push(
                  `/invoices/new?project=${row.projectId}&type=SETTLEMENT`,
                )
              }
            >
              <ReceiptTextIcon aria-hidden="true" />
              Buat settlement
            </DropdownMenuItem>
          ) : null}

          {permissions.markSent ? (
            <DropdownMenuItem onClick={() => open("markSent")}>
              <SendIcon aria-hidden="true" />
              Tandai terkirim
            </DropdownMenuItem>
          ) : null}

          {permissions.recordPayment && row.payment ? (
            <DropdownMenuItem onClick={() => setPaying(true)}>
              <WalletIcon aria-hidden="true" />
              Catat pembayaran
            </DropdownMenuItem>
          ) : null}

          {permissions.downloadPdf ? (
            <DropdownMenuItem
              render={
                <a href={`/api/invoices/${row.id}/pdf`} download />
              }
            >
              <DownloadIcon aria-hidden="true" />
              Unduh PDF
            </DropdownMenuItem>
          ) : null}

          {permissions.revise ? (
            <DropdownMenuItem onClick={() => open("revise")}>
              <CopyIcon aria-hidden="true" />
              Buat revisi
            </DropdownMenuItem>
          ) : null}

          {permissions.cancel ? (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                variant="destructive"
                onClick={() => open("cancel")}
              >
                <BanIcon aria-hidden="true" />
                Batalkan invoice
              </DropdownMenuItem>
            </>
          ) : null}

          {permissions.remove ? (
            <DropdownMenuItem
              variant="destructive"
              onClick={() => open("delete")}
            >
              <Trash2Icon aria-hidden="true" />
              Hapus draft
            </DropdownMenuItem>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>

      {copy ? (
        <Dialog
          open={kind !== null}
          onOpenChange={(next) => {
            if (!next && !pending) setKind(null);
          }}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{copy.title}</DialogTitle>
              <DialogDescription>{copy.description}</DialogDescription>
            </DialogHeader>

            {copy.withReason ? (
              <div className="flex flex-col gap-2">
                <Label htmlFor={`row-cancel-${row.id}`}>Alasan pembatalan</Label>
                <Textarea
                  id={`row-cancel-${row.id}`}
                  value={reason}
                  maxLength={500}
                  placeholder="Contoh: PO dibatalkan oleh customer."
                  aria-invalid={reasonError ? true : undefined}
                  aria-describedby={reasonError ? `row-cancel-${row.id}-error` : undefined}
                  onChange={(event) => {
                    setReason(event.target.value);
                    if (reasonError) setReasonError(null);
                  }}
                />
                {reasonError ? (
                  <p
                    id={`row-cancel-${row.id}-error`}
                    className="text-sm text-destructive"
                  >
                    {reasonError}
                  </p>
                ) : null}
              </div>
            ) : (
              <p className="font-mono text-sm text-muted-foreground">{row.label}</p>
            )}

            <DialogFooter>
              <DialogClose render={<Button type="button" variant="outline" disabled={pending} />}>
                Batal
              </DialogClose>
              <Button
                type="button"
                variant={copy.variant}
                disabled={pending}
                onClick={() => void confirm()}
              >
                {pending ? copy.pendingLabel : copy.confirmLabel}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : null}

      {row.payment ? (
        <PaymentRecordDialog
          invoices={[row.payment]}
          fixedInvoiceId={row.payment.id}
          canOverrideOverpayment={canOverrideOverpayment}
          maxUploadMb={uploadMaxMb}
          open={paying}
          onOpenChange={setPaying}
          hideTrigger
        />
      ) : null}
    </>
  );
}
