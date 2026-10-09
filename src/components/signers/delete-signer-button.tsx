"use client";

// src/components/signers/delete-signer-button.tsx
// Hard delete with a confirmation dialog first (ui-context: aksi destruktif
// selalu konfirmasi). The service authorizes (assertCan signer.delete), the row
// goes, the stored image is removed best-effort, and issued documents keep
// their frozen signerSnapshot.

import * as React from "react";
import { useRouter } from "next/navigation";
import { Trash2Icon } from "lucide-react";
import { toast } from "@/components/ui/toast";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/forms/confirm-dialog";
import { deleteSignerAction } from "@/modules/signers/actions";

export interface DeleteSignerButtonProps {
  signerId: string;
  signerName: string;
}

export function DeleteSignerButton({ signerId, signerName }: DeleteSignerButtonProps) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [pending, setPending] = React.useState(false);

  async function confirmDelete() {
    setPending(true);
    const form = new FormData();
    form.set("signerId", signerId);
    const result = await deleteSignerAction(form);
    setPending(false);
    if (result.ok) {
      toast.add({
        title: "Penanda tangan dihapus",
        description: `${signerName} dihapus permanen — tercatat di audit log.`,
        type: "success",
      });
      setOpen(false);
      router.push("/signers");
      router.refresh();
      return;
    }
    toast.add({
      title: "Gagal menghapus penanda tangan",
      description: result.error.message,
      type: "error",
    });
  }

  return (
    <>
      <Button variant="destructive" size="sm" onClick={() => setOpen(true)}>
        <Trash2Icon aria-hidden="true" />
        Hapus penanda tangan
      </Button>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title="Hapus penanda tangan ini?"
        description={`${signerName} dihapus permanen beserta gambar tanda tangannya. Invoice yang sudah terbit tetap memakai data snapshot-nya.`}
        confirmLabel="Hapus penanda tangan"
        pending={pending}
        onConfirm={confirmDelete}
        trigger={<span className="hidden" aria-hidden="true" />}
      />
    </>
  );
}
