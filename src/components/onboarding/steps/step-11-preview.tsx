"use client";

// src/components/onboarding/steps/step-11-preview.tsx
// Step 11: the sample invoice built from everything entered so far (data
// profile + dummy customer per spec — the full renderer is feature 06).

import * as React from "react";
import { useActionState } from "react";
import { advanceOnboardingStepAction } from "@/modules/onboarding/actions";
import type { ActionResult } from "@/lib/api-response";
import { bannerError } from "@/components/forms/form-utils";
import { useWizard } from "@/components/onboarding/context";
import {
  InvoicePreview,
  previewDataFromProfile,
} from "@/components/invoice/invoice-preview";
import { Button } from "@/components/ui/button";

export function Step11Preview() {
  const { profile, bank, signer, goTo } = useWizard();
  const step = 11;

  const [state, formAction, pending] = useActionState<
    ActionResult<{ step: number }> | null,
    FormData
  >(
    async (_prev, form) => {
      const result = await advanceOnboardingStepAction(form);
      if (result.ok) goTo(step + 1);
      return result;
    },
    null,
  );

  const banner = bannerError(state);

  return (
    <div className="flex flex-col gap-4">
      <InvoicePreview
        data={profile ? previewDataFromProfile(profile) : null}
        bank={bank}
        signer={signer}
      />
      <form action={formAction} className="flex flex-col gap-3" noValidate>
        <input type="hidden" name="step" value={step} />
        {banner ? (
          <p role="alert" className="text-sm text-destructive">
            {banner}
          </p>
        ) : null}
        <Button type="submit" disabled={pending} className="self-end">
          {pending ? "Menyimpan…" : "Lanjut"}
        </Button>
      </form>
    </div>
  );
}
