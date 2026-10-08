// Unit tests: feature 09 defense in depth — the SERVICE layer refuses
// non-admins before a single query runs (the proxy and layout guards are
// layers 1 and 2; a compromised route handler must not mean a bypass), plus
// the mutation guards that are answerable without a database.

import { describe, expect, it } from "vitest";
import { isAppError, type AppError } from "@/lib/errors";
import {
  adminDownloadInvoicePdf,
  adminViewInvoice,
  assertSuperAdmin,
  getAdminOrganizationDetail,
  getAdminOverview,
  getAdminUserDetail,
  getPlatformSettings,
  getStorageUsage,
  getSystemHealth,
  listAdminAuditLogs,
  listAdminFilterOptions,
  listAdminInvoices,
  listAdminPdfJobs,
  retryPdfJob,
  setOrganizationStatus,
  setPlatformRole,
  type AdminContext,
} from "@/modules/admin/service";

const USER: AdminContext = { platformRole: "USER", actorUserId: "user_plain" };
const ANON: AdminContext = { platformRole: null, actorUserId: "user_anon" };
const ADMIN: AdminContext = { platformRole: "SUPER_ADMIN", actorUserId: "user_admin" };

async function expectError(promise: Promise<unknown>, code: string): Promise<void> {
  let caught: unknown = null;
  try {
    await promise;
  } catch (error) {
    caught = error;
  }
  expect(isAppError(caught)).toBe(true);
  expect((caught as AppError).code).toBe(code);
}

describe("assertSuperAdmin", () => {
  it("throws FORBIDDEN for USER and missing platform role, passes for SUPER_ADMIN", () => {
    expect(() => assertSuperAdmin(ADMIN)).not.toThrow();

    const codes = [USER, ANON].map((ctx) => {
      try {
        assertSuperAdmin(ctx);
        return null;
      } catch (error) {
        return isAppError(error) ? error.code : "NOT_APP_ERROR";
      }
    });
    expect(codes).toEqual(["FORBIDDEN", "FORBIDDEN"]);
  });
});

describe("every admin entry point refuses a non-admin before any query", () => {
  it("read/monitoring entries reject with FORBIDDEN", async () => {
    await expectError(getAdminOverview(USER), "FORBIDDEN");
    await expectError(getAdminUserDetail(USER, "user_x"), "FORBIDDEN");
    await expectError(getAdminOrganizationDetail(USER, "org_x"), "FORBIDDEN");
    await expectError(listAdminInvoices(USER, {}), "FORBIDDEN");
    await expectError(listAdminAuditLogs(USER, {}), "FORBIDDEN");
    await expectError(listAdminPdfJobs(USER, {}), "FORBIDDEN");
    await expectError(listAdminFilterOptions(USER), "FORBIDDEN");
    await expectError(getStorageUsage(USER), "FORBIDDEN");
    await expectError(getSystemHealth(USER), "FORBIDDEN");
    await expectError(getPlatformSettings(USER), "FORBIDDEN");
  });

  it("sensitive invoice entries reject with FORBIDDEN", async () => {
    await expectError(adminViewInvoice(USER, "invoice_x"), "FORBIDDEN");
    await expectError(adminDownloadInvoicePdf(USER, "invoice_x"), "FORBIDDEN");
  });

  it("mutations reject with FORBIDDEN", async () => {
    await expectError(
      setPlatformRole(USER, { userId: "user_y", platformRole: "USER" }),
      "FORBIDDEN",
    );
    await expectError(
      setOrganizationStatus(USER, { organizationId: "org_y", status: "SUSPENDED" }),
      "FORBIDDEN",
    );
    await expectError(retryPdfJob(USER, "job_x"), "FORBIDDEN");
  });
});

describe("mutation guards that need no database", () => {
  it("setPlatformRole refuses to change your own role (lockout guard)", async () => {
    await expectError(
      setPlatformRole(ADMIN, { userId: ADMIN.actorUserId, platformRole: "USER" }),
      "CONFLICT",
    );
  });

  it("validates required identifiers before touching the database", async () => {
    await expectError(
      setPlatformRole(ADMIN, { userId: "", platformRole: "USER" }),
      "VALIDATION_ERROR",
    );
    await expectError(
      setOrganizationStatus(ADMIN, { organizationId: "", status: "SUSPENDED" }),
      "VALIDATION_ERROR",
    );
    await expectError(retryPdfJob(ADMIN, ""), "VALIDATION_ERROR");
  });
});
