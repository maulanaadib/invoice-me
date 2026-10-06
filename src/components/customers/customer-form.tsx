"use client";

// src/components/customers/customer-form.tsx
// Customer create/edit form (React Hook Form + Zod per feature 03 spec).
// Client validation is the same schema the server action re-runs — the server
// stays the trust boundary. VIEWER gets the identical form read-only with a
// masked NPWP (PII): their write would be rejected server-side anyway.

import * as React from "react";
import { useRouter } from "next/navigation";
import { zodResolver } from "@hookform/resolvers/zod";
import { Controller, useForm } from "react-hook-form";
import { toast } from "@/components/ui/toast";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  createCustomerAction,
  updateCustomerAction,
} from "@/modules/customers/actions";
import { customerFormSchema, type CustomerFormValues } from "@/modules/customers/schema";

function Field({
  id,
  label,
  error,
  hint,
  children,
}: {
  id: string;
  label: string;
  error?: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={id}>{label}</Label>
      {children}
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
      {error ? (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export interface CustomerFormProps {
  mode: "create" | "edit";
  /** Present in edit mode — scopes the update (server re-verifies ownership). */
  customerId?: string;
  defaultValues: CustomerFormValues;
  /**
   * What the NPWP input shows: the full value for editors (STAFF+), the
   * masked value for read-only viewers — a viewer's HTML never carries the
   * raw NPWP.
   */
  taxIdValue: string;
  /** True when the masked value is being displayed. */
  taxIdMasked: boolean;
  canEdit: boolean;
}

export function CustomerForm({
  mode,
  customerId,
  defaultValues,
  taxIdValue,
  taxIdMasked,
  canEdit,
}: CustomerFormProps) {
  const router = useRouter();
  const [banner, setBanner] = React.useState<string | null>(null);

  const form = useForm<CustomerFormValues>({
    resolver: zodResolver(customerFormSchema),
    defaultValues: { ...defaultValues, taxId: taxIdValue },
  });
  const {
    register,
    control,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = form;

  function fieldError(name: keyof CustomerFormValues): string | undefined {
    const message = errors[name]?.message;
    return typeof message === "string" ? message : undefined;
  }

  // handleSubmit awaits the returned promise, so isSubmitting tracks the
  // server round-trip (React 19: startTransition without an awaited thenable
  // would flip pending back immediately).
  const onSubmit = handleSubmit(async (values) => {
    setBanner(null);
    const result =
      mode === "create"
        ? await createCustomerAction(values)
        : await updateCustomerAction({ customerId: customerId ?? "", ...values });

    if (result.ok) {
      toast.add({
        title: mode === "create" ? "Customer dibuat" : "Perubahan disimpan",
        description: values.companyName,
        type: "success",
      });
      if (mode === "create") {
        router.push(`/customers/${result.data.customerId}`);
      } else {
        router.refresh();
      }
      return;
    }

    const details = result.error.details;
    let fieldShown = false;
    if (details && typeof details === "object") {
      for (const [field, message] of Object.entries(details)) {
        if (typeof message === "string" && field in values) {
          setError(field as keyof CustomerFormValues, { message });
          fieldShown = true;
        }
      }
    }
    if (!fieldShown) setBanner(result.error.message);
  });

  const disabled = !canEdit || isSubmitting;

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        void onSubmit();
      }}
      className="flex flex-col gap-6"
      noValidate
    >
      {!canEdit ? (
        <p className="rounded-lg border border-border bg-muted/50 p-3 text-sm text-muted-foreground">
          Mode lihat saja. Hanya STAFF, ADMIN, atau OWNER yang dapat mengubah data customer.
        </p>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Identitas perusahaan</CardTitle>
          <CardDescription>Nama perusahaan, badan usaha, dan NPWP customer.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field
              id="companyName"
              label="Nama perusahaan"
              error={fieldError("companyName")}
              hint="Muncul di invoice sebagai penerima penagihan."
            >
              <Input
                id="companyName"
                autoComplete="organization"
                disabled={disabled}
                {...register("companyName")}
              />
            </Field>
            <Field id="legalName" label="Nama legal" error={fieldError("legalName")}>
              <Input id="legalName" disabled={disabled} {...register("legalName")} />
            </Field>
            <Field
              id="businessType"
              label="Bentuk usaha"
              error={fieldError("businessType")}
              hint="mis. PT, CV, Firma, Perorangan."
            >
              <Input id="businessType" disabled={disabled} {...register("businessType")} />
            </Field>
            <Field
              id="taxId"
              label="NPWP"
              error={fieldError("taxId")}
              hint={
                taxIdMasked
                  ? "NPWP ditampilkan termask untuk akses lihat saja."
                  : "Opsional. Data ini bersifat pribadi dan tidak pernah dicatat di log."
              }
            >
              <Input
                id="taxId"
                disabled={disabled}
                inputMode="numeric"
                {...register("taxId")}
              />
            </Field>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Alamat</CardTitle>
          <CardDescription>Alamat surat dan domisili customer.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <Field id="address" label="Alamat" error={fieldError("address")}>
            <Textarea id="address" rows={3} disabled={disabled} {...register("address")} />
          </Field>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field id="city" label="Kota" error={fieldError("city")}>
              <Input id="city" disabled={disabled} {...register("city")} />
            </Field>
            <Field id="province" label="Provinsi" error={fieldError("province")}>
              <Input id="province" disabled={disabled} {...register("province")} />
            </Field>
            <Field id="postalCode" label="Kode pos" error={fieldError("postalCode")}>
              <Input id="postalCode" inputMode="numeric" disabled={disabled} {...register("postalCode")} />
            </Field>
            <Field
              id="country"
              label="Negara"
              error={fieldError("country")}
              hint="Kosongkan bila Indonesia."
            >
              <Input id="country" disabled={disabled} {...register("country")} />
            </Field>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Kontak & catatan</CardTitle>
          <CardDescription>
            Kontak umum perusahaan dan catatan internal. PIC detail dikelola di tab PIC.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field id="phone" label="Telepon" error={fieldError("phone")}>
              <Input id="phone" disabled={disabled} {...register("phone")} />
            </Field>
            <Field id="whatsapp" label="WhatsApp" error={fieldError("whatsapp")}>
              <Input id="whatsapp" disabled={disabled} {...register("whatsapp")} />
            </Field>
            <Field id="email" label="Email" error={fieldError("email")}>
              <Input id="email" type="email" disabled={disabled} {...register("email")} />
            </Field>
          </div>
          <Field
            id="notes"
            label="Catatan internal"
            error={fieldError("notes")}
            hint="Tidak dicetak di invoice."
          >
            <Textarea id="notes" rows={3} disabled={disabled} {...register("notes")} />
          </Field>
          <Controller
            control={control}
            name="isActive"
            render={({ field }) => (
              <Label htmlFor="isActive" className="flex items-center gap-2 font-normal">
                <Checkbox
                  id="isActive"
                  checked={field.value ?? true}
                  onCheckedChange={(checked) => field.onChange(checked === true)}
                  disabled={disabled}
                />
                <span className="text-sm">Customer aktif</span>
              </Label>
            )}
          />
          {fieldError("isActive") ? (
            <p role="alert" className="text-sm text-destructive">
              {fieldError("isActive")}
            </p>
          ) : null}
        </CardContent>
      </Card>

      {banner ? (
        <p role="alert" className="text-sm text-destructive">
          {banner}
        </p>
      ) : null}

      {canEdit ? (
        <div className="flex justify-end">
          <Button type="submit" disabled={isSubmitting}>
            {isSubmitting
              ? "Menyimpan…"
              : mode === "create"
                ? "Buat customer"
                : "Simpan perubahan"}
          </Button>
        </div>
      ) : null}
    </form>
  );
}
