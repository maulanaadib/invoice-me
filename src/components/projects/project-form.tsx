"use client";

// src/components/projects/project-form.tsx
// Project/PO create & edit form (React Hook Form + Zod per feature 03 spec).
// Client validation runs the same schema the server action re-runs — the server
// stays the trust boundary. VIEWER gets the identical form read-only (their
// write would be rejected server-side anyway).

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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { createProjectAction, updateProjectAction } from "@/modules/projects/actions";
import {
  PROJECT_STATUSES,
  PROJECT_STATUS_LABELS,
  projectFormSchema,
  REFERENCE_TYPES,
  REFERENCE_TYPE_LABELS,
  type ProjectFormValues,
} from "@/modules/projects/schema";
import { CurrencyInput } from "@/components/projects/currency-input";
import { CustomerPicker } from "@/components/projects/customer-picker";

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

export interface ProjectFormProps {
  mode: "create" | "edit";
  /** Present in edit mode — scopes the update (server re-verifies ownership). */
  projectId?: string;
  defaultValues: ProjectFormValues;
  /** Company name behind defaultValues.customerId (edit mode) — picker label. */
  initialCustomerName: string;
  canEdit: boolean;
}

export function ProjectForm({
  mode,
  projectId,
  defaultValues,
  initialCustomerName,
  canEdit,
}: ProjectFormProps) {
  const router = useRouter();
  const [banner, setBanner] = React.useState<string | null>(null);

  const form = useForm<ProjectFormValues>({
    resolver: zodResolver(projectFormSchema),
    defaultValues,
  });
  const {
    register,
    control,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = form;

  function fieldError(name: keyof ProjectFormValues): string | undefined {
    const message = errors[name]?.message;
    return typeof message === "string" ? message : undefined;
  }

  const onSubmit = handleSubmit(async (values) => {
    setBanner(null);
    const result =
      mode === "create"
        ? await createProjectAction(values)
        : await updateProjectAction({ ...values, projectId: projectId ?? "" });

    if (result.ok) {
      toast.add({
        title: mode === "create" ? "Project dibuat" : "Perubahan disimpan",
        description: values.title,
        type: "success",
      });
      if (mode === "create") {
        router.push(`/projects/${result.data.projectId}`);
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
          setError(field as keyof ProjectFormValues, { message });
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
          Mode lihat saja. Hanya STAFF, ADMIN, atau OWNER yang dapat mengubah project.
        </p>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Referensi & customer</CardTitle>
          <CardDescription>
            Nomor PO/SPK/kontrak dan customer yang menerima pekerjaan ini.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field
              id="customerId"
              label="Customer *"
              error={fieldError("customerId")}
              hint="Cari berdasarkan nama perusahaan."
            >
              <Controller
                control={control}
                name="customerId"
                render={({ field }) => (
                  <CustomerPicker
                    id="customerId"
                    value={field.value ?? ""}
                    initialName={initialCustomerName}
                    onValueChange={field.onChange}
                    disabled={disabled}
                  />
                )}
              />
            </Field>
            <Field
              id="referenceType"
              label="Jenis referensi *"
              error={fieldError("referenceType")}
            >
              <Controller
                control={control}
                name="referenceType"
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange} disabled={disabled}>
                    <SelectTrigger id="referenceType" className="w-full" aria-label="Jenis referensi">
                      {REFERENCE_TYPE_LABELS[field.value] ?? "Pilih jenis referensi"}
                    </SelectTrigger>
                    <SelectContent>
                      {REFERENCE_TYPES.map((type) => (
                        <SelectItem key={type} value={type}>
                          {REFERENCE_TYPE_LABELS[type]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
            </Field>
            <Field
              id="referenceNumber"
              label="Nomor referensi *"
              error={fieldError("referenceNumber")}
              hint="mis. 5198021181 (PO) atau SPK/2026/014."
            >
              <Input
                id="referenceNumber"
                spellCheck={false}
                disabled={disabled}
                {...register("referenceNumber")}
              />
            </Field>
            <Field id="referenceDate" label="Tanggal referensi" error={fieldError("referenceDate")}>
              <Input id="referenceDate" type="date" disabled={disabled} {...register("referenceDate")} />
            </Field>
            <Field id="title" label="Judul project *" error={fieldError("title")}>
              <Input id="title" disabled={disabled} {...register("title")} />
            </Field>
            {mode === "edit" ? (
              <Field id="status" label="Status" error={fieldError("status")}>
                <Controller
                  control={control}
                  name="status"
                  render={({ field }) => (
                    <Select
                      value={field.value ?? "ACTIVE"}
                      onValueChange={field.onChange}
                      disabled={disabled}
                    >
                      <SelectTrigger id="status" className="w-full" aria-label="Status project">
                        {PROJECT_STATUS_LABELS[field.value ?? "ACTIVE"]}
                      </SelectTrigger>
                      <SelectContent>
                        {PROJECT_STATUSES.map((status) => (
                          <SelectItem key={status} value={status}>
                            {PROJECT_STATUS_LABELS[status]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                />
              </Field>
            ) : null}
          </div>
          <Field id="description" label="Deskripsi" error={fieldError("description")}>
            <Textarea id="description" rows={3} disabled={disabled} {...register("description")} />
          </Field>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Nilai & jadwal</CardTitle>
          <CardDescription>
            Nilai pekerjaan dan jangka waktu. Mata uang saat ini Rupiah (IDR).
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field
              id="workValue"
              label="Nilai pekerjaan *"
              error={fieldError("workValue")}
              hint="Dalam Rupiah, mis. 450000000 — tanpa simbol Rp."
            >
              <Controller
                control={control}
                name="workValue"
                render={({ field }) => (
                  <CurrencyInput
                    id="workValue"
                    value={field.value ?? ""}
                    onValueChange={field.onChange}
                    disabled={disabled}
                    placeholder="0"
                    aria-invalid={Boolean(fieldError("workValue"))}
                  />
                )}
              />
            </Field>
            <Field id="startDate" label="Tanggal mulai" error={fieldError("startDate")}>
              <Input id="startDate" type="date" disabled={disabled} {...register("startDate")} />
            </Field>
            <Field id="endDate" label="Tanggal selesai" error={fieldError("endDate")}>
              <Input id="endDate" type="date" disabled={disabled} {...register("endDate")} />
            </Field>
          </div>
          <Field id="notes" label="Catatan internal" error={fieldError("notes")}>
            <Textarea id="notes" rows={3} disabled={disabled} {...register("notes")} />
          </Field>
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
                ? "Buat project"
                : "Simpan perubahan"}
          </Button>
        </div>
      ) : null}
    </form>
  );
}
