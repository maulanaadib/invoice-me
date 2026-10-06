// src/modules/customers/service.ts
// Customer + CustomerContact (PIC) domain: org-scoped CRUD, server-side list
// with pagination/search, soft delete, and PIC management with a single
// primary per customer.
//
// Authorization: reads require an active-org scope (fail closed) and every
// mutation runs through the central permission service (assertCan) — VIEWER is
// read-only, STAFF+ may write (feature 03 spec). Customer values are PII:
// audit metadata carries field NAMES only, never field values (NPWP never
// reaches the audit table or the logs).

import { log } from "@/modules/audit/service";
import { AppError } from "@/lib/errors";
import {
  assertCan,
  requireOrgScope,
} from "@/modules/permissions/service";
import { contactFormSchema, customerFormSchema } from "@/modules/customers/schema";
import { db } from "@/server/db";
import type { Customer, CustomerContact, OrganizationRole, Prisma } from "@prisma/client";
import type { z } from "zod";

export type CustomerFormInput = z.infer<typeof customerFormSchema>;
export type ContactFormInput = z.infer<typeof contactFormSchema>;

// ─── Service context ──────────────────────────────────────────────────────

export interface CustomerServiceContext {
  scope: { organizationId: string; role: OrganizationRole; userId: string };
  request?: Request | null;
}

// ─── Helpers ──────────────────────────────────────────────────────────────

/** "" / whitespace-only → null (clears the column); undefined → untouched. */
function nullIfEmpty(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

/**
 * NPWP shown to users who cannot edit customers: first 4 characters stay
 * readable, the rest is masked. The full value only ever reaches the edit
 * form of an authorized (STAFF+) caller — never a VIEWER's HTML.
 */
export function maskTaxId(value: string | null | undefined): string | null {
  if (!value) return null;
  const visible = value.slice(0, 4);
  const hidden = "•".repeat(Math.max(4, value.length - 4));
  return `${visible}${hidden}`;
}

function emptyToNulls<T extends Record<string, unknown>>(
  input: T,
  keys: ReadonlyArray<keyof T & string>,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...input };
  for (const key of keys) {
    const value = input[key];
    if (typeof value === "string") out[key] = nullIfEmpty(value);
  }
  return out;
}

const CUSTOMER_TEXT_NULL_KEYS = [
  "legalName",
  "businessType",
  "taxId",
  "address",
  "city",
  "province",
  "postalCode",
  "country",
  "phone",
  "whatsapp",
  "email",
  "notes",
] as const;

// ─── Views (serializable — server action → client components) ─────────────

export interface CustomerListItem {
  id: string;
  companyName: string;
  legalName: string | null;
  businessType: string | null;
  city: string | null;
  phone: string | null;
  email: string | null;
  isActive: boolean;
  contactCount: number;
  createdAt: string;
}

export interface CustomerDetail {
  id: string;
  companyName: string;
  legalName: string | null;
  businessType: string | null;
  /** Masked NPWP — safe for every reader, including VIEWER. */
  taxIdMasked: string | null;
  address: string | null;
  city: string | null;
  province: string | null;
  postalCode: string | null;
  country: string | null;
  phone: string | null;
  whatsapp: string | null;
  email: string | null;
  notes: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ContactView {
  id: string;
  name: string;
  title: string | null;
  division: string | null;
  email: string | null;
  phone: string | null;
  whatsapp: string | null;
  isPrimary: boolean;
}

export function toContactView(contact: CustomerContact): ContactView {
  return {
    id: contact.id,
    name: contact.name,
    title: contact.title,
    division: contact.division,
    email: contact.email,
    phone: contact.phone,
    whatsapp: contact.whatsapp,
    isPrimary: contact.isPrimary,
  };
}

export function toCustomerDetail(
  customer: Customer & { contacts?: CustomerContact[] },
): CustomerDetail {
  return {
    id: customer.id,
    companyName: customer.companyName,
    legalName: customer.legalName,
    businessType: customer.businessType,
    taxIdMasked: maskTaxId(customer.taxId),
    address: customer.address,
    city: customer.city,
    province: customer.province,
    postalCode: customer.postalCode,
    country: customer.country,
    phone: customer.phone,
    whatsapp: customer.whatsapp,
    email: customer.email,
    notes: customer.notes,
    isActive: customer.isActive,
    createdAt: customer.createdAt.toISOString(),
    updatedAt: customer.updatedAt.toISOString(),
  };
}

// ─── Audit (metadata: field names and ids only — never customer values) ────

async function writeAudit(
  ctx: CustomerServiceContext,
  action: "CUSTOMER_CREATED" | "CUSTOMER_UPDATED" | "CUSTOMER_DELETED",
  entityId: string,
  metadata: Record<string, unknown>,
): Promise<void> {
  await log({
    actorUserId: ctx.scope.userId,
    organizationId: ctx.scope.organizationId,
    action,
    entityType: "customer",
    entityId,
    metadata,
    request: ctx.request ?? null,
  });
}

// ─── Reads ─────────────────────────────────────────────────────────────────

export interface ListCustomersQuery {
  page?: number;
  pageSize?: number;
  q?: string;
}

/**
 * Server-side pagination + search, always scoped to the active organization.
 * Soft-deleted customers never appear. pageSize is capped at 100 so
 * `pageSize=999999` cannot pull the whole table (security-standards).
 */
export async function listCustomers(ctx: CustomerServiceContext, query: ListCustomersQuery = {}) {
  requireOrgScope(ctx.scope);
  const pageSize = Math.min(Math.max(query.pageSize ?? 20, 1), 100);
  const q = (query.q ?? "").trim().slice(0, 100);

  const where: Prisma.CustomerWhereInput = {
    organizationId: ctx.scope.organizationId,
    deletedAt: null,
    ...(q
      ? {
          OR: [
            { companyName: { contains: q, mode: "insensitive" as const } },
            { legalName: { contains: q, mode: "insensitive" as const } },
          ],
        }
      : {}),
  };

  const total = await db.customer.count({ where });
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(Math.max(query.page ?? 1, 1), totalPages);
  const rows = await db.customer.findMany({
    where,
    orderBy: [{ companyName: "asc" }, { createdAt: "asc" }],
    skip: (page - 1) * pageSize,
    take: pageSize,
    include: { _count: { select: { contacts: true } } },
  });

  return {
    rows: rows.map<CustomerListItem>((customer) => ({
      id: customer.id,
      companyName: customer.companyName,
      legalName: customer.legalName,
      businessType: customer.businessType,
      city: customer.city,
      phone: customer.phone,
      email: customer.email,
      isActive: customer.isActive,
      contactCount: customer._count.contacts,
      createdAt: customer.createdAt.toISOString(),
    })),
    total,
    page,
    pageSize,
    totalPages,
  };
}

/**
 * Detail read with the IDOR guard: another organization's id and a soft-
 * deleted customer both answer 404 (same as a row that never existed).
 */
export async function getCustomerForScope(
  customerId: string,
  ctx: CustomerServiceContext,
): Promise<Customer & { contacts: CustomerContact[] }> {
  requireOrgScope(ctx.scope);
  const customer = await db.customer.findUnique({
    where: { id: customerId },
    include: {
      contacts: { orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }] },
    },
  });
  if (
    !customer ||
    customer.organizationId !== ctx.scope.organizationId ||
    customer.deletedAt
  ) {
    throw new AppError("NOT_FOUND", "Customer tidak ditemukan.");
  }
  return customer;
}

// ─── Customer writes ──────────────────────────────────────────────────────

export async function createCustomer(
  input: CustomerFormInput,
  ctx: CustomerServiceContext,
): Promise<Customer> {
  assertCan("customer.create", ctx.scope);
  const data = emptyToNulls(input, CUSTOMER_TEXT_NULL_KEYS);

  const customer = await db.customer.create({
    data: {
      organizationId: ctx.scope.organizationId,
      companyName: input.companyName,
      legalName: (data.legalName as string | null) ?? null,
      businessType: (data.businessType as string | null) ?? null,
      taxId: (data.taxId as string | null) ?? null,
      address: (data.address as string | null) ?? null,
      city: (data.city as string | null) ?? null,
      province: (data.province as string | null) ?? null,
      postalCode: (data.postalCode as string | null) ?? null,
      country: (data.country as string | null) ?? null,
      phone: (data.phone as string | null) ?? null,
      whatsapp: (data.whatsapp as string | null) ?? null,
      email: (data.email as string | null) ?? null,
      notes: (data.notes as string | null) ?? null,
      isActive: input.isActive ?? true,
    },
  });
  await writeAudit(ctx, "CUSTOMER_CREATED", customer.id, { change: "created" });
  return customer;
}

/** Partial update: only keys present in `input` are written; audit lists the
 * changed FIELD NAMES (values stay out — PII rule). */
export async function updateCustomer(
  customerId: string,
  input: CustomerFormInput,
  ctx: CustomerServiceContext,
): Promise<Customer> {
  assertCan("customer.update", ctx.scope);
  const customer = await getCustomerForScope(customerId, ctx);

  const normalized = emptyToNulls(input, CUSTOMER_TEXT_NULL_KEYS);
  const changed: string[] = [];
  for (const key of Object.keys(normalized) as Array<keyof CustomerFormInput>) {
    const next = normalized[key];
    if (next === undefined) continue;
    const current = customer[key];
    if (String(current ?? "") !== String(next ?? "")) changed.push(key);
  }

  if (changed.length === 0) return customer;

  const data: Prisma.CustomerUpdateInput = {};
  for (const key of changed) {
    const value = normalized[key];
    if (value === undefined) continue;
    // Every changed key maps to a same-named scalar column of Customer
    // (CompanyName, TaxId, …) — explicit by construction, no casts.
    if (key === "isActive") {
      data.isActive = Boolean(value);
    } else if (key === "companyName") {
      data.companyName = String(value);
    } else if (key === "legalName") {
      data.legalName = value as string | null;
    } else if (key === "businessType") {
      data.businessType = value as string | null;
    } else if (key === "taxId") {
      data.taxId = value as string | null;
    } else if (key === "address") {
      data.address = value as string | null;
    } else if (key === "city") {
      data.city = value as string | null;
    } else if (key === "province") {
      data.province = value as string | null;
    } else if (key === "postalCode") {
      data.postalCode = value as string | null;
    } else if (key === "country") {
      data.country = value as string | null;
    } else if (key === "phone") {
      data.phone = value as string | null;
    } else if (key === "whatsapp") {
      data.whatsapp = value as string | null;
    } else if (key === "email") {
      data.email = value as string | null;
    } else if (key === "notes") {
      data.notes = value as string | null;
    }
  }

  const updated = await db.customer.update({ where: { id: customer.id }, data });
  await writeAudit(ctx, "CUSTOMER_UPDATED", customer.id, {
    change: "updated",
    fields: changed,
  });
  return updated;
}

/**
 * Soft delete (data-model rule: only Customer has deletedAt). The row and its
 * contacts stay in the database for the audit trail; every read path filters
 * them out. Never a hard delete.
 */
export async function softDeleteCustomer(
  customerId: string,
  ctx: CustomerServiceContext,
): Promise<Customer> {
  assertCan("customer.delete", ctx.scope);
  const customer = await getCustomerForScope(customerId, ctx);
  const updated = await db.customer.update({
    where: { id: customer.id },
    data: { deletedAt: new Date() },
  });
  await writeAudit(ctx, "CUSTOMER_DELETED", customer.id, { change: "deleted" });
  return updated;
}

// ─── PIC (CustomerContact) writes ──────────────────────────────────────────

/** Exactly one primary PIC per customer: demoting happens in the same
 * transaction as the write that promotes a new one. */
async function exclusivePrimary(customerId: string, tx: Prisma.TransactionClient): Promise<void> {
  await tx.customerContact.updateMany({
    where: { customerId, isPrimary: true },
    data: { isPrimary: false },
  });
}

export async function addContact(
  customerId: string,
  input: ContactFormInput,
  ctx: CustomerServiceContext,
): Promise<CustomerContact> {
  assertCan("customer.update", ctx.scope);
  const customer = await getCustomerForScope(customerId, ctx);

  const contact = await db.$transaction(async (tx) => {
    if (input.isPrimary) await exclusivePrimary(customer.id, tx);
    return tx.customerContact.create({
      data: {
        customerId: customer.id,
        name: input.name,
        title: nullIfEmpty(input.title),
        division: nullIfEmpty(input.division),
        email: nullIfEmpty(input.email),
        phone: nullIfEmpty(input.phone),
        whatsapp: nullIfEmpty(input.whatsapp),
        isPrimary: input.isPrimary ?? false,
      },
    });
  });

  await writeAudit(ctx, "CUSTOMER_UPDATED", customer.id, {
    change: "contact_created",
    contactId: contact.id,
  });
  return contact;
}

export async function updateContact(
  contactId: string,
  input: ContactFormInput,
  ctx: CustomerServiceContext,
): Promise<CustomerContact> {
  assertCan("customer.update", ctx.scope);
  const existing = await db.customerContact.findUnique({
    where: { id: contactId },
    include: { customer: true },
  });
  if (
    !existing ||
    existing.customer.organizationId !== ctx.scope.organizationId ||
    existing.customer.deletedAt
  ) {
    throw new AppError("NOT_FOUND", "Kontak tidak ditemukan.");
  }

  const contact = await db.$transaction(async (tx) => {
    if (input.isPrimary) await exclusivePrimary(existing.customerId, tx);
    return tx.customerContact.update({
      where: { id: existing.id },
      data: {
        name: input.name,
        title: nullIfEmpty(input.title),
        division: nullIfEmpty(input.division),
        email: nullIfEmpty(input.email),
        phone: nullIfEmpty(input.phone),
        whatsapp: nullIfEmpty(input.whatsapp),
        isPrimary: input.isPrimary ?? false,
      },
    });
  });

  await writeAudit(ctx, "CUSTOMER_UPDATED", existing.customerId, {
    change: "contact_updated",
    contactId: contact.id,
  });
  return contact;
}

/** PIC removal is a hard delete of the contact row (contacts are not
 * soft-deleted — data-model reserves deletedAt for Customer). The customer
 * itself is untouched. */
export async function deleteContact(
  contactId: string,
  ctx: CustomerServiceContext,
): Promise<void> {
  assertCan("customer.delete", ctx.scope);
  const existing = await db.customerContact.findUnique({
    where: { id: contactId },
    include: { customer: true },
  });
  if (
    !existing ||
    existing.customer.organizationId !== ctx.scope.organizationId ||
    existing.customer.deletedAt
  ) {
    throw new AppError("NOT_FOUND", "Kontak tidak ditemukan.");
  }
  await db.customerContact.delete({ where: { id: existing.id } });
  await writeAudit(ctx, "CUSTOMER_UPDATED", existing.customerId, {
    change: "contact_deleted",
    contactId: existing.id,
  });
}
