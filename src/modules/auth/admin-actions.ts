"use server";

// src/modules/auth/admin-actions.ts
// Server actions behind the super-admin user management screens. Every action
// requires a platform SUPER_ADMIN session first, then defers to the service
// layer (validation, audit, session revocation) for the actual work.

import { actionRequest, formDataString, toActionError, zodFailure } from "@/lib/action";
import { apiFailure, apiOk, type ActionResult } from "@/lib/api-response";
import {
  activateUser,
  adminCreateUserSchema,
  createUserByAdmin,
  resetPasswordSchema,
  resetUserPassword,
  revokeAllUserSessions,
  revokeUserSession,
  suspendUser,
} from "@/modules/auth/service";
import { requireSuperAdmin } from "@/server/session";

export async function createAdminUserAction(
  form: FormData,
): Promise<ActionResult<{ id: string }>> {
  try {
    const session = await requireSuperAdmin();
    const parsed = adminCreateUserSchema.safeParse({
      username: formDataString(form, "username"),
      email: formDataString(form, "email"),
      name: formDataString(form, "name") || undefined,
      tempPassword: formDataString(form, "tempPassword"),
      platformRole: formDataString(form, "platformRole") || "USER",
    });
    if (!parsed.success) return zodFailure(parsed.error);
    const created = await createUserByAdmin(parsed.data, {
      actorUserId: session.user.id,
      request: await actionRequest(),
    });
    return apiOk({ id: created.id });
  } catch (error) {
    return toActionError("auth.admin-actions", error);
  }
}

function targetUserIdFrom(form: FormData): string {
  return formDataString(form, "userId");
}

export async function suspendAdminUserAction(form: FormData): Promise<ActionResult> {
  try {
    const session = await requireSuperAdmin();
    const userId = targetUserIdFrom(form);
    if (!userId) return apiFailure("VALIDATION_ERROR", "User tidak valid.");
    await suspendUser(userId, { actorUserId: session.user.id, request: await actionRequest() });
    return apiOk({});
  } catch (error) {
    return toActionError("auth.admin-actions", error);
  }
}

export async function activateAdminUserAction(form: FormData): Promise<ActionResult> {
  try {
    const session = await requireSuperAdmin();
    const userId = targetUserIdFrom(form);
    if (!userId) return apiFailure("VALIDATION_ERROR", "User tidak valid.");
    await activateUser(userId, { actorUserId: session.user.id, request: await actionRequest() });
    return apiOk({});
  } catch (error) {
    return toActionError("auth.admin-actions", error);
  }
}

/** Admin password reset: forces a change on next login and revokes sessions. */
export async function resetPasswordAdminAction(form: FormData): Promise<ActionResult> {
  try {
    const session = await requireSuperAdmin();
    const userId = targetUserIdFrom(form);
    if (!userId) return apiFailure("VALIDATION_ERROR", "User tidak valid.");
    const confirmPassword = formDataString(form, "confirmPassword");
    const parsed = resetPasswordSchema.safeParse({
      newPassword: formDataString(form, "newPassword"),
    });
    if (!parsed.success) return zodFailure(parsed.error);
    if (parsed.data.newPassword !== confirmPassword) {
      return apiFailure("VALIDATION_ERROR", "Konfirmasi kata sandi tidak sama.", {
        confirmPassword: "Konfirmasi kata sandi tidak sama.",
      });
    }
    await resetUserPassword(userId, parsed.data.newPassword, {
      actorUserId: session.user.id,
      request: await actionRequest(),
    });
    return apiOk({});
  } catch (error) {
    return toActionError("auth.admin-actions", error);
  }
}

export async function revokeSessionAdminAction(form: FormData): Promise<ActionResult> {
  try {
    const session = await requireSuperAdmin();
    const userId = targetUserIdFrom(form);
    const sessionId = formDataString(form, "sessionId");
    if (!userId || !sessionId) return apiFailure("VALIDATION_ERROR", "Sesi tidak valid.");
    await revokeUserSession(userId, sessionId, {
      actorUserId: session.user.id,
      request: await actionRequest(),
    });
    return apiOk({});
  } catch (error) {
    return toActionError("auth.admin-actions", error);
  }
}

export async function revokeAllSessionsAdminAction(form: FormData): Promise<ActionResult> {
  try {
    const session = await requireSuperAdmin();
    const userId = targetUserIdFrom(form);
    if (!userId) return apiFailure("VALIDATION_ERROR", "User tidak valid.");
    await revokeAllUserSessions(userId, {
      actorUserId: session.user.id,
      request: await actionRequest(),
    });
    return apiOk({});
  } catch (error) {
    return toActionError("auth.admin-actions", error);
  }
}
