"use client";

// src/components/signers/set-default-signer-button.tsx
// "Jadikan penanda tangan utama" from the list row (feature 10). One click →
// server action → the service clears the other defaults, flips this row, and
// syncs the profile default the invoice editor prefills from.

import * as React from "react";
import { useRouter } from "next/navigation";
import { StarIcon } from "lucide-react";
import { toast } from "@/components/ui/toast";
import { Button } from "@/components/ui/button";
import { setDefaultSignerAction } from "@/modules/signers/actions";

export interface SetDefaultSignerButtonProps {
  signerId: string;
  signerName: string;
}

export function SetDefaultSignerButton({ signerId, signerName }: SetDefaultSignerButtonProps) {
  const router = useRouter();
  const [pending, setPending] = React.useState(false);

  async function setDefault() {
    setPending(true);
    const form = new FormData();
    form.set("signerId", signerId);
    const result = await setDefaultSignerAction(form);
    setPending(false);
    if (result.ok) {
      toast.add({
        title: "Penanda tangan utama diperbarui",
        description: `${signerName} kini jadi penanda tangan preset invoice.`,
        type: "success",
      });
      router.refresh();
      return;
    }
    toast.add({
      title: "Gagal mengubah penanda tangan utama",
      description: result.error.message,
      type: "error",
    });
  }

  return (
    <Button type="button" variant="outline" size="sm" disabled={pending} onClick={setDefault}>
      <StarIcon aria-hidden="true" />
      {pending ? "Menyimpan..." : "Jadikan utama"}
    </Button>
  );
}
