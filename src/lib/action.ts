// src/lib/action.ts
// Shared glue for server actions: FormData access, a Request stub carrying the
// real incoming headers (so audit rows keep IP/user agent), and the single
// error mapping to ActionResult (error-handling.md — same shape as ApiResponse).

import { headers } from "next/headers";
import { apiFailure, type ActionResult } from "@/lib/api-response";
import { isAppError } from "@/lib/errors";
import { firstZodMessage, zodFieldErrors } from "@/lib/validation";
import { logger } from "@/server/logger";
import { ZodError } from "zod";

export function formDataString(form: FormData, key: string): string {
  const value = form.get(key);
  return typeof value === "string" ? value : "";
}

export function zodFailure(error: ZodError): ActionResult<never> {
  return apiFailure("VALIDATION_ERROR", firstZodMessage(error), zodFieldErrors(error));
}

/**
 * Request stand-in for audit logging inside a server action: the incoming
 * request headers (x-forwarded-for, user-agent) survive into extractRequestMeta.
 */
export async function actionRequest(): Promise<Request> {
  const incoming = await headers();
  return new Request("http://server-action.local", { headers: incoming });
}

/** AppError/ZodError → ActionResult; anything else is logged, never leaked. */
export async function toActionError(scope: string, error: unknown): Promise<ActionResult<never>> {
  if (error instanceof ZodError) return zodFailure(error);
  if (isAppError(error)) return apiFailure(error.code, error.message, error.details);
  logger.error(
    { module: scope, err: error instanceof Error ? error.message : String(error) },
    "server action gagal",
  );
  return apiFailure("INTERNAL_ERROR", "Terjadi kesalahan pada server. Coba lagi.");
}
