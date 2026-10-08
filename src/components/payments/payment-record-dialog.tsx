"use client";

// src/components/payments/payment-record-dialog.tsx
// "Catat pembayaran" dialog (feature 07): RHF + Zod form with a currency
// input, date picker, method select, optional reference/notes and an optional
// proof upload. Two shapes, one component:
//
//   • fixed target (invoice detail) — the invoice is not pickable;
//   • picker (/payments) — choose among the organization's payable invoices.
//
// Overpayment (amount > sisa tagihan) surfaces a warning: STAFF confirms,
// OWNER/ADMIN give a reason (canOverrideOverpayment). The server re-derives
// and re-validates BOTH — this client state is a courtesy, never the rule.

import * as React from "react";
import { useRouter } from "next/navigation";
import { zodResolver } from "@hookform/resolvers/zod";
import { Controller, useForm, useWatch } from "react-hook-form";
import Decimal from "decimal.js";
import { PlusIcon, TriangleAlertIcon } from "lucide-react";
import { toast } from "@/components/ui/toast";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { CurrencyInput } from "@/components/projects/currency-input";
import { INVOICE_STATUS_LABELS } from "@/components/invoice/invoice-status-badge";
import { todayInJakarta } from "@/lib/date";
import { formatIdr } from "@/lib/money";
import { recordPaymentAction } from "@/modules/payments/actions";
import {
  PAYMENT_METHODS,
  PAYMENT_METHOD_LABELS,
  paymentFormSchema,
  type PaymentFormValues,
} from "@/modules/payments/schema";
import type { PayableInvoiceOption } from "@/modules/payments/service";

const PROOF_ACCEPT = "application/pdf,image/png,image/jpeg,image/webp";

export interface PaymentRecordDialogProps {
  /** Payable invoices; the first entry is the default selection. */
  invoices: PayableInvoiceOption[];
  /** Fixed target (invoice detail): hides the picker. */
  fixedInvoiceId?: string;
  /** OWNER/ADMIN: overpayment needs a reason; STAFF confirms instead. */
  canOverrideOverpayment: boolean;
  /** Server-side size ceiling, mirrored here for instant feedback. */
  maxUploadMb: number;
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

export function PaymentRecordDialog({
  invoices,
  fixedInvoiceId,
  canOverrideOverpayment,
  maxUploadMb,
}: PaymentRecordDialogProps) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [invoiceId, setInvoiceId] = React.useState(
    fixedInvoiceId ?? invoices[0]?.id ?? "",
  );
  const [proof, setProof] = React.useState<File | null>(null);
  const [confirmed, setConfirmed] = React.useState(false);
  const [overrideReason, setOverrideReason] = React.useState("");
  const [affirmError, setAffirmError] = React.useState<string | null>(null);
  const [banner, setBanner] = React.useState<string | null>(null);
  // CurrencyInput seeds its display from the value ONCE — bumping the key
  // remounts it so a reset really clears what the user sees.
  const [formKey, setFormKey] = React.useState(0);

  const form = useForm<PaymentFormValues>({
    resolver: zodResolver(paymentFormSchema),
    defaultValues: {
      paymentDate: todayInJakarta(),
      amount: "",
      method: "BANK_TRANSFER",
      referenceNumber: "",
      notes: "",
    },
  });
  const {
    register,
    control,
    handleSubmit,
    reset,
    setError,
    formState: { errors, isSubmitting },
  } = form;

  function fieldError(name: keyof PaymentFormValues): string | undefined {
    const message = errors[name]?.message;
    return typeof message === "string" ? message : undefined;
  }

  const target = invoices.find((row) => row.id === invoiceId) ?? null;
  // useWatch (not watch()) — subscribes to one field without the
  // incompatible-library warning React Compiler raises for watch().
  const amountRaw = useWatch({ control, name: "amount" });
  const amountValue = new Decimal(amountRaw || "0");
  const isOverpay =
    target !== null && amountValue.gt(0) && amountValue.gt(new Decimal(target.remaining));

  function close() {
    if (isSubmitting) return;
    setOpen(false);
    setBanner(null);
    setAffirmError(null);
    setProof(null);
    setConfirmed(false);
    setOverrideReason("");
    setInvoiceId(fixedInvoiceId ?? invoices[0]?.id ?? "");
    reset({
      paymentDate: todayInJakarta(),
      amount: "",
      method: "BANK_TRANSFER",
      referenceNumber: "",
      notes: "",
    });
    setFormKey((key) => key + 1);
  }

  const onSubmit = handleSubmit(async (values) => {
    if (!target) {
      setBanner("Pilih invoice yang akan dicatat pembayarannya.");
      return;
    }
    if (isOverpay) {
      if (canOverrideOverpayment) {
        if (overrideReason.trim() === "") {
          setAffirmError("Alasan override wajib diisi.");
          return;
        }
      } else if (!confirmed) {
        setAffirmError("Centang konfirmasi untuk melanjutkan.");
        return;
      }
    }
    setAffirmError(null);
    setBanner(null);

    const form = new FormData();
    form.set("invoiceId", target.id);
    form.set("paymentDate", values.paymentDate);
    form.set("amount", values.amount);
    form.set("method", values.method);
    if (values.referenceNumber) form.set("referenceNumber", values.referenceNumber);
    if (values.notes) form.set("notes", values.notes);
    form.set("confirmOverpayment", isOverpay ? "true" : "false");
    if (isOverpay && canOverrideOverpayment) form.set("overpaymentReason", overrideReason.trim());
    if (proof) form.set("proof", proof);

    const result = await recordPaymentAction(form);
    if (result.ok) {
      toast.add({
        title: "Pembayaran dicatat",
        description: `${formatIdr(result.data.amountPaid)} tercatat — status ${INVOICE_STATUS_LABELS[result.data.status]}.`,
        type: "success",
      });
      setOpen(false);
      setProof(null);
      setConfirmed(false);
      setOverrideReason("");
      reset({
        paymentDate: todayInJakarta(),
        amount: "",
        method: "BANK_TRANSFER",
        referenceNumber: "",
        notes: "",
      });
      setFormKey((key) => key + 1);
      router.refresh();
      return;
    }

    const details = result.error.details;
    let fieldShown = false;
    if (details && typeof details === "object") {
      for (const [field, message] of Object.entries(details)) {
        if (typeof message === "string" && field in values) {
          setError(field as keyof PaymentFormValues, { message });
          fieldShown = true;
        }
      }
    }
    if (!fieldShown) setBanner(result.error.message);
  });

  if (invoices.length === 0) return null;

  return (
    <>
      <Button type="button" onClick={() => setOpen(true)} data-testid="record-payment">
        <PlusIcon aria-hidden="true" />
        Catat pembayaran
      </Button>

      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (!next && !isSubmitting) close();
        }}
      >
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Catat pembayaran</DialogTitle>
            <DialogDescription>
              Pembayaran dicatat manual atas invoice terbit. Status invoice diperbarui otomatis
              menjadi Dibayar sebagian atau Lunas.
            </DialogDescription>
          </DialogHeader>

          <form
            className="flex flex-col gap-4"
            onSubmit={(event) => {
              event.preventDefault();
              void onSubmit();
            }}
            noValidate
          >
            {!fixedInvoiceId ? (
              <Field id="paymentInvoice" label="Invoice *">
                <Select
                  value={invoiceId}
                  onValueChange={(value) => setInvoiceId(value ?? "")}
                  disabled={isSubmitting}
                >
                  <SelectTrigger
                    id="paymentInvoice"
                    className="w-full"
                    aria-label="Invoice"
                  >
                    {target
                      ? `${target.label} — ${target.customerName}`
                      : "Pilih invoice"}
                  </SelectTrigger>
                  <SelectContent>
                    {invoices.map((row) => (
                      <SelectItem key={row.id} value={row.id}>
                        {row.label} — {row.customerName} (sisa {formatIdr(row.remaining)})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            ) : (
              <p className="rounded-lg border border-border bg-muted/50 p-3 font-mono text-sm">
                {target ? `${target.label} — ${target.customerName}` : fixedInvoiceId}
              </p>
            )}

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field
                id="paymentDate"
                label="Tanggal pembayaran *"
                error={fieldError("paymentDate")}
              >
                <Input
                  id="paymentDate"
                  type="date"
                  disabled={isSubmitting}
                  {...register("paymentDate")}
                />
              </Field>
              <Field
                id="paymentMethod"
                label="Metode *"
                error={fieldError("method")}
              >
                <Controller
                  control={control}
                  name="method"
                  render={({ field }) => (
                    <Select
                      value={field.value}
                      onValueChange={field.onChange}
                      disabled={isSubmitting}
                    >
                      <SelectTrigger id="paymentMethod" className="w-full" aria-label="Metode">
                        {PAYMENT_METHOD_LABELS[field.value] ?? "Pilih metode"}
                      </SelectTrigger>
                      <SelectContent>
                        {PAYMENT_METHODS.map((method) => (
                          <SelectItem key={method} value={method}>
                            {PAYMENT_METHOD_LABELS[method]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                />
              </Field>
            </div>

            <Field
              id="paymentAmount"
              label="Nominal *"
              error={fieldError("amount")}
              hint={
                target
                  ? `Sisa tagihan ${formatIdr(target.remaining)} dari ${formatIdr(target.grandTotal)}.`
                  : undefined
              }
            >
              <Controller
                control={control}
                name="amount"
                render={({ field }) => (
                  <CurrencyInput
                    key={formKey}
                    id="paymentAmount"
                    value={field.value ?? ""}
                    onValueChange={field.onChange}
                    disabled={isSubmitting}
                    placeholder="0"
                    aria-invalid={Boolean(fieldError("amount"))}
                  />
                )}
              />
            </Field>

            {isOverpay && target ? (
              <div className="flex flex-col gap-2 rounded-lg border border-warning/40 bg-warning/10 p-3">
                <p className="flex items-center gap-2 text-sm font-medium text-warning">
                  <TriangleAlertIcon aria-hidden="true" className="size-4 shrink-0" />
                  Nominal melebihi sisa tagihan {formatIdr(target.remaining)}.
                </p>
                {canOverrideOverpayment ? (
                  <div className="flex flex-col gap-1">
                    <Label htmlFor="overpayment-reason">Alasan override (wajib)</Label>
                    <Textarea
                      id="overpayment-reason"
                      rows={2}
                      maxLength={500}
                      value={overrideReason}
                      placeholder="Contoh: pelunasan termasuk bunga keterlambatan."
                      onChange={(event) => {
                        setOverrideReason(event.target.value);
                        if (affirmError) setAffirmError(null);
                      }}
                    />
                  </div>
                ) : (
                  <Label
                    htmlFor="overpayment-confirm"
                    className="flex items-start gap-2 font-normal"
                  >
                    <Checkbox
                      id="overpayment-confirm"
                      checked={confirmed}
                      onCheckedChange={(checked) => {
                        setConfirmed(checked === true);
                        if (affirmError) setAffirmError(null);
                      }}
                      disabled={isSubmitting}
                    />
                    <span className="text-sm">
                      Saya memahami nominal ini melebihi sisa tagihan dan mencatatnya atas
                      tanggung jawab saya.
                    </span>
                  </Label>
                )}
                {affirmError ? (
                  <p className="text-sm text-destructive" role="alert">
                    {affirmError}
                  </p>
                ) : null}
              </div>
            ) : null}

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field
                id="paymentReference"
                label="Nomor referensi"
                error={fieldError("referenceNumber")}
                hint="mis. 12345678 (mutasi bank) — opsional."
              >
                <Input
                  id="paymentReference"
                  autoComplete="off"
                  disabled={isSubmitting}
                  {...register("referenceNumber")}
                />
              </Field>
              <Field id="paymentProof" label="Bukti pembayaran" hint={`PDF, PNG, JPEG, atau WebP — maksimal ${maxUploadMb} MB. Tipe file diperiksa dari isi berkasnya.`}>
                <input
                  id="paymentProof"
                  type="file"
                  accept={PROOF_ACCEPT}
                  disabled={isSubmitting}
                  onChange={(event) => {
                    const next = event.target.files?.[0] ?? null;
                    if (next && next.size > maxUploadMb * 1024 * 1024) {
                      toast.add({
                        title: "File terlalu besar",
                        description: `Ukuran file melebihi batas ${maxUploadMb} MB. Kompres atau pilih file yang lebih kecil.`,
                        type: "error",
                      });
                      event.target.value = "";
                      return;
                    }
                    setProof(next);
                  }}
                  className="text-sm file:mr-3 file:cursor-pointer file:rounded-md file:border file:border-border file:bg-background file:px-3 file:py-1.5 file:text-sm file:font-medium hover:file:bg-muted"
                />
              </Field>
            </div>
            {proof ? (
              <p className="text-xs text-muted-foreground">Bukti terpilih: {proof.name}</p>
            ) : null}

            <Field id="paymentNotes" label="Catatan" error={fieldError("notes")}>
              <Textarea
                id="paymentNotes"
                rows={2}
                maxLength={500}
                disabled={isSubmitting}
                {...register("notes")}
              />
            </Field>

            {banner ? (
              <p role="alert" className="text-sm text-destructive">
                {banner}
              </p>
            ) : null}

            <DialogFooter>
              <DialogClose render={<Button type="button" variant="outline" disabled={isSubmitting} />}>
                Batal
              </DialogClose>
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting ? "Menyimpan..." : "Catat pembayaran"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
