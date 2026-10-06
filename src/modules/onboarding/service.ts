// src/modules/onboarding/service.ts
// Onboarding wizard state machine: 12 steps persisted on the user row
// (onboardingStep = furthest step reached, onboardingComplete = finished).
// The proxy and dashboard layout route on these flags; resume uses the step.

import { db } from "@/server/db";

export const ONBOARDING_TOTAL_STEPS = 12;

export interface OnboardingState {
  complete: boolean;
  step: number;
}

export async function getOnboardingState(userId: string): Promise<OnboardingState> {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { onboardingComplete: true, onboardingStep: true },
  });
  if (!user) return { complete: false, step: 1 };
  return {
    complete: user.onboardingComplete,
    step: clampStep(user.onboardingStep),
  };
}

export function clampStep(step: number): number {
  if (!Number.isFinite(step)) return 1;
  return Math.min(ONBOARDING_TOTAL_STEPS, Math.max(1, Math.floor(step)));
}

/**
 * Records the furthest step the user has completed a form for (monotonic —
 * going Back never rewinds the resume point). No-op after completion.
 */
export async function advanceOnboardingStep(userId: string, nextStep: number): Promise<OnboardingState> {
  const state = await getOnboardingState(userId);
  if (state.complete) return state;
  const target = clampStep(Math.max(state.step, nextStep));
  if (target === state.step) return state;
  await db.user.update({
    where: { id: userId },
    data: { onboardingStep: target },
  });
  return { complete: false, step: target };
}

/** Step 12: flip the flag; the proxy then keeps the user out of /onboarding. */
export async function completeOnboarding(userId: string): Promise<OnboardingState> {
  await db.user.update({
    where: { id: userId },
    data: { onboardingComplete: true, onboardingStep: ONBOARDING_TOTAL_STEPS },
  });
  return { complete: true, step: ONBOARDING_TOTAL_STEPS };
}
