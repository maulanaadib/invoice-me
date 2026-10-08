"use client";

// src/components/invoice/invoice-lifecycle-actions.tsx
// Issue / Mark sent / Cancel / Revise for /invoices/[id]. Every button the
// caller does NOT have permission for is never rendered (no fake buttons),
// and every destructive or irreversible action opens a confirmation dialog
// (ui-context). Cancel carries a MANDATORY reason — validated here AND on the
// server (feature 05 spec).

import * as React from "react";
import { useRouter } from "next/navigation";
import { BanIcon, CopyIcon, FileCheck2Icon, SendIcon } from "lucide-react";
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
  cancelInvoiceAction,
  issueInvoiceAction,
  markSentInvoiceAction,
  reviseInvoiceAction,
} from "@/modules/invoices/actions";
import type { InvoiceDetailPermissions } from "@/modules/invoices/detail-service";

type ActionKind = "issue" | "markSent" | "cancel" | "revise";

const DIALOG_COPY: Record<
  ActionKind,
  {
    title: string;
    description: string;
    confirmLabel: string;
    pendingLabel: string;
    variant: "default" | "destructive";
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
    toastTitle: "Invoice diterbitkan",
  },
  markSent: {
    title: "Tandai invoice terkirim?",
    description:
      "Status berubah dari Terbit ke Terkirim. Tindakan ini tercatat di audit log.",
    confirmLabel: "Tandai terkirim",
    pendingLabel: "Menyimpan...",
    variant: "default",
    toastTitle: "Invoice ditandai terkirim",
  },
  cancel: {
    title: "Batalkan invoice?",
    description:
      "Invoice tetap tersimpan sebagai riwayat, tidak bisa diedit, dan tidak dihitung sebagai tagihan aktif. Alasan pembatalan wajib diisi.",
    confirmLabel: "Batalkan invoice",
    pendingLabel: "Membatalkan...",
    variant: "destructive",
    toastTitle: "Invoice dibatalkan",
  },
  revise: {
    title: "Buat revisi?",
    description:
      "Invoice ini ditandai Diganti (REVISED) dan sebuah salinan draft baru dibuat untuk diedit. Angka dan isi dokumen asli tidak berubah.",
    confirmLabel: "Buat revisi",
    pendingLabel: "Membuat revisi...",
    variant: "default",
    toastTitle: "Draft revisi dibuat",
  },
};

export interface InvoiceLifecycleActionsProps {
  invoiceId: string;
  /** Number (issued) or preview (draft) — used in confirmation copy. */
  invoiceLabel: string;
  permissions: InvoiceDetailPermissions;
}

export function InvoiceLifecycleActions({
  invoiceId,
  invoiceLabel,
  permissions,
}: InvoiceLifecycleActionsProps) {
  const router = useRouter();
  const [active, setActive] = React.useState<ActionKind | null>(null);
  const [pending, setPending] = React.useState(false);
  const [reason, setReason] = React.useState("");
  const [reasonError, setReasonError] = React.useState<string | null>(null);

  function open(kind: ActionKind) {
    setReason("");
    setReasonError(null);
    setActive(kind);
  }

  async function confirm() {
    if (!active) return;
    if (active === "cancel" && reason.trim() === "") {
      setReasonError("Alasan pembatalan wajib diisi.");
      return;
    }
    const copy = DIALOG_COPY[active];
    setPending(true);
    try {
      if (active === "issue") {
        const result = await issueInvoiceAction({ invoiceId });
        if (!result.ok) {
          toast.add({ title: "Gagal menerbitkan invoice", description: result.error.message, type: "error" });
          return;
        }
        toast.add({
          title: copy.toastTitle,
          description: `Nomor ${result.data.number}`,
          type: "success",
        });
        setActive(null);
        router.refresh();
        return;
      }

      if (active === "markSent") {
        const result = await markSentInvoiceAction({ invoiceId });
        if (!result.ok) {
          toast.add({ title: "Gagal menandai terkirim", description: result.error.message, type: "error" });
          return;
        }
        toast.add({ title: copy.toastTitle, type: "success" });
        setActive(null);
        router.refresh();
        return;
      }

      if (active === "cancel") {
        const result = await cancelInvoiceAction({ invoiceId, reason: reason.trim() });
        if (!result.ok) {
          toast.add({ title: "Gagal membatalkan invoice", description: result.error.message, type: "error" });
          return;
        }
        toast.add({ title: copy.toastTitle, description: result.data.cancellationReason, type: "success" });
        setActive(null);
        router.refresh();
        return;
      }

      const result = await reviseInvoiceAction({ invoiceId });
      if (!result.ok) {
        toast.add({ title: "Gagal membuat revisi", description: result.error.message, type: "error" });
        return;
      }
      toast.add({
        title: copy.toastTitle,
        description: "Draft baru siap diedit — invoice asli kini berstatus Direvisi.",
        type: "success",
      });
      setActive(null);
      router.push(`/invoices/${result.data.draftId}`);
      router.refresh();
    } finally {
      setPending(false);
    }
  }

  if (!permissions.issue && !permissions.markSent && !permissions.cancel && !permissions.revise) {
    return null;
  }

  const copy = active ? DIALOG_COPY[active] : null;

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        {permissions.issue ? (
          <Button type="button" onClick={() => open("issue")}>
            <FileCheck2Icon aria-hidden="true" />
            Terbitkan invoice
          </Button>
        ) : null}
        {permissions.markSent ? (
          <Button type="button" onClick={() => open("markSent")}>
            <SendIcon aria-hidden="true" />
            Tandai terkirim
          </Button>
        ) : null}
        {permissions.revise ? (
          <Button type="button" variant="outline" onClick={() => open("revise")}>
            <CopyIcon aria-hidden="true" />
            Buat revisi
          </Button>
        ) : null}
        {permissions.cancel ? (
          <Button type="button" variant="destructive" onClick={() => open("cancel")}>
            <BanIcon aria-hidden="true" />
            Batalkan
          </Button>
        ) : null}
      </div>

      {copy ? (
        <Dialog
          open={active !== null}
          onOpenChange={(openState) => {
            if (!openState && !pending) setActive(null);
          }}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{copy.title}</DialogTitle>
              <DialogDescription>{copy.description}</DialogDescription>
            </DialogHeader>

            {active === "issue" || active === "revise" ? (
              <p className="font-mono text-sm text-muted-foreground">{invoiceLabel}</p>
            ) : null}

            {active === "cancel" ? (
              <div className="flex flex-col gap-2">
                <Label htmlFor="cancel-reason">Alasan pembatalan</Label>
                <Textarea
                  id="cancel-reason"
                  value={reason}
                  maxLength={500}
                  placeholder="Contoh: PO dibatalkan oleh customer."
                  aria-invalid={reasonError ? true : undefined}
                  aria-describedby={reasonError ? "cancel-reason-error" : undefined}
                  onChange={(event) => {
                    setReason(event.target.value);
                    if (reasonError) setReasonError(null);
                  }}
                />
                {reasonError ? (
                  <p id="cancel-reason-error" className="text-sm text-destructive">
                    {reasonError}
                  </p>
                ) : null}
              </div>
            ) : null}

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
    </>
  );
}
