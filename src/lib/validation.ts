// src/lib/validation.ts
// Zod issue → flat field error map for ActionResult.details (error-handling.md).

import type { ZodError } from "zod";

export function zodFieldErrors(error: ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.join(".") || "_";
    if (!out[key]) out[key] = issue.message;
  }
  return out;
}

export function firstZodMessage(error: ZodError): string {
  return error.issues[0]?.message ?? "Periksa kembali isian Anda.";
}
