"use client";

// src/components/onboarding/steps/step-02-company.tsx
// Step 2: legal identity written to InvoiceProfile (create-or-update by org).

import * as React from "react";
import { useActionState } from "react";
import { saveCompanyProfileAction } from "@/modules/onboarding/actions";
import type { ActionResult } from "@/lib/api-response";
import type { ProfileView } from "@/modules/profiles/service";
import { bannerError, fieldError } from "@/components/forms/form-utils";
import { useWizard } from "@/components/onboarding/context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

export function Step2Company() {
  const { profile, goTo, setProfile } = useWizard();
  const step = 2;

  const [state, formAction, pending] = useActionState<
    ActionResult<{ profile: ProfileView }> | null,
    FormData
  >(
    async (_prev, form) => {
      const result = await saveCompanyProfileAction(form);
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
        <Label htmlFor="legalName">Nama legal (opsional)</Label>
        <Input
          id="legalName"
          name="legalName"
          defaultValue={profile?.legalName ?? ""}
          autoComplete="organization"
          disabled={pending}
          aria-invalid={Boolean(fieldError(state, "legalName")) || undefined}
        />
        {fieldError(state, "legalName") ? (
          <p className="text-sm text-destructive">{fieldError(state, "legalName")}</p>
        ) : null}
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="address">Alamat (opsional)</Label>
        <Textarea
          id="address"
          name="address"
          defaultValue={profile?.address ?? ""}
          rows={3}
          disabled={pending}
          aria-invalid={Boolean(fieldError(state, "address")) || undefined}
        />
        {fieldError(state, "address") ? (
          <p className="text-sm text-destructive">{fieldError(state, "address")}</p>
        ) : null}
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="taxId">NPWP (opsional)</Label>
        <Input
          id="taxId"
          name="taxId"
          defaultValue={profile?.taxId ?? ""}
          autoComplete="off"
          disabled={pending}
          aria-invalid={Boolean(fieldError(state, "taxId")) || undefined}
        />
        {fieldError(state, "taxId") ? (
          <p className="text-sm text-destructive">{fieldError(state, "taxId")}</p>
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
