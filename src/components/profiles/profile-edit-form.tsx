"use client";

// src/components/profiles/profile-edit-form.tsx
// The complete InvoiceProfile edit form (every field in profileUpdateSchema).
// OWNER/ADMIN edit; STAFF/VIEWER get the same page read-only (the server
// rejects their writes too — this only doesn't waste their clicks). The
// invoice preview re-themes live as the accent color changes.

import * as React from "react";
import { useActionState } from "react";
import { updateProfileAction } from "@/modules/profiles/actions";
import type { ActionResult } from "@/lib/api-response";
import type { ProfileView } from "@/modules/profiles/service";
import type { BankAccountView } from "@/modules/bank-accounts/service";
import type { SignerView } from "@/modules/signers/service";
import { bannerError, fieldError } from "@/components/forms/form-utils";
import { LogoUploader } from "@/components/onboarding/logo-uploader";
import {
  InvoicePreview,
  previewDataFromProfile,
} from "@/components/invoice/invoice-preview";
import { NumberPatternField } from "@/components/profiles/number-pattern-field";
import { ColorPicker } from "@/components/profiles/color-picker";
import {
  RESET_POLICY_LABELS,
  STAMP_DISCLAIMER,
  STAMP_MODE_LABELS,
  TAX_MODE_LABELS,
} from "@/components/profiles/labels";
import { toast } from "@/components/ui/toast";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

export interface ProfileEditFormProps {
  profile: ProfileView;
  bank: BankAccountView | null;
  signer: SignerView | null;
  canEdit: boolean;
  maxMb: number;
}

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

export function ProfileEditForm({
  profile,
  bank,
  signer,
  canEdit,
  maxMb,
}: ProfileEditFormProps) {
  const [color, setColor] = React.useState(profile.primaryColor);
  const [logoPath, setLogoPath] = React.useState(profile.logoPath);
  const [policy, setPolicy] = React.useState<ProfileView["sequenceResetPolicy"]>(
    profile.sequenceResetPolicy,
  );
  const [taxMode, setTaxMode] = React.useState<ProfileView["defaultTaxMode"]>(
    profile.defaultTaxMode,
  );
  const [stampMode, setStampMode] = React.useState<ProfileView["defaultStampMode"]>(
    profile.defaultStampMode,
  );

  const [state, formAction, pending] = useActionState<
    ActionResult<{ profile: ProfileView }> | null,
    FormData
  >(
    async (_prev, form) => {
      const result = await updateProfileAction(form);
      if (result.ok) {
        toast.add({ title: "Profil invoice disimpan", type: "success" });
      }
      return result;
    },
    null,
  );

  const banner = bannerError(state);
  const disabled = !canEdit || pending;

  const previewData = {
    ...previewDataFromProfile(profile),
    primaryColor: color,
    logoPath,
  };

  return (
    <div className="flex flex-col gap-6">
      <form action={formAction} className="flex flex-col gap-6" noValidate>
        <input type="hidden" name="profileId" value={profile.id} />
        <input type="hidden" name="sequenceResetPolicy" value={policy} />
        <input type="hidden" name="defaultTaxMode" value={taxMode} />
        <input type="hidden" name="defaultStampMode" value={stampMode} />

        {!canEdit ? (
          <p className="rounded-lg border border-border bg-muted/50 p-3 text-sm text-muted-foreground">
            Anda memiliki akses lihat saja. Hubungi OWNER atau ADMIN workspace untuk mengubah
            profil invoice.
          </p>
        ) : null}

        <Card>
          <CardHeader>
            <CardTitle>Identitas & perusahaan</CardTitle>
            <CardDescription>Nama profil, kode invoice, data legal, dan kontak.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field id="name" label="Nama profil invoice" error={fieldError(state, "name")}>
                <Input id="name" name="name" defaultValue={profile.name} disabled={disabled} />
              </Field>
              <Field
                id="code"
                label="Kode singkat ({CODE})"
                error={fieldError(state, "code")}
                hint="2–8 karakter huruf/angka (mis. SB)."
              >
                <Input
                  id="code"
                  name="code"
                  defaultValue={profile.code}
                  disabled={disabled}
                  spellCheck={false}
                  autoCapitalize="characters"
                />
              </Field>
              <Field id="legalName" label="Nama legal" error={fieldError(state, "legalName")}>
                <Input
                  id="legalName"
                  name="legalName"
                  defaultValue={profile.legalName ?? ""}
                  disabled={disabled}
                />
              </Field>
              <Field id="taxId" label="NPWP" error={fieldError(state, "taxId")}>
                <Input
                  id="taxId"
                  name="taxId"
                  defaultValue={profile.taxId ?? ""}
                  disabled={disabled}
                />
              </Field>
            </div>
            <Field id="address" label="Alamat" error={fieldError(state, "address")}>
              <Textarea
                id="address"
                name="address"
                rows={3}
                defaultValue={profile.address ?? ""}
                disabled={disabled}
              />
            </Field>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field id="phone" label="Telepon" error={fieldError(state, "phone")}>
                <Input
                  id="phone"
                  name="phone"
                  defaultValue={profile.phone ?? ""}
                  disabled={disabled}
                />
              </Field>
              <Field id="whatsapp" label="WhatsApp" error={fieldError(state, "whatsapp")}>
                <Input
                  id="whatsapp"
                  name="whatsapp"
                  defaultValue={profile.whatsapp ?? ""}
                  disabled={disabled}
                />
              </Field>
              <Field id="fax" label="Fax" error={fieldError(state, "fax")}>
                <Input id="fax" name="fax" defaultValue={profile.fax ?? ""} disabled={disabled} />
              </Field>
              <Field id="email" label="Email" error={fieldError(state, "email")}>
                <Input
                  id="email"
                  name="email"
                  type="email"
                  defaultValue={profile.email ?? ""}
                  disabled={disabled}
                />
              </Field>
            </div>
            <Field id="website" label="Website" error={fieldError(state, "website")}>
              <Input
                id="website"
                name="website"
                type="url"
                defaultValue={profile.website ?? ""}
                disabled={disabled}
              />
            </Field>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Tampilan</CardTitle>
            <CardDescription>
              Logo perusahaan dan warna aksen invoice.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-5">
            <LogoUploader
              profileId={profile.id}
              logoPath={logoPath}
              maxMb={maxMb}
              disabled={!canEdit || pending}
              onProfileUpdated={(updated) => setLogoPath(updated.logoPath)}
            />
            <ColorPicker value={color} onChange={setColor} disabled={disabled} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Penomoran</CardTitle>
            <CardDescription>Pola nomor invoice dan reset nomor urut.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-5">
            <NumberPatternField
              code={profile.code}
              defaultValue={profile.numberPattern}
              disabled={disabled}
            />
            {fieldError(state, "numberPattern") ? (
              <p role="alert" className="text-sm text-destructive">
                {fieldError(state, "numberPattern")}
              </p>
            ) : null}
            <Field id="sequenceResetPolicyField" label="Reset nomor urut">
              <Select
                value={policy}
                onValueChange={(value) =>
                  setPolicy(value as ProfileView["sequenceResetPolicy"])
                }
                disabled={disabled}
              >
                <SelectTrigger
                  id="sequenceResetPolicyField"
                  className="w-full"
                  aria-label="Reset nomor urut"
                >
                  {RESET_POLICY_LABELS[policy]}
                </SelectTrigger>
                <SelectContent>
                  {(
                    Object.keys(RESET_POLICY_LABELS) as Array<
                      ProfileView["sequenceResetPolicy"]
                    >
                  ).map((key) => (
                    <SelectItem key={key} value={key}>
                      {RESET_POLICY_LABELS[key]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Pajak & meterai</CardTitle>
            <CardDescription>PPN default dan preferensi area meterai.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-5">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field id="defaultTaxModeField" label="Mode pajak (PPN)" error={fieldError(state, "defaultTaxMode")}>
                <Select
                  value={taxMode}
                  onValueChange={(value) => setTaxMode(value as ProfileView["defaultTaxMode"])}
                  disabled={disabled}
                >
                  <SelectTrigger
                    id="defaultTaxModeField"
                    className="w-full"
                    aria-label="Mode pajak"
                  >
                    {TAX_MODE_LABELS[taxMode]}
                  </SelectTrigger>
                  <SelectContent>
                    {(Object.keys(TAX_MODE_LABELS) as Array<ProfileView["defaultTaxMode"]>).map(
                      (key) => (
                        <SelectItem key={key} value={key}>
                          {TAX_MODE_LABELS[key]}
                        </SelectItem>
                      ),
                    )}
                  </SelectContent>
                </Select>
              </Field>
              <Field
                id="defaultTaxPercent"
                label="Persentase pajak (%)"
                error={fieldError(state, "defaultTaxPercent")}
                hint={
                  taxMode === "NONE"
                    ? "Tidak dipakai saat mode tanpa pajak — nilai disimpan dikosongkan."
                    : "mis. 11 atau 11.5"
                }
              >
                <Input
                  id="defaultTaxPercent"
                  name="defaultTaxPercent"
                  inputMode="decimal"
                  defaultValue={profile.defaultTaxPercent?.toString() ?? ""}
                  disabled={disabled || taxMode === "NONE"}
                />
              </Field>
            </div>

            <Field id="defaultStampModeField" label="Preferensi meterai" error={fieldError(state, "defaultStampMode")}>
              <Select
                value={stampMode}
                onValueChange={(value) => setStampMode(value as ProfileView["defaultStampMode"])}
                disabled={disabled}
              >
                <SelectTrigger
                  id="defaultStampModeField"
                  className="w-full"
                  aria-label="Preferensi meterai"
                >
                  {STAMP_MODE_LABELS[stampMode]}
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(STAMP_MODE_LABELS) as Array<ProfileView["defaultStampMode"]>).map(
                    (key) => (
                      <SelectItem key={key} value={key}>
                        {STAMP_MODE_LABELS[key]}
                      </SelectItem>
                    ),
                  )}
                </SelectContent>
              </Select>
            </Field>
            <div className="rounded-lg border border-dashed border-amber-500/60 bg-amber-500/10 p-3 text-xs">
              <p className="font-semibold">Catatan meterai</p>
              <p>{STAMP_DISCLAIMER}</p>
            </div>

            <Field
              id="defaultNotes"
              label="Catatan default"
              error={fieldError(state, "defaultNotes")}
              hint="Tampil di bawah invoice (mis. termin pembayaran)."
            >
              <Textarea
                id="defaultNotes"
                name="defaultNotes"
                rows={3}
                defaultValue={profile.defaultNotes ?? ""}
                disabled={disabled}
              />
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
            <Button type="submit" disabled={pending}>
              {pending ? "Menyimpan…" : "Simpan perubahan"}
            </Button>
          </div>
        ) : null}
      </form>

      <Card>
        <CardHeader>
          <CardTitle>Preview invoice</CardTitle>
          <CardDescription>
            Contoh invoice dengan data profil — warna mengikuti pilihan di atas.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <InvoicePreview data={previewData} bank={bank} signer={signer} />
        </CardContent>
      </Card>
    </div>
  );
}
