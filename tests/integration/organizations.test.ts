// tests/integration/organizations.test.ts
// Feature 01 "Check When Done" — multi-tenant isolation: org A member gets 404
// for org B (IDOR guard, same answer as a non-existent id), the workspace
// switcher changes the session's active org and every read re-validates the
// membership (forged activeOrganizationId fails closed), super admin bypass,
// and membership management (invite INVITED-only, role change, last-OWNER).

import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { GET } from "@/app/api/organizations/[id]/route";
import { AppError, isAppError, type ApiErrorCode } from "@/lib/errors";
import {
  assignRole,
  getOrganizationDetail,
  getWorkspaceOverview,
  inviteMember,
  resolveActiveOrgScope,
  switchActiveOrganization,
} from "@/modules/organizations/service";
import { clearLockoutStore } from "@/modules/auth/service";
import { auth } from "@/server/auth";
import { db } from "@/server/db";
import {
  addMembership,
  createOrganization,
  createUser,
  resetDatabase,
  type TestUser,
} from "../factories";
import { CookieJar, signIn } from "../helpers/auth";

let alice: TestUser;
let bob: TestUser;
let superAdmin: TestUser;
let orgA: { id: string };
let orgA2: { id: string };
let orgB: { id: string };

async function sessionFor(jar: CookieJar) {
  try {
    return await auth.api.getSession({ headers: jar.toHeaders() });
  } catch {
    return null;
  }
}

async function getOrg(jar: CookieJar, id: string): Promise<Response> {
  const request = new Request(`http://localhost:3000/api/organizations/${id}`, {
    headers: jar.toHeaders(),
  });
  return GET(request, { params: Promise.resolve({ id }) });
}

interface OrgBody {
  ok: boolean;
  data?: { role: string | null; viaSuperAdmin: boolean; organization: { id: string } };
  error?: { code: ApiErrorCode; message: string };
}

async function expectAppFailure(promise: Promise<unknown>, code: ApiErrorCode): Promise<AppError> {
  let caught: unknown = null;
  try {
    await promise;
  } catch (error) {
    caught = error;
  }
  expect(isAppError(caught)).toBe(true);
  expect((caught as AppError).code).toBe(code);
  return caught as AppError;
}

beforeAll(async () => {
  await resetDatabase();
  alice = await createUser({ username: "alice" });
  bob = await createUser({ username: "bob" });
  superAdmin = await createUser({ username: "root.org", platformRole: "SUPER_ADMIN" });
  orgA = await createOrganization("PT Alpha");
  orgA2 = await createOrganization("CV Beta");
  orgB = await createOrganization("Org Gamma");
  await addMembership(alice.id, orgA.id, "OWNER");
  await addMembership(alice.id, orgA2.id, "STAFF");
  await addMembership(bob.id, orgB.id, "OWNER");
});

beforeEach(() => {
  clearLockoutStore();
});

describe("org isolation (404 IDOR guard)", () => {
  it("member reads their own org, gets 404 for a foreign org and for a missing id", async () => {
    const jar = new CookieJar();
    expect((await signIn(jar, alice.username, alice.password)).status).toBe(200);
    const switched = await switchActiveOrganization(jar.toHeaders(), orgA.id);
    expect(switched).toEqual({ organizationId: orgA.id, role: "OWNER" });

    const own = await getOrg(jar, orgA.id);
    expect(own.status).toBe(200);
    const ownBody = (await own.json()) as OrgBody;
    expect(ownBody.ok).toBe(true);
    expect(ownBody.data?.organization.id).toBe(orgA.id);
    expect(ownBody.data?.role).toBe("OWNER");
    expect(ownBody.data?.viaSuperAdmin).toBe(false);

    const foreign = await getOrg(jar, orgB.id);
    expect(foreign.status).toBe(404);
    const foreignBody = (await foreign.json()) as OrgBody;
    expect(foreignBody.ok).toBe(false);
    expect(foreignBody.error?.code).toBe("NOT_FOUND");

    // Same answer for a non-existent organization — no existence leak.
    const missing = await getOrg(jar, "org_tidak_pernah_ada");
    expect(missing.status).toBe(404);
    const missingBody = (await missing.json()) as OrgBody;
    expect(missingBody.error?.code).toBe("NOT_FOUND");

    const unauthenticated = await getOrg(new CookieJar(), orgA.id);
    expect(unauthenticated.status).toBe(401);
  });
});

describe("workspace switcher", () => {
  it("changes the active org in the session and re-scopes every read", async () => {
    const jar = new CookieJar();
    expect((await signIn(jar, alice.username, alice.password)).status).toBe(200);
    await switchActiveOrganization(jar.toHeaders(), orgA.id);

    const session = await sessionFor(jar);
    expect(session?.session.activeOrganizationId).toBe(orgA.id);

    const switched = await switchActiveOrganization(jar.toHeaders(), orgA2.id);
    expect(switched).toEqual({ organizationId: orgA2.id, role: "STAFF" });

    const after = await sessionFor(jar);
    expect(after?.session.activeOrganizationId).toBe(orgA2.id);

    // Scope follows the active org: orgA2 readable, orgA now foreign.
    const second = await getOrg(jar, orgA2.id);
    expect(second.status).toBe(200);
    expect(((await second.json()) as OrgBody).data?.role).toBe("STAFF");

    const former = await getOrg(jar, orgA.id);
    expect(former.status).toBe(404);

    // Membership list for the switcher UI (2 orgs for alice).
    const current = await sessionFor(jar);
    const overview = await getWorkspaceOverview(
      current as NonNullable<typeof current>,
    );
    expect(overview.memberships.length).toBe(2);
    expect(overview.activeOrganizationId).toBe(orgA2.id);
  });

  it("refuses to switch into an organization the user is not a member of", async () => {
    const jar = new CookieJar();
    expect((await signIn(jar, alice.username, alice.password)).status).toBe(200);
    const failure = await expectAppFailure(
      switchActiveOrganization(jar.toHeaders(), orgB.id),
      "NOT_FOUND",
    );
    expect(failure.message).toMatch(/bukan anggota/i);
  });
});

describe("forged activeOrganizationId", () => {
  it("fails closed: the membership re-check rejects a tampered session field", async () => {
    const jar = new CookieJar();
    expect((await signIn(jar, alice.username, alice.password)).status).toBe(200);
    await switchActiveOrganization(jar.toHeaders(), orgA.id);

    // Simulate a tampered session row pointing at org B (alice is not a member).
    const session = await sessionFor(jar);
    await db.session.update({
      where: { id: session!.session.id },
      data: { activeOrganizationId: orgB.id },
    });

    const reread = await sessionFor(jar);
    expect(reread?.session.activeOrganizationId).toBe(orgB.id);
    const scope = await resolveActiveOrgScope(reread as NonNullable<typeof reread>);
    expect(scope).toBeNull();

    const forged = await getOrg(jar, orgB.id);
    expect(forged.status).toBe(404);

    // Legitimate switch restores a valid scope.
    await switchActiveOrganization(jar.toHeaders(), orgA.id);
    const restored = await getOrg(jar, orgA.id);
    expect(restored.status).toBe(200);
  });
});

describe("super admin", () => {
  it("may read any organization without a membership (bypass, role null)", async () => {
    const jar = new CookieJar();
    expect((await signIn(jar, superAdmin.username, superAdmin.password)).status).toBe(200);

    const res = await getOrg(jar, orgB.id);
    expect(res.status).toBe(200);
    const body = (await res.json()) as OrgBody;
    expect(body.data?.viaSuperAdmin).toBe(true);
    expect(body.data?.role).toBeNull();

    const detail = await getOrganizationDetail(
      new Request(`http://localhost:3000/api/organizations/${orgA.id}`, {
        headers: jar.toHeaders(),
      }),
      orgA.id,
    );
    expect(detail.viaSuperAdmin).toBe(true);
  });
});

describe("membership management", () => {
  it("denies STAFF (permission matrix) and non-members before touching data", async () => {
    // STAFF of orgA2: no org.member.update permission.
    const staffDenied = await expectAppFailure(
      inviteMember(
        { organizationId: orgA2.id, identifier: bob.username, role: "VIEWER" },
        { userId: alice.id, platformRole: "USER" },
      ),
      "FORBIDDEN",
    );
    expect(staffDenied.message).toMatch(/izin/i);

    // bob is not a member of orgA at all: fail closed.
    const nonMember = await expectAppFailure(
      inviteMember(
        { organizationId: orgA.id, identifier: alice.username, role: "VIEWER" },
        { userId: bob.id, platformRole: "USER" },
      ),
      "FORBIDDEN",
    );
    expect(nonMember.message).toMatch(/bukan anggota/i);

    expect(await db.membership.count({ where: { organizationId: orgA2.id } })).toBe(1);
  });

  it("invites as INVITED (no email) with super-admin bypass; duplicate invite conflicts", async () => {
    const carol = await createUser({ username: "carol.invite" });
    const actor = { userId: superAdmin.id, platformRole: "SUPER_ADMIN" };

    const invited = await inviteMember(
      { organizationId: orgA.id, identifier: carol.username, role: "VIEWER" },
      actor,
    );
    expect(invited.status).toBe("INVITED");
    expect(invited.role).toBe("VIEWER");

    const duplicate = await expectAppFailure(
      inviteMember({ organizationId: orgA.id, identifier: carol.username, role: "STAFF" }, actor),
      "CONFLICT",
    );
    expect(duplicate.message).toMatch(/sudah menjadi anggota/i);

    // Unknown user is a CONFLICT with an actionable Indonesian message.
    const unknown = await expectAppFailure(
      inviteMember({ organizationId: orgA.id, identifier: "belum.terdaftar", role: "STAFF" }, actor),
      "CONFLICT",
    );
    expect(unknown.message).toMatch(/belum terdaftar/i);
  });

  it("protects the last OWNER and audits successful role changes", async () => {
    const actor = { userId: superAdmin.id, platformRole: "SUPER_ADMIN" };

    // alice is the only ACTIVE owner of orgA → demotion must fail.
    const lastOwner = await expectAppFailure(
      assignRole({ organizationId: orgA.id, targetUserId: alice.id, role: "ADMIN" }, actor),
      "CONFLICT",
    );
    expect(lastOwner.message).toMatch(/OWNER/i);

    // Add a second owner, then the demotion is allowed.
    await addMembership(bob.id, orgA.id, "OWNER");
    const updated = await assignRole(
      { organizationId: orgA.id, targetUserId: alice.id, role: "ADMIN" },
      actor,
    );
    expect(updated.role).toBe("ADMIN");

    const audits = await db.auditLog.count({ where: { action: "MEMBERSHIP_CHANGED" } });
    expect(audits).toBeGreaterThanOrEqual(2);
    const demotion = await db.auditLog.findFirst({
      where: { action: "MEMBERSHIP_CHANGED", entityId: alice.id },
    });
    expect(JSON.stringify(demotion?.metadata ?? {})).toContain("role_assigned");
  });
});
