"use client";

import * as React from "react";
import { useActionState } from "react";
import { changeOwnPasswordAction } from "@/modules/auth/actions";
import type { ActionResult } from "@/lib/api-response";
import { fieldError } from "@/components/forms/form-utils";
import { toast } from "@/components/ui/toast";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function ChangePasswordForm({ forced }: { forced: boolean }) {
  const [state, formAction, pending] = useActionState<ActionResult | null, FormData>(
    (_prev, form) => changeOwnPasswordAction(form),
    null,
  );
  const [localError, setLocalError] = React.useState<string | null>(null);
  // Derived from the action result — a successful submit is the only way to
  // reach this state, so no state-sync effect is needed.
  const done = Boolean(state && state.ok);

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    const form = event.currentTarget;
    const data = new FormData(form);
    const current = typeof data.get("currentPassword") === "string" ? String(data.get("currentPassword")) : "";
    const next = typeof data.get("newPassword") === "string" ? String(data.get("newPassword")) : "";
    const confirm = typeof data.get("confirmPassword") === "string" ? String(data.get("confirmPassword")) : "";
    if (!current || !next || !confirm) {
      setLocalError("Semua kolom kata sandi wajib diisi.");
      event.preventDefault();
      return;
    }
    if (next.length < 8) {
      setLocalError("Kata sandi baru minimal 8 karakter.");
      event.preventDefault();
      return;
    }
    if (next !== confirm) {
      setLocalError("Konfirmasi kata sandi tidak sama.");
      event.preventDefault();
      return;
    }
    if (next === current) {
      setLocalError("Kata sandi baru tidak boleh sama dengan yang saat ini.");
      event.preventDefault();
      return;
    }
    setLocalError(null);
    // Let the form submit normally to the server action.
  }

  React.useEffect(() => {
    if (state && state.ok) {
      toast.add({ title: "Kata sandi berhasil diubah", type: "success" });
      const timer = setTimeout(() => window.location.assign("/dashboard"), 700);
      return () => clearTimeout(timer);
    }
  }, [state]);

  const serverError = state && !state.ok && !fieldError(state, "newPassword") && !fieldError(state, "currentPassword") && !fieldError(state, "confirmPassword")
    ? state.error.message
    : undefined;
  const shownError = localError ?? (serverError || undefined);

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          {forced ? "Ubah kata sandi sementara" : "Ubah kata sandi"}
        </CardTitle>
        <CardDescription>
          {forced
            ? "Kata sandi Anda diatur oleh administrator. Buat kata sandi baru untuk melanjutkan ke dashboard."
            : "Masukkan kata sandi saat ini dan kata sandi baru Anda."}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {done ? (
          <p className="text-sm text-muted-foreground" role="status">
            Kata sandi diubah. Mengalihkan ke dashboard…
          </p>
        ) : (
          <form action={formAction} onSubmit={handleSubmit} className="flex flex-col gap-4" noValidate>
            <div className="flex flex-col gap-2">
              <Label htmlFor="currentPassword">Kata sandi saat ini</Label>
              <Input
                id="currentPassword"
                name="currentPassword"
                type="password"
                autoComplete="current-password"
                disabled={pending}
                aria-invalid={Boolean(fieldError(state, "currentPassword")) || undefined}
              />
              {fieldError(state, "currentPassword") ? (
                <p className="text-sm text-destructive">{fieldError(state, "currentPassword")}</p>
              ) : null}
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="newPassword">Kata sandi baru</Label>
              <Input
                id="newPassword"
                name="newPassword"
                type="password"
                autoComplete="new-password"
                disabled={pending}
                aria-invalid={Boolean(fieldError(state, "newPassword")) || undefined}
              />
              {fieldError(state, "newPassword") ? (
                <p className="text-sm text-destructive">{fieldError(state, "newPassword")}</p>
              ) : null}
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="confirmPassword">Ulangi kata sandi baru</Label>
              <Input
                id="confirmPassword"
                name="confirmPassword"
                type="password"
                autoComplete="new-password"
                disabled={pending}
                aria-invalid={Boolean(fieldError(state, "confirmPassword")) || undefined}
              />
              {fieldError(state, "confirmPassword") ? (
                <p className="text-sm text-destructive">{fieldError(state, "confirmPassword")}</p>
              ) : null}
            </div>
            {shownError ? (
              <p role="alert" className="text-sm text-destructive">
                {shownError}
              </p>
            ) : null}
            <Button type="submit" disabled={pending}>
              {pending ? "Menyimpan…" : "Simpan kata sandi baru"}
            </Button>
          </form>
        )}
      </CardContent>
    </Card>
  );
}
