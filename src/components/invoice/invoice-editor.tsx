"use client";

// src/components/invoice/invoice-editor.tsx
// Feature 04's split-screen draft editor — the ONLY place the invoice form
// lives. One source component for /invoices/new and /invoices/[id]/edit.
//
// Data flow contract (architecture invariants):
//   1. Money is a decimal STRING everywhere in the browser — never a float.
//   2. The live preview runs the SAME calculateInvoice module the server runs,
//      so what the user sees is what the server will store.
//   3. Every save goes through the server action, which re-validates with the
//      same Zod schema and recalculates server-side. The client total is never
//      trusted.
//
// Feature 04 scope: Simpan Draft + Pratinjau only. "Issue Invoice" is feature
// 05 and is deliberately absent (no placeholder button that does nothing).

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { SaveIcon, LoaderCircleIcon } from "lucide-react";
import {
  createInvoiceDraftAction,
  getInvoiceDraftAction,
  invoiceNumberPreviewAction,
  listInvoiceCustomerContactsAction,
  prefillInvoiceFromProjectAction,
  updateInvoiceDraftAction,
} from "@/modules/invoices/actions";
import type { ActionResult } from "@/lib/api-response";
import {
  BILLING_MODE_LABELS,
  INVOICE_TAX_MODE_LABELS,
  INVOICE_TYPE_LABELS,
  INVOICE_TYPES,
  STAMP_MODES,
  TAX_MODES,
  type InvoiceTypeValue,
  type StampModeValue,
  type TaxModeValue,
} from "@/modules/invoices/schema";
import { REFERENCE_TYPE_LABELS, REFERENCE_TYPES } from "@/modules/projects/schema";
import { formatIdr } from "@/lib/money";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useNavigationBlocker } from "@/components/layout/navigation-blocker";
import { CurrencyInput } from "@/components/projects/currency-input";
import { ItemTable } from "@/components/invoice/item-table";
import { InvoiceRenderer } from "@/components/invoice/InvoiceRenderer";
import {
  buildRendererPreviewData,
  type InvoiceRendererData,
  type RendererParty,
} from "@/components/invoice/renderer-data";
import {
  canAutosave,
  dirtyFingerprint,
  editorValuesFromDraft,
  emptyEditorValues,
  newItemRow,
  rendererValuesOf,
  toDraftPayload,
  type EditorFormValues,
  type EditorItemRow,
} from "@/components/invoice/editor-state";
import type {
  DraftPartyView,
  EditorOptions,
  InvoiceDraftView,
} from "@/modules/invoices/service";

const AUTOSAVE_DEBOUNCE_MS = 1000;

type SaveState =
  | { kind: "idle" }
  | { kind: "saving" }
  | { kind: "saved"; at: number }
  | { kind: "error"; message: string };

/** Map the persisted customer view onto the renderer's party shape. */
function draftPartyToRenderer(customer: DraftPartyView): RendererParty {
  return {
    name: customer.companyName,
    address: [customer.address, customer.city, customer.province, customer.postalCode, customer.country]
      .filter(Boolean)
      .join(", "),
    phone: customer.phone,
    email: customer.email,
    taxId: customer.taxId,
  };
}

/** Prefill result shape the editor consumes (the action wraps it in ActionResult). */
interface PrefillResult {
  customerId: string;
  referenceType: string;
  referenceNumber: string;
  referenceDate: string;
  workValueOverrideAmount: string;
  workValueReason: string;
  items: Array<{ description: string }>;
}

export interface InvoiceEditorProps {
  options: EditorOptions;
  /** Present on the edit page: the draft to load (server already fetched it). */
  initialDraft?: InvoiceDraftView;
  /** Server-side preflight result for /invoices/new?project=<id>. */
  initialPrefill?: { projectId: string; data: PrefillResult };
}

export function InvoiceEditor({ options, initialDraft, initialPrefill }: InvoiceEditorProps) {
  const router = useRouter();
  const isEdit = Boolean(initialDraft);

  const profiles = options.profiles;
  const firstProfile = profiles[0];

  const [values, setValues] = React.useState<EditorFormValues>(() => {
    if (initialDraft) return editorValuesFromDraft(initialDraft);
    const fresh = emptyEditorValues();
    if (firstProfile) {
      fresh.profileId = firstProfile.id;
      fresh.taxMode = firstProfile.defaultTaxMode;
      fresh.taxPercent = firstProfile.defaultTaxPercent ?? "11";
      fresh.stampMode = (firstProfile.defaultStampMode as StampModeValue) ?? "NONE";
      fresh.notes = firstProfile.defaultNotes ?? "";
      fresh.bankAccountId = firstProfile.defaultBankAccountId ?? "";
      fresh.signerId = firstProfile.defaultSignerId ?? "";
    }
    return fresh;
  });

  const [saveState, setSaveState] = React.useState<SaveState>({ kind: "idle" });
  const [validationError, setValidationError] = React.useState<string | null>(null);
  const [invoiceId, setInvoiceId] = React.useState<string | null>(initialDraft?.id ?? null);
  const [numberPreview, setNumberPreview] = React.useState<string | null>(
    initialDraft?.numberPreview ?? null,
  );
  const [customerParty, setCustomerParty] = React.useState<RendererParty | null>(
    initialDraft?.customer ? draftPartyToRenderer(initialDraft.customer) : null,
  );
  const [contactName, setContactName] = React.useState<string | null>(
    initialDraft?.contactName ?? null,
  );
  const [contacts, setContacts] = React.useState<
    Array<{ id: string; name: string; title: string | null; isPrimary: boolean }>
  >([]);
  const [projectTitle, setProjectTitle] = React.useState<string | null>(
    initialDraft?.projectTitle ?? null,
  );
  const [previouslyBilled, setPreviouslyBilled] = React.useState<string>(
    initialDraft?.previouslyBilled ?? "0",
  );

  const [savedFingerprint, setSavedFingerprint] = React.useState<string>(() =>
    dirtyFingerprint(initialDraft ? editorValuesFromDraft(initialDraft) : values),
  );
  // Mirror of savedFingerprint that reads are safe from render-phase effects
  // (React 19 lint: no setState during render).
  const lastSavedFingerprint = React.useRef(savedFingerprint);
  React.useEffect(() => {
    lastSavedFingerprint.current = savedFingerprint;
  }, [savedFingerprint]);

  // ── Preflight from /invoices/new?project=<id> (feature 03 contract) ──────
  // One-shot sync from URL search params (external source) — the setState
  // here seeds the form once on open, so React's set-state-in-effect warning
  // does not apply.
  React.useEffect(() => {
    if (isEdit || !initialPrefill) return;
    const prefill = initialPrefill.data;
    const projectId = initialPrefill.projectId;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setValues((current) => ({
      ...current,
      customerId: prefill.customerId,
      projectReferenceId: projectId,
      referenceType: prefill.referenceType,
      referenceNumber: prefill.referenceNumber,
      referenceDate: prefill.referenceDate,
      workValueOverride: true,
      workValueOverrideAmount: prefill.workValueOverrideAmount,
      workValueReason: prefill.workValueReason,
      items: prefill.items.length > 0 ? prefill.items.map(() => newItemRow()) : current.items,
    }));
    const project = options.projects.find((row) => row.id === projectId);
    if (project) {
      setProjectTitle(project.title);
      setPreviouslyBilled(project.previouslyBilled);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one-shot preflight on open
  }, []);

  const activeProfile = profiles.find((profile) => profile.id === values.profileId) ?? null;

  // ── Live number preview (non-allocating read of the sequence bucket) ─────
  // Async server fetch — state is set from the resolved promise, not
  // synchronously during the effect body.
  React.useEffect(() => {
    if (!activeProfile) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setNumberPreview(null);
      return;
    }
    let cancelled = false;
    invoiceNumberPreviewAction({
      profileId: activeProfile.id,
      invoiceDate: values.invoiceDate,
    }).then((result: ActionResult<string | null>) => {
      if (!cancelled && result.ok) setNumberPreview(result.data);
    });
    return () => {
      cancelled = true;
    };
  }, [activeProfile, values.invoiceDate]);

  const customerProject = React.useMemo(
    () => options.projects.find((project) => project.id === values.projectReferenceId) ?? null,
    [options.projects, values.projectReferenceId],
  );

  // ── Customer lookup: PIC options + bill-to block for the preview ─────────
  // Early-return reset + async server fetch — neither cascades renders.
  React.useEffect(() => {
    if (!values.customerId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setContacts([]);
      setCustomerParty(null);
      setContactName(null);
      return;
    }
    let cancelled = false;
    listInvoiceCustomerContactsAction({ customerId: values.customerId }).then((result) => {
      if (cancelled || !result.ok) return;
      const { customer, contacts } = result.data;
      setContacts(contacts);
      setCustomerParty(customer ? { name: customer.companyName, address: customer.address, phone: customer.phone, email: customer.email, taxId: customer.taxId } : null);
      // Keep a stale PIC selection only while it still belongs to this customer.
      setContactName((currentName) => {
        const selected = values.customerContactId
          ? contacts.find((row) => row.id === values.customerContactId)?.name ?? null
          : contacts.find((row) => row.isPrimary)?.name ?? null;
        return currentName !== selected && selected !== undefined ? selected : currentName;
      });
    });
    return () => {
      cancelled = true;
    };
  }, [values.customerId, values.customerContactId]);

  // ── Live preview: same decimal engine as the server ─────────────────────
  const previewData: InvoiceRendererData | null = React.useMemo(() => {
    if (!activeProfile) return null;
    const bank = options.banks.find((row) => row.id === values.bankAccountId) ?? null;
    const signer = options.signers.find((row) => row.id === values.signerId) ?? null;
    return buildRendererPreviewData({
      values: rendererValuesOf(values),
      numberPreview,
      profile: {
        name: activeProfile.name,
        legalName: activeProfile.legalName,
        logoPath: activeProfile.logoPath,
        primaryColor: activeProfile.primaryColor,
        address: activeProfile.address,
        phone: activeProfile.phone,
        whatsapp: activeProfile.whatsapp,
        fax: activeProfile.fax,
        email: activeProfile.email,
        website: activeProfile.website,
        taxId: activeProfile.taxId,
      },
      customer: customerParty,
      contactName,
      projectTitle,
      bank: bank ? { bankName: bank.bankName, accountHolder: bank.accountHolder, maskedNumber: bank.maskedNumber, branch: bank.branch } : null,
      signer: signer ? { name: signer.name, title: signer.title, location: signer.location, signaturePath: signer.signaturePath } : null,
      previouslyBilled: customerProject?.previouslyBilled ?? previouslyBilled,
      currency: "IDR",
    });
  }, [
    activeProfile,
    options.banks,
    options.signers,
    values,
    numberPreview,
    customerParty,
    contactName,
    projectTitle,
    previouslyBilled,
    customerProject,
  ]);

  const isDirty = React.useMemo(
    () => dirtyFingerprint(values) !== savedFingerprint,
    [values, savedFingerprint],
  );

  async function persist(current: EditorFormValues) {
    if (!canAutosave(current)) return;
    setValidationError(null);
    setSaveState({ kind: "saving" });
    const payload = toDraftPayload(current, invoiceId ?? undefined);
    const result = invoiceId
      ? await updateInvoiceDraftAction(payload as never)
      : await createInvoiceDraftAction(payload);
    if (!result.ok) {
      setSaveState({ kind: "error", message: result.error.message });
      return;
    }
    lastSavedFingerprint.current = dirtyFingerprint(current);
    setSavedFingerprint(dirtyFingerprint(current));
    if (!invoiceId) {
      setInvoiceId(result.data.id);
      // The URL becomes the edit URL so a reload keeps the draft (and the
      // browser back button lands on the list, not on "new").
      router.replace(`/invoices/${result.data.id}/edit`);
    }
    setSaveState({ kind: "saved", at: Date.now() });
  }

  // ── Autosave (debounced ~1s), only when the draft can exist ─────────────
  React.useEffect(() => {
    if (!isDirty || !canAutosave(values)) return;
    const handle = setTimeout(() => {
      void persist(values);
    }, AUTOSAVE_DEBOUNCE_MS);
    return () => clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- persist closes over state
  }, [isDirty, values]);

  // Warn before tab close with unsaved edits.
  React.useEffect(() => {
    function onBeforeUnload(event: BeforeUnloadEvent) {
      if (dirtyFingerprint(values) !== lastSavedFingerprint.current) {
        event.preventDefault();
      }
    }
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [values]);

  // ── Field helpers ────────────────────────────────────────────────────────
  function update(patch: Partial<EditorFormValues>) {
    setValues((current) => ({ ...current, ...patch }));
  }

  function onProfileChange(profileId: string) {
    const profile = profiles.find((row) => row.id === profileId);
    update({
      profileId,
      taxMode: profile?.defaultTaxMode ?? values.taxMode,
      taxPercent: profile?.defaultTaxPercent ?? values.taxPercent,
      stampMode: (profile?.defaultStampMode as StampModeValue) ?? values.stampMode,
      notes: profile?.defaultNotes ?? values.notes,
      bankAccountId: profile?.defaultBankAccountId ?? values.bankAccountId,
      signerId: profile?.defaultSignerId ?? values.signerId,
    });
  }

  function onProjectChange(projectId: string) {
    if (!projectId) {
      update({ projectReferenceId: "", projectTitle: "" });
      setProjectTitle(null);
      return;
    }
    const project = options.projects.find((row) => row.id === projectId);
    if (!project) return;
    prefillInvoiceFromProjectAction({ projectId }).then((result) => {
      if (!result.ok) return;
      const prefill = result.data;
      setValues((current) => ({
        ...current,
        projectReferenceId: projectId,
        customerId: current.customerId || prefill.customerId,
        referenceType: prefill.referenceType,
        referenceNumber: prefill.referenceNumber,
        referenceDate: prefill.referenceDate,
        workValueOverride: true,
        workValueOverrideAmount: prefill.workValueOverrideAmount,
        workValueReason: prefill.workValueReason,
      }));
      setProjectTitle(project.title);
      setPreviouslyBilled(project.previouslyBilled);
    });
  }

  function onItemsChange(items: EditorItemRow[]) {
    update({ items });
  }

  async function onSaveDraft(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canAutosave(values)) {
      setValidationError("Pilih profil invoice dan customer sebelum menyimpan draft.");
      return;
    }
    await persist(values);
  }

  const saveLabel =
    saveState.kind === "saving"
      ? "Menyimpan…"
      : saveState.kind === "saved"
        ? "Tersimpan"
        : saveState.kind === "error"
          ? "Gagal menyimpan"
          : isEdit
            ? "Simpan perubahan"
            : "Simpan draft";

  const formSection = (
    <form onSubmit={onSaveDraft} className="flex flex-col gap-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight">
            {isEdit ? "Edit draft invoice" : "Invoice baru"}
          </h1>
          <p className="text-sm text-muted-foreground">
            Pratinjau di samping mengikuti setiap perubahan — total dihitung ulang server-side.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <span
            className="text-sm text-muted-foreground"
            aria-live="polite"
            data-testid="autosave-indicator"
          >
            {saveState.kind === "saving"
              ? "Menyimpan…"
              : saveState.kind === "saved"
                ? "Tersimpan"
                : saveState.kind === "error"
                  ? `Gagal: ${saveState.message}`
                  : isDirty
                    ? "Belum tersimpan"
                    : "Tersimpan"}
          </span>
          <Button type="submit" disabled={saveState.kind === "saving"}>
            {saveState.kind === "saving" ? (
              <LoaderCircleIcon aria-hidden="true" className="animate-spin" />
            ) : (
              <SaveIcon aria-hidden="true" />
            )}
            {saveLabel}
          </Button>
        </div>
      </div>

      {validationError ? (
        <p className="text-sm text-destructive" role="alert">
          {validationError}
        </p>
      ) : null}

      {/* 1 — Profil invoice */}
      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          1 · Profil invoice
        </h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-2">
            <Label htmlFor="invoice-profile">Profil invoice *</Label>
            <Select
              value={values.profileId}
              onValueChange={(value) => {
                if (value) onProfileChange(value);
              }}
            >
              <SelectTrigger id="invoice-profile">
                <SelectValue placeholder="Pilih profil" />
              </SelectTrigger>
              <SelectContent>
                {profiles.map((profile) => (
                  <SelectItem key={profile.id} value={profile.id}>
                    {profile.name} ({profile.code})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <p className="self-end text-xs text-muted-foreground">
            Nomor sementara: <span className="font-mono">{numberPreview ?? "—"}</span>
          </p>
        </div>
      </section>

      <Separator />

      {/* 2 — Jenis penagihan */}
      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          2 · Jenis penagihan
        </h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-2">
            <Label htmlFor="invoice-type">Jenis invoice *</Label>
            <Select
              value={values.invoiceType}
              onValueChange={(type) => update({ invoiceType: type as InvoiceTypeValue })}
            >
              <SelectTrigger id="invoice-type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {INVOICE_TYPES.map((type) => (
                  <SelectItem key={type} value={type}>
                    {INVOICE_TYPE_LABELS[type]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {(values.invoiceType === "DOWN_PAYMENT" || values.invoiceType === "TERM") && (
            <div className="flex flex-col gap-2">
              <Label htmlFor="billing-mode">Dasar tagihan</Label>
              <Select
                value={values.billingMode}
                onValueChange={(mode) => update({ billingMode: mode as "PERCENT" | "MANUAL" })}
              >
                <SelectTrigger id="billing-mode">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(BILLING_MODE_LABELS) as Array<keyof typeof BILLING_MODE_LABELS>).map(
                    (mode) => (
                      <SelectItem key={mode} value={mode}>
                        {BILLING_MODE_LABELS[mode]}
                      </SelectItem>
                    ),
                  )}
                </SelectContent>
              </Select>
            </div>
          )}
        </div>

        {(values.invoiceType === "DOWN_PAYMENT" || values.invoiceType === "TERM") &&
        values.billingMode === "PERCENT" ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-2">
              <Label htmlFor="billing-percent">Persentase tagihan (%)</Label>
              <Input
                id="billing-percent"
                inputMode="decimal"
                value={values.billingPercent}
                onChange={(event) => update({ billingPercent: event.target.value })}
              />
            </div>
            {values.invoiceType === "TERM" ? (
              <div className="grid grid-cols-2 gap-4">
                <div className="flex flex-col gap-2">
                  <Label htmlFor="term-name">Nama termin</Label>
                  <Input
                    id="term-name"
                    placeholder="mis. 2"
                    value={values.termName}
                    onChange={(event) => update({ termName: event.target.value })}
                  />
                </div>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="term-number">Nomor termin</Label>
                  <Input
                    id="term-number"
                    inputMode="numeric"
                    value={values.termNumber}
                    onChange={(event) => update({ termNumber: event.target.value })}
                  />
                </div>
              </div>
            ) : null}
          </div>
        ) : null}

        {(values.invoiceType === "DOWN_PAYMENT" || values.invoiceType === "TERM") &&
        values.billingMode === "MANUAL" ? (
          <div className="flex flex-col gap-2">
            <Label htmlFor="billing-amount">Nominal tagihan (Rp)</Label>
            <CurrencyInput
              id="billing-amount"
              value={values.billingAmount}
              onValueChange={(raw) => update({ billingAmount: raw })}
            />
          </div>
        ) : null}

        {values.invoiceType === "CUSTOM" ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-2">
              <Label htmlFor="custom-label">Label tagihan</Label>
              <Input
                id="custom-label"
                placeholder="mis. Penagihan tambahan"
                value={values.customLabel}
                onChange={(event) => update({ customLabel: event.target.value })}
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="custom-amount">Nominal tagihan (Rp)</Label>
              <CurrencyInput
                id="custom-amount"
                value={values.billingAmount}
                onValueChange={(raw) => update({ billingAmount: raw })}
              />
            </div>
            <div className="flex flex-col gap-2 sm:col-span-2">
              <Label htmlFor="custom-reason">Alasan tagihan (wajib jika melebihi nilai pekerjaan)</Label>
              <Textarea
                id="custom-reason"
                rows={2}
                value={values.customReason}
                onChange={(event) => update({ customReason: event.target.value })}
              />
            </div>
          </div>
        ) : null}

        {values.invoiceType === "SETTLEMENT" && customerProject ? (
          <div className="rounded-lg border border-border bg-muted/30 p-4 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Nilai pekerjaan</span>
              <span className="font-mono">{formatIdr(customerProject.workValue)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Sudah ditagihkan</span>
              <span className="font-mono">{formatIdr(customerProject.previouslyBilled)}</span>
            </div>
            <div className="flex justify-between font-semibold">
              <span>Sisa / pelunasan</span>
              <span className="font-mono">
                {formatIdr(previewData?.calc.remainingAfter ?? "0")}
              </span>
            </div>
            <div className="mt-2 flex justify-between border-t border-border pt-2">
              <span className="text-muted-foreground">Total ditagihkan sekarang</span>
              <span className="font-mono font-semibold">
                {formatIdr(previewData?.calc.billingBase ?? "0")}
              </span>
            </div>
          </div>
        ) : null}
      </section>

      <Separator />

      {/* 3 — Informasi invoice */}
      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          3 · Informasi invoice
        </h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-2">
            <Label htmlFor="invoice-date">Tanggal invoice *</Label>
            <Input
              id="invoice-date"
              type="date"
              value={values.invoiceDate}
              onChange={(event) => update({ invoiceDate: event.target.value })}
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="due-date">Jatuh tempo</Label>
            <Input
              id="due-date"
              type="date"
              value={values.dueDate}
              onChange={(event) => update({ dueDate: event.target.value })}
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="payment-terms">Syarat pembayaran</Label>
            <Input
              id="payment-terms"
              placeholder="mis. 30 hari setelah invoice diterbitkan"
              value={values.paymentTerms}
              onChange={(event) => update({ paymentTerms: event.target.value })}
            />
          </div>
        </div>
      </section>

      <Separator />

      {/* 4 — Customer / PIC */}
      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          4 · Customer / PIC
        </h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-2">
            <Label htmlFor="invoice-customer">Customer *</Label>
            <Select
              value={values.customerId || undefined}
              onValueChange={(customerId) => update({ customerId: customerId ?? "", customerContactId: "" })}
            >
              <SelectTrigger id="invoice-customer">
                <SelectValue placeholder="Pilih customer" />
              </SelectTrigger>
              <SelectContent>
                {options.customers.map((customer) => (
                  <SelectItem key={customer.id} value={customer.id}>
                    {customer.companyName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="invoice-contact">PIC</Label>
            <Select
              value={values.customerContactId || undefined}
              onValueChange={(contactId) => {
                const contact = contacts.find((row) => row.id === contactId);
                update({ customerContactId: contactId ?? "" });
                setContactName(contact?.name ?? null);
              }}
              disabled={contacts.length === 0}
            >
              <SelectTrigger id="invoice-contact">
                <SelectValue placeholder={contacts.length === 0 ? "Customer ini belum punya PIC" : "Pilih PIC"} />
              </SelectTrigger>
              <SelectContent>
                {contacts.map((contact) => (
                  <SelectItem key={contact.id} value={contact.id}>
                    {contact.name}
                    {contact.isPrimary ? " (utama)" : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </section>

      <Separator />

      {/* 5 — Project / PO */}
      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          5 · Project / PO
        </h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-2">
            <Label htmlFor="invoice-project">Project / PO</Label>
            <Select
              value={values.projectReferenceId || undefined}
              onValueChange={(value) => {
                if (value) onProjectChange(value);
              }}
            >
              <SelectTrigger id="invoice-project">
                <SelectValue placeholder="Tanpa referensi project" />
              </SelectTrigger>
              <SelectContent>
                {options.projects.map((project) => (
                  <SelectItem key={project.id} value={project.id}>
                    {project.title} — {project.referenceNumber}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="reference-type">Jenis referensi</Label>
            <Select
              value={values.referenceType || undefined}
              onValueChange={(type) => update({ referenceType: type ?? "" })}
            >
              <SelectTrigger id="reference-type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {REFERENCE_TYPES.map((type) => (
                  <SelectItem key={type} value={type}>
                    {REFERENCE_TYPE_LABELS[type]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="reference-number">Nomor referensi</Label>
            <Input
              id="reference-number"
              placeholder="mis. PO-2026-0001"
              value={values.referenceNumber}
              onChange={(event) => update({ referenceNumber: event.target.value })}
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="reference-date">Tanggal referensi</Label>
            <Input
              id="reference-date"
              type="date"
              value={values.referenceDate}
              onChange={(event) => update({ referenceDate: event.target.value })}
            />
          </div>
        </div>
      </section>

      <Separator />

      {/* 6 — Item pekerjaan */}
      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            6 · Item pekerjaan
          </h2>
          <span className="text-xs text-muted-foreground">
            Tarik gagang untuk menyusun ulang, atau fokus gagang lalu gunakan panah keyboard.
          </span>
        </div>
        <ItemTable items={values.items} onChange={onItemsChange} />
      </section>

      <Separator />

      {/* 7 — Pajak dan ringkasan */}
      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          7 · Pajak dan ringkasan
        </h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-2">
            <Label htmlFor="tax-mode">Mode pajak</Label>
            <Select
              value={values.taxMode}
              onValueChange={(mode) => update({ taxMode: mode as TaxModeValue })}
            >
              <SelectTrigger id="tax-mode">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TAX_MODES.map((mode) => (
                  <SelectItem key={mode} value={mode}>
                    {INVOICE_TAX_MODE_LABELS[mode]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {(values.taxMode === "EXCLUSIVE" || values.taxMode === "INCLUSIVE") && (
            <div className="flex flex-col gap-2">
              <Label htmlFor="tax-percent">Persentase PPN (%)</Label>
              <Input
                id="tax-percent"
                inputMode="decimal"
                value={values.taxPercent}
                onChange={(event) => update({ taxPercent: event.target.value })}
              />
            </div>
          )}
          {values.taxMode === "MANUAL" && (
            <div className="flex flex-col gap-2">
              <Label htmlFor="tax-amount">Nominal pajak (Rp)</Label>
              <CurrencyInput
                id="tax-amount"
                value={values.taxAmountInput}
                onValueChange={(raw) => update({ taxAmountInput: raw })}
              />
            </div>
          )}
          <div className="flex flex-col gap-2">
            <Label htmlFor="invoice-discount">Diskon invoice (Rp)</Label>
            <CurrencyInput
              id="invoice-discount"
              value={values.discountAmount}
              onValueChange={(raw) => update({ discountAmount: raw })}
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="additional-amount">Biaya tambahan (Rp)</Label>
            <CurrencyInput
              id="additional-amount"
              value={values.additionalAmount}
              onValueChange={(raw) => update({ additionalAmount: raw })}
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="rounding-amount">Pembulatan (Rp, boleh negatif)</Label>
            <CurrencyInput
              id="rounding-amount"
              value={values.roundingAmount}
              onValueChange={(raw) => update({ roundingAmount: raw })}
            />
          </div>
        </div>

        <div className="flex flex-col gap-2 rounded-lg border border-border bg-muted/30 p-4 text-sm">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Nilai pekerjaan</span>
            <span className="font-mono">{formatIdr(previewData?.calc.workValue ?? "0")}</span>
          </div>
          <div className="flex justify-between font-semibold">
            <span>Total ditagihkan</span>
            <span className="font-mono">{formatIdr(previewData?.calc.grandTotal ?? "0")}</span>
          </div>
        </div>
      </section>

      <Separator />

      {/* 8 — Pembayaran */}
      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          8 · Pembayaran
        </h2>
        <div className="flex flex-col gap-2">
          <Label htmlFor="bank-account">Rekening tujuan</Label>
          <Select
            value={values.bankAccountId || undefined}
            onValueChange={(bankAccountId) => update({ bankAccountId: bankAccountId ?? "" })}
          >
            <SelectTrigger id="bank-account">
              <SelectValue placeholder="Pilih rekening" />
            </SelectTrigger>
            <SelectContent>
              {options.banks.map((bank) => (
                <SelectItem key={bank.id} value={bank.id}>
                  {bank.bankName} — {bank.maskedNumber} ({bank.accountHolder})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </section>

      <Separator />

      {/* 9 — Catatan */}
      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          9 · Catatan
        </h2>
        <div className="flex flex-col gap-2">
          <Label htmlFor="invoice-notes">Catatan untuk customer</Label>
          <Textarea
            id="invoice-notes"
            rows={3}
            value={values.notes}
            onChange={(event) => update({ notes: event.target.value })}
          />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="footer-text">Teks footer invoice</Label>
          <Input
            id="footer-text"
            placeholder="mis. Terima kasih atas kepercayaan Anda."
            value={values.footerText}
            onChange={(event) => update({ footerText: event.target.value })}
          />
        </div>
      </section>

      <Separator />

      {/* 10 — Meterai dan tanda tangan */}
      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          10 · Meterai dan tanda tangan
        </h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-2">
            <Label htmlFor="stamp-mode">Meterai</Label>
            <Select
              value={values.stampMode}
              onValueChange={(mode) => update({ stampMode: mode as StampModeValue })}
            >
              <SelectTrigger id="stamp-mode">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {STAMP_MODES.map((mode) => (
                  <SelectItem key={mode} value={mode}>
                    {mode === "NONE"
                      ? "Tanpa meterai"
                      : mode === "E_METERAI"
                        ? "E-Meterai"
                        : mode === "PHYSICAL"
                          ? "Meterai fisik"
                          : "Ruang kosong"}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="signer">Penanda tangan</Label>
            <Select
              value={values.signerId || undefined}
              onValueChange={(signerId) => update({ signerId: signerId ?? "" })}
            >
              <SelectTrigger id="signer">
                <SelectValue placeholder="Pilih penanda tangan" />
              </SelectTrigger>
              <SelectContent>
                {options.signers.map((signer) => (
                  <SelectItem key={signer.id} value={signer.id}>
                    {signer.name}
                    {signer.title ? ` — ${signer.title}` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <p className="text-xs text-muted-foreground">
          Gambar meterai nyata dan tanda tangan ditempatkan di tata letak pratinjau — pasangan
          e-meterai gambar datang dari fitur penyediaan terpisah.
        </p>
      </section>

      <div className="flex items-center justify-between gap-3">
        <Button variant="ghost" render={<Link href="/invoices">Kembali ke daftar draft</Link>} />
        <Button type="submit" disabled={saveState.kind === "saving"}>
          {saveState.kind === "saving" ? (
            <LoaderCircleIcon aria-hidden="true" className="animate-spin" />
          ) : (
            <SaveIcon aria-hidden="true" />
          )}
          {saveLabel}
        </Button>
      </div>
    </form>
  );

  const previewSection = (
    <div className="lg:sticky lg:top-6 flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          11 · Pratinjau
        </h2>
        <span className="text-xs text-muted-foreground">A4 portrait · diperbarui real-time</span>
      </div>
      <div className="overflow-auto rounded-lg border border-border bg-muted/20 p-4">
        {previewData ? (
          <InvoiceRenderer data={previewData} className="mx-auto shadow-sm" />
        ) : (
          <p className="py-12 text-center text-sm text-muted-foreground">
            Pilih profil invoice untuk melihat pratinjau.
          </p>
        )}
      </div>
    </div>
  );

  return (
    <div className="flex flex-col gap-6">
      {/* Desktop: split-screen (form left, sticky A4 preview right).
          Tablet/mobile: tabs Form / Pratinjau (spec Design). */}
      <div className="hidden gap-8 lg:flex">
        <div className="min-w-0 flex-1">{formSection}</div>
        <aside className="w-[46%] min-w-0 shrink-0">{previewSection}</aside>
      </div>
      <div className="lg:hidden">
        <Tabs defaultValue="form">
          <TabsList>
            <TabsTrigger value="form">Form</TabsTrigger>
            <TabsTrigger value="preview">Pratinjau</TabsTrigger>
          </TabsList>
          <TabsContent value="form">{formSection}</TabsContent>
          <TabsContent value="preview">{previewSection}</TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
