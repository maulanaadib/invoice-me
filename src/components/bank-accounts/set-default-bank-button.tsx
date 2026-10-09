"use client";

// src/components/bank-accounts/set-default-bank-button.tsx
// "Jadikan rekening utama" from the list row (feature 10). One click → server
// action → the service clears the other defaults, flips this row, and syncs the
// profile default the invoice editor prefills from. Idempotent server-side.

import * as React from "react";
import { useRouter } from "next/navigation";
import { StarIcon } from "lucide-react";
import { toast } from "@/components/ui/toast";
import { Button } from "@/components/ui/button";
import { setDefaultBankAccountAction } from "@/modules/bank-accounts/actions";

export interface SetDefaultBankButtonProps {
  bankAccountId: string;
  bankName: string;
}

export function SetDefaultBankButton({ bankAccountId, bankName }: SetDefaultBankButtonProps) {
  const router = useRouter();
  const [pending, setPending] = React.useState(false);

  async function setDefault() {
    setPending(true);
    const form = new FormData();
    form.set("bankAccountId", bankAccountId);
    const result = await setDefaultBankAccountAction(form);
    setPending(false);
    if (result.ok) {
      toast.add({
        title: "Rekening utama diperbarui",
        description: `${bankName} kini jadi rekening preset invoice.`,
        type: "success",
      });
      router.refresh();
      return;
    }
    toast.add({ title: "Gagal mengubah rekening utama", description: result.error.message, type: "error" });
  }

  return (
    <Button type="button" variant="outline" size="sm" disabled={pending} onClick={setDefault}>
      <StarIcon aria-hidden="true" />
      {pending ? "Menyimpan..." : "Jadikan utama"}
    </Button>
  );
}
