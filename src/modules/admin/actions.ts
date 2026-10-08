// src/modules/admin/actions.ts
// Feature 09 — server actions behind the super-admin panel mutations
// (assign platform role, suspend/reactivate organization, retry PDF job).
// Session gate first (`requireSuperAdmin`), Zod at the boundary, then the
// service layer — which re-checks the platform role via assertSuperAdmin.

"use server";

import { actionRequest, formDataString, toActionError, zodFailure } from "@/lib/action";
import { apiOk, type ActionResult } from "@/lib/api-response";
import {
  retryPdfJobSchema,
  setOrganizationStatusSchema,
  setPlatformRoleSchema,
} from "@/modules/admin/schema";
import { retryPdfJob, setOrganizationStatus, setPlatformRole } from "@/modules/admin/service";
import { requireSuperAdmin } from "@/server/session";

export async function setPlatformRoleAction(form: FormData): Promise<ActionResult> {
  try {
    const session = await requireSuperAdmin();
    const parsed = setPlatformRoleSchema.safeParse({
      userId: formDataString(form, "userId"),
      platformRole: formDataString(form, "platformRole"),
    });
    if (!parsed.success) return zodFailure(parsed.error);
    await setPlatformRole(
      {
        platformRole: session.user.platformRole,
        actorUserId: session.user.id,
        request: await actionRequest(),
      },
      parsed.data,
    );
    return apiOk({});
  } catch (error) {
    return toActionError("admin.actions", error);
  }
}

export async function setOrganizationStatusAction(form: FormData): Promise<ActionResult> {
  try {
    const session = await requireSuperAdmin();
    const parsed = setOrganizationStatusSchema.safeParse({
      organizationId: formDataString(form, "organizationId"),
      status: formDataString(form, "status"),
    });
    if (!parsed.success) return zodFailure(parsed.error);
    await setOrganizationStatus(
      {
        platformRole: session.user.platformRole,
        actorUserId: session.user.id,
        request: await actionRequest(),
      },
      parsed.data,
    );
    return apiOk({});
  } catch (error) {
    return toActionError("admin.actions", error);
  }
}

export async function retryPdfJobAction(form: FormData): Promise<ActionResult> {
  try {
    const session = await requireSuperAdmin();
    const parsed = retryPdfJobSchema.safeParse({ jobId: formDataString(form, "jobId") });
    if (!parsed.success) return zodFailure(parsed.error);
    await retryPdfJob(
      {
        platformRole: session.user.platformRole,
        actorUserId: session.user.id,
        request: await actionRequest(),
      },
      parsed.data.jobId,
    );
    return apiOk({});
  } catch (error) {
    return toActionError("admin.actions", error);
  }
}
