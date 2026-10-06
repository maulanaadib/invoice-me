"use client";

import * as React from "react";
import { useActionState } from "react";
import { useRouter } from "next/navigation";
import { KeyRoundIcon, RefreshCcwIcon, UserCheckIcon, UserXIcon } from "lucide-react";
import {
  activateAdminUserAction,
  resetPasswordAdminAction,
  revokeAllSessionsAdminAction,
  suspendAdminUserAction,
} from "@/modules/auth/admin-actions";
import type { ActionResult } from "@/lib/api-response";
import { bannerError, fieldError } from "@/components/forms/form-utils";
import { toast } from "@/components/ui/toast";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function UserDetailActions({
  userId,
  status,
}: {
  userId: string;
  status: "ACTIVE" | "SUSPENDED";
}) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [resetOpen, setResetOpen] = React.useState(false);
  const [revokeOpen, setRevokeOpen] = React.useState(false);

  // Success side-effects run where each result is known (inside the action),
  // not in a state-sync effect: close the dialog, toast, refresh.
  const [resetState, resetAction, resetPending] = useActionState<
    ActionResult | null,
    FormData
  >(
    async (_prev, form) => {
      const result = await resetPasswordAdminAction(form);
      if (result.ok) {
        setResetOpen(false);
        toast.add({
          title: "Kata sandi diatur ulang",
          description: "Semua sesi dicabut — user wajib ganti sandi saat masuk berikutnya.",
          type: "success",
        });
        router.refresh();
      }
      return result;
    },
    null,
  );
  const [revokeState, revokeAction, revokePending] = useActionState<
    ActionResult | null,
    FormData
  >(
    async (_prev, form) => {
      const result = await revokeAllSessionsAdminAction(form);
      if (result.ok) {
        setRevokeOpen(false);
        toast.add({ title: "Semua sesi dicabut", type: "success" });
        router.refresh();
      }
      return result;
    },
    null,
  );

  function toggleStatus() {
    startTransition(async () => {
      const form = new FormData();
      form.set("userId", userId);
      const result =
        status === "SUSPENDED"
          ? await activateAdminUserAction(form)
          : await suspendAdminUserAction(form);
      if (result.ok) {
        toast.add({
          title: status === "SUSPENDED" ? "User diaktifkan" : "User ditangguhkan",
          type: "success",
        });
        router.refresh();
      } else {
        toast.add({ title: "Gagal", description: result.error.message, type: "error" });
      }
    });
  }

  return (
    <div className="flex flex-wrap gap-2">
      <Button
        variant={status === "SUSPENDED" ? "outline" : "destructive"}
        onClick={toggleStatus}
        disabled={pending}
      >
        {status === "SUSPENDED" ? (
          <>
            <UserCheckIcon aria-hidden="true" />
            Aktifkan kembali
          </>
        ) : (
          <>
            <UserXIcon aria-hidden="true" />
            Tangguhkan akun
          </>
        )}
      </Button>

      <Dialog open={resetOpen} onOpenChange={setResetOpen}>
        <Button variant="outline" onClick={() => setResetOpen(true)}>
          <KeyRoundIcon aria-hidden="true" />
          Atur ulang kata sandi
        </Button>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Atur ulang kata sandi</DialogTitle>
            <DialogDescription>
              User harus mengganti kata sandi saat masuk berikutnya. Semua sesi user
              ini akan dicabut.
            </DialogDescription>
          </DialogHeader>
          <form
            action={resetAction}
            onSubmit={(event) => {
              const data = new FormData(event.currentTarget);
              const next = String(data.get("newPassword") ?? "");
              const confirm = String(data.get("confirmPassword") ?? "");
              if (next.length < 8 || next !== confirm) {
                event.preventDefault();
              }
            }}
            className="flex flex-col gap-4"
            noValidate
          >
            <input type="hidden" name="userId" value={userId} />
            <div className="flex flex-col gap-2">
              <Label htmlFor={`reset-${userId}`}>Kata sandi baru</Label>
              <Input
                id={`reset-${userId}`}
                name="newPassword"
                type="password"
                autoComplete="off"
                disabled={resetPending}
              />
              {fieldError(resetState, "newPassword") ? (
                <p className="text-sm text-destructive">
                  {fieldError(resetState, "newPassword")}
                </p>
              ) : null}
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor={`reset-confirm-${userId}`}>Ulangi kata sandi baru</Label>
              <Input
                id={`reset-confirm-${userId}`}
                name="confirmPassword"
                type="password"
                autoComplete="off"
                disabled={resetPending}
              />
              {fieldError(resetState, "confirmPassword") ? (
                <p className="text-sm text-destructive">
                  {fieldError(resetState, "confirmPassword")}
                </p>
              ) : null}
            </div>
            {bannerError(resetState) ? (
              <p role="alert" className="text-sm text-destructive">
                {bannerError(resetState)}
              </p>
            ) : null}
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => setResetOpen(false)}>
                Batal
              </Button>
              <Button type="submit" disabled={resetPending}>
                {resetPending ? "Menyimpan…" : "Simpan kata sandi baru"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={revokeOpen} onOpenChange={setRevokeOpen}>
        <Button variant="outline" onClick={() => setRevokeOpen(true)}>
          <RefreshCcwIcon aria-hidden="true" />
          Cabut semua sesi
        </Button>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Cabut semua sesi?</DialogTitle>
            <DialogDescription>
              User ini akan keluar dari semua perangkat dan harus masuk ulang.
            </DialogDescription>
          </DialogHeader>
          <form action={revokeAction} className="flex flex-col gap-4">
            <input type="hidden" name="userId" value={userId} />
            {bannerError(revokeState) ? (
              <p role="alert" className="text-sm text-destructive">
                {bannerError(revokeState)}
              </p>
            ) : null}
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => setRevokeOpen(false)}>
                Batal
              </Button>
              <Button type="submit" variant="destructive" disabled={revokePending}>
                {revokePending ? "Mencabut…" : "Cabut semua sesi"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <span className="sr-only">{pending ? "Memproses…" : ""}</span>
    </div>
  );
}
