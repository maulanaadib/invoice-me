"use client";

// src/components/customers/contact-dialog.tsx
// Add/edit PIC (CustomerContact) dialog. React Hook Form + the shared Zod
// schema; the server action re-validates and authorizes. isPrimary flips the
// primary flag atomically server-side (single primary per customer).

import * as React from "react";
import { useRouter } from "next/navigation";
import { zodResolver } from "@hookform/resolvers/zod";
import { Controller, useForm } from "react-hook-form";
import { toast } from "@/components/ui/toast";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
import { addContactAction, updateContactAction } from "@/modules/customers/actions";
import { contactFormSchema, type ContactFormValues } from "@/modules/customers/schema";
import type { ContactView } from "@/modules/customers/service";

function Field({
  id,
  label,
  error,
  children,
}: {
  id: string;
  label: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={id}>{label}</Label>
      {children}
      {error ? (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export interface ContactDialogProps {
  customerId: string;
  /** null = add mode; a contact = edit mode. */
  contact: ContactView | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ContactDialog({ customerId, contact, open, onOpenChange }: ContactDialogProps) {
  const router = useRouter();
  const [banner, setBanner] = React.useState<string | null>(null);

  const form = useForm<ContactFormValues>({
    resolver: zodResolver(contactFormSchema),
    values: {
      name: contact?.name ?? "",
      title: contact?.title ?? "",
      division: contact?.division ?? "",
      email: contact?.email ?? "",
      phone: contact?.phone ?? "",
      whatsapp: contact?.whatsapp ?? "",
      isPrimary: contact?.isPrimary ?? false,
    },
  });
  const {
    register,
    control,
    handleSubmit,
    setError,
    clearErrors,
    formState: { errors, isSubmitting },
  } = form;

  // Closing wipes banner + field errors, so a reopen always starts clean —
  // reset happens in the event handler, never in an effect (react-hooks rule).
  function handleOpenChange(next: boolean) {
    if (!next) {
      setBanner(null);
      clearErrors();
    }
    onOpenChange(next);
  }

  function fieldError(name: keyof ContactFormValues): string | undefined {
    const message = errors[name]?.message;
    return typeof message === "string" ? message : undefined;
  }

  const onSubmit = handleSubmit(async (values) => {
    setBanner(null);
    const result = contact
      ? await updateContactAction({ ...values, contactId: contact.id })
      : await addContactAction({ ...values, customerId });

    if (result.ok) {
      toast.add({
        title: contact ? "PIC diperbarui" : "PIC ditambahkan",
        description: values.name,
        type: "success",
      });
      onOpenChange(false);
      router.refresh();
      return;
    }

    const details = result.error.details;
    let fieldShown = false;
    if (details && typeof details === "object") {
      for (const [field, message] of Object.entries(details)) {
        if (typeof message === "string" && field in values) {
          setError(field as keyof ContactFormValues, { message });
          fieldShown = true;
        }
      }
    }
    if (!fieldShown) setBanner(result.error.message);
  });

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{contact ? "Edit PIC" : "Tambah PIC"}</DialogTitle>
          <DialogDescription>
            Person in charge di customer ini — dipakai sebagai kontak invoice.
          </DialogDescription>
        </DialogHeader>

        <form
          onSubmit={(event) => {
            event.preventDefault();
            void onSubmit();
          }}
          className="flex flex-col gap-4"
          noValidate
        >
          <Field id="contactName" label="Nama PIC *" error={fieldError("name")}>
            <Input id="contactName" autoComplete="name" disabled={isSubmitting} {...register("name")} />
          </Field>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field id="contactTitle" label="Jabatan" error={fieldError("title")}>
              <Input id="contactTitle" placeholder="mis. Finance Manager" disabled={isSubmitting} {...register("title")} />
            </Field>
            <Field id="contactDivision" label="Divisi" error={fieldError("division")}>
              <Input id="contactDivision" placeholder="mis. Purchasing" disabled={isSubmitting} {...register("division")} />
            </Field>
            <Field id="contactEmail" label="Email" error={fieldError("email")}>
              <Input id="contactEmail" type="email" disabled={isSubmitting} {...register("email")} />
            </Field>
            <Field id="contactPhone" label="Telepon" error={fieldError("phone")}>
              <Input id="contactPhone" disabled={isSubmitting} {...register("phone")} />
            </Field>
            <Field id="contactWhatsapp" label="WhatsApp" error={fieldError("whatsapp")}>
              <Input id="contactWhatsapp" disabled={isSubmitting} {...register("whatsapp")} />
            </Field>
          </div>

          <Controller
            control={control}
            name="isPrimary"
            render={({ field }) => (
              <Label htmlFor="contactPrimary" className="flex items-center gap-2 font-normal">
                <Checkbox
                  id="contactPrimary"
                  checked={field.value ?? false}
                  onCheckedChange={(checked) => field.onChange(checked === true)}
                  disabled={isSubmitting}
                />
                <span className="text-sm">Jadikan PIC utama</span>
              </Label>
            )}
          />

          {banner ? (
            <p role="alert" className="text-sm text-destructive">
              {banner}
            </p>
          ) : null}

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={isSubmitting}
              onClick={() => handleOpenChange(false)}
            >
              Batal
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? "Menyimpan…" : contact ? "Simpan perubahan" : "Tambah PIC"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
