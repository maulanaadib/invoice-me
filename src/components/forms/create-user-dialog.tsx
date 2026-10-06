"use client";

import * as React from "react";
import { useActionState } from "react";
import { useRouter } from "next/navigation";
import { PlusIcon } from "lucide-react";
import { createAdminUserAction } from "@/modules/auth/admin-actions";
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
import { Select, SelectContent, SelectItem, SelectTrigger } from "@/components/ui/select";

export function CreateUserDialog() {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [platformRole, setPlatformRole] = React.useState("USER");
  const [state, formAction, pending] = useActionState<ActionResult<{ id: string }> | null, FormData>(
    // Success side-effects run where the result is known (inside the action),
    // not in a state-sync effect: close, reset the role select, toast, refresh.
    async (_prev, form) => {
      const result = await createAdminUserAction(form);
      if (result.ok) {
        setOpen(false);
        setPlatformRole("USER");
        toast.add({
          title: "User dibuat",
          description: "Bagikan kata sandi sementara kepada user — wajib diganti saat masuk.",
          type: "success",
        });
        router.refresh();
      }
      return result;
    },
    null,
  );

  const banner = bannerError(state);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        <PlusIcon aria-hidden="true" />
        Buat user
      </Button>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Buat pengguna baru</DialogTitle>
          <DialogDescription>
            User dibuat oleh super admin. Kata sandi sementara wajib diganti saat
            pertama kali masuk.
          </DialogDescription>
        </DialogHeader>
        <form action={formAction} className="flex flex-col gap-4" noValidate>
          <input type="hidden" name="platformRole" value={platformRole} />
          <div className="flex flex-col gap-2">
            <Label htmlFor="create-username">Username</Label>
            <Input
              id="create-username"
              name="username"
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              disabled={pending}
              aria-invalid={Boolean(fieldError(state, "username")) || undefined}
            />
            {fieldError(state, "username") ? (
              <p className="text-sm text-destructive">{fieldError(state, "username")}</p>
            ) : null}
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="create-email">Email</Label>
            <Input
              id="create-email"
              name="email"
              type="email"
              autoComplete="off"
              disabled={pending}
              aria-invalid={Boolean(fieldError(state, "email")) || undefined}
            />
            {fieldError(state, "email") ? (
              <p className="text-sm text-destructive">{fieldError(state, "email")}</p>
            ) : null}
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="create-name">Nama (opsional)</Label>
            <Input id="create-name" name="name" autoComplete="name" disabled={pending} />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="create-temp-password">Kata sandi sementara</Label>
            <Input
              id="create-temp-password"
              name="tempPassword"
              type="text"
              autoComplete="off"
              disabled={pending}
              aria-invalid={Boolean(fieldError(state, "tempPassword")) || undefined}
            />
            {fieldError(state, "tempPassword") ? (
              <p className="text-sm text-destructive">{fieldError(state, "tempPassword")}</p>
            ) : null}
            <p className="text-xs text-muted-foreground">
              Minimal 8 karakter. User wajib menggantinya saat masuk pertama kali.
            </p>
          </div>
          <div className="flex flex-col gap-2">
            <Label>Peran platform</Label>
            <Select value={platformRole} onValueChange={(value) => setPlatformRole(String(value))}>
              <SelectTrigger className="w-full" aria-label="Peran platform">
                {platformRole === "SUPER_ADMIN" ? "Super Admin" : "User"}
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="USER">User</SelectItem>
                <SelectItem value="SUPER_ADMIN">Super Admin</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              Super admin dapat mengelola semua pengguna dan organisasi.
            </p>
          </div>
          {banner ? (
            <p role="alert" className="text-sm text-destructive">
              {banner}
            </p>
          ) : null}
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => setOpen(false)}
              disabled={pending}
            >
              Batal
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? "Membuat…" : "Buat pengguna"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
