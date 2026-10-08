// Unit tests: feature 09 input contract (src/modules/admin/schema.ts).
// The service parses every admin list filter through these schemas, so this is
// where "malformed filter fails loudly instead of silently returning
// everything" is decided. Covered here: the Indonesian messages the UI shows,
// date format, enum filters, page coercion, and the length ceilings.

import { describe, expect, it } from "vitest";
import {
  ADMIN_PAGE_SIZE,
  adminAuditQuerySchema,
  adminInvoiceQuerySchema,
  adminPdfJobQuerySchema,
  retryPdfJobSchema,
  setOrganizationStatusSchema,
  setPlatformRoleSchema,
} from "@/modules/admin/schema";

function firstIssue(schema: { safeParse: (input: unknown) => { success: boolean; error?: { issues: Array<{ message: string; path: Array<unknown> }> } } }, input: unknown) {
  const parsed = schema.safeParse(input);
  expect(parsed.success).toBe(false);
  return parsed.error?.issues[0];
}

describe("ADMIN_PAGE_SIZE", () => {
  it("is 20 rows per page (the value integration tests assert against)", () => {
    expect(ADMIN_PAGE_SIZE).toBe(20);
  });
});

describe("adminInvoiceQuerySchema", () => {
  it("accepts an empty query (no filter at all)", () => {
    expect(adminInvoiceQuerySchema.safeParse({}).success).toBe(true);
  });

  it("coerces a numeric page string and keeps a number as-is", () => {
    expect(adminInvoiceQuerySchema.parse({ page: "3" }).page).toBe(3);
    expect(adminInvoiceQuerySchema.parse({ page: 7 }).page).toBe(7);
  });

  it("rejects page 0, negatives, fractions and non-numeric pages", () => {
    for (const page of ["0", "-1", "2.5", "abc", ""]) {
      expect(adminInvoiceQuerySchema.safeParse({ page }).success).toBe(false);
    }
  });

  it("trims and caps the free-text search at 100 characters", () => {
    expect(adminInvoiceQuerySchema.parse({ q: "  dharma  " }).q).toBe("dharma");
    expect(adminInvoiceQuerySchema.safeParse({ q: "x".repeat(101) }).success).toBe(false);
  });

  it("accepts every real invoice status, including the effective OVERDUE", () => {
    for (const status of [
      "DRAFT",
      "ISSUED",
      "SENT",
      "PARTIALLY_PAID",
      "PAID",
      "OVERDUE",
      "CANCELLED",
      "REVISED",
    ]) {
      expect(adminInvoiceQuerySchema.safeParse({ status }).success).toBe(true);
    }
  });

  it("rejects an unknown status with the Indonesian message", () => {
    const issue = firstIssue(adminInvoiceQuerySchema, { status: "LUNAS" });
    expect(issue?.message).toBe("Status filter tidak valid.");
  });

  it("requires YYYY-MM-DD for both date bounds", () => {
    expect(adminInvoiceQuerySchema.safeParse({ from: "2026-10-08" }).success).toBe(true);
    expect(adminInvoiceQuerySchema.safeParse({ to: "2026-12-31" }).success).toBe(true);

    for (const from of ["01-02-2026", "2026-2-1", "bukan-tanggal", "2026/10/08"]) {
      const issue = firstIssue(adminInvoiceQuerySchema, { from });
      expect(issue?.message).toBe("Format tanggal harus YYYY-MM-DD.");
    }
    expect(adminInvoiceQuerySchema.safeParse({ to: "31-12-2026" }).success).toBe(false);
  });

  it("caps organizationId at 64 characters", () => {
    expect(adminInvoiceQuerySchema.safeParse({ organizationId: "o".repeat(65) }).success).toBe(
      false,
    );
    expect(adminInvoiceQuerySchema.safeParse({ organizationId: "org_1" }).success).toBe(true);
  });
});

describe("adminAuditQuerySchema", () => {
  it("accepts every real audit action", () => {
    for (const action of [
      "LOGIN_SUCCESS",
      "LOGIN_FAILED",
      "ADMIN_VIEWED_INVOICE",
      "USER_ROLE_CHANGED",
      "ORGANIZATION_STATUS_CHANGED",
      "PDF_JOB_RETRIED",
    ]) {
      expect(adminAuditQuerySchema.safeParse({ action }).success).toBe(true);
    }
  });

  it("rejects an unknown action with the Indonesian message", () => {
    const issue = firstIssue(adminAuditQuerySchema, { action: "BUKAN_AKSI" });
    expect(issue?.message).toBe("Filter aksi tidak valid.");
  });

  it("applies page, actor, organization and date rules like the invoice list", () => {
    expect(adminAuditQuerySchema.parse({ page: "2" }).page).toBe(2);
    expect(adminAuditQuerySchema.safeParse({ page: "0" }).success).toBe(false);
    expect(adminAuditQuerySchema.safeParse({ actorUserId: "u".repeat(65) }).success).toBe(false);
    expect(adminAuditQuerySchema.safeParse({ organizationId: "o".repeat(65) }).success).toBe(false);
    const issue = firstIssue(adminAuditQuerySchema, { from: "08-10-2026" });
    expect(issue?.message).toBe("Format tanggal harus YYYY-MM-DD.");
  });
});

describe("adminPdfJobQuerySchema", () => {
  it("accepts every PdfJobStatus and rejects anything else", () => {
    for (const status of ["PENDING", "RUNNING", "SUCCESS", "FAILED"]) {
      expect(adminPdfJobQuerySchema.safeParse({ status }).success).toBe(true);
    }
    const issue = firstIssue(adminPdfJobQuerySchema, { status: "BUKAN_STATUS" });
    expect(issue?.message).toBe("Filter status tidak valid.");
  });

  it("caps the invoice search box at 100 characters", () => {
    expect(adminPdfJobQuerySchema.safeParse({ invoice: "i".repeat(101) }).success).toBe(false);
    expect(adminPdfJobQuerySchema.safeParse({ invoice: "INV/2026" }).success).toBe(true);
  });
});

describe("setPlatformRoleSchema", () => {
  it("accepts the two platform roles", () => {
    expect(setPlatformRoleSchema.parse({ userId: "u1", platformRole: "SUPER_ADMIN" })).toEqual({
      userId: "u1",
      platformRole: "SUPER_ADMIN",
    });
    expect(setPlatformRoleSchema.safeParse({ userId: "u1", platformRole: "USER" }).success).toBe(
      true,
    );
  });

  it("requires a user and rejects any other platform role", () => {
    expect(firstIssue(setPlatformRoleSchema, { userId: "", platformRole: "USER" })?.message).toBe(
      "User wajib dipilih.",
    );
    expect(
      firstIssue(setPlatformRoleSchema, { userId: "u1", platformRole: "OWNER" })?.message,
    ).toBe("Platform role tidak valid.");
  });
});

describe("setOrganizationStatusSchema", () => {
  it("accepts ACTIVE and SUSPENDED only", () => {
    expect(
      setOrganizationStatusSchema.safeParse({ organizationId: "o1", status: "ACTIVE" }).success,
    ).toBe(true);
    expect(
      setOrganizationStatusSchema.safeParse({ organizationId: "o1", status: "SUSPENDED" }).success,
    ).toBe(true);
    expect(
      setOrganizationStatusSchema.safeParse({ organizationId: "o1", status: "FROZEN" }).success,
    ).toBe(false);
  });

  it("requires an organization id", () => {
    expect(
      firstIssue(setOrganizationStatusSchema, { organizationId: "", status: "SUSPENDED" })?.message,
    ).toBe("Organisasi wajib dipilih.");
  });

  it("reports the invalid-status message in Indonesian", () => {
    expect(
      firstIssue(setOrganizationStatusSchema, { organizationId: "o1", status: "BANNED" })?.message,
    ).toBe("Status organisasi tidak valid.");
  });
});

describe("retryPdfJobSchema", () => {
  it("requires a job id", () => {
    expect(retryPdfJobSchema.safeParse({ jobId: "job_1" }).success).toBe(true);
    expect(firstIssue(retryPdfJobSchema, { jobId: "" })?.message).toBe("Job PDF wajib dipilih.");
  });
});
