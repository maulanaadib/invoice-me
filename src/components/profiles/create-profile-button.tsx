"use client";

// src/components/profiles/create-profile-button.tsx
// Real create for orgs that finished onboarding without a profile (or
// STAFF-created workspaces). OWNER/ADMIN only — the server enforces the same
// permission; this button just doesn't show up for anyone else.

import * as React from "react";
import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { createDefaultProfileAction } from "@/modules/profiles/actions";
import { toast } from "@/components/ui/toast";
import { Button } from "@/components/ui/button";

export function CreateProfileButton() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = React.useState<string | null>(null);

  function handleCreate() {
    setError(null);
    startTransition(async () => {
      const result = await createDefaultProfileAction();
      if (result.ok) {
        toast.add({ title: "Profil invoice dibuat", type: "success" });
        router.push(`/profiles/${result.data.profileId}`);
        router.refresh();
      } else {
        setError(result.error.message);
      }
    });
  }

  return (
    <div className="flex flex-col gap-2">
      <Button type="button" onClick={handleCreate} disabled={pending}>
        {pending ? "Membuat…" : "Buat profil invoice"}
      </Button>
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
