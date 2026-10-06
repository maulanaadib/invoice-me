// src/server/session.ts
// Server-side session access for layouts, server components and server
// actions. All authorization decisions that matter run in the service layer;
// these helpers only resolve *who is calling*.

import { headers } from "next/headers";
import { AppError } from "@/lib/errors";
import { auth } from "@/server/auth";

export type AuthSession = NonNullable<Awaited<ReturnType<typeof auth.api.getSession>>>;

/** Current session from the request cookies, or null when absent/expired. */
export async function getSession(): Promise<AuthSession | null> {
  try {
    return await auth.api.getSession({ headers: await headers() });
  } catch {
    return null;
  }
}

/** Throws UNAUTHORIZED when there is no valid session. */
export async function requireSession(): Promise<AuthSession> {
  const session = await getSession();
  if (!session) {
    throw new AppError("UNAUTHORIZED", "Sesi Anda sudah berakhir. Silakan masuk kembali.");
  }
  return session;
}

/** Throws unless the session belongs to a platform SUPER_ADMIN. */
export async function requireSuperAdmin(): Promise<AuthSession> {
  const session = await requireSession();
  if (session.user.platformRole !== "SUPER_ADMIN") {
    throw new AppError("FORBIDDEN", "Hanya super admin yang diizinkan mengakses fitur ini.");
  }
  return session;
}
