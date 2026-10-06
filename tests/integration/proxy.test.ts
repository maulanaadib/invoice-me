// tests/integration/proxy.test.ts
// Feature 01 "Check When Done" — route protection in src/proxy.ts (Next 16's
// middleware): anonymous users are redirected to /login with ?next=, signed-in
// users are kept off /login, mustChangePassword forces /change-password before
// anything else, and /admin/* is SUPER_ADMIN-only.

import { NextRequest } from "next/server";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { clearLockoutStore } from "@/modules/auth/service";
import { proxy } from "@/proxy";
import { createUser, resetDatabase, type TestUser } from "../factories";
import { CookieJar, signIn } from "../helpers/auth";

let regularUser: TestUser;
let forcedChangeUser: TestUser;
let superAdmin: TestUser;
let regularJar: CookieJar;
let forcedJar: CookieJar;
let adminJar: CookieJar;

function req(path: string, jar?: CookieJar): NextRequest {
  return new NextRequest(`http://localhost:3000${path}`, {
    headers: jar ? jar.toHeaders() : undefined,
  });
}

function locationOf(response: Response): string {
  return response.headers.get("location") ?? "";
}

function isNext(response: Response): boolean {
  return response.headers.get("x-middleware-next") === "1";
}

async function login(user: TestUser): Promise<CookieJar> {
  const jar = new CookieJar();
  const res = await signIn(jar, user.username, user.password);
  expect(res.status).toBe(200);
  return jar;
}

beforeAll(async () => {
  await resetDatabase();
  regularUser = await createUser({ username: "proxy.user" });
  forcedChangeUser = await createUser({ username: "proxy.forced", mustChangePassword: true });
  superAdmin = await createUser({ username: "proxy.root", platformRole: "SUPER_ADMIN" });
  regularJar = await login(regularUser);
  forcedJar = await login(forcedChangeUser);
  adminJar = await login(superAdmin);
});

beforeEach(() => {
  clearLockoutStore();
});

describe("anonymous requests", () => {
  it("redirects protected routes to /login preserving ?next=", async () => {
    const res = await proxy(req("/dashboard"));
    expect(res.status).toBe(307);
    const location = locationOf(res);
    expect(location).toContain("/login");
    expect(location).toContain("next=");
    expect(location).toContain("dashboard");

    const adminRes = await proxy(req("/admin/users"));
    expect(locationOf(adminRes)).toContain("/login");
  });

  it("lets anonymous visitors onto the public auth pages", async () => {
    const loginPage = await proxy(req("/login"));
    expect(isNext(loginPage)).toBe(true);

    const forgot = await proxy(req("/forgot-password"));
    expect(isNext(forgot)).toBe(true);
  });
});

describe("signed-in regular user", () => {
  it("reaches the dashboard but not /admin or /login", async () => {
    expect(isNext(await proxy(req("/dashboard", regularJar)))).toBe(true);

    const adminRes = await proxy(req("/admin/users", regularJar));
    expect(adminRes.status).toBe(307);
    expect(locationOf(adminRes)).toContain("/unauthorized");

    const loginRes = await proxy(req("/login", regularJar));
    expect(loginRes.status).toBe(307);
    expect(locationOf(loginRes)).toContain("/dashboard");
  });
});

describe("forced password change", () => {
  it("locks every route — including /login and /admin — behind /change-password", async () => {
    const dashboard = await proxy(req("/dashboard", forcedJar));
    expect(dashboard.status).toBe(307);
    expect(locationOf(dashboard)).toContain("/change-password");

    const admin = await proxy(req("/admin/users", forcedJar));
    expect(admin.status).toBe(307);
    expect(locationOf(admin)).toContain("/change-password");

    const loginPage = await proxy(req("/login", forcedJar));
    expect(loginPage.status).toBe(307);
    expect(locationOf(loginPage)).toContain("/change-password");

    // The target page itself stays reachable.
    expect(isNext(await proxy(req("/change-password", forcedJar)))).toBe(true);
  });
});

describe("onboarding gate (feature 02)", () => {
  let newbie: TestUser;
  let newbieJar: CookieJar;
  let forcedNewbie: TestUser;
  let forcedNewbieJar: CookieJar;

  beforeAll(async () => {
    newbie = await createUser({ username: "proxy.newbie", onboardingComplete: false });
    newbieJar = await login(newbie);
    forcedNewbie = await createUser({
      username: "proxy.newbie.forced",
      onboardingComplete: false,
      mustChangePassword: true,
    });
    forcedNewbieJar = await login(forcedNewbie);
  });

  it("bounces an unfinished user from /dashboard to /onboarding", async () => {
    const res = await proxy(req("/dashboard", newbieJar));
    expect(res.status).toBe(307);
    expect(locationOf(res)).toContain("/onboarding");
  });

  it("lets an unfinished user onto /onboarding", async () => {
    expect(isNext(await proxy(req("/onboarding", newbieJar)))).toBe(true);
  });

  it("keeps a finished user off /onboarding (back to the dashboard)", async () => {
    const res = await proxy(req("/onboarding", regularJar));
    expect(res.status).toBe(307);
    expect(locationOf(res)).toContain("/dashboard");
  });

  it("keeps the super admin off /onboarding", async () => {
    const res = await proxy(req("/onboarding", adminJar));
    expect(res.status).toBe(307);
    expect(locationOf(res)).toContain("/dashboard");
  });

  it("mustChangePassword still wins first for an unfinished user", async () => {
    const toDashboard = await proxy(req("/dashboard", forcedNewbieJar));
    expect(toDashboard.status).toBe(307);
    expect(locationOf(toDashboard)).toContain("/change-password");

    const toOnboarding = await proxy(req("/onboarding", forcedNewbieJar));
    expect(toOnboarding.status).toBe(307);
    expect(locationOf(toOnboarding)).toContain("/change-password");
  });
});

describe("super admin", () => {
  it("passes the /admin gate", async () => {
    expect(isNext(await proxy(req("/admin/users", adminJar)))).toBe(true);
    expect(isNext(await proxy(req("/admin/organizations", adminJar)))).toBe(true);
  });
});
