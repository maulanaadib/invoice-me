"use server";

// src/modules/organizations/actions.ts
// Server actions for workspace switching and super-admin organization
// bootstrap. Each action authorizes in the service layer and answers with the
// standard ActionResult shape.

import { actionRequest, formDataString, toActionError, zodFailure } from "@/lib/action";
import { apiFailure, apiOk, type ActionResult } from "@/lib/api-response";
import {
  assignRole,
  assignRoleSchema,
  createOrganization,
  createOrganizationSchema,
  inviteMember,
  inviteMemberSchema,
  listOrganizationMembers,
  switchActiveOrganization,
} from "@/modules/organizations/service";
import { findUserByIdentifier } from "@/modules/auth/service";
import { requireSession, requireSuperAdmin } from "@/server/session";
import { headers } from "next/headers";
import { z } from "zod";

/** Workspace switcher: validates ACTIVE membership, then updates the session. */
export async function switchWorkspaceAction(organizationId: string): Promise<ActionResult<{ organizationId: string }>> {
  try {
    if (typeof organizationId !== "string" || !organizationId) {
      return apiFailure("VALIDATION_ERROR", "Workspace tidak valid.");
    }
    await requireSession();
    // Membership check (ACTIVE only) happens inside switchActiveOrganization.
    await switchActiveOrganization(await headers(), organizationId);
    return apiOk({ organizationId });
  } catch (error) {
    return toActionError("organizations.actions", error);
  }
}

/** Super admin creates an organization and assigns its first OWNER. */
export async function createOrganizationAction(form: FormData): Promise<ActionResult<{ id: string; slug: string }>> {
  try {
    const session = await requireSuperAdmin();
    const parsed = createOrganizationSchema.safeParse({
      name: formDataString(form, "name"),
      ownerUserId: formDataString(form, "ownerUserId"),
    });
    if (!parsed.success) return zodFailure(parsed.error);
    const organization = await createOrganization(parsed.data, {
      actorUserId: session.user.id,
      request: await actionRequest(),
    });
    return apiOk({ id: organization.id, slug: organization.slug });
  } catch (error) {
    return toActionError("organizations.actions", error);
  }
}

const ownerIdentifierSchema = z.object({
  name: createOrganizationSchema.shape.name,
  ownerIdentifier: z.string().trim().min(3, "Masukkan username atau email pemilik."),
});

/** Same as createOrganizationAction but resolves the OWNER by username/email. */
export async function createOrganizationByIdentifierAction(
  form: FormData,
): Promise<ActionResult<{ id: string; slug: string }>> {
  try {
    const session = await requireSuperAdmin();
    const parsed = ownerIdentifierSchema.safeParse({
      name: formDataString(form, "name"),
      ownerIdentifier: formDataString(form, "ownerIdentifier"),
    });
    if (!parsed.success) return zodFailure(parsed.error);

    const owner = await findUserByIdentifier(parsed.data.ownerIdentifier);
    if (!owner) {
      return apiFailure("NOT_FOUND", "User pemilik tidak ditemukan. Buat user terlebih dahulu.");
    }
    const organization = await createOrganization(
      { name: parsed.data.name, ownerUserId: owner.id },
      { actorUserId: session.user.id, request: await actionRequest() },
    );
    return apiOk({ id: organization.id, slug: organization.slug });
  } catch (error) {
    return toActionError("organizations.actions", error);
  }
}

/** Records an INVITED membership (no email is sent in feature 01). */
export async function inviteMemberAction(form: FormData): Promise<ActionResult<{ membershipId: string }>> {
  try {
    const session = await requireSession();
    const parsed = inviteMemberSchema.safeParse({
      organizationId: formDataString(form, "organizationId"),
      identifier: formDataString(form, "identifier"),
      role: formDataString(form, "role"),
    });
    if (!parsed.success) return zodFailure(parsed.error);
    const membership = await inviteMember(
      parsed.data,
      { userId: session.user.id, platformRole: session.user.platformRole ?? "USER" },
      await actionRequest(),
    );
    return apiOk({ membershipId: membership.id });
  } catch (error) {
    return toActionError("organizations.actions", error);
  }
}

/** Changes a member's organization role (last-OWNER protection inside). */
export async function assignRoleAction(form: FormData): Promise<ActionResult<{ membershipId: string }>> {
  try {
    const session = await requireSession();
    const parsed = assignRoleSchema.safeParse({
      organizationId: formDataString(form, "organizationId"),
      targetUserId: formDataString(form, "targetUserId"),
      role: formDataString(form, "role"),
    });
    if (!parsed.success) return zodFailure(parsed.error);
    const membership = await assignRole(
      parsed.data,
      { userId: session.user.id, platformRole: session.user.platformRole ?? "USER" },
      await actionRequest(),
    );
    return apiOk({ membershipId: membership.id });
  } catch (error) {
    return toActionError("organizations.actions", error);
  }
}

export interface OrgMemberView {
  membershipId: string;
  userId: string;
  username: string | null;
  name: string | null;
  email: string;
  role: string;
  status: string;
  joinedAt: string;
}

/** Members of one organization for the admin member-management dialog. */
export async function listOrganizationMembersAction(
  organizationId: string,
): Promise<ActionResult<{ members: OrgMemberView[] }>> {
  try {
    await requireSuperAdmin();
    if (typeof organizationId !== "string" || !organizationId) {
      return apiFailure("VALIDATION_ERROR", "Organisasi tidak valid.");
    }
    const rows = await listOrganizationMembers(organizationId);
    return apiOk({
      members: rows.map((row) => ({
        membershipId: row.id,
        userId: row.userId,
        username: row.user.username,
        name: row.user.name,
        email: row.user.email,
        role: row.role,
        status: row.status,
        joinedAt: row.joinedAt.toISOString(),
      })),
    });
  } catch (error) {
    return toActionError("organizations.actions", error);
  }
}
