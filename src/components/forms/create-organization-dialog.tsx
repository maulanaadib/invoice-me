"use client";

import * as React from "react";
import { useActionState } from "react";
import { useRouter } from "next/navigation";
import { Building2Icon } from "lucide-react";
import { createOrganizationByIdentifierAction } from "@/modules/organizations/actions";
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

export function CreateOrganizationDialog() {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [state, formAction, pending] = useActionState<
    ActionResult<{ id: string; slug: string }> | null,
    FormData
  >(
    // Success side-effects run where the result is known (inside the action),
    // not in a state-sync effect: close, toast, refresh.
    async (_prev, form) => {
      const result = await createOrganizationByIdentifierAction(form);
      if (result.ok) {
        setOpen(false);
        toast.add({
          title: "Organisasi dibuat",
          description: `Slug: ${result.data.slug}`,
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
        <Building2Icon aria-hidden="true" />
        Buat organisasi
      </Button>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Buat organisasi baru</DialogTitle>
          <DialogDescription>
            Pemilik organisasi otomatis mendapat peran OWNER. User harus sudah
            terdaftar terlebih dahulu.
          </DialogDescription>
        </DialogHeader>
        <form action={formAction} className="flex flex-col gap-4" noValidate>
          <div className="flex flex-col gap-2">
            <Label htmlFor="org-name">Nama organisasi</Label>
            <Input
              id="org-name"
              name="name"
              autoComplete="organization"
              disabled={pending}
              aria-invalid={Boolean(fieldError(state, "name")) || undefined}
            />
            {fieldError(state, "name") ? (
              <p className="text-sm text-destructive">{fieldError(state, "name")}</p>
            ) : null}
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="org-owner">Pemilik (username atau email)</Label>
            <Input
              id="org-owner"
              name="ownerIdentifier"
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              disabled={pending}
              aria-invalid={Boolean(fieldError(state, "ownerIdentifier")) || undefined}
            />
            {fieldError(state, "ownerIdentifier") ? (
              <p className="text-sm text-destructive">
                {fieldError(state, "ownerIdentifier")}
              </p>
            ) : null}
          </div>
          {banner ? (
            <p role="alert" className="text-sm text-destructive">
              {banner}
            </p>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)} disabled={pending}>
              Batal
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? "Membuat…" : "Buat organisasi"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
