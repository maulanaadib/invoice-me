"use client";

// src/components/onboarding/steps/step-10-stamp.tsx
// Step 10: stamp preference + the mandatory disclaimer — the app only lays
// out the placeholder, it never performs official e-meterai stamping.

import * as React from "react";
import { useActionState } from "react";
import { saveStampPreferenceAction } from "@/modules/onboarding/actions";
import type { ActionResult } from "@/lib/api-response";
import type { ProfileView } from "@/modules/profiles/service";
import { bannerError } from "@/components/forms/form-utils";
import { useWizard } from "@/components/onboarding/context";
import { STAMP_DISCLAIMER, STAMP_MODE_LABELS } from "@/components/profiles/labels";
import { Button } from "@/components/ui/button";

const STAMP_HINTS: Record<ProfileView["defaultStampMode"], string> = {
  NONE: "Invoice tanpa area meterai sama sekali.",
  E_METERAI: "Area meterai ditampilkan sebagai placeholder e-meterai.",
  PHYSICAL: "Tersedia ruang untuk materai fisik yang dibubuhkan manual.",
  BLANK_SPACE: "Sediakan kotak kosong untuk kebutuhan penempelan sendiri.",
};

export function Step10Stamp() {
  const { profile, goTo, setProfile } = useWizard();
  const step = 10;
  const [mode, setMode] = React.useState<ProfileView["defaultStampMode"]>(
    profile?.defaultStampMode ?? "NONE",
  );

  const [state, formAction, pending] = useActionState<
    ActionResult<{ profile: ProfileView }> | null,
    FormData
  >(
    async (_prev, form) => {
      const result = await saveStampPreferenceAction(form);
      if (result.ok) {
        setProfile(result.data.profile);
        goTo(step + 1);
      }
      return result;
    },
    null,
  );

  const banner = bannerError(state);
  const modes = Object.keys(STAMP_MODE_LABELS) as Array<ProfileView["defaultStampMode"]>;

  return (
    <form action={formAction} className="flex flex-col gap-5" noValidate>
      <input type="hidden" name="step" value={step} />
      <input type="hidden" name="defaultStampMode" value={mode} />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2" role="radiogroup" aria-label="Preferensi meterai">
        {modes.map((key) => (
          <button
            key={key}
            type="button"
            role="radio"
            aria-checked={mode === key}
            disabled={pending}
            onClick={() => setMode(key)}
            className={`flex flex-col gap-1 rounded-lg border p-4 text-left transition-colors ${
              mode === key
                ? "border-primary bg-primary/5"
                : "border-border bg-card hover:bg-muted/50"
            }`}
          >
            <span className="text-sm font-medium">{STAMP_MODE_LABELS[key]}</span>
            <span className="text-xs text-muted-foreground">{STAMP_HINTS[key]}</span>
          </button>
        ))}
      </div>

      <div className="rounded-lg border border-dashed border-amber-500/60 bg-amber-500/10 p-3 text-xs text-foreground">
        <p className="font-semibold">Catatan meterai</p>
        <p>{STAMP_DISCLAIMER}</p>
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
