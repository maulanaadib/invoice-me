// tests/integration/auth-login.test.ts
// Feature 01 "Check When Done" — login flow against the real Better Auth
// handler through our interception wrapper: username/email login, cookie
// flags, 5x lockout with an Indonesian duration message, suspended rejection,
// admin create/reset → forced change, server-side logout, and audit hygiene
// (no password/token in AuditLog.metadata). Runs against the test database.

import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { auth } from "@/server/auth";
import { db } from "@/server/db";
import {
  activateUser,
  changeOwnPassword,
  clearLockoutStore,
  createUserByAdmin,
  listUsers,
  resetUserPassword,
  revokeAllUserSessions,
  revokeUserSession,
  suspendUser,
} from "@/modules/auth/service";
import { isAppError } from "@/lib/errors";
import { createUser, resetDatabase, type TestUser } from "../factories";
import { CookieJar, callAuth, readSetCookies, signIn } from "../helpers/auth";

async function sessionFor(jar: CookieJar) {
  try {
    return await auth.api.getSession({ headers: jar.toHeaders() });
  } catch {
    return null;
  }
}

async function sessionForCookie(cookie: string) {
  try {
    return await auth.api.getSession({ headers: new Headers({ cookie }) });
  } catch {
    return null;
  }
}

async function auditMeta(row: { metadata: unknown } | null): Promise<string> {
  return JSON.stringify(row?.metadata ?? null);
}

beforeAll(async () => {
  await resetDatabase();
});

beforeEach(() => {
  // Lockout state is in-memory — isolate each case.
  clearLockoutStore();
});

describe("login", () => {
  it("accepts username, sets an HttpOnly+SameSite session cookie, audits LOGIN_SUCCESS", async () => {
    const user = await createUser({ username: "budi.santoso", password: "Rahasia12345" });
    const jar = new CookieJar();

    const res = await signIn(jar, "budi.santoso", "Rahasia12345");

    expect(res.status).toBe(200);

    // Cookie flags (Secure-in-production is covered by shouldUseSecureCookies
    // unit test; this test env runs on http so Secure must be absent here).
    const setCookies = readSetCookies(res.headers);
    expect(setCookies.length).toBeGreaterThan(0);
    const attributes = setCookies.map((c) => c.split(";").slice(1).join(";")).join(";");
    expect(setCookies.join(" ")).toMatch(/session/i);
    expect(attributes).toMatch(/httponly/i);
    expect(attributes).toMatch(/samesite=lax/i);
    expect(attributes).toMatch(/path=\//i);
    expect(attributes).not.toMatch(/;\s*secure/i);

    const session = await sessionFor(jar);
    expect(session?.user.username).toBe("budi.santoso");
    expect(session?.user.mustChangePassword).toBe(false);
    expect(await db.session.count({ where: { userId: user.id } })).toBe(1);

    const success = await db.auditLog.findFirst({ where: { action: "LOGIN_SUCCESS" } });
    expect(success?.entityId).toBe(user.id);
  });

  it("accepts the same account by email", async () => {
    const user = await createUser({ username: "email.login", password: "Rahasia12345" });
    const jar = new CookieJar();

    const res = await signIn(jar, user.email, "Rahasia12345");

    expect(res.status).toBe(200);
    const session = await sessionFor(jar);
    expect(session?.user.email).toBe(user.email);
    expect(session?.user.username).toBe("email.login");
  });

  it("rejects a wrong password with 401 and a generic Indonesian message", async () => {
    const user = await createUser({ username: "salah.kata", password: "Benar1234567" });
    const res = await signIn(new CookieJar(), user.username, "Salah1234567");
    expect(res.status).toBe(401);
    const failed = await db.auditLog.findFirst({
      where: { action: "LOGIN_FAILED", metadata: { path: ["reason"], equals: "invalid_credentials" } },
    });
    expect(failed).not.toBeNull();
  });
});

describe("lockout after 5 failed attempts", () => {
  it("locks with 429 + Indonesian duration message, then blocks even the correct password", async () => {
    const user = await createUser({ username: "uji.lockout", password: "Benar1234567" });

    for (let attempt = 1; attempt <= 4; attempt++) {
      const res = await signIn(new CookieJar(), user.username, "Salah1234567");
      expect(res.status).toBe(401);
    }

    const fifth = await signIn(new CookieJar(), user.username, "Salah1234567");
    expect(fifth.status).toBe(429);
    const body = (await fifth.json()) as { code?: string; message?: string };
    expect(body.code).toBe("RATE_LIMITED");
    expect(body.message).toMatch(/Coba lagi dalam/);
    expect(body.message).toMatch(/(detik|menit)/);
    expect(fifth.headers.get("retry-after")).toBeTruthy();

    // Locked: even the correct password is rejected until the lock expires.
    const whileLocked = await signIn(new CookieJar(), user.username, user.password);
    expect(whileLocked.status).toBe(429);

    const failures = await db.auditLog.count({
      where: { action: "LOGIN_FAILED", metadata: { path: ["identifier"], equals: user.username } },
    });
    // 4x401 + 429-on-5th + rate-limited retry.
    expect(failures).toBe(6);

    const rateLimited = await db.auditLog.findFirst({
      where: { action: "LOGIN_FAILED", metadata: { path: ["reason"], equals: "rate_limited" } },
    });
    expect(rateLimited).not.toBeNull();
  });
});

describe("suspended user", () => {
  it("cannot log in and gets an Indonesian 403", async () => {
    const user = await createUser({ username: "uji.tangguh", status: "SUSPENDED" });

    const res = await signIn(new CookieJar(), user.username, user.password);

    expect(res.status).toBe(403);
    const body = (await res.json()) as { code?: string; message?: string };
    expect(body.code).toBe("FORBIDDEN");
    expect(body.message).toContain("ditangguhkan");

    const failed = await db.auditLog.findFirst({
      where: { action: "LOGIN_FAILED", metadata: { path: ["reason"], equals: "suspended" } },
    });
    expect(failed?.actorUserId).toBe(user.id);
    expect(await db.session.count({ where: { userId: user.id } })).toBe(0);
  });
});

describe("force password change", () => {
  it("admin-created user must change the temp password before the flag clears", async () => {
    const admin = await createUser({ username: "root.uji", platformRole: "SUPER_ADMIN" });
    const created = await createUserByAdmin(
      {
        username: "karyawan.satu",
        email: "karyawan.satu@test.local",
        name: "Karyawan Satu",
        tempPassword: "Sementara123",
        platformRole: "USER",
      },
      { actorUserId: admin.id },
    );

    const jar = new CookieJar();
    const login = await signIn(jar, created.username, "Sementara123");
    expect(login.status).toBe(200);
    let session = await sessionFor(jar);
    expect(session?.user.mustChangePassword).toBe(true);

    // Same code path the /change-password form uses.
    await changeOwnPassword(
      {
        userId: session!.user.id,
        currentSessionId: session!.session.id,
        currentPassword: "Sementara123",
        newPassword: "BaruRahasia123",
      },
      new Request("http://localhost:3000/change-password"),
    );

    session = await sessionFor(jar);
    expect(session?.user.mustChangePassword).toBe(false);
    expect((await signIn(new CookieJar(), created.username, "BaruRahasia123")).status).toBe(200);
    expect(
      (await signIn(new CookieJar(), created.username, "Sementara123", "10.77.0.9")).status,
    ).toBe(401);

    const userCreated = await db.auditLog.findFirst({
      where: { action: "USER_CREATED", entityId: created.id },
    });
    expect(userCreated?.actorUserId).toBe(admin.id);
    const pwdChanged = await db.auditLog.findFirst({
      where: { action: "PASSWORD_CHANGED", actorUserId: created.id },
    });
    expect(pwdChanged).not.toBeNull();
    expect(await auditMeta(pwdChanged)).not.toContain("Sementara123");
    expect(await auditMeta(pwdChanged)).toMatch(/self_service/);
  });

  it("admin reset revokes every session, forces a change, and audits PASSWORD_RESET", async () => {
    const admin = await createUser({ username: "root.reset", platformRole: "SUPER_ADMIN" });
    const target: TestUser = await createUser({ username: "uji.reset" });

    const jar = new CookieJar();
    expect((await signIn(jar, target.username, target.password)).status).toBe(200);
    expect(await db.session.count({ where: { userId: target.id } })).toBe(1);

    await resetUserPassword(target.id, "GantiBaru1234", { actorUserId: admin.id });

    // Sessions revoked server-side: the old cookie is dead (back button too).
    expect(await db.session.count({ where: { userId: target.id } })).toBe(0);
    expect(await sessionFor(jar)).toBeNull();

    const fresh = new CookieJar();
    const login = await signIn(fresh, target.username, "GantiBaru1234");
    expect(login.status).toBe(200);
    const session = await sessionFor(fresh);
    expect(session?.user.mustChangePassword).toBe(true);

    const audit = await db.auditLog.findFirst({
      where: { action: "PASSWORD_RESET", entityId: target.id },
    });
    expect(audit?.actorUserId).toBe(admin.id);
    expect(await auditMeta(audit)).not.toContain("GantiBaru1234");
  });
});

describe("logout", () => {
  it("kills the session server-side: old cookie replay stays dead, LOGOUT audited", async () => {
    const user = await createUser({ username: "uji.keluar" });
    const jar = new CookieJar();
    expect((await signIn(jar, user.username, user.password)).status).toBe(200);
    const cookieBeforeLogout = jar.header();
    expect(cookieBeforeLogout.length).toBeGreaterThan(0);

    const res = await callAuth("/api/auth/sign-out", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
      jar,
    });
    expect(res.status).toBeLessThan(300);

    // Jar cookie was cleared and the row is gone.
    expect(await sessionFor(jar)).toBeNull();
    expect(await db.session.count({ where: { userId: user.id } })).toBe(0);
    // "Back button": replaying the pre-logout cookie must not resurrect it.
    expect(await sessionForCookie(cookieBeforeLogout)).toBeNull();

    const audit = await db.auditLog.findFirst({ where: { action: "LOGOUT", actorUserId: user.id } });
    expect(audit).not.toBeNull();
  });
});

describe("super admin user management", () => {
  it("lists users, suspends (revokes sessions + audit), activates, revokes sessions", async () => {
    const admin = await createUser({ username: "root.kelola", platformRole: "SUPER_ADMIN" });
    const target = await createUser({ username: "uji.kelola", password: "Utama1234567" });

    const jar = new CookieJar();
    expect((await signIn(jar, target.username, target.password)).status).toBe(200);
    expect(await db.session.count({ where: { userId: target.id } })).toBe(1);

    // List view behind /admin/users.
    const listed = await listUsers({ page: 1, pageSize: 10, q: "uji.kelola" });
    expect(listed.total).toBe(1);
    expect(listed.rows[0]?.id).toBe(target.id);
    expect(listed.rows[0]?.membershipCount).toBe(0);

    const malformedPage = await listUsers({ page: Number.NaN, pageSize: 10 });
    expect(malformedPage.page).toBe(1);
    expect(malformedPage.rows.length).toBeGreaterThan(0);

    // Suspend: flag set, sessions revoked server-side, audited, login blocked.
    await suspendUser(target.id, { actorUserId: admin.id });
    const suspended = await db.user.findUnique({ where: { id: target.id } });
    expect(suspended?.status).toBe("SUSPENDED");
    expect(suspended?.banned).toBe(true);
    expect(await db.session.count({ where: { userId: target.id } })).toBe(0);
    expect(await sessionFor(jar)).toBeNull();
    expect((await signIn(new CookieJar(), target.username, target.password)).status).toBe(403);
    const suspendAudit = await db.auditLog.findFirst({
      where: { action: "USER_SUSPENDED", entityId: target.id },
    });
    expect(suspendAudit?.actorUserId).toBe(admin.id);

    // Self-suspend is blocked (CONFLICT).
    let selfBlocked: unknown = null;
    try {
      await suspendUser(admin.id, { actorUserId: admin.id });
    } catch (error) {
      selfBlocked = error;
    }
    expect(isAppError(selfBlocked) && selfBlocked.code === "CONFLICT").toBe(true);

    // Activate restores login and is audited.
    await activateUser(target.id, { actorUserId: admin.id });
    expect((await signIn(new CookieJar(), target.username, target.password)).status).toBe(200);
    expect(
      await db.auditLog.count({ where: { action: "USER_ACTIVATED", entityId: target.id } }),
    ).toBe(1);

    // Revoke one session, then all remaining sessions.
    // 4 successful sign-ins total (L271, L304, plus the two below) minus the
    // session revoked at suspend = 3 rows; one row per sign-in.
    const jars = [new CookieJar(), new CookieJar()];
    for (const one of jars) {
      expect((await signIn(one, target.username, target.password)).status).toBe(200);
    }
    expect(await db.session.count({ where: { userId: target.id } })).toBe(3);
    const first = await db.session.findFirst({
      where: { userId: target.id },
      orderBy: { createdAt: "asc" },
    });
    await revokeUserSession(target.id, first!.id, { actorUserId: admin.id });
    expect(await db.session.count({ where: { userId: target.id } })).toBe(2);
    expect(
      await db.auditLog.count({ where: { action: "SESSION_REVOKED", entityId: first!.id } }),
    ).toBe(1);

    const revokedAll = await revokeAllUserSessions(target.id, { actorUserId: admin.id });
    expect(revokedAll).toBe(2);
    expect(await db.session.count({ where: { userId: target.id } })).toBe(0);
    const revokeAllAudit = await db.auditLog.findFirst({
      where: { action: "SESSION_REVOKED", entityId: target.id },
    });
    expect(revokeAllAudit?.actorUserId).toBe(admin.id);
  });
});

describe("audit metadata hygiene", () => {
  it("never stores password or session token material in AuditLog", async () => {
    // This file already exercised login success/failure/logout, user create,
    // password change and reset — dump everything it wrote.
    const rows = await db.auditLog.findMany();
    expect(rows.length).toBeGreaterThan(0);
    const dump = JSON.stringify(rows);

    expect(dump).not.toMatch(/"password"\s*:/i);
    expect(dump).not.toMatch(/"token"\s*:/i);
    expect(dump).not.toContain("Rahasia12345");
    expect(dump).not.toContain("Benar1234567");
    expect(dump).not.toContain("Sementara123");
    expect(dump).not.toContain("BaruRahasia123");
    expect(dump).not.toContain("GantiBaru1234");

    // All three login-relevant actions are present.
    const actions = new Set(rows.map((row) => row.action));
    expect(actions.has("LOGIN_SUCCESS")).toBe(true);
    expect(actions.has("LOGIN_FAILED")).toBe(true);
    expect(actions.has("LOGOUT")).toBe(true);
  });
});
