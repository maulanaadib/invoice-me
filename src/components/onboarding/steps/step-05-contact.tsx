"use client";

// src/components/onboarding/steps/step-05-contact.tsx
// Step 5: contact channels shown on the invoice (all optional, but validated
// server-side for email/URL format).

import * as React from "react";
import { useActionState } from "react";
import { saveContactInfoAction } from "@/modules/onboarding/actions";
import type { ActionResult } from "@/lib/api-response";
import type { ProfileView } from "@/modules/profiles/service";
import { bannerError, fieldError } from "@/components/forms/form-utils";
import { useWizard } from "@/components/onboarding/context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface FieldProps {
  id: string;
  label: string;
  type?: string;
  placeholder?: string;
  defaultValue: string;
  disabled: boolean;
  error?: string;
}

function ContactField({ id, label, type = "text", placeholder, defaultValue, disabled, error }: FieldProps) {
  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        name={id}
        type={type}
        placeholder={placeholder}
        defaultValue={defaultValue}
        disabled={disabled}
        aria-invalid={Boolean(error) || undefined}
      />
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
    </div>
  );
}

export function Step5Contact() {
  const { profile, goTo, setProfile } = useWizard();
  const step = 5;

  const [state, formAction, pending] = useActionState<
    ActionResult<{ profile: ProfileView }> | null,
    FormData
  >(
    async (_prev, form) => {
      const result = await saveContactInfoAction(form);
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
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <ContactField
          id="phone"
          label="Telepon"
          placeholder="021 555 0100"
          defaultValue={profile?.phone ?? ""}
          disabled={pending}
          error={fieldError(state, "phone")}
        />
        <ContactField
          id="whatsapp"
          label="WhatsApp"
          placeholder="0812 3456 7890"
          defaultValue={profile?.whatsapp ?? ""}
          disabled={pending}
          error={fieldError(state, "whatsapp")}
        />
        <ContactField
          id="fax"
          label="Fax"
          defaultValue={profile?.fax ?? ""}
          disabled={pending}
          error={fieldError(state, "fax")}
        />
        <ContactField
          id="email"
          label="Email"
          type="email"
          placeholder="halo@perusahaan.com"
          defaultValue={profile?.email ?? ""}
          disabled={pending}
          error={fieldError(state, "email")}
        />
      </div>
      <ContactField
        id="website"
        label="Website"
        type="url"
        placeholder="https://perusahaan.com"
        defaultValue={profile?.website ?? ""}
        disabled={pending}
        error={fieldError(state, "website")}
      />

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
