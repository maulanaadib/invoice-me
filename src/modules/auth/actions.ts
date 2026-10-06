"use server";

// src/modules/auth/actions.ts
// Server actions for the self-service password change form. Authorization and
// validation live in the service layer; this file only maps HTTP-ish inputs to
// service calls and ActionResult (error-handling.md).

import { actionRequest, formDataString, toActionError, zodFailure } from "@/lib/action";
import { apiFailure, apiOk, type ActionResult } from "@/lib/api-response";
import { changeOwnPassword, changePasswordSchema } from "@/modules/auth/service";
import { requireSession } from "@/server/session";

export async function changeOwnPasswordAction(form: FormData): Promise<ActionResult> {
  try {
    const session = await requireSession();
    const parsed = changePasswordSchema.safeParse({
      currentPassword: formDataString(form, "currentPassword"),
      newPassword: formDataString(form, "newPassword"),
      confirmPassword: formDataString(form, "confirmPassword"),
    });
    if (!parsed.success) return zodFailure(parsed.error);

    const { currentPassword, newPassword, confirmPassword } = parsed.data;
    if (newPassword !== confirmPassword) {
      return apiFailure(
        "VALIDATION_ERROR",
        "Konfirmasi kata sandi tidak sama.",
        { confirmPassword: "Konfirmasi kata sandi tidak sama." },
      );
    }
    if (newPassword === currentPassword) {
      return apiFailure(
        "VALIDATION_ERROR",
        "Kata sandi baru tidak boleh sama dengan yang saat ini.",
        { newPassword: "Kata sandi baru tidak boleh sama dengan yang saat ini." },
      );
    }

    await changeOwnPassword(
      {
        userId: session.user.id,
        currentSessionId: session.session.id,
        currentPassword,
        newPassword,
      },
      await actionRequest(),
    );
    return apiOk({});
  } catch (error) {
    return toActionError("auth.actions", error);
  }
}
