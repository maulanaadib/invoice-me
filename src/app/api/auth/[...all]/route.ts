// src/app/api/auth/[...all]/route.ts
// Better Auth endpoint mount (/api/auth/*). Every verb passes through
// handleAuthRequest: lockout + suspension + audit wrap the real auth handler.
// withErrorHandler catches anything unexpected and answers with the standard
// failure body instead of an HTML 500.

import { withErrorHandler } from "@/lib/api-response";
import { handleAuthRequest } from "@/modules/auth/service";

export const GET = withErrorHandler(handleAuthRequest);
export const POST = withErrorHandler(handleAuthRequest);
export const PUT = withErrorHandler(handleAuthRequest);
export const PATCH = withErrorHandler(handleAuthRequest);
export const DELETE = withErrorHandler(handleAuthRequest);
