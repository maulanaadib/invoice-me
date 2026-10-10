// src/modules/admin/service.ts
// Feature 09 — the super-admin service layer.
//
// Every exported function starts with `assertSuperAdmin(ctx)` BEFORE any query
// (defense in depth #3: proxy redirects, layouts re-check, and the service
// itself refuses — a compromised route handler must not mean a bypass). The
// unit test calls these directly with a USER context to prove it.
//
// Cross-org reads are the sanctioned exception to org isolation (invariant 7)
// and the sensitive ones are audited here: `adminViewInvoice` writes
// ADMIN_VIEWED_INVOICE before it returns anything, and the admin PDF download
// writes PDF_DOWNLOADED with admin metadata.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { AppError } from "@/lib/errors";
import { adminRoleForPlatform } from "@/lib/security";
import { parseCalendarDate, toCalendarInput, todayInJakarta } from "@/lib/date";
import { roundMoney } from "@/lib/money";
import { db } from "@/server/db";
import { env } from "@/server/env";
import { logAudit } from "@/modules/audit/service";
import { getAdminUserDetail as getAuthAdminUserDetail } from "@/modules/auth/service";
import { BILLED_STATUSES } from "@/modules/invoices/billed";
import {
  OVERDUE_ELIGIBLE_STATUSES,
  recomputeOverdue,
} from "@/modules/invoices/lifecycle-service";
import { safePdfFilename } from "@/modules/pdf/client";
import { getStorageService, reconcileUploadRecords } from "@/modules/storage";
import {
  ADMIN_PAGE_SIZE,
  adminAuditQuerySchema,
  adminInvoiceQuerySchema,
  adminPdfJobQuerySchema,
} from "@/modules/admin/schema";
import type {
  AuditAction,
  BillingMode,
  InvoiceStatus,
  InvoiceType,
  OrgStatus,
  PdfJobStatus,
  PlatformRole,
  Prisma,
  ReferenceType,
  StampMode,
  TaxMode,
} from "@prisma/client";

// ─── Guard ───────────────────────────────────────────────────────────────────

export interface AdminContext {
  /** Platform role of the calling session (Better Auth returns it as string). */
  platformRole?: PlatformRole | string | null;
  actorUserId: string;
  request?: Request | null;
}

/** Defense in depth: throws FORBIDDEN before a single query runs. */
export function assertSuperAdmin(ctx: AdminContext): void {
  if (ctx.platformRole !== "SUPER_ADMIN") {
    throw new AppError("FORBIDDEN", "Hanya super admin yang diizinkan mengakses fitur ini.");
  }
}

// ─── Query parsing (server-side validation) ─────────────────────────────────

/** Drops empty values, trims, then validates — malformed → VALIDATION_ERROR. */
function parseAdminQuery<S extends z.ZodType>(
  schema: S,
  raw: Record<string, string | string[] | undefined>,
): z.output<S> {
  const cleaned: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw)) {
    const single = Array.isArray(value) ? value[0] : value;
    if (single !== undefined && single !== "") cleaned[key] = single.trim();
  }
  const parsed = schema.safeParse(cleaned);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new AppError("VALIDATION_ERROR", issue?.message ?? "Filter tidak valid.");
  }
  return parsed.data as z.output<S>;
}

function requireDate(value: string, label: string): Date {
  const parsed = parseCalendarDate(value);
  if (!parsed || Number.isNaN(parsed.getTime()) || toCalendarInput(parsed.toISOString()) !== value) {
    throw new AppError("VALIDATION_ERROR", `Format tanggal ${label} tidak valid.`);
  }
  return parsed;
}

/** Range for a calendar-date column stored as UTC midnight (invoiceDate). */
function calendarDateRange(
  from: string | undefined,
  to: string | undefined,
): { gte?: Date; lte?: Date } | null {
  if (!from && !to) return null;
  const range: { gte?: Date; lte?: Date } = {};
  if (from) range.gte = requireDate(from, "mulai");
  if (to) {
    const end = requireDate(to, "akhir");
    range.lte = new Date(end.getTime() + 24 * 60 * 60 * 1000 - 1);
  }
  if (range.gte && range.lte && range.gte.getTime() > range.lte.getTime()) {
    throw new AppError("VALIDATION_ERROR", "Rentang tanggal tidak valid.");
  }
  return range;
}

/** Range for a timestamp column read as whole days in Asia/Jakarta (UTC+7). */
function jakartaDayRange(
  from: string | undefined,
  to: string | undefined,
): { gte?: Date; lte?: Date } | null {
  if (!from && !to) return null;
  const range: { gte?: Date; lte?: Date } = {};
  if (from) range.gte = new Date(`${requireDate(from, "mulai").toISOString().slice(0, 10)}T00:00:00+07:00`);
  if (to) {
    const day = requireDate(to, "akhir").toISOString().slice(0, 10);
    range.lte = new Date(new Date(`${day}T00:00:00+07:00`).getTime() + 24 * 60 * 60 * 1000 - 1);
  }
  if (range.gte && range.lte && range.gte.getTime() > range.lte.getTime()) {
    throw new AppError("VALIDATION_ERROR", "Rentang tanggal tidak valid.");
  }
  return range;
}

/**
 * Effective-status clause (same semantics as feature 08's list, so a badge and
 * its filter can never disagree): OVERDUE = eligible + past due (Jakarta),
 * eligible stored statuses exclude the rows the badge already reports OVERDUE.
 */
function adminStatusWhere(status: InvoiceStatus, now: Date): Prisma.InvoiceWhereInput {
  const startOfToday = new Date(`${todayInJakarta(now)}T00:00:00.000Z`);
  if (status === "OVERDUE") {
    // Feature 11A: the sweep persists OVERDUE, so stored OVERDUE rows must
    // match this filter too (same fix as feature 08's list).
    return {
      OR: [
        { status: { in: [...OVERDUE_ELIGIBLE_STATUSES] }, dueDate: { not: null, lt: startOfToday } },
        { status: "OVERDUE" },
      ],
    };
  }
  if (OVERDUE_ELIGIBLE_STATUSES.includes(status)) {
    return { status, OR: [{ dueDate: null }, { dueDate: { gte: startOfToday } }] };
  }
  return { status };
}

function money(value: { toFixed: (dp: number) => string } | null | undefined): string {
  return value ? roundMoney(value.toFixed(2)) : "0.00";
}

function pageOf(page: number | undefined): number {
  return Math.max(1, page ?? 1);
}

export interface AdminListPage<T> {
  rows: T[];
  total: number;
  page: number;
  pageSize: number;
}

// ─── Overview (/admin) ───────────────────────────────────────────────────────

export interface AdminOverview {
  totalUsers: number;
  activeUsers: number;
  suspendedUsers: number;
  totalOrganizations: number;
  suspendedOrganizations: number;
  /** Invoice dated today (Jakarta calendar day — dashboard semantics). */
  invoicesToday: number;
  /** Invoice dated in the current Jakarta month (any status). */
  invoicesThisMonth: number;
  /** Σ grandTotal of BILLED invoices dated this month (series semantics). */
  invoiceValueThisMonth: string;
  pdfSuccess: number;
  pdfFailed: number;
  pdfPending: number;
  storageTotalBytes: number;
  /** All-time LOGIN_FAILED rows (labelled as such in the UI). */
  loginFailures: number;
}

export async function getAdminOverview(ctx: AdminContext): Promise<AdminOverview> {
  assertSuperAdmin(ctx);

  const now = new Date();
  const [year = now.getUTCFullYear(), month = 1, day = 1] = todayInJakarta(now)
    .split("-")
    .map(Number);
  const monthStart = new Date(Date.UTC(year, month - 1, 1));
  const monthEnd = new Date(Date.UTC(year, month, 1));
  const startOfToday = new Date(Date.UTC(year, month - 1, day));
  const endOfToday = new Date(Date.UTC(year, month - 1, day + 1));

  const [
    totalUsers,
    activeUsers,
    suspendedUsers,
    orgStats,
    invoicesToday,
    invoicesThisMonth,
    valueThisMonth,
    pdfSuccess,
    pdfFailed,
    pdfPending,
    storage,
    loginFailures,
  ] = await Promise.all([
    db.user.count(),
    db.user.count({ where: { status: "ACTIVE" } }),
    db.user.count({ where: { status: "SUSPENDED" } }),
    db.organization.groupBy({ by: ["status"], _count: { _all: true } }),
    db.invoice.count({ where: { invoiceDate: { gte: startOfToday, lt: endOfToday } } }),
    db.invoice.count({ where: { invoiceDate: { gte: monthStart, lt: monthEnd } } }),
    db.invoice.aggregate({
      where: { invoiceDate: { gte: monthStart, lt: monthEnd }, status: { in: [...BILLED_STATUSES] } },
      _sum: { grandTotal: true },
    }),
    db.pdfJob.count({ where: { status: "SUCCESS" } }),
    db.pdfJob.count({ where: { status: "FAILED" } }),
    db.pdfJob.count({ where: { status: { in: ["PENDING", "RUNNING"] } } }),
    getStorageUsage(ctx),
    db.auditLog.count({ where: { action: "LOGIN_FAILED" } }),
  ]);

  const totalOrganizations = orgStats.reduce((sum, row) => sum + row._count._all, 0);
  const suspendedOrganizations = orgStats.find((row) => row.status === "SUSPENDED")?._count._all ?? 0;

  return {
    totalUsers,
    activeUsers,
    suspendedUsers,
    totalOrganizations,
    suspendedOrganizations,
    invoicesToday,
    invoicesThisMonth,
    invoiceValueThisMonth: money(valueThisMonth._sum.grandTotal),
    pdfSuccess,
    pdfFailed,
    pdfPending,
    storageTotalBytes: storage.totals.totalBytes,
    loginFailures,
  };
}

// ─── Users: per-org invoice metric + platform role ───────────────────────────

export interface AdminUserDetail {
  detail: Awaited<ReturnType<typeof getAuthAdminUserDetail>>;
  /** Invoices CREATED BY this user, grouped per organization (sum = invoiceCount). */
  invoicesByOrg: Array<{ organizationId: string; organizationName: string; count: number }>;
}

/**
 * Feature 01's user detail plus the feature-09 metric: the total
 * `invoiceCount` broken down per organization, counted the same way
 * (`createdById`) so the parts always sum to the total the page already shows.
 */
export async function getAdminUserDetail(
  ctx: AdminContext,
  userId: string,
): Promise<AdminUserDetail> {
  assertSuperAdmin(ctx);
  const detail = await getAuthAdminUserDetail(userId);
  const grouped = await db.invoice.groupBy({
    by: ["organizationId"],
    where: { createdById: userId },
    _count: { _all: true },
  });
  const orgs =
    grouped.length === 0
      ? []
      : await db.organization.findMany({
          where: { id: { in: grouped.map((row) => row.organizationId) } },
          select: { id: true, name: true },
        });
  const nameById = new Map(orgs.map((org) => [org.id, org.name]));
  const invoicesByOrg = grouped
    .map((row) => ({
      organizationId: row.organizationId,
      organizationName: nameById.get(row.organizationId) ?? "(organisasi terhapus)",
      count: row._count._all,
    }))
    .sort((a, b) => b.count - a.count || a.organizationName.localeCompare(b.organizationName));
  return { detail, invoicesByOrg };
}

/** Assign/replace a platform role. Self-change is refused (lockout guard,
 *  mirroring feature 01's "cannot suspend yourself"). */
export async function setPlatformRole(
  ctx: AdminContext,
  input: { userId: string; platformRole: PlatformRole },
  request?: Request | null,
): Promise<void> {
  assertSuperAdmin(ctx);
  if (!input.userId) {
    throw new AppError("VALIDATION_ERROR", "User wajib dipilih.");
  }
  if (input.userId === ctx.actorUserId) {
    throw new AppError("CONFLICT", "Anda tidak bisa mengubah platform role sendiri.");
  }
  const target = await db.user.findUnique({
    where: { id: input.userId },
    select: { id: true, platformRole: true },
  });
  if (!target) throw new AppError("NOT_FOUND", "User tidak ditemukan.");
  if (target.platformRole === input.platformRole) {
    throw new AppError("CONFLICT", "Platform role user tersebut sudah sama.");
  }
  await db.user.update({
    where: { id: target.id },
    data: { platformRole: input.platformRole, role: adminRoleForPlatform(input.platformRole) },
  });
  await logAudit({
    actorUserId: ctx.actorUserId,
    organizationId: null,
    action: "USER_ROLE_CHANGED",
    entityType: "user",
    entityId: target.id,
    metadata: { from: target.platformRole, to: input.platformRole },
    request: request ?? ctx.request ?? null,
  });
}

// ─── Organizations ───────────────────────────────────────────────────────────

export interface AdminOrganizationDetail {
  organization: { id: string; name: string; slug: string; status: OrgStatus; createdAt: Date };
  memberships: Array<{
    id: string;
    role: string;
    status: string;
    userId: string;
    username: string | null;
    name: string | null;
    userStatus: string;
    joinedAt: Date;
  }>;
  invoiceCount: number;
  memberCount: number;
  storage: { uploadFiles: number; uploadBytes: number; pdfFiles: number; pdfBytes: number; totalBytes: number };
  lastActivity: { action: AuditAction; actorName: string; createdAt: Date } | null;
}

export async function getAdminOrganizationDetail(
  ctx: AdminContext,
  organizationId: string,
): Promise<AdminOrganizationDetail> {
  assertSuperAdmin(ctx);
  const organization = await db.organization.findUnique({
    where: { id: organizationId },
    select: { id: true, name: true, slug: true, status: true, createdAt: true },
  });
  if (!organization) throw new AppError("NOT_FOUND", "Organisasi tidak ditemukan.");

  const [memberships, invoiceCount, usage, lastActivity] = await Promise.all([
    db.membership.findMany({
      where: { organizationId },
      include: { user: { select: { id: true, username: true, name: true, status: true } } },
      orderBy: { joinedAt: "asc" },
    }),
    db.invoice.count({ where: { organizationId } }),
    getStorageUsage(ctx),
    db.auditLog.findFirst({
      where: { organizationId },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      select: {
        action: true,
        createdAt: true,
        actor: { select: { name: true, username: true } },
      },
    }),
  ]);

  const row = usage.rows.find((entry) => entry.organizationId === organizationId);
  return {
    organization,
    memberships: memberships.map((membership) => ({
      id: membership.id,
      role: membership.role,
      status: membership.status,
      userId: membership.userId,
      username: membership.user.username,
      name: membership.user.name,
      userStatus: membership.user.status,
      joinedAt: membership.joinedAt,
    })),
    invoiceCount,
    memberCount: memberships.filter((membership) => membership.status === "ACTIVE").length,
    storage: {
      uploadFiles: row?.uploadFiles ?? 0,
      uploadBytes: row?.uploadBytes ?? 0,
      pdfFiles: row?.pdfFiles ?? 0,
      pdfBytes: row?.pdfBytes ?? 0,
      totalBytes: row?.totalBytes ?? 0,
    },
    lastActivity: lastActivity
      ? {
          action: lastActivity.action,
          actorName:
            lastActivity.actor?.name || lastActivity.actor?.username || "Sistem",
          createdAt: lastActivity.createdAt,
        }
      : null,
  };
}

/** Suspend/reactivate an organization (login + new mutations only, per the
 *  ratified rule; data is retained and reads keep working). */
export async function setOrganizationStatus(
  ctx: AdminContext,
  input: { organizationId: string; status: OrgStatus },
  request?: Request | null,
): Promise<void> {
  assertSuperAdmin(ctx);
  if (!input.organizationId) {
    throw new AppError("VALIDATION_ERROR", "Organisasi wajib dipilih.");
  }
  const organization = await db.organization.findUnique({
    where: { id: input.organizationId },
    select: { id: true, status: true },
  });
  if (!organization) throw new AppError("NOT_FOUND", "Organisasi tidak ditemukan.");
  if (organization.status === input.status) {
    throw new AppError(
      "CONFLICT",
      input.status === "SUSPENDED"
        ? "Organisasi sudah berstatus ditangguhkan."
        : "Organisasi sudah aktif.",
    );
  }
  await db.organization.update({
    where: { id: organization.id },
    data: { status: input.status },
  });
  await logAudit({
    actorUserId: ctx.actorUserId,
    organizationId: organization.id,
    action: "ORGANIZATION_STATUS_CHANGED",
    entityType: "organization",
    entityId: organization.id,
    metadata: { from: organization.status, to: input.status },
    request: request ?? ctx.request ?? null,
  });
}

// ─── Filter options (organization/user selects on list pages) ────────────────

export interface AdminFilterOptions {
  organizations: Array<{ id: string; name: string }>;
  users: Array<{ id: string; label: string }>;
}

export async function listAdminFilterOptions(ctx: AdminContext): Promise<AdminFilterOptions> {
  assertSuperAdmin(ctx);
  const [organizations, users] = await Promise.all([
    db.organization.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }),
    db.user.findMany({
      select: { id: true, username: true, name: true },
      orderBy: { username: "asc" },
      take: 200,
    }),
  ]);
  return {
    organizations,
    users: users.map((user) => ({
      id: user.id,
      label: user.username || user.name || user.id,
    })),
  };
}

// ─── Invoices: cross-org list + audit-on-view detail + admin download ────────

export interface AdminInvoiceRow {
  id: string;
  number: string | null;
  numberPreview: string | null;
  status: InvoiceStatus;
  storedStatus: InvoiceStatus;
  invoiceType: InvoiceType;
  invoiceDate: string;
  dueDate: string | null;
  grandTotal: string;
  amountPaid: string;
  remainingAfter: string;
  organizationId: string;
  organizationName: string;
  customerName: string;
  pdfReady: boolean;
}

export async function listAdminInvoices(
  ctx: AdminContext,
  raw: Record<string, string | string[] | undefined>,
): Promise<AdminListPage<AdminInvoiceRow>> {
  assertSuperAdmin(ctx);
  const query = parseAdminQuery(adminInvoiceQuerySchema, raw);
  const page = pageOf(query.page);
  const now = new Date();

  const clauses: Prisma.InvoiceWhereInput[] = [];
  if (query.q) {
    clauses.push({
      OR: [
        { number: { contains: query.q, mode: "insensitive" } },
        { numberPreview: { contains: query.q, mode: "insensitive" } },
        { customer: { companyName: { contains: query.q, mode: "insensitive" } } },
      ],
    });
  }
  if (query.organizationId) clauses.push({ organizationId: query.organizationId });
  if (query.status) clauses.push(adminStatusWhere(query.status, now));
  const range = calendarDateRange(query.from, query.to);
  if (range) clauses.push({ invoiceDate: range });
  const where: Prisma.InvoiceWhereInput = clauses.length ? { AND: clauses } : {};

  const [total, rows] = await Promise.all([
    db.invoice.count({ where }),
    db.invoice.findMany({
      where,
      orderBy: [{ invoiceDate: "desc" }, { id: "desc" }],
      skip: (page - 1) * ADMIN_PAGE_SIZE,
      take: ADMIN_PAGE_SIZE,
      select: {
        id: true,
        number: true,
        numberPreview: true,
        status: true,
        dueDate: true,
        invoiceDate: true,
        invoiceType: true,
        grandTotal: true,
        amountPaid: true,
        remainingAfter: true,
        pdfPath: true,
        organization: { select: { id: true, name: true } },
        customer: { select: { companyName: true } },
      },
    }),
  ]);

  return {
    total,
    page,
    pageSize: ADMIN_PAGE_SIZE,
    rows: rows.map((row) => ({
      id: row.id,
      number: row.number,
      numberPreview: row.numberPreview,
      status: recomputeOverdue(row, now),
      storedStatus: row.status,
      invoiceType: row.invoiceType,
      invoiceDate: toCalendarInput(row.invoiceDate.toISOString()),
      dueDate: row.dueDate ? toCalendarInput(row.dueDate.toISOString()) : null,
      grandTotal: money(row.grandTotal),
      amountPaid: money(row.amountPaid),
      remainingAfter: money(row.remainingAfter),
      organizationId: row.organization.id,
      organizationName: row.organization.name,
      customerName: row.customer.companyName,
      pdfReady: row.pdfPath !== null,
    })),
  };
}

export interface AdminInvoiceDetail {
  id: string;
  number: string | null;
  numberPreview: string | null;
  status: InvoiceStatus;
  storedStatus: InvoiceStatus;
  invoiceType: InvoiceType;
  termName: string | null;
  invoiceDate: string;
  dueDate: string | null;
  currency: string;
  referenceType: ReferenceType | null;
  referenceNumber: string | null;
  paymentTerms: string | null;
  organizationId: string;
  organizationName: string;
  customerName: string;
  profileName: string;
  createdByName: string;
  issuedByName: string | null;
  issuedAt: Date | null;
  cancelledAt: Date | null;
  cancellationReason: string | null;
  revisedFromId: string | null;
  replacedById: string | null;
  workValue: string;
  itemsSubtotal: string;
  previouslyBilled: string;
  discountAmount: string;
  additionalAmount: string;
  taxMode: TaxMode;
  taxPercent: string | null;
  taxAmount: string;
  roundingAmount: string;
  grandTotal: string;
  amountPaid: string;
  remainingAfter: string;
  billingMode: BillingMode;
  stampMode: StampMode;
  items: Array<{
    id: string;
    position: number;
    description: string;
    details: string | null;
    quantity: string;
    unit: string;
    unitPrice: string;
    discountAmount: string;
    lineAmount: string;
  }>;
  paymentCount: number;
  paymentTotal: string;
  pdfReady: boolean;
}

/**
 * Audit-on-view (spec item): the ADMIN_VIEWED_INVOICE row is written BEFORE the
 * data is returned, so an audited view that fails half-way still happened.
 */
export async function adminViewInvoice(
  ctx: AdminContext,
  invoiceId: string,
  request?: Request | null,
): Promise<AdminInvoiceDetail> {
  assertSuperAdmin(ctx);
  const invoice = await db.invoice.findUnique({
    where: { id: invoiceId },
    include: {
      organization: { select: { id: true, name: true } },
      customer: { select: { companyName: true } },
      profile: { select: { name: true } },
      createdBy: { select: { name: true, username: true, email: true } },
      issuedBy: { select: { name: true, username: true } },
      items: { orderBy: { position: "asc" } },
      payments: { select: { amount: true } },
    },
  });
  if (!invoice) throw new AppError("NOT_FOUND", "Invoice tidak ditemukan.");

  await logAudit({
    actorUserId: ctx.actorUserId,
    organizationId: invoice.organizationId,
    action: "ADMIN_VIEWED_INVOICE",
    entityType: "Invoice",
    entityId: invoice.id,
    metadata: {
      invoiceNumber: invoice.number ?? invoice.numberPreview ?? null,
      organizationId: invoice.organizationId,
    },
    request: request ?? ctx.request ?? null,
  });

  const issuer = invoice.issuerSnapshot as unknown as { profileName?: string } | null;
  const customerSnapshot = invoice.customerSnapshot as unknown as
    | { companyName?: string }
    | null;
  const paymentTotal = invoice.payments.reduce(
    (sum, payment) => sum + Number(payment.amount.toFixed(2)),
    0,
  );

  const now = new Date();
  return {
    id: invoice.id,
    number: invoice.number,
    numberPreview: invoice.numberPreview,
    status: recomputeOverdue(invoice, now),
    storedStatus: invoice.status,
    invoiceType: invoice.invoiceType,
    termName: invoice.termName,
    invoiceDate: toCalendarInput(invoice.invoiceDate.toISOString()),
    dueDate: invoice.dueDate ? toCalendarInput(invoice.dueDate.toISOString()) : null,
    currency: invoice.currency,
    referenceType: invoice.referenceType,
    referenceNumber: invoice.referenceNumber,
    paymentTerms: invoice.paymentTerms,
    organizationId: invoice.organization.id,
    organizationName: invoice.organization.name,
    customerName: customerSnapshot?.companyName ?? invoice.customer.companyName,
    profileName: issuer?.profileName ?? invoice.profile.name,
    createdByName:
      invoice.createdBy.name || invoice.createdBy.username || invoice.createdBy.email,
    issuedByName: invoice.issuedBy
      ? invoice.issuedBy.name || invoice.issuedBy.username
      : null,
    issuedAt: invoice.issuedAt,
    cancelledAt: invoice.cancelledAt,
    cancellationReason: invoice.cancellationReason,
    revisedFromId: invoice.revisedFromId,
    replacedById: invoice.replacedById,
    workValue: money(invoice.workValue),
    itemsSubtotal: money(invoice.itemsSubtotal),
    previouslyBilled: money(invoice.previouslyBilled),
    discountAmount: money(invoice.discountAmount),
    additionalAmount: money(invoice.additionalAmount),
    taxMode: invoice.taxMode,
    taxPercent: invoice.taxPercent ? roundMoney(invoice.taxPercent.toFixed(2)) : null,
    taxAmount: money(invoice.taxAmount),
    roundingAmount: money(invoice.roundingAmount),
    grandTotal: money(invoice.grandTotal),
    amountPaid: money(invoice.amountPaid),
    remainingAfter: money(invoice.remainingAfter),
    billingMode: invoice.billingMode,
    stampMode: invoice.stampMode,
    items: invoice.items.map((item) => ({
      id: item.id,
      position: item.position,
      description: item.description,
      details: item.details,
      quantity: item.quantity.toFixed(2),
      unit: item.unit,
      unitPrice: money(item.unitPrice),
      discountAmount: money(item.discountAmount),
      lineAmount: money(item.lineAmount),
    })),
    paymentCount: invoice.payments.length,
    paymentTotal: roundMoney(paymentTotal.toFixed(2)),
    pdfReady: invoice.pdfPath !== null,
  };
}

export interface AdminPdfDownload {
  bytes: Buffer;
  filename: string;
  sizeBytes: number;
}

/**
 * Admin-panel PDF download (spec: "download juga teraudit dengan metadata
 * admin"). Own path instead of reusing `downloadOfficialPdf`, because that one
 * is org-scoped by design — the platform-role guard must live here, and the
 * audit row records that the actor came through the admin panel.
 */
export async function adminDownloadInvoicePdf(
  ctx: AdminContext,
  invoiceId: string,
  request?: Request | null,
): Promise<AdminPdfDownload> {
  assertSuperAdmin(ctx);
  const invoice = await db.invoice.findUnique({
    where: { id: invoiceId },
    select: { id: true, organizationId: true, number: true, pdfPath: true },
  });
  if (!invoice) throw new AppError("NOT_FOUND", "Invoice tidak ditemukan.");
  if (!invoice.pdfPath) {
    throw new AppError("NOT_FOUND", "PDF invoice ini belum tersedia.");
  }

  const { data, mimeType } = await getStorageService().read(invoice.pdfPath);
  if (mimeType !== "application/pdf" || data.subarray(0, 5).toString("latin1") !== "%PDF-") {
    throw new AppError("INTERNAL_ERROR", "File PDF tidak valid.");
  }

  const pdf = await db.invoicePdf.findFirst({
    where: { invoiceId },
    orderBy: { version: "desc" },
    select: { originalFilename: true, version: true },
  });
  const filename = pdf?.originalFilename ?? safePdfFilename(invoice.id, invoice.number);

  await logAudit({
    actorUserId: ctx.actorUserId,
    organizationId: invoice.organizationId,
    action: "PDF_DOWNLOADED",
    entityType: "InvoicePdf",
    entityId: invoiceId,
    metadata: {
      filename,
      sizeBytes: data.length,
      version: pdf?.version ?? null,
      viaAdminPanel: true,
      organizationId: invoice.organizationId,
    },
    request: request ?? ctx.request ?? null,
  });

  return { bytes: data, filename, sizeBytes: data.length };
}

// ─── PDF jobs ────────────────────────────────────────────────────────────────

export interface AdminPdfJobRow {
  id: string;
  status: PdfJobStatus;
  attempt: number;
  errorMessage: string | null;
  durationMs: number | null;
  createdAt: Date;
  startedAt: Date | null;
  finishedAt: Date | null;
  invoiceId: string;
  invoiceLabel: string;
  organizationId: string;
  organizationName: string;
}

export async function listAdminPdfJobs(
  ctx: AdminContext,
  raw: Record<string, string | string[] | undefined>,
): Promise<AdminListPage<AdminPdfJobRow>> {
  assertSuperAdmin(ctx);
  const query = parseAdminQuery(adminPdfJobQuerySchema, raw);
  const page = pageOf(query.page);

  const clauses: Prisma.PdfJobWhereInput[] = [];
  if (query.status) clauses.push({ status: query.status });
  if (query.invoice) {
    clauses.push({
      invoice: {
        OR: [
          { number: { contains: query.invoice, mode: "insensitive" } },
          { numberPreview: { contains: query.invoice, mode: "insensitive" } },
        ],
      },
    });
  }
  const where: Prisma.PdfJobWhereInput = clauses.length ? { AND: clauses } : {};

  const [total, rows] = await Promise.all([
    db.pdfJob.count({ where }),
    db.pdfJob.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip: (page - 1) * ADMIN_PAGE_SIZE,
      take: ADMIN_PAGE_SIZE,
      include: {
        invoice: {
          select: {
            id: true,
            number: true,
            numberPreview: true,
            organization: { select: { id: true, name: true } },
          },
        },
      },
    }),
  ]);

  return {
    total,
    page,
    pageSize: ADMIN_PAGE_SIZE,
    rows: rows.map((row) => ({
      id: row.id,
      status: row.status,
      attempt: row.attempt,
      errorMessage: row.errorMessage,
      durationMs: row.durationMs,
      createdAt: row.createdAt,
      startedAt: row.startedAt,
      finishedAt: row.finishedAt,
      invoiceId: row.invoice.id,
      invoiceLabel: row.invoice.number ?? row.invoice.numberPreview ?? "(tanpa nomor)",
      organizationId: row.invoice.organization.id,
      organizationName: row.invoice.organization.name,
    })),
  };
}

/**
 * Re-enqueue a FAILED job (spec: "retry failed job → re-enqueue, attempt
 * bertambah"). The attempt counter is intentionally NOT reset: the worker's
 * claim increments it on the next try, so the row keeps its full history.
 * `startedAt`/`finishedAt`/`durationMs` are cleared because the job is no
 * longer running or finished — it is back in the queue.
 */
export async function retryPdfJob(
  ctx: AdminContext,
  jobId: string,
  request?: Request | null,
): Promise<void> {
  assertSuperAdmin(ctx);
  if (!jobId) throw new AppError("VALIDATION_ERROR", "Job PDF wajib dipilih.");
  const job = await db.pdfJob.findUnique({
    where: { id: jobId },
    select: { id: true, status: true, attempt: true, invoice: { select: { id: true, organizationId: true } } },
  });
  if (!job) throw new AppError("NOT_FOUND", "Job PDF tidak ditemukan.");
  if (job.status !== "FAILED") {
    throw new AppError("CONFLICT", "Hanya job PDF gagal yang bisa diulang.");
  }
  await db.pdfJob.update({
    where: { id: job.id },
    data: { status: "PENDING", startedAt: null, finishedAt: null, durationMs: null },
  });
  await logAudit({
    actorUserId: ctx.actorUserId,
    organizationId: job.invoice.organizationId,
    action: "PDF_JOB_RETRIED",
    entityType: "PdfJob",
    entityId: job.id,
    metadata: { invoiceId: job.invoice.id, attemptAtRetry: job.attempt },
    request: request ?? ctx.request ?? null,
  });
}

// ─── Audit logs ──────────────────────────────────────────────────────────────

export interface AdminAuditRow {
  id: string;
  action: AuditAction;
  entityType: string;
  entityId: string;
  actorName: string;
  actorUserId: string | null;
  organizationId: string | null;
  organizationName: string | null;
  ipAddress: string | null;
  metadata: unknown;
  createdAt: Date;
}

export async function listAdminAuditLogs(
  ctx: AdminContext,
  raw: Record<string, string | string[] | undefined>,
): Promise<AdminListPage<AdminAuditRow>> {
  assertSuperAdmin(ctx);
  const query = parseAdminQuery(adminAuditQuerySchema, raw);
  const page = pageOf(query.page);

  const clauses: Prisma.AuditLogWhereInput[] = [];
  if (query.action) clauses.push({ action: query.action as AuditAction });
  if (query.actorUserId) clauses.push({ actorUserId: query.actorUserId });
  if (query.organizationId) clauses.push({ organizationId: query.organizationId });
  const range = jakartaDayRange(query.from, query.to);
  if (range) clauses.push({ createdAt: range });
  const where: Prisma.AuditLogWhereInput = clauses.length ? { AND: clauses } : {};

  const [total, rows] = await Promise.all([
    db.auditLog.count({ where }),
    db.auditLog.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip: (page - 1) * ADMIN_PAGE_SIZE,
      take: ADMIN_PAGE_SIZE,
      select: {
        id: true,
        action: true,
        entityType: true,
        entityId: true,
        ipAddress: true,
        metadata: true,
        createdAt: true,
        actorUserId: true,
        organizationId: true,
        actor: { select: { name: true, username: true } },
        organization: { select: { name: true } },
      },
    }),
  ]);

  return {
    total,
    page,
    pageSize: ADMIN_PAGE_SIZE,
    rows: rows.map((row) => ({
      id: row.id,
      action: row.action,
      entityType: row.entityType,
      entityId: row.entityId,
      actorName: row.actor?.name || row.actor?.username || "Sistem",
      actorUserId: row.actorUserId,
      organizationId: row.organizationId,
      organizationName: row.organization?.name ?? null,
      ipAddress: row.ipAddress,
      metadata: row.metadata,
      createdAt: row.createdAt,
    })),
  };
}

// ─── Storage usage ───────────────────────────────────────────────────────────

export interface OrgStorageRow {
  organizationId: string;
  organizationName: string;
  uploadFiles: number;
  uploadBytes: number;
  pdfFiles: number;
  pdfBytes: number;
  totalFiles: number;
  totalBytes: number;
}

export interface StorageUsage {
  rows: OrgStorageRow[];
  totals: {
    uploadFiles: number;
    uploadBytes: number;
    pdfFiles: number;
    pdfBytes: number;
    totalFiles: number;
    totalBytes: number;
  };
}

/**
 * Per-org usage = Σ InvoicePdf.sizeBytes + Σ UploadRecord.sizeBytes (spec).
 * The reconcile runs FIRST (ratified decision): files that predate feature 09
 * or whose row write failed are inserted idempotently, so the numbers describe
 * the disk, not just what happened to be recorded.
 */
export async function getStorageUsage(ctx: AdminContext): Promise<StorageUsage> {
  assertSuperAdmin(ctx);
  await reconcileUploadRecords();

  const [organizations, uploadGroups, pdfGroups] = await Promise.all([
    db.organization.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }),
    db.uploadRecord.groupBy({
      by: ["organizationId"],
      _count: { _all: true },
      _sum: { sizeBytes: true },
    }),
    db.$queryRaw<Array<{ organizationId: string; files: bigint; bytes: bigint }>>`
      SELECT i."organizationId" AS "organizationId",
             COUNT(*)::bigint AS files,
             COALESCE(SUM(p."sizeBytes"), 0)::bigint AS bytes
      FROM "InvoicePdf" p
      JOIN "Invoice" i ON i."id" = p."invoiceId"
      GROUP BY i."organizationId"
    `,
  ]);

  const uploadsByOrg = new Map(
    uploadGroups.map((group) => [
      group.organizationId,
      { files: group._count._all, bytes: Number(group._sum.sizeBytes ?? 0) },
    ]),
  );
  const pdfsByOrg = new Map(
    pdfGroups.map((group) => [
      group.organizationId,
      { files: Number(group.files), bytes: Number(group.bytes) },
    ]),
  );

  const rows: OrgStorageRow[] = organizations.map((organization) => {
    const upload = uploadsByOrg.get(organization.id) ?? { files: 0, bytes: 0 };
    const pdf = pdfsByOrg.get(organization.id) ?? { files: 0, bytes: 0 };
    return {
      organizationId: organization.id,
      organizationName: organization.name,
      uploadFiles: upload.files,
      uploadBytes: upload.bytes,
      pdfFiles: pdf.files,
      pdfBytes: pdf.bytes,
      totalFiles: upload.files + pdf.files,
      totalBytes: upload.bytes + pdf.bytes,
    };
  });
  rows.sort((a, b) => b.totalBytes - a.totalBytes || a.organizationName.localeCompare(b.organizationName));

  const totals = rows.reduce(
    (acc, row) => ({
      uploadFiles: acc.uploadFiles + row.uploadFiles,
      uploadBytes: acc.uploadBytes + row.uploadBytes,
      pdfFiles: acc.pdfFiles + row.pdfFiles,
      pdfBytes: acc.pdfBytes + row.pdfBytes,
      totalFiles: acc.totalFiles + row.totalFiles,
      totalBytes: acc.totalBytes + row.totalBytes,
    }),
    { uploadFiles: 0, uploadBytes: 0, pdfFiles: 0, pdfBytes: 0, totalFiles: 0, totalBytes: 0 },
  );

  return { rows, totals };
}

// ─── System health + settings ────────────────────────────────────────────────

export interface HealthProbe {
  status: "ok" | "degraded";
  latencyMs?: number;
  /** Indonesian, secret-free message. */
  message?: string;
}

export interface EnvCheck {
  name: string;
  present: boolean;
  /** Only ever set for NON-secret variables — secrets render as "terisi/belum". */
  value: string | null;
}

export interface SystemHealth {
  database: HealthProbe;
  storage: HealthProbe;
  pdfService: HealthProbe;
  envChecks: EnvCheck[];
  version: { app: string; node: string; next: string };
}

/** Never show the value of these — presence only (security-standards). */
const SECRET_ENV_VARS = [
  "DATABASE_URL",
  "BETTER_AUTH_SECRET",
  "INTERNAL_PDF_SECRET",
  "BANK_ACCOUNT_ENCRYPTION_KEY",
  "GLITCHTIP_DSN",
  "CLOUDFLARE_TUNNEL_TOKEN",
  "SEED_ADMIN_PASSWORD",
] as const;

/** Non-secret operational values, shown read-only. */
const SHOWN_ENV_VARS = [
  "NODE_ENV",
  "APP_URL",
  "APP_PORT",
  "PDF_SERVICE_URL",
  "INTERNAL_APP_URL",
  "PDF_WORKER_ENABLED",
  "STORAGE_ROOT",
  "UPLOAD_MAX_MB",
  "DEFAULT_TIMEZONE",
] as const;

let cachedVersions: { app: string; next: string } | null = null;

/** App + Next versions read from package.json (honest fallback: "—"). */
function readVersions(): { app: string; next: string } {
  if (cachedVersions) return cachedVersions;
  try {
    const pkg = JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf8")) as {
      version?: string;
      dependencies?: Record<string, string>;
    };
    cachedVersions = { app: pkg.version ?? "—", next: pkg.dependencies?.next ?? "—" };
  } catch {
    cachedVersions = { app: "—", next: "—" };
  }
  return cachedVersions;
}

async function probeDatabase(): Promise<HealthProbe> {
  const started = Date.now();
  try {
    await db.$queryRaw`SELECT 1`;
    return { status: "ok", latencyMs: Date.now() - started };
  } catch {
    return { status: "degraded", message: "Database tidak terjangkau." };
  }
}

async function probeStorage(): Promise<HealthProbe> {
  const { mkdir, writeFile, unlink } = await import("node:fs/promises");
  const testFile = join(env.STORAGE_ROOT, ".admin-health-check");
  try {
    await mkdir(env.STORAGE_ROOT, { recursive: true });
    await writeFile(testFile, "ok");
    await unlink(testFile);
    return { status: "ok" };
  } catch {
    return { status: "degraded", message: "Penyimpanan tidak dapat ditulisi." };
  }
}

async function probePdfService(): Promise<HealthProbe> {
  const started = Date.now();
  try {
    const response = await fetch(`${env.PDF_SERVICE_URL}/health`, {
      signal: AbortSignal.timeout(3000),
    });
    if (!response.ok) {
      return { status: "degraded", message: "Layanan PDF merespons tidak normal." };
    }
    return { status: "ok", latencyMs: Date.now() - started };
  } catch {
    return { status: "degraded", message: "Layanan PDF tidak dapat dihubungi." };
  }
}

export async function getSystemHealth(ctx: AdminContext): Promise<SystemHealth> {
  assertSuperAdmin(ctx);
  const [database, storage, pdfService] = await Promise.all([
    probeDatabase(),
    probeStorage(),
    probePdfService(),
  ]);

  const envChecks: EnvCheck[] = [
    ...SECRET_ENV_VARS.map((name) => ({
      name,
      present: Boolean(process.env[name]),
      value: null,
    })),
    ...SHOWN_ENV_VARS.map((name) => ({
      name,
      present: Boolean(process.env[name]),
      value: process.env[name] ?? null,
    })),
  ];

  const versions = readVersions();
  return {
    database,
    storage,
    pdfService,
    envChecks,
    version: { app: versions.app, node: process.version, next: versions.next },
  };
}

export interface PlatformSettings {
  defaultTimezone: string;
  uploadMaxMb: number;
  storageRoot: string;
  pdfWorkerEnabled: string;
  appUrl: string;
  nodeEnv: string;
  locale: string;
  currency: string;
}

/** Read-only platform settings (spec: values from env, never editable here). */
export async function getPlatformSettings(ctx: AdminContext): Promise<PlatformSettings> {
  assertSuperAdmin(ctx);
  return {
    defaultTimezone: env.DEFAULT_TIMEZONE,
    uploadMaxMb: env.UPLOAD_MAX_MB,
    storageRoot: env.STORAGE_ROOT,
    pdfWorkerEnabled: env.PDF_WORKER_ENABLED,
    appUrl: env.APP_URL,
    nodeEnv: env.NODE_ENV,
    locale: "id-ID",
    currency: "IDR",
  };
}
