"use client";

// src/components/onboarding/context.tsx
// Client-side state for the 12-step wizard: current step (UI position only —
// the resume point lives on user.onboardingStep and is monotonic server-side)
// plus the profile/bank/signer snapshots each step refreshes after saving, so
// later steps and the preview show what was just entered.

import * as React from "react";
import type { ProfileView } from "@/modules/profiles/service";
import type { BankAccountView } from "@/modules/bank-accounts/service";
import type { SignerView } from "@/modules/signers/service";

export interface WorkspaceOption {
  id: string;
  name: string;
  slug: string;
}

interface WizardContextValue {
  /** Current UI position (1..12). */
  step: number;
  /** Furthest step reached server-side — where step 1 resumes to. */
  resumeStep: number;
  /** env.UPLOAD_MAX_MB, for display in the logo step. */
  maxMb: number;
  memberships: WorkspaceOption[];
  profile: ProfileView | null;
  bank: BankAccountView | null;
  signer: SignerView | null;
  /** Session already had an active org when the wizard mounted. */
  hasScope: boolean;
  goTo: (step: number) => void;
  setProfile: (profile: ProfileView | null) => void;
  setBank: (bank: BankAccountView | null) => void;
  setSigner: (signer: SignerView | null) => void;
}

const WizardContext = React.createContext<WizardContextValue | null>(null);

export function useWizard(): WizardContextValue {
  const value = React.useContext(WizardContext);
  if (!value) {
    throw new Error("useWizard harus dipakai di dalam OnboardingWizard.");
  }
  return value;
}

export interface WizardProviderProps {
  initialStep: number;
  resumeStep: number;
  maxMb: number;
  memberships: WorkspaceOption[];
  profile: ProfileView | null;
  bank: BankAccountView | null;
  signer: SignerView | null;
  hasScope: boolean;
  children?: React.ReactNode;
}

export function WizardProvider({
  initialStep,
  resumeStep,
  maxMb,
  memberships,
  profile,
  bank,
  signer,
  hasScope,
  children,
}: WizardProviderProps) {
  const [step, setStep] = React.useState(initialStep);
  const [profileState, setProfileState] = React.useState(profile);
  const [bankState, setBankState] = React.useState(bank);
  const [signerState, setSignerState] = React.useState(signer);

  const value = React.useMemo<WizardContextValue>(
    () => ({
      step,
      resumeStep,
      maxMb,
      memberships,
      profile: profileState,
      bank: bankState,
      signer: signerState,
      hasScope,
      goTo: (next) => setStep(Math.min(12, Math.max(1, next))),
      setProfile: setProfileState,
      setBank: setBankState,
      setSigner: setSignerState,
    }),
    [step, resumeStep, maxMb, memberships, profileState, bankState, signerState, hasScope],
  );

  return <WizardContext.Provider value={value}>{children}</WizardContext.Provider>;
}
