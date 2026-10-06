// src/lib/api-response.ts
// One response shape for every API route (error-handling.md), plus the single
// error-mapping wrapper so route handlers never hand-roll error responses.

import { ERROR_STATUS, isAppError, type ApiErrorCode } from "@/lib/errors";
import { logger } from "@/server/logger";

export type ApiSuccess<T> = { ok: true; data: T };

export type ApiFailure = {
  ok: false;
  error: {
    code: ApiErrorCode;
    message: string;
    details?: Record<string, unknown>;
  };
};

export type ApiResponse<T> = ApiSuccess<T> | ApiFailure;

export function apiOk<T>(data: T): ApiSuccess<T> {
  return { ok: true, data };
}

export function apiFailure(
  code: ApiErrorCode,
  message: string,
  details?: Record<string, unknown>,
): ApiFailure {
  return { ok: false, error: { code, message, ...(details ? { details } : {}) } };
}

/** Result shape for server actions (same contract, no HTTP status attached). */
export type ActionResult<T = Record<string, never>> = ApiSuccess<T> | ApiFailure;

/**
 * Wraps a route handler: AppError maps to its HTTP status with the failure
 * body; anything else is logged server-side and answered with a generic
 * INTERNAL_ERROR so internals never leak to the client. Generic over the
 * handler's argument list so Next's params context passes through.
 */
export function withErrorHandler<A extends unknown[]>(
  handler: (...args: A) => Promise<Response>,
): (...args: A) => Promise<Response> {
  return async (...args: A) => {
    try {
      return await handler(...args);
    } catch (error) {
      const request = args[0] instanceof Request ? args[0] : null;
      if (isAppError(error)) {
        return Response.json(apiFailure(error.code, error.message, error.details), {
          status: ERROR_STATUS[error.code],
        });
      }
      logger.error(
        { module: "http", path: request ? new URL(request.url).pathname : "unknown", err: describeError(error) },
        "unhandled route error",
      );
      return Response.json(
        apiFailure("INTERNAL_ERROR", "Terjadi kesalahan pada server. Coba lagi."),
        { status: 500 },
      );
    }
  };
}

/** Safe error description for logs — message only, never the payload. */
export function describeError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}
