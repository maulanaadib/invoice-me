"use client";

// src/components/bank-accounts/delete-bank-account-button.tsx
// Hard delete with a confirmation dialog first (ui-context: aksi destruktif
// selalu konfirmasi). The service authorizes (assertCan bankAccount.delete),
// the row goes, and the schema's SetNull FKs clear invoice/profile links —
// issued documents keep their frozen snapshot.

import * as React from "react";
import { useRouter } from "next/navigation";
import { Trash2Icon } from "lucide-react";
import { toast } from "@/components/ui/toast";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/forms/confirm-dialog";
import { deleteBankAccountAction } from "@/modules/bank-accounts/actions";

export interface DeleteBankAccountButtonProps {
  bankAccountId: string;
  bankName: string;
}

export function DeleteBankAccountButton({ bankAccountId, bankName }: DeleteBankAccountButtonProps) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [pending, setPending] = React.useState(false);

  async function confirmDelete() {
    setPending(true);
    const form = new FormData();
    form.set("bankAccountId", bankAccountId);
    const result = await deleteBankAccountAction(form);
    setPending(false);
    if (result.ok) {
      toast.add({
        title: "Rekening dihapus",
        description: `${bankName} dihapus permanen — tercatat di audit log.`,
        type: "success",
      });
      setOpen(false);
      router.push("/bank-accounts");
      router.refresh();
      return;
    }
    toast.add({ title: "Gagal menghapus rekening", description: result.error.message, type: "error" });
  }

  return (
    <>
      <Button variant="destructive" size="sm" onClick={() => setOpen(true)}>
        <Trash2Icon aria-hidden="true" />
        Hapus rekening
      </Button>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title="Hapus rekening ini?"
        description={`${bankName} dihapus permanen. Invoice yang sudah terbit tetap memakai data snapshot-nya; profil kehilangan rekening utama bila ini rekening utama.`}
        confirmLabel="Hapus rekening"
        pending={pending}
        onConfirm={confirmDelete}
        trigger={<span className="hidden" aria-hidden="true" />}
      />
    </>
  );
}
