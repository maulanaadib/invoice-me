// Unit tests: the central permission matrix (feature 01 spec).
// Every role gets ≥10 assertions; OWNER allows everything, VIEWER never allows
// invoice.issue, ADMIN lacks the OWNER-only actions, and guards fail closed.

import { describe, expect, it } from "vitest";
import { AppError, isAppError } from "@/lib/errors";
import {
  assertCan,
  can,
  requireOrgScope,
  type PermissionAction,
} from "@/modules/permissions/service";
import type { OrganizationRole } from "@prisma/client";

const ORG = "org_test_1";

function ctxFor(role: OrganizationRole | null) {
  return { organizationId: ORG, role };
}

function expectForbiddenThrow(run: () => unknown): void {
  let caught: unknown = null;
  try {
    run();
  } catch (error) {
    caught = error;
  }
  expect(isAppError(caught)).toBe(true);
  expect((caught as AppError).code).toBe("FORBIDDEN");
}

describe("OWNER", () => {
  const ctx = ctxFor("OWNER");

  it("grants every business action", () => {
    expect(can("invoice.issue", ctx)).toBe(true);
    expect(can("invoice.cancel", ctx)).toBe(true);
    expect(can("invoice.revise", ctx)).toBe(true);
    expect(can("invoice.draft.delete", ctx)).toBe(true);
    expect(can("customer.delete", ctx)).toBe(true);
    expect(can("project.delete", ctx)).toBe(true);
    expect(can("payment.record", ctx)).toBe(true);
    expect(can("payment.delete", ctx)).toBe(true);
    expect(can("payment.override", ctx)).toBe(true);
    expect(can("report.view", ctx)).toBe(true);
    expect(can("org.settings.update", ctx)).toBe(true);
    expect(can("org.member.invite", ctx)).toBe(true);
    expect(can("delete_org", ctx)).toBe(true);
    expect(can("transfer_ownership", ctx)).toBe(true);
  });
});

describe("ADMIN", () => {
  const ctx = ctxFor("ADMIN");

  it("grants everything except the OWNER-only actions", () => {
    expect(can("invoice.issue", ctx)).toBe(true);
    expect(can("invoice.cancel", ctx)).toBe(true);
    expect(can("invoice.draft.delete", ctx)).toBe(true);
    expect(can("customer.delete", ctx)).toBe(true);
    expect(can("project.delete", ctx)).toBe(true);
    expect(can("payment.record", ctx)).toBe(true);
    // Reversal and the overpayment override are OWNER/ADMIN (feature 07).
    expect(can("payment.delete", ctx)).toBe(true);
    expect(can("payment.override", ctx)).toBe(true);
    expect(can("report.view", ctx)).toBe(true);
    expect(can("org.settings.update", ctx)).toBe(true);
    expect(can("org.member.invite", ctx)).toBe(true);
    expect(can("org.member.remove", ctx)).toBe(true);
    expect(can("delete_org", ctx)).toBe(false);
    expect(can("transfer_ownership", ctx)).toBe(false);
  });
});

describe("STAFF", () => {
  const ctx = ctxFor("STAFF");

  it("grants drafts, customers, projects, issue/marksent, payments and read/export invoice actions", () => {
    expect(can("invoice.draft.create", ctx)).toBe(true);
    expect(can("invoice.draft.read", ctx)).toBe(true);
    expect(can("invoice.draft.update", ctx)).toBe(true);
    expect(can("invoice.draft.delete", ctx)).toBe(true);
    expect(can("invoice.view", ctx)).toBe(true);
    expect(can("invoice.download", ctx)).toBe(true);
    expect(can("invoice.preview", ctx)).toBe(true);
    expect(can("invoice.export", ctx)).toBe(true);
    // Feature 05 spec: STAFF+ issues and marks sent (permission updated there).
    expect(can("invoice.issue", ctx)).toBe(true);
    expect(can("invoice.markSent", ctx)).toBe(true);
    expect(can("customer.create", ctx)).toBe(true);
    expect(can("customer.update", ctx)).toBe(true);
    expect(can("customer.delete", ctx)).toBe(true);
    expect(can("project.create", ctx)).toBe(true);
    expect(can("project.update", ctx)).toBe(true);
    // Feature 07 spec: STAFF+ records payments and reads the history.
    expect(can("payment.view", ctx)).toBe(true);
    expect(can("payment.record", ctx)).toBe(true);
    expect(can("report.view", ctx)).toBe(true);
  });

  it("denies cancel/revise, payment reversal/override, org admin and destructive actions", () => {
    expect(can("invoice.cancel", ctx)).toBe(false);
    expect(can("invoice.revise", ctx)).toBe(false);
    expect(can("payment.delete", ctx)).toBe(false);
    expect(can("payment.override", ctx)).toBe(false);
    expect(can("org.settings.update", ctx)).toBe(false);
    expect(can("org.member.invite", ctx)).toBe(false);
    expect(can("delete_org", ctx)).toBe(false);
  });
});

describe("VIEWER", () => {
  const ctx = ctxFor("VIEWER");

  it("only grants invoice view + download and payment read (≥10 assertions)", () => {
    expect(can("invoice.view", ctx)).toBe(true);
    expect(can("invoice.download", ctx)).toBe(true);
    // Feature 07 spec: VIEWER is read-only on payments — history yes, no writes.
    expect(can("payment.view", ctx)).toBe(true);
    expect(can("invoice.issue", ctx)).toBe(false);
    expect(can("invoice.preview", ctx)).toBe(false);
    expect(can("invoice.export", ctx)).toBe(false);
    expect(can("invoice.draft.create", ctx)).toBe(false);
    expect(can("invoice.draft.delete", ctx)).toBe(false);
    expect(can("customer.create", ctx)).toBe(false);
    expect(can("customer.delete", ctx)).toBe(false);
    expect(can("project.create", ctx)).toBe(false);
    expect(can("payment.record", ctx)).toBe(false);
    expect(can("payment.delete", ctx)).toBe(false);
    expect(can("payment.override", ctx)).toBe(false);
    expect(can("report.view", ctx)).toBe(false);
    expect(can("org.settings.update", ctx)).toBe(false);
    expect(can("org.member.invite", ctx)).toBe(false);
    expect(can("delete_org", ctx)).toBe(false);
    expect(can("transfer_ownership", ctx)).toBe(false);
  });
});

describe("fail-closed guards", () => {
  it("denies everything without a role", () => {
    expect(can("invoice.issue", { organizationId: ORG, role: null })).toBe(false);
    expect(can("invoice.issue", { organizationId: ORG })).toBe(false);
    expect(can("org.settings.update", { organizationId: null, role: null })).toBe(false);
  });

  it("requireOrgScope throws FORBIDDEN without organization or role", () => {
    expectForbiddenThrow(() => requireOrgScope({ organizationId: null, role: null }));
    expectForbiddenThrow(() => requireOrgScope({ organizationId: ORG, role: null }));
    // Valid context does not throw and narrows the type.
    expect(() => requireOrgScope(ctxFor("OWNER"))).not.toThrow();
  });

  it("assertCan throws FORBIDDEN when the matrix denies the action", () => {
    expect(() => assertCan("invoice.issue", ctxFor("OWNER"))).not.toThrow();
    expectForbiddenThrow(() => assertCan("invoice.issue", ctxFor("VIEWER")));
    expectForbiddenThrow(() => assertCan("delete_org", ctxFor("ADMIN")));
  });
});

describe("suspended organization (feature 09, ratified rule)", () => {
  const suspended = (role: OrganizationRole) => ({
    organizationId: ORG,
    role,
    organizationStatus: "SUSPENDED" as const,
  });

  it("blocks every mutation while leaving reads and downloads open", () => {
    expect(can("invoice.issue", suspended("OWNER"))).toBe(false);
    expect(can("invoice.draft.create", suspended("OWNER"))).toBe(false);
    expect(can("customer.create", suspended("STAFF"))).toBe(false);
    expect(can("payment.record", suspended("ADMIN"))).toBe(false);
    expect(can("org.settings.update", suspended("ADMIN"))).toBe(false);
    expect(can("org.member.invite", suspended("OWNER"))).toBe(false);
    expect(can("delete_org", suspended("OWNER"))).toBe(false);
    // Reads/downloads stay allowed — data is never frozen.
    expect(can("invoice.view", suspended("VIEWER"))).toBe(true);
    expect(can("invoice.download", suspended("VIEWER"))).toBe(true);
    expect(can("payment.view", suspended("STAFF"))).toBe(true);
    expect(can("report.view", suspended("ADMIN"))).toBe(true);
    expect(can("invoice.preview", suspended("STAFF"))).toBe(true);
    expect(can("org.view", suspended("OWNER"))).toBe(true);
  });

  it("ACTIVE status (and absent status) changes nothing", () => {
    expect(
      can("invoice.issue", { organizationId: ORG, role: "OWNER", organizationStatus: "ACTIVE" }),
    ).toBe(true);
    expect(can("invoice.issue", { organizationId: ORG, role: "OWNER" })).toBe(true);
  });

  it("assertCan throws FORBIDDEN with the suspension message on mutations", () => {
    let caught: unknown = null;
    try {
      assertCan("invoice.draft.create", suspended("OWNER"));
    } catch (error) {
      caught = error;
    }
    expect(isAppError(caught)).toBe(true);
    expect((caught as AppError).code).toBe("FORBIDDEN");
    expect((caught as AppError).message).toBe(
      "Organisasi ini ditangguhkan oleh super admin. Aksi baru tidak diizinkan.",
    );
    // A read still passes through untouched.
    expect(() => assertCan("invoice.view", suspended("VIEWER"))).not.toThrow();
  });

  it("keeps the ordinary matrix message when the suspension is not the cause", () => {
    let caught: unknown = null;
    try {
      assertCan("invoice.issue", { organizationId: ORG, role: "VIEWER" });
    } catch (error) {
      caught = error;
    }
    expect((caught as AppError).message).toBe(
      "Anda tidak memiliki izin untuk melakukan aksi ini.",
    );
  });
});

describe("spec acceptance example", () => {
  it("can('invoice.issue', ctx): OWNER true, VIEWER false", () => {
    const owner: Parameters<typeof can>[1] = { organizationId: ORG, role: "OWNER" };
    const viewer: Parameters<typeof can>[1] = { organizationId: ORG, role: "VIEWER" };
    const action: PermissionAction = "invoice.issue";
    expect(can(action, owner)).toBe(true);
    expect(can(action, viewer)).toBe(false);
  });
});
