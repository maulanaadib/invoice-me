"use client";

// src/components/onboarding/steps/step-08-identity.tsx
// Step 8: invoice profile identity — display name + short code that becomes
// the {CODE} token in the number pattern.

import * as React from "react";
import { useActionState } from "react";
import { saveInvoiceProfileAction } from "@/modules/onboarding/actions";
import type { ActionResult } from "@/lib/api-response";
import type { ProfileView } from "@/modules/profiles/service";
import { bannerError, fieldError } from "@/components/forms/form-utils";
import { useWizard } from "@/components/onboarding/context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function Step8Identity() {
  const { profile, goTo, setProfile } = useWizard();
  const step = 8;

  const [state, formAction, pending] = useActionState<
    ActionResult<{ profile: ProfileView }> | null,
    FormData
  >(
    async (_prev, form) => {
      const result = await saveInvoiceProfileAction(form);
      if (result.ok) {
        setProfile(result.data.profile);
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
        <Label htmlFor="profile-name">Nama profil invoice</Label>
        <Input
          id="profile-name"
          name="name"
          defaultValue={profile?.name ?? ""}
          disabled={pending}
          aria-invalid={Boolean(fieldError(state, "name")) || undefined}
        />
        {fieldError(state, "name") ? (
          <p className="text-sm text-destructive">{fieldError(state, "name")}</p>
        ) : null}
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="profile-code">Kode singkat</Label>
        <Input
          id="profile-code"
          name="code"
          defaultValue={profile?.code ?? ""}
          spellCheck={false}
          autoCapitalize="characters"
          disabled={pending}
          aria-invalid={Boolean(fieldError(state, "code")) || undefined}
        />
        {fieldError(state, "code") ? (
          <p className="text-sm text-destructive">{fieldError(state, "code")}</p>
        ) : null}
        <p className="text-xs text-muted-foreground">
          2–8 karakter huruf/angka, dipakai sebagai token {"{CODE}"} pada nomor invoice (mis.
          SB → INV/SB/…).
        </p>
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
