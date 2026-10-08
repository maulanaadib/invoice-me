// tests/integration/admin.test.ts
// Feature 09 Check When Done — proven end to end against the test database:
//   - proxy layer: USER → /unauthorized on /admin/*
//   - overview numbers (total user/org, invoice bulan ini) match reality
//   - user detail: memberships, invoice count PER ORG (sums to the total),
//     revoke session, force password change, assign platform role (+audit)
//   - organization detail: membership, invoice count, storage, last activity,
//     suspend → login blocked + new mutations blocked (reads still allowed)
//   - invoice monitoring: cross-org view + ADMIN_VIEWED_INVOICE audit
//   - admin PDF download → PDF_DOWNLOADED with admin metadata
//   - PDF jobs: list shows status/duration/error; retry re-enqueues and the
//     worker's claim bumps the attempt counter
//   - audit logs: action/actor/org/date filters, pagination, sanitized metadata
//   - storage: UploadRecord + reconcile + InvoicePdf sums per org
//   - system health: probes report status, secret env values never leak

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { NextRequest } from "next/server";
import { beforeAll, describe, expect, it } from "vitest";
import { isAppError, type AppError } from "@/lib/errors";
import { todayInJakarta } from "@/lib/date";
import { createCustomer, type CustomerFormInput } from "@/modules/customers/service";
import { createProfile } from "@/modules/profiles/service";
import { createDraft } from "@/modules/invoices/service";
import { issueInvoice } from "@/modules/invoices/issue-service";
import type { InvoiceDraftFormOutput } from "@/modules/invoices/schema";
import {
  ORG_SUSPENDED_MESSAGE,
  assertCan,
} from "@/modules/permissions/service";
import { ADMIN_PAGE_SIZE } from "@/modules/admin/schema";
import {
  adminDownloadInvoicePdf,
  adminViewInvoice,
  getAdminOrganizationDetail,
  getAdminOverview,
  getAdminUserDetail,
  getPlatformSettings,
  getStorageUsage,
  getSystemHealth,
  listAdminAuditLogs,
  listAdminInvoices,
  listAdminPdfJobs,
  retryPdfJob,
  setOrganizationStatus,
  setPlatformRole,
  type AdminContext,
} from "@/modules/admin/service";
import { blockedBySuspendedOrganization, resetUserPassword, revokeUserSession } from "@/modules/auth/service";
import { claimNextJob } from "@/modules/pdf/worker";
import { getStorageService } from "@/modules/storage";
import { resolveActiveOrgScope, switchActiveOrganization } from "@/modules/organizations/service";
import { getDashboardCards } from "@/modules/dashboard/service";
import { logAudit } from "@/modules/audit/service";
import { auth } from "@/server/auth";
import { db } from "@/server/db";
import { env } from "@/server/env";
import { proxy } from "@/proxy";
import {
  addMembership,
  createOrganization,
  createUser,
  resetDatabase,
  type TestUser,
} from "../factories";
import { CookieJar, signIn } from "../helpers/auth";

let admin: TestUser;
let owner: TestUser;
let regular: TestUser;
let suspendOnly: TestUser;
let multiOrgUser: TestUser;

let orgA: { id: string };
let suspendOrg: { id: string };
let activeOrg: { id: string };

let profileId: string;
let customerId: string;
let issuedInvoiceId: string;
let issuedGrandTotal = "0";
let pdfStoragePath = "";
let pdfFixtureBytes = 0;
let uploadFixturePath = "";
let uploadFixtureBytes = 0;
let manualUploadPath = "";
let failedJobId = "";

const adminCtx: AdminContext = { platformRole: "SUPER_ADMIN", actorUserId: "" };

function ownerCtx(organizationId?: string) {
  return {
    scope: {
      organizationId: organizationId ?? orgA.id,
      role: "OWNER" as const,
      userId: owner.id,
    },
    request: null,
  };
}

function customerInput(name: string): CustomerFormInput {
  return {
    companyName: name,
    legalName: name,
    businessType: "Dagang",
    isActive: true,
  } as CustomerFormInput;
}

async function expectAppError(promise: Promise<unknown>, code: string): Promise<AppError> {
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

const PNG = new Uint8Array(
  Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
    "base64",
  ),
);

beforeAll(async () => {
  await resetDatabase();
  admin = await createUser({ username: "admin09", platformRole: "SUPER_ADMIN" });
  owner = await createUser({ username: "owner09" });
  regular = await createUser({ username: "regular09" });
  suspendOnly = await createUser({ username: "suspend09" });
  multiOrgUser = await createUser({ username: "multi09" });
  adminCtx.actorUserId = admin.id;

  orgA = await createOrganization("Sigit Berkarya");
  suspendOrg = await createOrganization("Org Ditangguhkan");
  activeOrg = await createOrganization("Org Aktif Lain");
  await addMembership(owner.id, orgA.id, "OWNER");
  await addMembership(regular.id, orgA.id, "VIEWER");
  await addMembership(suspendOnly.id, suspendOrg.id, "OWNER");
  await addMembership(multiOrgUser.id, suspendOrg.id, "OWNER");
  await addMembership(multiOrgUser.id, activeOrg.id, "OWNER");

  profileId = (await createProfile(ownerCtx(), { name: "Sigit Berkarya", code: "SB" })).id;
  customerId = (await createCustomer(customerInput("PT Dharma Polimetal Tbk"), ownerCtx())).id;

  const draft = await createDraft(
    {
      profileId,
      invoiceType: "FULL",
      customerId,
      billingMode: "PERCENT",
      billingPercent: "100",
      invoiceDate: todayInJakarta(),
      dueDate: todayInJakarta(),
      items: [
        { description: "Pekerjaan uji admin", quantity: "1", unit: "Paket", unitPrice: "1000000" },
      ],
    } as InvoiceDraftFormOutput,
    ownerCtx(),
  );
  await issueInvoice(draft.id, ownerCtx());
  issuedInvoiceId = draft.id;
  const issued = await db.invoice.findUniqueOrThrow({ where: { id: issuedInvoiceId } });
  issuedGrandTotal = issued.grandTotal.toFixed(2);

  // ── PDF fixture: real file on disk + InvoicePdf row + invoice.pdfPath ──
  const year = todayInJakarta().slice(0, 4);
  pdfStoragePath = `invoices/organizations/${orgA.id}/${year}/INV-UJI-09-001.pdf`;
  const pdfBytes = Buffer.from("%PDF-1.4\n% fixture fitur 09\n%%EOF\n", "latin1");
  pdfFixtureBytes = pdfBytes.length;
  const pdfAbsolute = join(env.STORAGE_ROOT, pdfStoragePath);
  await mkdir(join(pdfAbsolute, ".."), { recursive: true });
  await writeFile(pdfAbsolute, pdfBytes);
  await db.invoice.update({ where: { id: issuedInvoiceId }, data: { pdfPath: pdfStoragePath } });
  await db.invoicePdf.create({
    data: {
      invoiceId: issuedInvoiceId,
      version: 1,
      storagePath: pdfStoragePath,
      originalFilename: "INV-UJI-09-001.pdf",
      mimeType: "application/pdf",
      sizeBytes: BigInt(pdfFixtureBytes),
      sha256: "0".repeat(64),
      templateVersion: "corporate-blue@1",
      generatedById: owner.id,
      isOfficial: true,
    },
  });

  // ── Upload fixtures: one recorded upload + one raw file for reconcile ──
  const uploaded = await getStorageService().upload(new File([PNG], "logo.png", { type: "image/png" }), {
    orgId: orgA.id,
    kind: "logos",
    allowedMimeTypes: ["image/png"],
  });
  uploadFixturePath = uploaded.path;
  uploadFixtureBytes = uploaded.size;
  manualUploadPath = `uploads/organizations/${orgA.id}/signatures/manual.png`;
  await mkdir(join(env.STORAGE_ROOT, manualUploadPath, ".."), { recursive: true });
  await writeFile(join(env.STORAGE_ROOT, manualUploadPath), Buffer.from(PNG));

  // Issue enqueued its own PENDING PdfJob — remove it so the retry test's
  // claimNextJob() can only ever claim the job this suite re-enqueues.
  await db.pdfJob.deleteMany({ where: { status: "PENDING" } });

  // ── PDF job fixtures: one FAILED (retryable), one SUCCESS (not retryable) ──
  const failedJob = await db.pdfJob.create({
    data: {
      invoiceId: issuedInvoiceId,
      status: "FAILED",
      attempt: 3,
      errorMessage: "Layanan PDF tidak dapat dihubungi.",
      startedAt: new Date(),
      finishedAt: new Date(),
      durationMs: 1234,
    },
  });
  failedJobId = failedJob.id;
  await db.pdfJob.create({
    data: { invoiceId: issuedInvoiceId, status: "SUCCESS", attempt: 1, durationMs: 800, finishedAt: new Date() },
  });
});

// ─── CWD: non-admin → /unauthorized (proxy layer) ───────────────────────────

describe("route guard (layer 1 — proxy)", () => {
  it("redirects a USER away from /admin/* to /unauthorized", async () => {
    const jar = new CookieJar();
    const login = await signIn(jar, regular.username, regular.password);
    expect(login.status).toBe(200);

    for (const path of ["/admin", "/admin/users", "/admin/audit-logs"]) {
      const res = await proxy(
        new NextRequest(`http://localhost:3000${path}`, { headers: jar.toHeaders() }),
      );
      expect(res.status).toBe(307);
      expect(res.headers.get("location") ?? "").toContain("/unauthorized");
    }

    // The super admin passes the same gate.
    const adminJar = new CookieJar();
    expect((await signIn(adminJar, admin.username, admin.password)).status).toBe(200);
    const ok = await proxy(
      new NextRequest("http://localhost:3000/admin", { headers: adminJar.toHeaders() }),
    );
    expect(ok.headers.get("x-middleware-next")).toBe("1");
  });
});

// ─── CWD: overview cards menampilkan angka benar ────────────────────────────

describe("overview", () => {
  it("reports totals that match independent counts", async () => {
    const overview = await getAdminOverview(adminCtx);

    expect(overview.totalUsers).toBe(await db.user.count());
    expect(overview.totalUsers).toBeGreaterThanOrEqual(1);
    expect(overview.activeUsers + overview.suspendedUsers).toBe(overview.totalUsers);
    expect(overview.totalOrganizations).toBe(await db.organization.count());
    expect(overview.totalOrganizations).toBeGreaterThanOrEqual(1);
    expect(overview.invoicesToday).toBeGreaterThanOrEqual(1);
    expect(overview.invoicesThisMonth).toBeGreaterThanOrEqual(1);
    expect(overview.invoiceValueThisMonth).toBe(issuedGrandTotal);
    expect(overview.pdfFailed).toBeGreaterThanOrEqual(1);
    expect(overview.storageTotalBytes).toBeGreaterThan(0);
    expect(overview.loginFailures).toBe(await db.auditLog.count({ where: { action: "LOGIN_FAILED" } }));
  });
});

// ─── CWD: user detail — membership, per-org invoice count, sessions, role ───

describe("user detail", () => {
  it("shows memberships and the per-org invoice count that sums to the total", async () => {
    const { detail, invoicesByOrg } = await getAdminUserDetail(adminCtx, owner.id);
    expect(detail.memberships.map((m) => m.organization.id)).toContain(orgA.id);
    expect(detail.invoiceCount).toBeGreaterThanOrEqual(1);
    expect(invoicesByOrg.length).toBeGreaterThanOrEqual(1);
    expect(invoicesByOrg[0]?.organizationId).toBe(orgA.id);
    expect(invoicesByOrg[0]?.organizationName).toBe("Sigit Berkarya");
    expect(invoicesByOrg.reduce((sum, row) => sum + row.count, 0)).toBe(detail.invoiceCount);
  });

  it("revoke session and force password change work", async () => {
    const session = await db.session.create({
      data: {
        userId: owner.id,
        token: `tok-feature09-${owner.id}`,
        expiresAt: new Date(Date.now() + 7 * 24 * 3600 * 1000),
        activeOrganizationId: orgA.id,
      },
    });
    await revokeUserSession(owner.id, session.id, { actorUserId: admin.id, request: null });
    expect(await db.session.findUnique({ where: { id: session.id } })).toBeNull();

    await resetUserPassword(owner.id, "Fitur09-Baru-1", { actorUserId: admin.id, request: null });
    const reloaded = await db.user.findUniqueOrThrow({ where: { id: owner.id } });
    expect(reloaded.mustChangePassword).toBe(true);
    expect(reloaded.banned).toBe(false);
  });

  it("assigns a platform role and audits USER_ROLE_CHANGED", async () => {
    await setPlatformRole(adminCtx, { userId: regular.id, platformRole: "SUPER_ADMIN" });
    const promoted = await db.user.findUniqueOrThrow({ where: { id: regular.id } });
    expect(promoted.platformRole).toBe("SUPER_ADMIN");
    expect(promoted.role).toBe("SUPER_ADMIN");

    const audit = await db.auditLog.findFirst({
      where: { action: "USER_ROLE_CHANGED", entityId: regular.id },
      orderBy: { createdAt: "desc" },
    });
    expect(audit).not.toBeNull();
    expect(audit?.actorUserId).toBe(admin.id);
    expect(audit?.metadata).toMatchObject({ from: "USER", to: "SUPER_ADMIN" });

    // Same-role change is a no-op CONFLICT (no phantom audit rows).
    await expectAppError(
      setPlatformRole(adminCtx, { userId: regular.id, platformRole: "SUPER_ADMIN" }),
      "CONFLICT",
    );

    await setPlatformRole(adminCtx, { userId: regular.id, platformRole: "USER" });
    const demoted = await db.user.findUniqueOrThrow({ where: { id: regular.id } });
    expect(demoted.platformRole).toBe("USER");
    expect(demoted.role).toBe("USER");
  });
});

// ─── CWD: invoice monitoring — cross-org view + ADMIN_VIEWED_INVOICE ─────────

describe("invoice monitoring", () => {
  it("lists invoices from any organization with org names", async () => {
    const result = await listAdminInvoices(adminCtx, {});
    expect(result.total).toBeGreaterThanOrEqual(1);
    const row = result.rows.find((r) => r.id === issuedInvoiceId);
    expect(row).toBeDefined();
    expect(row?.organizationName).toBe("Sigit Berkarya");
    expect(row?.number).not.toBeNull();
    expect(row?.grandTotal).toBe(issuedGrandTotal);

    // Effective-status filter and a validated date range both work.
    const filtered = await listAdminInvoices(adminCtx, { status: "ISSUED" });
    expect(filtered.rows.some((r) => r.id === issuedInvoiceId)).toBe(true);
    await expectAppError(listAdminInvoices(adminCtx, { from: "01-02-2026" }), "VALIDATION_ERROR");
    await expectAppError(
      listAdminInvoices(adminCtx, { from: todayInJakarta(), to: "2000-01-01" }),
      "VALIDATION_ERROR",
    );
  });

  it("records ADMIN_VIEWED_INVOICE for every view of the detail", async () => {
    const before = await db.auditLog.count({
      where: { action: "ADMIN_VIEWED_INVOICE", entityId: issuedInvoiceId },
    });
    const detail = await adminViewInvoice(adminCtx, issuedInvoiceId, null);
    expect(detail.organizationName).toBe("Sigit Berkarya");
    expect(detail.customerName).toBe("PT Dharma Polimetal Tbk");
    expect(detail.grandTotal).toBe(issuedGrandTotal);
    expect(detail.items.length).toBeGreaterThanOrEqual(1);

    const rows = await db.auditLog.findMany({
      where: { action: "ADMIN_VIEWED_INVOICE", entityId: issuedInvoiceId },
      orderBy: { createdAt: "desc" },
    });
    expect(rows.length).toBe(before + 1);
    const latest = rows[0];
    expect(latest?.actorUserId).toBe(admin.id);
    expect(latest?.organizationId).toBe(orgA.id);
    expect(latest?.metadata).toMatchObject({ organizationId: orgA.id });

    // Unknown invoice is an honest 404, not a 500.
    await expectAppError(adminViewInvoice(adminCtx, "invoice-tidak-ada", null), "NOT_FOUND");
  });
});

// ─── CWD: download PDF dari admin panel → audit + metadata admin ─────────────

describe("admin PDF download", () => {
  it("streams the file and audits PDF_DOWNLOADED with admin metadata", async () => {
    const download = await adminDownloadInvoicePdf(adminCtx, issuedInvoiceId, null);
    expect(download.filename).toBe("INV-UJI-09-001.pdf");
    expect(download.sizeBytes).toBe(pdfFixtureBytes);
    expect(download.bytes.subarray(0, 5).toString("latin1")).toBe("%PDF-");

    const audit = await db.auditLog.findFirst({
      where: { action: "PDF_DOWNLOADED", entityId: issuedInvoiceId },
      orderBy: { createdAt: "desc" },
    });
    expect(audit).not.toBeNull();
    expect(audit?.actorUserId).toBe(admin.id);
    expect(audit?.metadata).toMatchObject({ viaAdminPanel: true, organizationId: orgA.id });
  });

  it("answers NOT_FOUND when no PDF exists yet", async () => {
    const draft = await createDraft(
      {
        profileId,
        invoiceType: "FULL",
        customerId,
        billingMode: "PERCENT",
        billingPercent: "100",
        invoiceDate: todayInJakarta(),
        items: [
          { description: "Draft tanpa PDF", quantity: "1", unit: "Paket", unitPrice: "1" },
        ],
      } as InvoiceDraftFormOutput,
      ownerCtx(),
    );
    await expectAppError(adminDownloadInvoicePdf(adminCtx, draft.id, null), "NOT_FOUND");
    await db.invoice.delete({ where: { id: draft.id } });
  });
});

// ─── CWD: PDF jobs list + retry (re-enqueue, attempt bertambah) ─────────────

describe("PDF jobs", () => {
  it("lists status, duration, attempts and the real error message", async () => {
    const result = await listAdminPdfJobs(adminCtx, { status: "FAILED" });
    const row = result.rows.find((r) => r.id === failedJobId);
    expect(row).toBeDefined();
    expect(row?.status).toBe("FAILED");
    expect(row?.attempt).toBe(3);
    expect(row?.durationMs).toBe(1234);
    expect(row?.errorMessage).toBe("Layanan PDF tidak dapat dihubungi.");
    expect(row?.invoiceLabel).not.toBe("");

    await expectAppError(listAdminPdfJobs(adminCtx, { status: "BUKAN_STATUS" }), "VALIDATION_ERROR");
  });

  it("retry re-enqueues the job (audit PDF_JOB_RETRIED) and the worker claim bumps the attempt", async () => {
    await retryPdfJob(adminCtx, failedJobId, null);
    const queued = await db.pdfJob.findUniqueOrThrow({ where: { id: failedJobId } });
    expect(queued.status).toBe("PENDING");
    expect(queued.attempt).toBe(3); // history preserved until the claim
    expect(queued.startedAt).toBeNull();
    expect(queued.finishedAt).toBeNull();
    expect(queued.durationMs).toBeNull();

    const audit = await db.auditLog.findFirst({
      where: { action: "PDF_JOB_RETRIED", entityId: failedJobId },
      orderBy: { createdAt: "desc" },
    });
    expect(audit?.actorUserId).toBe(admin.id);
    expect(audit?.metadata).toMatchObject({ invoiceId: issuedInvoiceId, attemptAtRetry: 3 });

    // The worker's claim increments attempt — "attempt bertambah", verifiable.
    const claimed = await claimNextJob();
    expect(claimed?.id).toBe(failedJobId);
    const after = await db.pdfJob.findUniqueOrThrow({ where: { id: failedJobId } });
    expect(after.attempt).toBe(4);
    expect(after.status).toBe("RUNNING");
  });

  it("refuses to retry a job that is not FAILED", async () => {
    const successJob = await db.pdfJob.findFirstOrThrow({ where: { status: "SUCCESS" } });
    await expectAppError(retryPdfJob(adminCtx, successJob.id, null), "CONFLICT");
    await expectAppError(retryPdfJob(adminCtx, "job-tidak-ada", null), "NOT_FOUND");
  });
});

// ─── CWD: audit logs — filters, pagination, sanitized metadata ───────────────

describe("audit logs", () => {
  it("filters by action, actor, organization and date range", async () => {
    await logAudit({
      actorUserId: owner.id,
      organizationId: orgA.id,
      action: "CUSTOMER_CREATED",
      entityType: "Customer",
      entityId: "audit-filter-fixture",
      metadata: {},
      request: null,
    });

    const byAction = await listAdminAuditLogs(adminCtx, { action: "CUSTOMER_CREATED" });
    expect(byAction.total).toBeGreaterThanOrEqual(1);
    expect(byAction.rows.every((row) => row.action === "CUSTOMER_CREATED")).toBe(true);

    const byActor = await listAdminAuditLogs(adminCtx, { actorUserId: owner.id });
    expect(byActor.total).toBeGreaterThanOrEqual(1);
    expect(byActor.rows.every((row) => row.actorUserId === owner.id)).toBe(true);

    const byOrg = await listAdminAuditLogs(adminCtx, { organizationId: orgA.id });
    expect(byOrg.total).toBeGreaterThanOrEqual(1);
    expect(byOrg.rows.every((row) => row.organizationId === orgA.id)).toBe(true);

    const today = todayInJakarta();
    const byDate = await listAdminAuditLogs(adminCtx, { from: today, to: today });
    expect(byDate.total).toBeGreaterThanOrEqual(1);

    const yesterday = new Date(Date.now() - 24 * 3600 * 1000).toISOString().slice(0, 10);
    const none = await listAdminAuditLogs(adminCtx, { from: yesterday, to: yesterday });
    expect(none.total).toBe(0);

    // Malformed filters fail loudly instead of silently returning everything.
    await expectAppError(listAdminAuditLogs(adminCtx, { action: "BUKAN_AKSI" }), "VALIDATION_ERROR");
    await expectAppError(listAdminAuditLogs(adminCtx, { from: "bukan-tanggal" }), "VALIDATION_ERROR");
  });

  it("paginates: 25 rows → 20 + 5", async () => {
    // LOGOUT is an action nothing else in this suite writes (SESSION_REVOKED
    // IS — the revoke-session test above adds a row of its own).
    await db.auditLog.createMany({
      data: Array.from({ length: 25 }, (_, index) => ({
        actorUserId: admin.id,
        organizationId: null,
        action: "LOGOUT" as const,
        entityType: "session",
        entityId: `page-fixture-${index}`,
        metadata: {},
      })),
    });

    const page1 = await listAdminAuditLogs(adminCtx, { action: "LOGOUT", page: "1" });
    const page2 = await listAdminAuditLogs(adminCtx, { action: "LOGOUT", page: "2" });
    expect(page1.total).toBe(25);
    expect(page1.rows.length).toBe(ADMIN_PAGE_SIZE);
    expect(page2.rows.length).toBe(5);
    expect(page2.page).toBe(2);
    // No overlap between pages.
    const ids = new Set([...page1.rows, ...page2.rows].map((row) => row.id));
    expect(ids.size).toBe(25);
  });

  it("serves already-sanitized metadata (no secret values reach the viewer)", async () => {
    await logAudit({
      actorUserId: admin.id,
      organizationId: null,
      action: "USER_CREATED",
      entityType: "user",
      entityId: "sanity-metadata-fixture",
      metadata: { password: "rahasia-yang-harus-hilang", note: "aman" },
      request: null,
    });
    const result = await listAdminAuditLogs(adminCtx, { action: "USER_CREATED" });
    const row = result.rows.find((r) => r.entityId === "sanity-metadata-fixture");
    expect(row).toBeDefined();
    const metadata = row?.metadata as Record<string, unknown>;
    expect(metadata.password).toBe("[REDACTED]");
    expect(metadata.note).toBe("aman");
    expect(JSON.stringify(row?.metadata)).not.toContain("rahasia-yang-harus-hilang");
  });
});

// ─── CWD: storage usage — UploadRecord + reconcile + InvoicePdf sum ──────────

describe("storage usage", () => {
  it("records uploads, reconciles raw files, and sums per organization", async () => {
    // The recorded upload produced a UploadRecord row.
    const uploadRow = await db.uploadRecord.findUniqueOrThrow({ where: { path: uploadFixturePath } });
    expect(uploadRow.organizationId).toBe(orgA.id);
    expect(uploadRow.kind).toBe("logos");
    expect(uploadRow.mimeType).toBe("image/png");
    expect(Number(uploadRow.sizeBytes)).toBe(uploadFixtureBytes);

    // First read reconciles the raw file (no row existed), second read is a no-op.
    const usage = await getStorageUsage(adminCtx);
    const manual = await db.uploadRecord.findUnique({ where: { path: manualUploadPath } });
    expect(manual).not.toBeNull();
    const usageAgain = await getStorageUsage(adminCtx);
    expect(usageAgain.rows).toEqual(usage.rows);

    const rowA = usage.rows.find((r) => r.organizationId === orgA.id);
    expect(rowA).toBeDefined();
    expect(rowA?.uploadFiles).toBe(2); // recorded + reconciled, exactly
    expect(rowA?.uploadBytes).toBe(uploadFixtureBytes + Buffer.from(PNG).length);
    expect(rowA?.pdfFiles).toBe(1);
    expect(rowA?.pdfBytes).toBe(pdfFixtureBytes);
    expect(rowA?.totalBytes).toBe((rowA?.uploadBytes ?? 0) + (rowA?.pdfBytes ?? 0));
    expect(usage.totals.totalBytes).toBeGreaterThanOrEqual(rowA?.totalBytes ?? 0);

    // Deleting the file removes its row too.
    await getStorageService().delete(uploadFixturePath);
    expect(await db.uploadRecord.findUnique({ where: { path: uploadFixturePath } })).toBeNull();
  });
});

// ─── CWD: system health + settings — status tampil, secret tidak bocor ───────

describe("system health and settings", () => {
  it("probes database/storage/pdf and never exposes secret values", async () => {
    const health = await getSystemHealth(adminCtx);
    expect(health.database.status).toBe("ok");
    expect(health.storage.status).toBe("ok");
    expect(["ok", "degraded"]).toContain(health.pdfService.status);

    const secretCheck = health.envChecks.find((check) => check.name === "BETTER_AUTH_SECRET");
    expect(secretCheck).toBeDefined();
    expect(secretCheck?.present).toBe(true);
    expect(secretCheck?.value).toBeNull();
    const operational = health.envChecks.find((check) => check.name === "UPLOAD_MAX_MB");
    expect(operational?.value).toBe("2");

    const serialized = JSON.stringify(health);
    expect(serialized).not.toContain(process.env.BETTER_AUTH_SECRET ?? "<unset>");
    expect(serialized).not.toContain(process.env.INTERNAL_PDF_SECRET ?? "<unset>");
    expect(serialized).not.toContain(process.env.DATABASE_URL ?? "<unset>");
    expect(health.version.node).toBe(process.version);
  });

  it("settings are a read-only echo of the environment", async () => {
    const settings = await getPlatformSettings(adminCtx);
    expect(settings.defaultTimezone).toBe("Asia/Jakarta");
    expect(settings.uploadMaxMb).toBe(2);
    expect(settings.locale).toBe("id-ID");
    expect(settings.currency).toBe("IDR");
  });
});

// ─── CWD: organization detail + suspend (login + mutation block) ─────────────

describe("organization detail and suspension", () => {
  it("shows membership, invoice count, storage and last activity", async () => {
    const detail = await getAdminOrganizationDetail(adminCtx, orgA.id);
    expect(detail.organization.name).toBe("Sigit Berkarya");
    expect(detail.memberships.length).toBeGreaterThanOrEqual(2);
    expect(detail.memberCount).toBeGreaterThanOrEqual(1);
    expect(detail.invoiceCount).toBe(1);
    expect(detail.storage.uploadFiles).toBeGreaterThanOrEqual(1);
    expect(detail.storage.totalBytes).toBeGreaterThan(0);
    expect(detail.lastActivity).not.toBeNull();
    expect(detail.lastActivity?.actorName).toBeTruthy();

    await expectAppError(getAdminOrganizationDetail(adminCtx, "org-tidak-ada"), "NOT_FOUND");
  });

  it("suspending blocks login for org-only users, audits, and can be reverted", async () => {
    // Before: login works.
    const beforeJar = new CookieJar();
    expect((await signIn(beforeJar, suspendOnly.username, suspendOnly.password)).status).toBe(200);
    expect(await blockedBySuspendedOrganization(suspendOnly.id)).toBe(false);

    // Suspend → audit + status persisted.
    await setOrganizationStatus(adminCtx, { organizationId: suspendOrg.id, status: "SUSPENDED" });
    const suspended = await db.organization.findUniqueOrThrow({ where: { id: suspendOrg.id } });
    expect(suspended.status).toBe("SUSPENDED");
    const audit = await db.auditLog.findFirst({
      where: { action: "ORGANIZATION_STATUS_CHANGED", organizationId: suspendOrg.id },
      orderBy: { createdAt: "desc" },
    });
    expect(audit?.actorUserId).toBe(admin.id);
    expect(audit?.metadata).toMatchObject({ from: "ACTIVE", to: "SUSPENDED" });

    // Login for the org-only user is refused with a clear Indonesian message.
    expect(await blockedBySuspendedOrganization(suspendOnly.id)).toBe(true);
    const blockedJar = new CookieJar();
    const blocked = await signIn(blockedJar, suspendOnly.username, suspendOnly.password);
    expect(blocked.status).toBe(403);
    const body = (await blocked.json()) as { message?: string };
    expect(body.message).toContain("ditangguhkan");

    // A user with another ACTIVE membership still signs in (reads never frozen).
    const multiJar = new CookieJar();
    expect((await signIn(multiJar, multiOrgUser.username, multiOrgUser.password)).status).toBe(200);

    // Same-status change is a CONFLICT, not a phantom audit row.
    await expectAppError(
      setOrganizationStatus(adminCtx, { organizationId: suspendOrg.id, status: "SUSPENDED" }),
      "CONFLICT",
    );
  });

  it("blocks NEW mutations in a suspended organization while reads keep working", async () => {
    const jar = new CookieJar();
    expect((await signIn(jar, multiOrgUser.username, multiOrgUser.password)).status).toBe(200);
    await switchActiveOrganization(jar.toHeaders(), suspendOrg.id);

    const session = await auth.api.getSession({ headers: jar.toHeaders() });
    expect(session).not.toBeNull();
    const scope = await resolveActiveOrgScope(session!);
    if (!scope) throw new Error("scope gagal di-resolve");
    expect(scope.organizationStatus).toBe("SUSPENDED");

    // Mutations refuse with the suspension message (central permission gate).
    let caught: unknown = null;
    try {
      assertCan("invoice.draft.create", scope);
    } catch (error) {
      caught = error;
    }
    expect(isAppError(caught)).toBe(true);
    expect((caught as AppError).code).toBe("FORBIDDEN");
    expect((caught as AppError).message).toBe(ORG_SUSPENDED_MESSAGE);
    expect(() => assertCan("invoice.draft.create", scope)).toThrow(ORG_SUSPENDED_MESSAGE);
    expect(() => assertCan("payment.record", scope)).toThrow(ORG_SUSPENDED_MESSAGE);
    expect(() => assertCan("org.settings.update", scope)).toThrow(ORG_SUSPENDED_MESSAGE);

    // Reads still work: a view permission passes and the dashboard renders.
    expect(() => assertCan("invoice.view", scope)).not.toThrow();
    expect(() => assertCan("invoice.download", scope)).not.toThrow();
    const cards = await getDashboardCards({ scope });
    expect(typeof cards.invoicesThisMonth).toBe("number");
  });

  it("reactivating restores login", async () => {
    await setOrganizationStatus(adminCtx, { organizationId: suspendOrg.id, status: "ACTIVE" });
    const active = await db.organization.findUniqueOrThrow({ where: { id: suspendOrg.id } });
    expect(active.status).toBe("ACTIVE");
    expect(await blockedBySuspendedOrganization(suspendOnly.id)).toBe(false);
    const jar = new CookieJar();
    expect((await signIn(jar, suspendOnly.username, suspendOnly.password)).status).toBe(200);
  });
});
