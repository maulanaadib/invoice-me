"use client";

// src/components/onboarding/steps/step-04-color.tsx
// Step 4: accent color. The invoice preview re-renders with the picked color
// on every keystroke — nothing is saved until "Lanjut".

import * as React from "react";
import { useActionState } from "react";
import { setPrimaryColorAction } from "@/modules/onboarding/actions";
import type { ActionResult } from "@/lib/api-response";
import type { ProfileView } from "@/modules/profiles/service";
import { bannerError, fieldError } from "@/components/forms/form-utils";
import { useWizard } from "@/components/onboarding/context";
import {
  InvoicePreview,
  previewDataFromProfile,
} from "@/components/invoice/invoice-preview";
import { ColorPicker } from "@/components/profiles/color-picker";
import { Button } from "@/components/ui/button";

export function Step4Color() {
  const { profile, bank, signer, goTo, setProfile } = useWizard();
  const step = 4;
  const [color, setColor] = React.useState(profile?.primaryColor ?? "#2563eb");

  const [state, formAction, pending] = useActionState<
    ActionResult<{ profile: ProfileView }> | null,
    FormData
  >(
    async (_prev, form) => {
      const result = await setPrimaryColorAction(form);
      if (result.ok) {
        setProfile(result.data.profile);
        goTo(step + 1);
      }
      return result;
    },
    null,
  );

  const banner = bannerError(state);
  const previewData = {
    ...(profile ? previewDataFromProfile(profile) : {}),
    primaryColor: color,
  };

  return (
    <form action={formAction} className="flex flex-col gap-5" noValidate>
      <input type="hidden" name="step" value={step} />
      <ColorPicker value={color} onChange={setColor} disabled={pending} />

      <div className="flex flex-col gap-2">
        <p className="text-sm font-medium">Pratinjau invoice dengan warna ini</p>
        <InvoicePreview data={previewData} bank={bank} signer={signer} />
      </div>

      {banner || fieldError(state, "primaryColor") ? (
        <p role="alert" className="text-sm text-destructive">
          {banner ?? fieldError(state, "primaryColor")}
        </p>
      ) : null}

      <Button type="submit" disabled={pending}>
        {pending ? "Menyimpan…" : "Lanjut"}
      </Button>
    </form>
  );
}
