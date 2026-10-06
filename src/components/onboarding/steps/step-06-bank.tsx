"use client";

// src/components/onboarding/steps/step-06-bank.tsx
// Step 6: the single default bank account. The plaintext number travels once
// over the wire, is encrypted server-side (AES-256-GCM), and only ever comes
// back masked — re-saving with an empty number keeps the stored ciphertext.

import * as React from "react";
import { useActionState } from "react";
import { saveBankAccountAction } from "@/modules/onboarding/actions";
import type { ActionResult } from "@/lib/api-response";
import type { BankAccountView } from "@/modules/bank-accounts/service";
import { bannerError, fieldError } from "@/components/forms/form-utils";
import { useWizard } from "@/components/onboarding/context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function Step6Bank() {
  const { bank, goTo, setBank } = useWizard();
  const step = 6;

  const [state, formAction, pending] = useActionState<
    ActionResult<{ bank: BankAccountView }> | null,
    FormData
  >(
    async (_prev, form) => {
      const result = await saveBankAccountAction(form);
      if (result.ok) {
        setBank(result.data.bank);
        goTo(step + 1);
      }
      return result;
    },
    null,
  );

  const banner = bannerError(state);

  return (
    <form action={formAction} className="flex flex-col gap-4" noValidate>
      <input type="hidden" name="step" value={step} />

      {bank ? (
        <div className="rounded-lg border border-border bg-muted/50 p-3 text-sm">
          <p className="font-medium">Rekening tersimpan</p>
          <p className="text-muted-foreground">
            {bank.bankName} a.n. {bank.accountHolder} —{" "}
            <span className="tabular-nums">{bank.maskedNumber}</span> ({bank.currency})
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Nomor disimpan terenkripsi dan tidak dapat dilihat kembali. Kosongkan kolom nomor
            untuk mempertahankan nomor saat ini.
          </p>
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-2">
          <Label htmlFor="bankName">Nama bank</Label>
          <Input
            id="bankName"
            name="bankName"
            placeholder="mis. Bank Central Asia"
            defaultValue={bank?.bankName ?? ""}
            disabled={pending}
            aria-invalid={Boolean(fieldError(state, "bankName")) || undefined}
          />
          {fieldError(state, "bankName") ? (
            <p className="text-sm text-destructive">{fieldError(state, "bankName")}</p>
          ) : null}
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="bankCode">Kode bank (opsional)</Label>
          <Input
            id="bankCode"
            name="bankCode"
            placeholder="mis. BCA"
            defaultValue={bank?.bankCode ?? ""}
            disabled={pending}
            aria-invalid={Boolean(fieldError(state, "bankCode")) || undefined}
          />
          {fieldError(state, "bankCode") ? (
            <p className="text-sm text-destructive">{fieldError(state, "bankCode")}</p>
          ) : null}
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="accountNumber">Nomor rekening</Label>
          <Input
            id="accountNumber"
            name="accountNumber"
            inputMode="numeric"
            autoComplete="off"
            placeholder={bank ? "biarkan kosong untuk mempertahankan" : "mis. 1234567890"}
            defaultValue=""
            disabled={pending}
            aria-invalid={Boolean(fieldError(state, "accountNumber")) || undefined}
          />
          {fieldError(state, "accountNumber") ? (
            <p className="text-sm text-destructive">{fieldError(state, "accountNumber")}</p>
          ) : null}
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="accountHolder">Atas nama</Label>
          <Input
            id="accountHolder"
            name="accountHolder"
            autoComplete="off"
            defaultValue={bank?.accountHolder ?? ""}
            disabled={pending}
            aria-invalid={Boolean(fieldError(state, "accountHolder")) || undefined}
          />
          {fieldError(state, "accountHolder") ? (
            <p className="text-sm text-destructive">{fieldError(state, "accountHolder")}</p>
          ) : null}
        </div>
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="branch">Cabang (opsional)</Label>
        <Input
          id="branch"
          name="branch"
          defaultValue={bank?.branch ?? ""}
          disabled={pending}
          aria-invalid={Boolean(fieldError(state, "branch")) || undefined}
        />
        {fieldError(state, "branch") ? (
          <p className="text-sm text-destructive">{fieldError(state, "branch")}</p>
        ) : null}
      </div>

      {banner ? (
        <p role="alert" className="text-sm text-destructive">
          {banner}
        </p>
      ) : null}

      <Button type="submit" disabled={pending}>
        {pending ? "Menyimpan…" : "Lanjut"}
      </Button>
    </form>
  );
}
