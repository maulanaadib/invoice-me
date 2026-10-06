// src/components/forms/form-utils.ts
// Client-safe helpers for reading ActionResult field errors in forms.

import type { ActionResult } from "@/lib/api-response";

export function fieldError<T>(
  state: ActionResult<T> | null,
  field: string,
): string | undefined {
  if (!state || state.ok) return undefined;
  const details = state.error.details;
  if (details && typeof details === "object") {
    const value = (details as Record<string, unknown>)[field];
    if (typeof value === "string") return value;
  }
  return undefined;
}

/** Message to show as a banner: only when no field-level errors exist. */
export function bannerError<T>(state: ActionResult<T> | null): string | undefined {
  if (!state || state.ok) return undefined;
  const details = state.error.details;
  const hasFieldErrors = Boolean(details && Object.keys(details).length > 0);
  return hasFieldErrors ? undefined : state.error.message;
}
