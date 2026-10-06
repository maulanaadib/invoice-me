"use client";

// src/components/onboarding/logo-uploader.tsx
// Logo upload/replace/remove used by wizard step 3 and /profiles/[id]. Not a
// <form>: it builds FormData imperatively so it can sit inside the profile
// edit form without nested forms. Size, magic-byte MIME and the random
// filename are all decided server-side — this only previews the result.

import * as React from "react";
import { useTransition } from "react";
import { removeLogoAction, uploadLogoAction } from "@/modules/profiles/actions";
import { IMAGE_MIME_LABEL } from "@/lib/image-meta";
import { toast } from "@/components/ui/toast";
import { Button } from "@/components/ui/button";

export interface LogoUploaderProps {
  profileId: string | null;
  logoPath: string | null;
  /** Max size in MB (env.UPLOAD_MAX_MB) — display only, server enforces it. */
  maxMb: number;
  disabled?: boolean;
  /** Called with the fresh profile after a successful upload/remove. */
  onProfileUpdated?: (profile: import("@/modules/profiles/service").ProfileView) => void;
}

export function LogoUploader({
  profileId,
  logoPath,
  maxMb,
  disabled,
  onProfileUpdated,
}: LogoUploaderProps) {
  const inputRef = React.useRef<HTMLInputElement>(null);
  const [currentPath, setCurrentPath] = React.useState(logoPath);
  const [error, setError] = React.useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function handleUpload() {
    const file = inputRef.current?.files?.[0];
    if (!file) {
      setError("Pilih file logo terlebih dahulu.");
      return;
    }
    setError(null);
    startTransition(async () => {
      const form = new FormData();
      form.append("file", file);
      if (profileId) form.append("profileId", profileId);
      const result = await uploadLogoAction(form);
      if (result.ok) {
        setCurrentPath(result.data.profile.logoPath);
        onProfileUpdated?.(result.data.profile);
        if (inputRef.current) inputRef.current.value = "";
        toast.add({ title: "Logo berhasil diunggah", type: "success" });
      } else {
        setError(result.error.message);
      }
    });
  }

  function handleRemove() {
    if (!profileId) return;
    setError(null);
    startTransition(async () => {
      const form = new FormData();
      form.append("profileId", profileId);
      const result = await removeLogoAction(form);
      if (result.ok) {
        setCurrentPath(null);
        onProfileUpdated?.(result.data.profile);
        toast.add({ title: "Logo dihapus", type: "success" });
      } else {
        setError(result.error.message);
      }
    });
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-4">
        <div className="flex h-20 w-36 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-dashed border-border bg-muted">
          {currentPath ? (
            // eslint-disable-next-line @next/next/no-img-element -- auth-gated storage route; plain img avoids the optimizer's static-src assumption
            <img
              src={`/api/storage/${currentPath}`}
              alt="Logo perusahaan"
              className="max-h-20 w-auto max-w-full object-contain p-1"
            />
          ) : (
            <span className="px-2 text-center text-xs text-muted-foreground">Belum ada logo</span>
          )}
        </div>
        <div className="flex flex-col gap-2">
          <input
            ref={inputRef}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            disabled={disabled || pending}
            className="text-xs file:mr-3 file:rounded-md file:border file:border-border file:bg-background file:px-3 file:py-1.5 file:text-xs file:font-medium hover:file:bg-muted"
            aria-label="File logo"
          />
          <p className="text-xs text-muted-foreground">
            {IMAGE_MIME_LABEL}, maksimal {maxMb} MB. Nama file diganti otomatis saat disimpan.
          </p>
        </div>
      </div>
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
      <div className="flex gap-2">
        <Button
          type="button"
          size="sm"
          onClick={handleUpload}
          disabled={disabled || pending}
        >
          {pending ? "Mengunggah…" : "Unggah logo"}
        </Button>
        {currentPath && profileId ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={handleRemove}
            disabled={disabled || pending}
          >
            Hapus logo
          </Button>
        ) : null}
      </div>
    </div>
  );
}
