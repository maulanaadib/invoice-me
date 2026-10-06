"use client";

import * as React from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface LoginResponse {
  message?: unknown;
}

/**
 * Login posts to Better Auth directly (no JS SDK): the identifier contains "@"
 * → email endpoint, otherwise → username endpoint. The /api/auth wrapper in
 * modules/auth/service.ts owns lockout, suspension and audit server-side.
 */
export function LoginForm({ next }: { next: string | null }) {
  const [identifier, setIdentifier] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [rememberMe, setRememberMe] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [pending, startTransition] = React.useTransition();

  // Same-origin paths only — a crafted ?next= can never leave the app.
  const target =
    next && next.startsWith("/") && !next.startsWith("//") ? next : "/dashboard";

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!identifier.trim() || !password) {
      setError("Isi username/email dan kata sandi Anda.");
      return;
    }
    setError(null);
    startTransition(async () => {
      try {
        const isEmail = identifier.includes("@");
        const endpoint = isEmail ? "/api/auth/sign-in/email" : "/api/auth/sign-in/username";
        const body = isEmail
          ? { email: identifier.trim(), password, rememberMe }
          : { username: identifier.trim(), password, rememberMe };
        const response = await fetch(endpoint, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        });
        if (response.ok) {
          // The proxy re-evaluates the fresh session: forced password change
          // (if any) redirects to /change-password before anything else.
          window.location.assign(target);
          return;
        }
        const payload = (await response.json().catch(() => null)) as LoginResponse | null;
        if (response.status === 429 || response.status === 403) {
          // Indonesian messages from the auth wrapper (lockout / suspended).
          setError(typeof payload?.message === "string" ? payload.message : "Coba lagi nanti.");
        } else if (response.status === 401) {
          setError("Username/email atau kata sandi salah. Periksa kembali isian Anda.");
        } else {
          setError("Terjadi kesalahan saat masuk. Coba lagi.");
        }
      } catch {
        setError("Tidak dapat terhubung ke server. Periksa koneksi Anda.");
      }
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Masuk</CardTitle>
        <CardDescription>Gunakan username atau email akun Anda.</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
          <div className="flex flex-col gap-2">
            <Label htmlFor="identifier">Username atau email</Label>
            <Input
              id="identifier"
              name="identifier"
              autoComplete="username"
              autoCapitalize="none"
              spellCheck={false}
              placeholder="mis. budi atau budi@perusahaan.co.id"
              value={identifier}
              onChange={(event) => setIdentifier(event.target.value)}
              disabled={pending}
              required
            />
          </div>
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="password">Kata sandi</Label>
              <Link
                href="/forgot-password"
                className="text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
              >
                Lupa kata sandi?
              </Link>
            </div>
            <Input
              id="password"
              name="password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              disabled={pending}
              required
            />
          </div>
          <Label
            htmlFor="rememberMe"
            className="flex items-center gap-2 text-sm font-normal text-muted-foreground"
          >
            <Checkbox
              id="rememberMe"
              checked={rememberMe}
              onCheckedChange={(checked) => setRememberMe(checked === true)}
              disabled={pending}
            />
            Biarkan saya tetap masuk
          </Label>
          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ) : null}
          <Button type="submit" disabled={pending} className="w-full">
            {pending ? "Masuk…" : "Masuk"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
