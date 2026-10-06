"use client";

// src/components/onboarding/steps/step-03-logo.tsx
// Step 3: optional logo upload (validated + stored by the server pipeline),
// then advance. Skipping without a logo is a legitimate path.

import * as React from "react";
import { useActionState } from "react";
import { advanceOnboardingStepAction } from "@/modules/onboarding/actions";
import type { ActionResult } from "@/lib/api-response";
import { bannerError } from "@/components/forms/form-utils";
import { useWizard } from "@/components/onboarding/context";
import { LogoUploader } from "@/components/onboarding/logo-uploader";
import { Button } from "@/components/ui/button";

export function Step3Logo() {
  const { profile, maxMb, goTo, setProfile } = useWizard();
  const step = 3;

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
      <LogoUploader
        profileId={profile?.id ?? null}
        logoPath={profile?.logoPath ?? null}
        maxMb={maxMb}
        onProfileUpdated={setProfile}
      />

      <form action={formAction} className="flex flex-col gap-3" noValidate>
        <input type="hidden" name="step" value={step} />
        {banner ? (
          <p role="alert" className="text-sm text-destructive">
            {banner}
          </p>
        ) : null}
        <Button type="submit" disabled={pending} className="self-end">
          {pending ? "Menyimpan…" : profile?.logoPath ? "Lanjut" : "Lanjut tanpa logo"}
        </Button>
      </form>
    </div>
  );
}
