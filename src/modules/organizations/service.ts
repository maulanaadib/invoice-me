// src/modules/organizations/service.ts
// Organization + membership domain: bootstrap (super admin creates orgs),
// workspace switching, role assignment and invitations. Authorization runs
// through the central permission service — this module never compares role
// strings on its own.

import { log } from "@/modules/audit/service";
import { findUserByIdentifier } from "@/modules/auth/service";
import { AppError } from "@/lib/errors";
import { assertCan, requireOrgScope } from "@/modules/permissions/service";
import { auth } from "@/server/auth";
import { db } from "@/server/db";
import type { AuthSession } from "@/server/session";
import type { OrganizationRole, Prisma } from "@prisma/client";
import { z } from "zod";

// ─── Input schemas ───────────────────────────────────────────────────────

export const createOrganizationSchema = z.object({
  name: z
    .string()
    .trim()
    .min(2, "Nama organisasi minimal 2 karakter.")
    .max(80, "Nama organisasi maksimal 80 karakter."),
  ownerUserId: z.string().min(1, "Pemilik organisasi wajib dipilih."),
});
export type CreateOrganizationInput = z.infer<typeof createOrganizationSchema>;

export const assignRoleSchema = z.object({
  organizationId: z.string().min(1, "Organisasi wajib dipilih."),
  targetUserId: z.string().min(1, "Target user wajib dipilih."),
  role: z.enum(["OWNER", "ADMIN", "STAFF", "VIEWER"]),
});
export type AssignRoleInput = z.infer<typeof assignRoleSchema>;

export const inviteMemberSchema = z.object({
  organizationId: z.string().min(1, "Organisasi wajib dipilih."),
  identifier: z.string().trim().min(3, "Masukkan username atau email user."),
  role: z.enum(["OWNER", "ADMIN", "STAFF", "VIEWER"]),
});
export type InviteMemberInput = z.infer<typeof inviteMemberSchema>;

// ─── Helpers ──────────────────────────────────────────────────────────────

export function slugify(name: string): string {
  const slug = name
    .trim()
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\p{Letter}\p{Number}]+/gu, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "org";
}

async function uniqueSlug(tx: Prisma.TransactionClient, name: string): Promise<string> {
  const base = slugify(name);
  let candidate = base;
  let suffix = 2;
  while (await tx.organization.findUnique({ where: { slug: candidate }, select: { id: true } })) {
    candidate = `${base}-${suffix}`;
    suffix += 1;
    if (suffix > 100) {
      candidate = `${base}-${Date.now()}`;
      break;
    }
  }
  return candidate;
}

// ─── Workspace scope ──────────────────────────────────────────────────────

export interface ActiveOrgScope {
  organizationId: string;
  role: OrganizationRole;
  userId: string;
}

/**
 * Resolves the active organization from the session and RE-VALIDATES the
 * membership every time (ACTIVE only). Session fields can be written by any
 * authenticated request, so scope is never trusted without this check —
 * the invariant that keeps cross-tenant queries impossible.
 */
export async function resolveActiveOrgScope(
  session: AuthSession,
): Promise<ActiveOrgScope | null> {
  const activeOrganizationId = session.session.activeOrganizationId;
  if (!activeOrganizationId) return null;
  const membership = await db.membership.findUnique({
    where: {
      userId_organizationId: { userId: session.user.id, organizationId: activeOrganizationId },
    },
  });
  if (!membership || membership.status !== "ACTIVE") return null;
  return {
    organizationId: activeOrganizationId,
    role: membership.role,
    userId: session.user.id,
  };
}

/**
 * Throwing wrapper for organization-scoped mutations (profile, bank account,
 * signer): FORBIDDEN when the session has no active, membership-verified org.
 */
export async function requireActiveOrgScope(session: AuthSession): Promise<ActiveOrgScope> {
  const scope = await resolveActiveOrgScope(session);
  if (!scope) {
    throw new AppError(
      "FORBIDDEN",
      "Tidak ada organisasi aktif. Pilih organisasi terlebih dahulu.",
    );
  }
  return scope;
}

/** Active memberships for the workspace switcher (INVITED/REMOVED excluded). */
export async function listMembershipsForUser(userId: string) {
  return db.membership.findMany({
    where: { userId, status: "ACTIVE" },
    include: {
      organization: { select: { id: true, name: true, slug: true, status: true } },
    },
    orderBy: { joinedAt: "asc" },
  });
}

export interface WorkspaceOverview {
  memberships: Awaited<ReturnType<typeof listMembershipsForUser>>;
  activeOrganizationId: string | null;
}

export async function getWorkspaceOverview(session: AuthSession): Promise<WorkspaceOverview> {
  const memberships = await listMembershipsForUser(session.user.id);
  const requested = session.session.activeOrganizationId ?? null;
  const activeOrganizationId =
    requested && memberships.some((m) => m.organization.id === requested)
      ? requested
      : (memberships[0]?.organization.id ?? null);
  return { memberships, activeOrganizationId };
}

/**
 * GET /api/organizations/[id] service — 404 IDOR guard: non-super-admin
 * callers only ever see the organization matching their ACTIVE membership.
 */
export async function getOrganizationDetail(request: Request, organizationId: string) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) {
    throw new AppError("UNAUTHORIZED", "Sesi Anda sudah berakhir. Silakan masuk kembali.");
  }
  const organization = await db.organization.findUnique({ where: { id: organizationId } });
  if (!organization) {
    throw new AppError("NOT_FOUND", "Organisasi tidak ditemukan.");
  }
  const scope = await resolveActiveOrgScope(session);
  const isSuperAdmin = session.user.platformRole === "SUPER_ADMIN";
  const isMemberScope = scope?.organizationId === organizationId;
  if (!isSuperAdmin && !isMemberScope) {
    // Same answer as a non-existent organization — no existence leak.
    throw new AppError("NOT_FOUND", "Organisasi tidak ditemukan.");
  }
  return {
    organization: {
      id: organization.id,
      name: organization.name,
      slug: organization.slug,
      status: organization.status,
      createdAt: organization.createdAt,
    },
    role: isMemberScope && scope ? scope.role : null,
    viaSuperAdmin: isSuperAdmin && !isMemberScope,
  };
}

/** Workspace switcher: validates the membership, then writes the session field. */
export async function switchActiveOrganization(
  headers: Headers,
  organizationId: string,
): Promise<{ organizationId: string; role: OrganizationRole }> {
  const session = await auth.api.getSession({ headers });
  if (!session) {
    throw new AppError("UNAUTHORIZED", "Sesi Anda sudah berakhir. Silakan masuk kembali.");
  }
  const membership = await db.membership.findUnique({
    where: { userId_organizationId: { userId: session.user.id, organizationId } },
  });
  if (!membership || membership.status !== "ACTIVE") {
    throw new AppError("NOT_FOUND", "Anda bukan anggota organisasi tersebut.");
  }
  await auth.api.updateSession({ body: { activeOrganizationId: organizationId }, headers });
  return { organizationId, role: membership.role };
}

// ─── Bootstrap: super admin creates an organization for a user ───────────

export async function createOrganization(
  input: CreateOrganizationInput,
  ctx: { actorUserId: string; request?: Request | null },
) {
  const owner = await db.user.findUnique({
    where: { id: input.ownerUserId },
    select: { id: true, username: true, status: true },
  });
  if (!owner) {
    throw new AppError("NOT_FOUND", "Pemilik organisasi tidak ditemukan.");
  }
  if (owner.status !== "ACTIVE") {
    throw new AppError("VALIDATION_ERROR", "Pemilik organisasi harus berstatus aktif.");
  }
  const name = input.name.trim();
  const organization = await db.$transaction(async (tx) => {
    const slug = await uniqueSlug(tx, name);
    const org = await tx.organization.create({ data: { name, slug } });
    await tx.membership.create({
      data: { userId: owner.id, organizationId: org.id, role: "OWNER", status: "ACTIVE" },
    });
    return org;
  });
  await log({
    actorUserId: ctx.actorUserId,
    organizationId: organization.id,
    action: "ORGANIZATION_CREATED",
    entityType: "organization",
    entityId: organization.id,
    metadata: { name: organization.name, slug: organization.slug, ownerUserId: owner.id },
    request: ctx.request,
  });
  await log({
    actorUserId: ctx.actorUserId,
    organizationId: organization.id,
    action: "MEMBERSHIP_CHANGED",
    entityType: "membership",
    entityId: owner.id,
    metadata: { userId: owner.id, role: "OWNER", status: "ACTIVE", reason: "organization_created" },
    request: ctx.request,
  });
  return organization;
}

export async function listOrganizations() {
  return db.organization.findMany({
    orderBy: { createdAt: "desc" },
    include: { _count: { select: { memberships: true } } },
  });
}

/** Non-removed memberships of one organization (admin member management UI). */
export async function listOrganizationMembers(organizationId: string) {
  return db.membership.findMany({
    where: { organizationId, status: { not: "REMOVED" } },
    include: {
      user: { select: { id: true, username: true, name: true, email: true, status: true } },
    },
    orderBy: { joinedAt: "asc" },
  });
}

// ─── Membership management (invitations + role assignment) ───────────────

interface MembershipActor {
  userId: string;
  platformRole: string;
}

/** Super admin bypass, otherwise the actor's ACTIVE membership + permission. */
async function authorizeMemberManagement(actor: MembershipActor, organizationId: string) {
  if (actor.platformRole === "SUPER_ADMIN") return;
  const actorMembership = await db.membership.findUnique({
    where: { userId_organizationId: { userId: actor.userId, organizationId } },
  });
  const ctx = {
    organizationId,
    role: actorMembership && actorMembership.status === "ACTIVE" ? actorMembership.role : null,
  };
  requireOrgScope(ctx);
  assertCan("org.member.update", ctx);
}

export async function assignRole(
  input: AssignRoleInput,
  actor: MembershipActor,
  request?: Request | null,
) {
  await authorizeMemberManagement(actor, input.organizationId);
  const target = await db.membership.findUnique({
    where: {
      userId_organizationId: { userId: input.targetUserId, organizationId: input.organizationId },
    },
  });
  if (!target) {
    throw new AppError("NOT_FOUND", "Target bukan anggota organisasi ini.");
  }
  if (target.role === input.role) return target;
  if (target.role === "OWNER" && input.role !== "OWNER") {
    const otherOwners = await db.membership.count({
      where: {
        organizationId: input.organizationId,
        role: "OWNER",
        status: "ACTIVE",
        userId: { not: target.userId },
      },
    });
    if (otherOwners === 0) {
      throw new AppError("CONFLICT", "Organisasi harus memiliki minimal satu OWNER aktif.");
    }
  }
  const updated = await db.membership.update({
    where: { id: target.id },
    data: { role: input.role },
  });
  await log({
    actorUserId: actor.userId,
    organizationId: input.organizationId,
    action: "MEMBERSHIP_CHANGED",
    entityType: "membership",
    entityId: target.userId,
    metadata: { userId: target.userId, from: target.role, to: input.role, reason: "role_assigned" },
    request,
  });
  return updated;
}

/**
 * Records an INVITED membership for an existing user. Email sending is
 * explicitly deferred (feature 01 spec) — no message is composed or faked.
 */
export async function inviteMember(
  input: InviteMemberInput,
  actor: MembershipActor,
  request?: Request | null,
) {
  await authorizeMemberManagement(actor, input.organizationId);
  const target = await findUserByIdentifier(input.identifier);
  if (!target) {
    throw new AppError(
      "CONFLICT",
      "User belum terdaftar. Minta super admin membuat user terlebih dahulu.",
    );
  }
  const existing = await db.membership.findUnique({
    where: { userId_organizationId: { userId: target.id, organizationId: input.organizationId } },
  });
  if (existing && existing.status !== "REMOVED") {
    throw new AppError("CONFLICT", "User sudah menjadi anggota organisasi ini.");
  }
  const membership = existing
    ? await db.membership.update({
        where: { id: existing.id },
        data: { role: input.role, status: "INVITED" },
      })
    : await db.membership.create({
        data: {
          userId: target.id,
          organizationId: input.organizationId,
          role: input.role,
          status: "INVITED",
        },
      });
  await log({
    actorUserId: actor.userId,
    organizationId: input.organizationId,
    action: "MEMBERSHIP_CHANGED",
    entityType: "membership",
    entityId: target.id,
    metadata: { userId: target.id, role: input.role, status: "INVITED", reason: "invited" },
    request,
  });
  return membership;
}
