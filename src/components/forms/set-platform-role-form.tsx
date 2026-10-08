"use client";

import { useActionState, useState } from "react";
import { useRouter } from "next/navigation";
import { ShieldCheckIcon, ShieldOffIcon } from "lucide-react";
import { setPlatformRoleAction } from "@/modules/admin/actions";
import type { ActionResult } from "@/lib/api-response";
import { bannerError } from "@/components/forms/form-utils";
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
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

/**
 * Assign/replace a user's platform role (feature 09). The server refuses a
 * self-change (lockout guard) and re-checks the caller's own role; the form
 * stays closed for the current user's own row because of `isSelf`.
 */
export function SetPlatformRoleForm({
  userId,
  currentRole,
  isSelf,
}: {
  userId: string;
  currentRole: "SUPER_ADMIN" | "USER";
  isSelf: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [nextRole, setNextRole] = useState<"SUPER_ADMIN" | "USER">(
    currentRole === "SUPER_ADMIN" ? "USER" : "SUPER_ADMIN",
  );

  const [state, formAction, pending] = useActionState<ActionResult | null, FormData>(
    async (_prev, form) => {
      const result = await setPlatformRoleAction(form);
      if (result.ok) {
        setOpen(false);
        toast.add({
          title: "Platform role diperbarui",
          description:
            nextRole === "SUPER_ADMIN"
              ? "User kini memiliki akses panel super admin."
              : "User kini hanya pengguna biasa.",
          type: "success",
        });
        router.refresh();
      } else {
        toast.add({
          title: "Gagal mengubah platform role",
          description: result.error.message,
          type: "error",
        });
      }
      return result;
    },
    null,
  );

  if (isSelf) {
    return (
      <p className="text-sm text-muted-foreground">
        Anda tidak bisa mengubah platform role akun Anda sendiri.
      </p>
    );
  }

  const promoting = nextRole === "SUPER_ADMIN";

  return (
    <>
      <Button
        variant={currentRole === "SUPER_ADMIN" ? "outline" : "default"}
        size="sm"
        onClick={() => setOpen(true)}
      >
        {currentRole === "SUPER_ADMIN" ? (
          <>
            <ShieldOffIcon aria-hidden="true" />
            Turunkan ke User
          </>
        ) : (
          <>
            <ShieldCheckIcon aria-hidden="true" />
            Naikkan ke Super Admin
          </>
        )}
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {promoting
                ? "Naikkan menjadi super admin?"
                : "Turunkan menjadi user biasa?"}
            </DialogTitle>
            <DialogDescription>
              {promoting
                ? "Super admin dapat melihat seluruh pengguna, organisasi, dan invoice lintas organisasi. Setiap aksinya tercatat di log audit."
                : "User ini kehilangan akses ke panel super admin. Keanggotaan organisasinya tidak berubah."}
            </DialogDescription>
          </DialogHeader>
          <form action={formAction} className="flex flex-col gap-4">
            <input type="hidden" name="userId" value={userId} />
            <input type="hidden" name="platformRole" value={nextRole} />
            <div className="flex flex-col gap-2">
              <Label htmlFor={`role-${userId}`}>Platform role</Label>
              <Select
                value={nextRole}
                onValueChange={(value) =>
                  setNextRole(String(value) === "SUPER_ADMIN" ? "SUPER_ADMIN" : "USER")
                }
              >
                <SelectTrigger id={`role-${userId}`} className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="USER">User — pengguna biasa</SelectItem>
                  <SelectItem value="SUPER_ADMIN">
                    Super admin — akses penuh panel admin
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
            {bannerError(state) ? (
              <p role="alert" className="text-sm text-destructive">
                {bannerError(state)}
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
              <Button
                type="submit"
                variant={promoting ? "default" : "destructive"}
                disabled={pending}
              >
                {pending ? "Menyimpan..." : "Simpan perubahan"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
