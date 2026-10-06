"use client";

// src/components/onboarding/steps/step-07-signer.tsx
// Step 7: the default signer. The signature image (optional) goes through the
// same sniffed-MIME + sharp pipeline as the logo; skipping the file keeps any
// signature already stored.

import * as React from "react";
import { useActionState } from "react";
import { saveSignerAction } from "@/modules/onboarding/actions";
import type { ActionResult } from "@/lib/api-response";
import type { SignerView } from "@/modules/signers/service";
import { bannerError, fieldError } from "@/components/forms/form-utils";
import { useWizard } from "@/components/onboarding/context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function Step7Signer() {
  const { signer, maxMb, goTo, setSigner } = useWizard();
  const step = 7;

  const [state, formAction, pending] = useActionState<
    ActionResult<{ signer: SignerView }> | null,
    FormData
  >(
    async (_prev, form) => {
      const result = await saveSignerAction(form);
      if (result.ok) {
        setSigner(result.data.signer);
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

      <div className="flex flex-col gap-2">
        <Label htmlFor="signer-name">Nama penanda tangan</Label>
        <Input
          id="signer-name"
          name="name"
          autoComplete="name"
          defaultValue={signer?.name ?? ""}
          disabled={pending}
          aria-invalid={Boolean(fieldError(state, "name")) || undefined}
        />
        {fieldError(state, "name") ? (
          <p className="text-sm text-destructive">{fieldError(state, "name")}</p>
        ) : null}
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-2">
          <Label htmlFor="signer-title">Jabatan (opsional)</Label>
          <Input
            id="signer-title"
            name="title"
            placeholder="mis. Direktur"
            defaultValue={signer?.title ?? ""}
            disabled={pending}
            aria-invalid={Boolean(fieldError(state, "title")) || undefined}
          />
          {fieldError(state, "title") ? (
            <p className="text-sm text-destructive">{fieldError(state, "title")}</p>
          ) : null}
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="signer-location">Lokasi (opsional)</Label>
          <Input
            id="signer-location"
            name="location"
            placeholder="mis. Jakarta"
            defaultValue={signer?.location ?? ""}
            disabled={pending}
            aria-invalid={Boolean(fieldError(state, "location")) || undefined}
          />
          {fieldError(state, "location") ? (
            <p className="text-sm text-destructive">{fieldError(state, "location")}</p>
          ) : null}
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="signatureFile">Gambar tanda tangan (opsional)</Label>
        <input
          id="signatureFile"
          name="signatureFile"
          type="file"
          accept="image/png,image/jpeg,image/webp"
          disabled={pending}
          className="text-xs file:mr-3 file:rounded-md file:border file:border-border file:bg-background file:px-3 file:py-1.5 file:text-xs file:font-medium hover:file:bg-muted"
        />
        <p className="text-xs text-muted-foreground">
          PNG, JPEG, atau WebP, maksimal {maxMb} MB.
          {signer?.hasSignature ? " Tanda tangan tersimpan — pilih file baru untuk mengganti." : ""}
        </p>
        {fieldError(state, "signatureFile") ? (
          <p className="text-sm text-destructive">{fieldError(state, "signatureFile")}</p>
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
