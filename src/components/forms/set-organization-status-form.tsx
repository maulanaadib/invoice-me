"use client";

import { useActionState, useState } from "react";
import { useRouter } from "next/navigation";
import { BanIcon, CheckCircle2Icon } from "lucide-react";
import { setOrganizationStatusAction } from "@/modules/admin/actions";
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

/**
 * Suspend/reactivate an organization (feature 09, ratified rule): suspend
 * blocks sign-in and new mutations for that workspace — reads, downloads and
 * the stored data are untouched. Confirmation dialog because suspending a
 * whole organization is destructive-adjacent (ui-context).
 */
export function SetOrganizationStatusForm({
  organizationId,
  organizationName,
  status,
}: {
  organizationId: string;
  organizationName: string;
  status: "ACTIVE" | "SUSPENDED";
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const suspending = status === "ACTIVE";

  const [state, formAction, pending] = useActionState<ActionResult | null, FormData>(
    async (_prev, form) => {
      const result = await setOrganizationStatusAction(form);
      if (result.ok) {
        setOpen(false);
        toast.add({
          title: suspending ? "Organisasi ditangguhkan" : "Organisasi diaktifkan",
          description: suspending
            ? "Anggotanya tidak bisa masuk atau membuat perubahan baru. Data tetap tersimpan dan bisa dibaca."
            : "Anggota bisa masuk dan bekerja kembali.",
          type: "success",
        });
        router.refresh();
      } else {
        toast.add({
          title: "Gagal mengubah status",
          description: result.error.message,
          type: "error",
        });
      }
      return result;
    },
    null,
  );

  return (
    <>
      <Button
        variant={suspending ? "destructive" : "default"}
        size="sm"
        onClick={() => setOpen(true)}
      >
        {suspending ? (
          <>
            <BanIcon aria-hidden="true" />
            Tangguhkan organisasi
          </>
        ) : (
          <>
            <CheckCircle2Icon aria-hidden="true" />
            Aktifkan kembali
          </>
        )}
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {suspending
                ? `Tangguhkan ${organizationName}?`
                : `Aktifkan kembali ${organizationName}?`}
            </DialogTitle>
            <DialogDescription>
              {suspending
                ? "Semua anggota yang hanya berorganisasi di sini tidak bisa masuk; yang sedang masuk tidak bisa membuat perubahan baru. Membaca data dan mengunduh invoice tetap diizinkan — tidak ada data yang dihapus atau dibekukan."
                : "Status kembali normal: anggota bisa masuk dan membuat perubahan seperti sediakala."}
            </DialogDescription>
          </DialogHeader>
          <form action={formAction} className="flex flex-col gap-4">
            <input type="hidden" name="organizationId" value={organizationId} />
            <input
              type="hidden"
              name="status"
              value={suspending ? "SUSPENDED" : "ACTIVE"}
            />
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
                variant={suspending ? "destructive" : "default"}
                disabled={pending}
              >
                {pending
                  ? "Menyimpan..."
                  : suspending
                    ? "Tangguhkan sekarang"
                    : "Aktifkan sekarang"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
