// src/modules/onboarding/actions.ts
// Server actions for the 12-step onboarding wizard. Every action: requires an
// in-progress onboarding session, resolves the active-org scope when it writes
// profile data, calls the domain service, then persists the furthest step
// reached (resume point). Nothing here trusts a client-computed total.

"use server";

import { actionRequest, formDataString, toActionError, zodFailure } from "@/lib/action";
import { apiFailure, apiOk, type ActionResult } from "@/lib/api-response";
import { AppError } from "@/lib/errors";
import { headers } from "next/headers";
import { requireSession, type AuthSession } from "@/server/session";
import {
  createOrganization,
  createOrganizationSchema,
  resolveActiveOrgScope,
  switchActiveOrganization,
} from "@/modules/organizations/service";
import {
  advanceOnboardingStep,
  clampStep,
  completeOnboarding,
} from "@/modules/onboarding/service";
import {
  companyProfileSchema,
  contactProfileSchema,
  createProfile,
  ensureProfile,
  getProfileByOrg,
  numberingSchema,
  primaryColorSchema,
  profileIdentitySchema,
  stampModeSchema,
  toProfileView,
  updateProfile,
  type ProfileView,
} from "@/modules/profiles/service";
import {
  bankAccountSchema,
  saveBankAccount,
  toBankAccountView,
  type BankAccountView,
} from "@/modules/bank-accounts/service";
import { saveSigner, signerSchema, toSignerView, type SignerView } from "@/modules/signers/service";
import type { ActiveOrgScope } from "@/modules/organizations/service";
import { z } from "zod";

// ─── Guards ───────────────────────────────────────────────────────────────

async function requireOnboardingSession(): Promise<AuthSession> {
  const session = await requireSession();
  if (
    session.user.platformRole === "SUPER_ADMIN" ||
    session.user.onboardingComplete === true
  ) {
    throw new AppError("CONFLICT", "Onboarding sudah selesai.");
  }
  return session;
}

async function requireScope(session: AuthSession): Promise<ActiveOrgScope> {
  const scope = await resolveActiveOrgScope(session);
  if (!scope) {
    throw new AppError(
      "FORBIDDEN",
      "Tidak ada organisasi aktif. Selesaikan langkah 1 terlebih dahulu.",
    );
  }
  return scope;
}

function stepFromForm(form: FormData): number {
  const raw = Number(formDataString(form, "step"));
  return clampStep(Number.isFinite(raw) ? raw : 1);
}

type WizardOk<T> = ActionResult<T>;

// ─── Step 1 — organization ────────────────────────────────────────────────

const workspaceChoiceSchema = z.object({
  mode: z.enum(["create", "select"]),
  organizationId: z.string().optional(),
});

export async function chooseWorkspaceAction(form: FormData): Promise<
  WizardOk<{ organizationId: string }>
> {
  try {
    const session = await requireOnboardingSession();
    const parsed = workspaceChoiceSchema.safeParse({
      mode: formDataString(form, "mode") || "create",
      organizationId: formDataString(form, "organizationId"),
    });
    if (!parsed.success) return zodFailure(parsed.error);

    let organizationId: string;
    if (parsed.data.mode === "select") {
      if (!parsed.data.organizationId) {
        return apiFailure("VALIDATION_ERROR", "Pilih salah satu organisasi.", {
          organizationId: "Pilih salah satu organisasi.",
        });
      }
      // Validates the ACTIVE membership before writing the session field.
      await switchActiveOrganization(await headers(), parsed.data.organizationId);
      organizationId = parsed.data.organizationId;
    } else {
      const name = createOrganizationSchema.shape.name.safeParse(
        formDataString(form, "name"),
      );
      if (!name.success) return zodFailure(name.error);
      const organization = await createOrganization(
        { name: name.data, ownerUserId: session.user.id },
        { actorUserId: session.user.id, request: await actionRequest() },
      );
      await switchActiveOrganization(await headers(), organization.id);
      organizationId = organization.id;
    }

    await advanceOnboardingStep(session.user.id, 2);
    return apiOk({ organizationId });
  } catch (error) {
    return toActionError("onboarding.actions", error);
  }
}

// ─── Step 2 — company profile ─────────────────────────────────────────────

export async function saveCompanyProfileAction(form: FormData): Promise<
  WizardOk<{ profile: ProfileView }>
> {
  try {
    const session = await requireOnboardingSession();
    const scope = await requireScope(session);
    const ctx = { scope, request: await actionRequest() };
    const parsed = companyProfileSchema.safeParse({
      legalName: formDataString(form, "legalName"),
      address: formDataString(form, "address"),
      taxId: formDataString(form, "taxId"),
    });
    if (!parsed.success) return zodFailure(parsed.error);

    const existing = await getProfileByOrg(scope.organizationId);
    const profile = existing
      ? await updateProfile(existing.id, parsed.data, ctx)
      : await createProfile(ctx, parsed.data);
    await advanceOnboardingStep(session.user.id, stepFromForm(form) + 1);
    return apiOk({ profile: toProfileView(profile) });
  } catch (error) {
    return toActionError("onboarding.actions", error);
  }
}

// ─── Step 5 — contact details ─────────────────────────────────────────────

export async function saveContactInfoAction(form: FormData): Promise<
  WizardOk<{ profile: ProfileView }>
> {
  try {
    const session = await requireOnboardingSession();
    const scope = await requireScope(session);
    const ctx = { scope, request: await actionRequest() };
    const parsed = contactProfileSchema.safeParse({
      phone: formDataString(form, "phone"),
      whatsapp: formDataString(form, "whatsapp"),
      fax: formDataString(form, "fax"),
      email: formDataString(form, "email"),
      website: formDataString(form, "website"),
    });
    if (!parsed.success) return zodFailure(parsed.error);

    const profile = await ensureProfile(ctx);
    const updated = await updateProfile(profile.id, parsed.data, ctx);
    await advanceOnboardingStep(session.user.id, stepFromForm(form) + 1);
    return apiOk({ profile: toProfileView(updated) });
  } catch (error) {
    return toActionError("onboarding.actions", error);
  }
}

// ─── Step 4 — accent color ────────────────────────────────────────────────

const colorSchema = z.object({ primaryColor: primaryColorSchema });

export async function setPrimaryColorAction(form: FormData): Promise<
  WizardOk<{ profile: ProfileView }>
> {
  try {
    const session = await requireOnboardingSession();
    const scope = await requireScope(session);
    const ctx = { scope, request: await actionRequest() };
    const parsed = colorSchema.safeParse({
      primaryColor: formDataString(form, "primaryColor"),
    });
    if (!parsed.success) return zodFailure(parsed.error);

    const profile = await ensureProfile(ctx);
    const updated = await updateProfile(profile.id, parsed.data, ctx);
    await advanceOnboardingStep(session.user.id, stepFromForm(form) + 1);
    return apiOk({ profile: toProfileView(updated) });
  } catch (error) {
    return toActionError("onboarding.actions", error);
  }
}

// ─── Step 6 — bank account ────────────────────────────────────────────────

export async function saveBankAccountAction(form: FormData): Promise<
  WizardOk<{ bank: BankAccountView }>
> {
  try {
    const session = await requireOnboardingSession();
    const scope = await requireScope(session);
    const parsed = bankAccountSchema.safeParse({
      bankName: formDataString(form, "bankName"),
      bankCode: formDataString(form, "bankCode"),
      accountNumber: formDataString(form, "accountNumber"),
      accountHolder: formDataString(form, "accountHolder"),
      branch: formDataString(form, "branch"),
    });
    if (!parsed.success) return zodFailure(parsed.error);

    const account = await saveBankAccount(parsed.data, {
      scope,
      request: await actionRequest(),
    });
    await advanceOnboardingStep(session.user.id, stepFromForm(form) + 1);
    return apiOk({ bank: toBankAccountView(account) });
  } catch (error) {
    return toActionError("onboarding.actions", error);
  }
}

// ─── Step 7 — signer ─────────────────────────────────────────────────────

export async function saveSignerAction(form: FormData): Promise<
  WizardOk<{ signer: SignerView }>
> {
  try {
    const session = await requireOnboardingSession();
    const scope = await requireScope(session);
    const parsed = signerSchema.safeParse({
      name: formDataString(form, "name"),
      title: formDataString(form, "title"),
      location: formDataString(form, "location"),
    });
    if (!parsed.success) return zodFailure(parsed.error);

    const signature = form.get("signatureFile");
    const signatureFile =
      signature instanceof File && signature.size > 0 ? signature : null;

    const signer = await saveSigner(
      parsed.data,
      { scope, request: await actionRequest() },
      { signatureFile },
    );
    await advanceOnboardingStep(session.user.id, stepFromForm(form) + 1);
    return apiOk({ signer: toSignerView(signer) });
  } catch (error) {
    return toActionError("onboarding.actions", error);
  }
}

// ─── Step 8 — invoice profile identity ───────────────────────────────────

export async function saveInvoiceProfileAction(form: FormData): Promise<
  WizardOk<{ profile: ProfileView }>
> {
  try {
    const session = await requireOnboardingSession();
    const scope = await requireScope(session);
    const ctx = { scope, request: await actionRequest() };
    const parsed = profileIdentitySchema.safeParse({
      name: formDataString(form, "name"),
      code: formDataString(form, "code"),
    });
    if (!parsed.success) return zodFailure(parsed.error);

    const existing = await getProfileByOrg(scope.organizationId);
    const profile = existing
      ? await updateProfile(existing.id, parsed.data, ctx)
      : await createProfile(ctx, parsed.data);
    await advanceOnboardingStep(session.user.id, stepFromForm(form) + 1);
    return apiOk({ profile: toProfileView(profile) });
  } catch (error) {
    return toActionError("onboarding.actions", error);
  }
}

// ─── Step 9 — numbering ──────────────────────────────────────────────────

export async function saveNumberingAction(form: FormData): Promise<
  WizardOk<{ profile: ProfileView }>
> {
  try {
    const session = await requireOnboardingSession();
    const scope = await requireScope(session);
    const ctx = { scope, request: await actionRequest() };
    const parsed = numberingSchema.safeParse({
      numberPattern: formDataString(form, "numberPattern"),
      sequenceResetPolicy: formDataString(form, "sequenceResetPolicy") || "YEARLY",
    });
    if (!parsed.success) return zodFailure(parsed.error);

    const profile = await ensureProfile(ctx);
    const updated = await updateProfile(profile.id, parsed.data, ctx);
    await advanceOnboardingStep(session.user.id, stepFromForm(form) + 1);
    return apiOk({ profile: toProfileView(updated) });
  } catch (error) {
    return toActionError("onboarding.actions", error);
  }
}

// ─── Step 10 — stamp preference ───────────────────────────────────────────

const stampSchema = z.object({ defaultStampMode: stampModeSchema });

export async function saveStampPreferenceAction(form: FormData): Promise<
  WizardOk<{ profile: ProfileView }>
> {
  try {
    const session = await requireOnboardingSession();
    const scope = await requireScope(session);
    const ctx = { scope, request: await actionRequest() };
    const parsed = stampSchema.safeParse({
      defaultStampMode: formDataString(form, "defaultStampMode"),
    });
    if (!parsed.success) return zodFailure(parsed.error);

    const profile = await ensureProfile(ctx);
    const updated = await updateProfile(profile.id, parsed.data, ctx);
    await advanceOnboardingStep(session.user.id, stepFromForm(form) + 1);
    return apiOk({ profile: toProfileView(updated) });
  } catch (error) {
    return toActionError("onboarding.actions", error);
  }
}

// ─── Step 11 → 12 navigation (no data written) ────────────────────────────

export async function advanceOnboardingStepAction(form: FormData): Promise<
  WizardOk<{ step: number }>
> {
  try {
    const session = await requireOnboardingSession();
    const state = await advanceOnboardingStep(
      session.user.id,
      stepFromForm(form) + 1,
    );
    return apiOk({ step: state.step });
  } catch (error) {
    return toActionError("onboarding.actions", error);
  }
}

// ─── Step 12 — finish ─────────────────────────────────────────────────────

export async function finishOnboardingAction(): Promise<WizardOk<{ step: number }>> {
  try {
    const session = await requireOnboardingSession();
    // Defense in depth: completion requires a chosen org AND a saved profile —
    // legitimate users reach step 12 only after step 2, this proves it.
    const scope = await requireScope(session);
    const profile = await getProfileByOrg(scope.organizationId);
    if (!profile) {
      return apiFailure(
        "VALIDATION_ERROR",
        "Lengkapi profil perusahaan (langkah 2) sebelum menyelesaikan onboarding.",
      );
    }
    const state = await completeOnboarding(session.user.id);
    return apiOk({ step: state.step });
  } catch (error) {
    return toActionError("onboarding.actions", error);
  }
}
