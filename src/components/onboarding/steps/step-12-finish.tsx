"use client";

// src/components/onboarding/steps/step-12-finish.tsx
// Step 12: review the summary, flip user.onboardingComplete server-side, then
// leave for /dashboard. After completion the proxy keeps this route closed.

import * as React from "react";
import { useActionState } from "react";
import { useRouter } from "next/navigation";
import { finishOnboardingAction } from "@/modules/onboarding/actions";
import type { ActionResult } from "@/lib/api-response";
import { bannerError } from "@/components/forms/form-utils";
import { useWizard } from "@/components/onboarding/context";
import { RESET_POLICY_LABELS, STAMP_MODE_LABELS } from "@/components/profiles/labels";
import { toast } from "@/components/ui/toast";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export function Step12Finish() {
  const router = useRouter();
  const { profile, bank, signer } = useWizard();

  const [state, formAction, pending] = useActionState<
    ActionResult<{ step: number }> | null,
    FormData
  >(
    async () => finishOnboardingAction(),
    null,
  );

  const done = Boolean(state && state.ok);
  const banner = bannerError(state);

  React.useEffect(() => {
    if (!done) return;
    toast.add({ title: "Onboarding selesai", description: "Selamat datang di dashboard.", type: "success" });
    const timer = setTimeout(() => router.push("/dashboard"), 700);
    return () => clearTimeout(timer);
  }, [done, router]);

  if (done) {
    return (
      <p className="text-sm text-muted-foreground" role="status">
        Onboarding selesai. Mengalihkan ke dashboard…
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle>Ringkasan profil invoice</CardTitle>
          <CardDescription>
            Semua pengaturan ini bisa diubah kapan saja di halaman Profil Invoice.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 text-sm">
          <div className="flex items-center justify-between gap-3">
            <span className="text-muted-foreground">Profil</span>
            <span className="text-right font-medium">
              {profile?.name ?? "—"} ({profile?.code ?? "—"})
            </span>
          </div>
          <div className="flex items-center justify-between gap-3">
            <span className="text-muted-foreground">Warna utama</span>
            <span className="flex items-center gap-2">
              <span
                className="inline-block h-4 w-4 rounded-full border border-border"
                style={{ backgroundColor: profile?.primaryColor ?? "#2563eb" }}
              />
              <span className="font-mono text-xs">{profile?.primaryColor ?? "#2563eb"}</span>
            </span>
          </div>
          <div className="flex items-center justify-between gap-3">
            <span className="text-muted-foreground">Pola nomor</span>
            <span className="break-all text-right font-mono text-xs">
              {profile?.numberPattern ?? "—"}
            </span>
          </div>
          <div className="flex items-center justify-between gap-3">
            <span className="text-muted-foreground">Reset nomor urut</span>
            <span className="text-right">
              {profile ? RESET_POLICY_LABELS[profile.sequenceResetPolicy] : "—"}
            </span>
          </div>
          <div className="flex items-center justify-between gap-3">
            <span className="text-muted-foreground">Meterai</span>
            <span className="text-right">
              {profile ? STAMP_MODE_LABELS[profile.defaultStampMode] : "—"}
            </span>
          </div>
          <div className="flex items-center justify-between gap-3">
            <span className="text-muted-foreground">Rekening bank</span>
            <span className="text-right">
              {bank ? (
                <>
                  {bank.bankName} <span className="tabular-nums">{bank.maskedNumber}</span>
                </>
              ) : (
                "—"
              )}
            </span>
          </div>
          <div className="flex items-center justify-between gap-3">
            <span className="text-muted-foreground">Penanda tangan</span>
            <span className="text-right">{signer?.name ?? "—"}</span>
          </div>
          <div className="flex items-center justify-between gap-3">
            <span className="text-muted-foreground">Logo</span>
            <span>
              <Badge variant={profile?.logoPath ? "default" : "outline"}>
                {profile?.logoPath ? "Terunggah" : "Belum ada"}
              </Badge>
            </span>
          </div>
        </CardContent>
      </Card>

      <form action={formAction} className="flex flex-col gap-3" noValidate>
        {banner ? (
          <p role="alert" className="text-sm text-destructive">
            {banner}
          </p>
        ) : null}
        <Button type="submit" disabled={pending}>
          {pending ? "Menyelesaikan…" : "Selesaikan onboarding"}
        </Button>
      </form>
    </div>
  );
}
