"use client";

// src/components/bank-accounts/bank-account-form.tsx
// Bank account create/edit form (feature 10). Plain FormData +
// useActionState — the same shape onboarding step 6 established for these
// fields — so the Zod schema runs once on the server at the boundary and the
// plaintext number travels in exactly one direction (into the form). VIEWER
// gets the identical form read-only with the MASKED number: their "full number"
// is never in the HTML at all (spec: nomor lengkap hanya dengan permission).

import * as React from "react";
import { useActionState } from "react";
import { useRouter } from "next/navigation";
import { EyeIcon, EyeOffIcon } from "lucide-react";
import { toast } from "@/components/ui/toast";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { bannerError, fieldError } from "@/components/forms/form-utils";
import {
  createBankAccountAction,
  updateBankAccountAction,
} from "@/modules/bank-accounts/actions";
import type { ActionResult } from "@/lib/api-response";

function FieldError({ message }: { message?: string }) {
  if (!message) return null;
  return (
    <p role="alert" className="text-sm text-destructive">
      {message}
    </p>
  );
}

export interface BankAccountFormProps {
  mode: "create" | "edit";
  /** Present in edit mode — the action scopes it (server re-verifies org). */
  bankAccountId?: string;
  defaultValues: {
    bankName: string;
    bankCode: string;
    accountHolder: string;
    branch: string;
    isDefault: boolean;
    isActive: boolean;
  };
  /**
   * What the account-number input shows: the full value for editors (STAFF+),
   * the masked value for VIEWER, empty on create.
   */
  accountNumberValue: string;
  /** True when the masked value is being displayed (VIEWER). */
  accountNumberMasked: boolean;
  canEdit: boolean;
}

export function BankAccountForm({
  mode,
  bankAccountId,
  defaultValues,
  accountNumberValue,
  accountNumberMasked,
  canEdit,
}: BankAccountFormProps) {
  const router = useRouter();
  const [showNumber, setShowNumber] = React.useState(false);
  const [isDefault, setIsDefault] = React.useState(defaultValues.isDefault);
  const [isActive, setIsActive] = React.useState(defaultValues.isActive);

  const [state, formAction, pending] = useActionState<
    ActionResult<{ bankAccountId: string }> | null,
    FormData
  >(
    async (_prev, form) => {
      const result =
        mode === "create"
          ? await createBankAccountAction(form)
          : await updateBankAccountAction(form);
      if (result.ok) {
        toast.add({
          title: mode === "create" ? "Rekening dibuat" : "Perubahan disimpan",
          description: "Nomor rekening disimpan terenkripsi (AES-256-GCM).",
          type: "success",
        });
        if (mode === "create") {
          router.push(`/bank-accounts/${result.data.bankAccountId}`);
        } else {
          router.refresh();
        }
      }
      return result;
    },
    null,
  );

  const banner = bannerError(state);
  const disabled = !canEdit || pending;

  return (
    <form action={formAction} className="flex flex-col gap-6" noValidate>
      {bankAccountId ? <input type="hidden" name="bankAccountId" value={bankAccountId} /> : null}
      <input type="hidden" name="isDefault" value={String(isDefault)} />
      <input type="hidden" name="isActive" value={String(isActive)} />

      {!canEdit ? (
        <p className="rounded-lg border border-border bg-muted/50 p-3 text-sm text-muted-foreground">
          Mode lihat saja. Hanya STAFF, ADMIN, atau OWNER yang dapat mengubah data rekening —
          nomor rekening ditampilkan termask.
        </p>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Rekening bank</CardTitle>
          <CardDescription>
            Nomor rekening dienkripsi di rest (AES-256-GCM) dan hanya tampil utuh di dokumen
            invoice terbit.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-2">
              <Label htmlFor="bankName">Nama bank</Label>
              <Input
                id="bankName"
                name="bankName"
                placeholder="mis. Bank Central Asia"
                defaultValue={defaultValues.bankName}
                disabled={disabled}
                aria-invalid={Boolean(fieldError(state, "bankName")) || undefined}
              />
              <FieldError message={fieldError(state, "bankName")} />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="bankCode">Kode bank (opsional)</Label>
              <Input
                id="bankCode"
                name="bankCode"
                placeholder="mis. BCA"
                defaultValue={defaultValues.bankCode}
                disabled={disabled}
                aria-invalid={Boolean(fieldError(state, "bankCode")) || undefined}
              />
              <FieldError message={fieldError(state, "bankCode")} />
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="accountNumber">Nomor rekening</Label>
            <div className="flex items-center gap-2">
              <Input
                id="accountNumber"
                name="accountNumber"
                type={showNumber ? "text" : "password"}
                inputMode="numeric"
                autoComplete="off"
                placeholder={
                  mode === "edit"
                    ? "biarkan kosong untuk mempertahankan nomor saat ini"
                    : "mis. 1234567890"
                }
                defaultValue={accountNumberValue}
                disabled={disabled}
                aria-invalid={Boolean(fieldError(state, "accountNumber")) || undefined}
              />
              <Button
                type="button"
                variant="outline"
                size="icon"
                aria-label={showNumber ? "Sembunyikan nomor rekening" : "Tampilkan nomor rekening"}
                disabled={disabled}
                onClick={() => setShowNumber((value) => !value)}
              >
                {showNumber ? <EyeOffIcon aria-hidden="true" /> : <EyeIcon aria-hidden="true" />}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              {accountNumberMasked
                ? "Akses lihat saja — nomor ditampilkan termask."
                : "6–34 digit. Disimpan terenkripsi; kolom kosong = pertahankan nomor tersimpan."}
            </p>
            <FieldError message={fieldError(state, "accountNumber")} />
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-2">
              <Label htmlFor="accountHolder">Atas nama</Label>
              <Input
                id="accountHolder"
                name="accountHolder"
                autoComplete="off"
                defaultValue={defaultValues.accountHolder}
                disabled={disabled}
                aria-invalid={Boolean(fieldError(state, "accountHolder")) || undefined}
              />
              <FieldError message={fieldError(state, "accountHolder")} />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="branch">Cabang (opsional)</Label>
              <Input
                id="branch"
                name="branch"
                defaultValue={defaultValues.branch}
                disabled={disabled}
                aria-invalid={Boolean(fieldError(state, "branch")) || undefined}
              />
              <FieldError message={fieldError(state, "branch")} />
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="currency">Mata uang</Label>
            <Input id="currency" value="IDR" disabled aria-describedby="currency-hint" />
            <p id="currency-hint" className="text-xs text-muted-foreground">
              MVP hanya Rupiah — konversi mata uang di luar scope.
            </p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Pengaturan</CardTitle>
          <CardDescription>
            Rekening utama menjadi preset saat membuat invoice. Rekening nonaktif tetap tampil di
            sini tetapi hilang dari pilihan invoice.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <Label htmlFor="isDefault" className="flex items-center gap-2 font-normal">
            <Checkbox
              id="isDefault"
              checked={isDefault}
              onCheckedChange={(checked) => setIsDefault(checked === true)}
              disabled={disabled}
            />
            <span className="text-sm">Jadikan rekening utama</span>
          </Label>
          <Label htmlFor="isActive" className="flex items-center gap-2 font-normal">
            <Checkbox
              id="isActive"
              checked={isActive}
              onCheckedChange={(checked) => setIsActive(checked === true)}
              disabled={disabled}
            />
            <span className="text-sm">Rekening aktif</span>
          </Label>
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
            {pending
              ? "Menyimpan..."
              : mode === "create"
                ? "Buat rekening"
                : "Simpan perubahan"}
          </Button>
        </div>
      ) : null}
    </form>
  );
}
