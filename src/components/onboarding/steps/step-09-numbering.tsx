"use client";

// src/components/onboarding/steps/step-09-numbering.tsx
// Step 9: number pattern with real-time preview (client) + the same
// validation the server applies on save, plus the sequence reset policy.

import * as React from "react";
import { useActionState } from "react";
import { saveNumberingAction } from "@/modules/onboarding/actions";
import type { ActionResult } from "@/lib/api-response";
import type { ProfileView } from "@/modules/profiles/service";
import { bannerError, fieldError } from "@/components/forms/form-utils";
import { useWizard } from "@/components/onboarding/context";
import { NumberPatternField } from "@/components/profiles/number-pattern-field";
import { RESET_POLICY_LABELS } from "@/components/profiles/labels";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger } from "@/components/ui/select";

const DEFAULT_PATTERN = "INV/{CODE}/{ROMAN_MONTH}/{YYYY}/{SEQ:3}";

export function Step9Numbering() {
  const { profile, goTo, setProfile } = useWizard();
  const step = 9;
  const [policy, setPolicy] = React.useState<ProfileView["sequenceResetPolicy"]>(
    profile?.sequenceResetPolicy ?? "YEARLY",
  );

  const [state, formAction, pending] = useActionState<
    ActionResult<{ profile: ProfileView }> | null,
    FormData
  >(
    async (_prev, form) => {
      const result = await saveNumberingAction(form);
      if (result.ok) {
        setProfile(result.data.profile);
        goTo(step + 1);
      }
      return result;
    },
    null,
  );

  const banner = bannerError(state);

  // useActionState (React 19) exposes no setter, so a rejected save's message
  // would linger after the user edits the field. Track it ourselves and clear
  // the banner on any edit, so the message never describes a stale value.
  const [dismissed, setDismissed] = React.useState(false);
  const dismissError = () => {
    if (state && !state.ok) setDismissed(true);
  };
  const showError = dismissed ? null : banner ?? fieldError(state, "numberPattern");

  return (
    <form action={formAction} className="flex flex-col gap-5" noValidate>
      <input type="hidden" name="step" value={step} />
      <input type="hidden" name="sequenceResetPolicy" value={policy} />

      <div onChange={dismissError}>
        <NumberPatternField
          code={profile?.code ?? "INV"}
          defaultValue={profile?.numberPattern ?? DEFAULT_PATTERN}
          disabled={pending}
        />
      </div>

      <div className="flex flex-col gap-2">
        <Label>Reset nomor urut</Label>
        <Select
          value={policy}
          onValueChange={(value) => {
            setPolicy(value as ProfileView["sequenceResetPolicy"]);
            dismissError();
          }}
          disabled={pending}
        >
          <SelectTrigger className="w-full" aria-label="Reset nomor urut">
            {RESET_POLICY_LABELS[policy]}
          </SelectTrigger>
          <SelectContent>
            {(Object.keys(RESET_POLICY_LABELS) as Array<ProfileView["sequenceResetPolicy"]>).map(
              (key) => (
                <SelectItem key={key} value={key}>
                  {RESET_POLICY_LABELS[key]}
                </SelectItem>
              ),
            )}
          </SelectContent>
        </Select>
      </div>

      {showError ? (
        <p role="alert" className="text-sm text-destructive">
          {showError}
        </p>
      ) : null}

      <Button type="submit" disabled={pending}>
        {pending ? "Menyimpan…" : "Lanjut"}
      </Button>
    </form>
  );
}
