"use client";

// src/components/customers/delete-customer-button.tsx
// Soft-delete trigger for /customers/[id]: confirm dialog first (ui-context),
// then the server action — the service authorizes (assertCan) and flips
// deletedAt, so the row and its PICs survive for the audit trail.

import * as React from "react";
import { useRouter } from "next/navigation";
import { Trash2Icon } from "lucide-react";
import { toast } from "@/components/ui/toast";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/forms/confirm-dialog";
import { deleteCustomerAction } from "@/modules/customers/actions";

export interface DeleteCustomerButtonProps {
  customerId: string;
  companyName: string;
}

export function DeleteCustomerButton({ customerId, companyName }: DeleteCustomerButtonProps) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [pending, setPending] = React.useState(false);

  async function confirmDelete() {
    setPending(true);
    const result = await deleteCustomerAction({ customerId });
    setPending(false);
    if (result.ok) {
      toast.add({
        title: "Customer dihapus",
        description: `${companyName} diarsipkan (soft delete) — tercatat di audit log.`,
        type: "success",
      });
      setOpen(false);
      router.push("/customers");
      router.refresh();
      return;
    }
    toast.add({
      title: "Gagal menghapus customer",
      description: result.error.message,
      type: "error",
    });
  }

  return (
    <>
      <Button variant="destructive" size="sm" onClick={() => setOpen(true)}>
        <Trash2Icon aria-hidden="true" />
        Hapus customer
      </Button>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title="Hapus customer ini?"
        description={`${companyName} akan diarsipkan (soft delete) dan hilang dari daftar. Data tetap tersimpan untuk jejak audit.`}
        confirmLabel="Hapus (arsipkan)"
        pending={pending}
        onConfirm={confirmDelete}
        trigger={<span className="hidden" aria-hidden="true" />}
      />
    </>
  );
}
