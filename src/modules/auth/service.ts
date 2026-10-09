// src/modules/auth/service.ts
// Feature 01 auth domain: login interception (lockout, suspend check, audit),
// self-service password change, and super-admin user management.
//
// The Better Auth HTTP handler is wrapped by handleAuthRequest so sign-in,
// sign-out and change-password responses pass through our audit trail and the
// per-identifier lockout before/after Better Auth runs. No Better Auth hooks
// are configured in server/auth.ts — this wrapper is the single interception
// point, chosen so request/response context stays explicit and testable.

import { AppError } from "@/lib/errors";
import { adminRoleForPlatform } from "@/lib/security";
import { log } from "@/modules/audit/service";
import { auth } from "@/server/auth";
import { db } from "@/server/db";
import { logger } from "@/server/logger";
import { hashPassword, verifyPassword } from "better-auth/crypto";
import type { PlatformRole, Prisma, UserStatus, user } from "@prisma/client";
import { z } from "zod";

// ─── Lockout: per identifier (username/email) + IP, in-memory with TTL ───
// Spec choice: AuditLog rows are the durable trail; lockout state itself lives
// in this process (MVP — no Redis). Escalating durations 1m → 5m → 15m.

interface LockState {
  failures: number;
  lockedUntil: number;
  strikes: number;
  updatedAt: number;
}

export const LOCKOUT_THRESHOLD = 5;
const LOCKOUT_DURATIONS_MS = [60_000, 300_000, 900_000] as const;
const LOCK_STATE_TTL_MS = 6 * 60 * 60 * 1000;

const lockoutStore = new Map<string, LockState>();

function makeLockKey(identifier: string, ip: string | null): string {
  return `${identifier.trim().toLowerCase()}|${ip ?? "unknown"}`;
}

function sweepLockStates(now: number): void {
  for (const [key, state] of lockoutStore) {
    if (now >= state.lockedUntil && now - state.updatedAt > LOCK_STATE_TTL_MS) {
      lockoutStore.delete(key);
    }
  }
}

export type LockCheck = { locked: false } | { locked: true; retryAfterSeconds: number };

export function checkLockout(identifier: string, ip: string | null): LockCheck {
  const now = Date.now();
  sweepLockStates(now);
  const state = lockoutStore.get(makeLockKey(identifier, ip));
  if (state && now < state.lockedUntil) {
    return { locked: true, retryAfterSeconds: Math.ceil((state.lockedUntil - now) / 1000) };
  }
  return { locked: false };
}

export function recordFailedLogin(identifier: string, ip: string | null): LockCheck {
  const now = Date.now();
  sweepLockStates(now);
  const key = makeLockKey(identifier, ip);
  const state =
    lockoutStore.get(key) ?? { failures: 0, lockedUntil: 0, strikes: 0, updatedAt: now };
  state.updatedAt = now;
  if (now >= state.lockedUntil) {
    state.failures += 1;
    if (state.failures >= LOCKOUT_THRESHOLD) {
      state.strikes += 1;
      const durationMs =
        LOCKOUT_DURATIONS_MS[Math.min(state.strikes, LOCKOUT_DURATIONS_MS.length) - 1];
      state.lockedUntil = now + durationMs;
      state.failures = 0;
      lockoutStore.set(key, state);
      return { locked: true, retryAfterSeconds: Math.ceil(durationMs / 1000) };
    }
  }
  lockoutStore.set(key, state);
  return { locked: false };
}

export function recordSuccessfulLogin(identifier: string, ip: string | null): void {
  lockoutStore.delete(makeLockKey(identifier, ip));
}

/** Test hook — resets in-memory lockout state between integration cases. */
export function clearLockoutStore(): void {
  lockoutStore.clear();
}

/** id-ID duration for lockout messages: "45 detik" / "1 menit" / "15 menit". */
export function formatDurasi(totalSeconds: number): string {
  if (totalSeconds < 60) return `${Math.max(totalSeconds, 1)} detik`;
  return `${Math.ceil(totalSeconds / 60)} menit`;
}

// ─── Request helpers ─────────────────────────────────────────────────────

function clientIp(headers: Headers): string | null {
  const forwarded = headers.get("x-forwarded-for");
  return (forwarded && forwarded.split(",")[0]?.trim()) || headers.get("x-real-ip") || null;
}

async function readRequestJson(request: Request): Promise<Record<string, unknown>> {
  try {
    const parsed = await request.clone().json();
    return typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

async function readResponseJson(response: Response): Promise<Record<string, unknown> | null> {
  try {
    const parsed = await response.clone().json();
    return typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function lockResponse(retryAfterSeconds: number): Response {
  const message = `Terlalu banyak percobaan gagal. Coba lagi dalam ${formatDurasi(retryAfterSeconds)}.`;
  return Response.json(
    { code: "RATE_LIMITED", message, retryAfter: retryAfterSeconds },
    {
      status: 429,
      headers: { "content-type": "application/json", "retry-after": String(retryAfterSeconds) },
    },
  );
}

/** Resolves a login identifier: emails contain "@", usernames never do. */
export function findUserByIdentifier(identifier: string): Promise<user | null> {
  const value = identifier.trim().toLowerCase();
  if (!value) return Promise.resolve(null);
  if (value.includes("@")) return db.user.findUnique({ where: { email: value } });
  return db.user.findUnique({ where: { username: value } });
}

/**
 * Feature 09 (ratified suspend rule): sign-in is blocked when the user has at
 * least one ACTIVE membership and EVERY one of them lives in a suspended
 * organization. Zero memberships (fresh user / super admin) is NOT blocked —
 * they still need the onboarding wizard, and reads are never frozen.
 */
export async function blockedBySuspendedOrganization(userId: string): Promise<boolean> {
  const rows = await db.membership.findMany({
    where: { userId, status: "ACTIVE" },
    select: { organization: { select: { status: true } } },
  });
  if (rows.length === 0) return false;
  return rows.every((row) => row.organization.status === "SUSPENDED");
}

/**
 * First login starts the session in the user's earliest active organization so
 * the dashboard and switcher have an active workspace without extra clicks.
 */
async function ensureActiveOrganization(token: string, userId: string): Promise<void> {
  try {
    const session = await db.session.findUnique({
      where: { token },
      select: { id: true, activeOrganizationId: true },
    });
    if (!session || session.activeOrganizationId) return;
    // Prefer an ACTIVE organization over a suspended one (feature 09): the
    // sign-in gate lets this user through because at least one membership is
    // not suspended, so land the fresh session there first.
    const first = await db.membership.findFirst({
      where: { userId, status: "ACTIVE" },
      orderBy: [{ organization: { status: "asc" } }, { joinedAt: "asc" }],
      select: { organizationId: true },
    });
    if (first) {
      await db.session.update({
        where: { id: session.id },
        data: { activeOrganizationId: first.organizationId },
      });
    }
  } catch (error) {
    logger.error(
      { module: "auth", err: error instanceof Error ? error.message : String(error) },
      "gagal menetapkan organisasi aktif saat login",
    );
  }
}

// ─── Better Auth request wrapper ─────────────────────────────────────────

/**
 * The route handler for /api/auth/* — all Better Auth traffic passes through
 * here so login success/failure, lockout, suspension and logout auditing are
 * enforced server-side regardless of which client calls the endpoint.
 */
export async function handleAuthRequest(request: Request): Promise<Response> {
  const { pathname } = new URL(request.url);
  const method = request.method.toUpperCase();
  if (
    method === "POST" &&
    (pathname === "/api/auth/sign-in/email" || pathname === "/api/auth/sign-in/username")
  ) {
    return interceptSignIn(request);
  }
  if (method === "POST" && pathname === "/api/auth/sign-out") {
    return interceptSignOut(request);
  }
  if (method === "POST" && pathname === "/api/auth/change-password") {
    return interceptChangePassword(request);
  }
  return auth.handler(request);
}

async function interceptSignIn(request: Request): Promise<Response> {
  const body = await readRequestJson(request);
  const rawIdentifier =
    typeof body.username === "string" ? body.username : typeof body.email === "string" ? body.email : "";
  const identifier = rawIdentifier.trim();
  const ip = clientIp(request.headers);

  const lock = checkLockout(identifier || "unknown", ip);
  if (lock.locked) {
    await log({
      action: "LOGIN_FAILED",
      entityType: "user",
      entityId: "",
      metadata: { identifier, reason: "rate_limited" },
      request,
    });
    return lockResponse(lock.retryAfterSeconds);
  }

  if (identifier) {
    const user = await findUserByIdentifier(identifier);
    if (user && user.status === "SUSPENDED") {
      await log({
        actorUserId: user.id,
        action: "LOGIN_FAILED",
        entityType: "user",
        entityId: user.id,
        metadata: { identifier, reason: "suspended" },
        request,
      });
      return Response.json(
        { code: "FORBIDDEN", message: "Akun Anda telah ditangguhkan. Hubungi administrator Anda." },
        { status: 403, headers: { "content-type": "application/json" } },
      );
    }
    // Feature 09 (ratified): a suspended organization blocks sign-in for users
    // whose every ACTIVE membership lives in suspended organizations. Users
    // with a membership in an ACTIVE organization still sign in (their data is
    // retained and readable — suspend blocks login and new mutations only).
    if (user && (await blockedBySuspendedOrganization(user.id))) {
      await log({
        actorUserId: user.id,
        action: "LOGIN_FAILED",
        entityType: "user",
        entityId: user.id,
        metadata: { identifier, reason: "organization_suspended" },
        request,
      });
      return Response.json(
        {
          code: "FORBIDDEN",
          message: "Organisasi Anda ditangguhkan oleh super admin. Hubungi administrator Anda.",
        },
        { status: 403, headers: { "content-type": "application/json" } },
      );
    }
  }

  const response = await auth.handler(request);

  if (response.status >= 200 && response.status < 300) {
    recordSuccessfulLogin(identifier || "unknown", ip);
    const payload = await readResponseJson(response);
    const userObject =
      payload && typeof payload.user === "object" && payload.user !== null
        ? (payload.user as { id?: unknown })
        : null;
    const userId = userObject && typeof userObject.id === "string" ? userObject.id : null;
    const token = typeof payload?.token === "string" ? payload.token : null;
    await log({
      actorUserId: userId,
      action: "LOGIN_SUCCESS",
      entityType: "user",
      entityId: userId ?? "",
      metadata: { identifier, rememberMe: body.rememberMe === true },
      request,
    });
    if (token && userId) await ensureActiveOrganization(token, userId);
    return response;
  }

  if (response.status === 401) {
    const failed = recordFailedLogin(identifier || "unknown", ip);
    await log({
      action: "LOGIN_FAILED",
      entityType: "user",
      entityId: "",
      metadata: { identifier, reason: "invalid_credentials" },
      request,
    });
    if (failed.locked) return lockResponse(failed.retryAfterSeconds);
  }

  return response;
}

async function getSessionFromHeaders(
  headers: Headers,
): Promise<Awaited<ReturnType<typeof auth.api.getSession>>> {
  try {
    return await auth.api.getSession({ headers });
  } catch {
    return null;
  }
}

async function interceptSignOut(request: Request): Promise<Response> {
  const session = await getSessionFromHeaders(request.headers);
  const response = await auth.handler(request);
  if (response.status < 300 && session) {
    await log({
      actorUserId: session.user.id,
      action: "LOGOUT",
      entityType: "session",
      entityId: session.session.id,
      metadata: {},
      request,
    });
  }
  return response;
}

/**
 * Better Auth's own /change-password endpoint can be called directly by an
 * authenticated client — flip the force-change flag and audit here too, so the
 * self-service server action and direct HTTP callers end in the same state.
 */
async function interceptChangePassword(request: Request): Promise<Response> {
  const session = await getSessionFromHeaders(request.headers);
  const response = await auth.handler(request);
  if (response.status < 300 && session) {
    try {
      await db.user.update({ where: { id: session.user.id }, data: { mustChangePassword: false } });
    } catch (error) {
      logger.error(
        { module: "auth", err: error instanceof Error ? error.message : String(error) },
        "gagal menandai perubahan kata sandi selesai",
      );
    }
    await log({
      actorUserId: session.user.id,
      action: "PASSWORD_CHANGED",
      entityType: "user",
      entityId: session.user.id,
      metadata: { via: "auth_api" },
      request,
    });
  }
  return response;
}

// ─── Input schemas (server validation source of truth) ────────────────────

export const USERNAME_PATTERN = /^[a-z0-9_.]+$/i;

export const adminCreateUserSchema = z.object({
  username: z
    .string()
    .trim()
    .min(3, "Username minimal 3 karakter.")
    .max(30, "Username maksimal 30 karakter.")
    .regex(USERNAME_PATTERN, "Username hanya boleh huruf, angka, titik, dan garis bawah."),
  email: z
    .string()
    .trim()
    .min(1, "Email wajib diisi.")
    .max(254, "Email terlalu panjang.")
    .regex(/^[^\s@]+@[^\s@]+\.[^\s@]+$/, "Format email tidak valid."),
  name: z
    .string()
    .trim()
    .min(1, "Nama wajib diisi.")
    .max(100, "Nama maksimal 100 karakter.")
    .optional(),
  tempPassword: z
    .string()
    .min(8, "Kata sandi minimal 8 karakter.")
    .max(128, "Kata sandi maksimal 128 karakter."),
  platformRole: z.enum(["SUPER_ADMIN", "USER"]),
});
export type AdminCreateUserInput = z.infer<typeof adminCreateUserSchema>;

export const resetPasswordSchema = z.object({
  newPassword: z
    .string()
    .min(8, "Kata sandi minimal 8 karakter.")
    .max(128, "Kata sandi maksimal 128 karakter."),
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, "Kata sandi saat ini wajib diisi."),
  newPassword: z
    .string()
    .min(8, "Kata sandi baru minimal 8 karakter.")
    .max(128, "Kata sandi baru maksimal 128 karakter."),
  confirmPassword: z.string().min(1, "Konfirmasi kata sandi wajib diisi."),
});

// ─── Self-service password change ────────────────────────────────────────

export interface ChangeOwnPasswordInput {
  userId: string;
  currentSessionId: string | null;
  currentPassword: string;
  newPassword: string;
}

/**
 * Changes the signed-in user's password directly through Prisma (hashing via
 * better-auth/crypto — the same hasher Better Auth verifies against), clears
 * mustChangePassword and revokes every other session.
 */
export async function changeOwnPassword(
  input: ChangeOwnPasswordInput,
  request?: Request | null,
): Promise<void> {
  const account = await db.account.findFirst({
    where: { userId: input.userId, providerId: "credential" },
  });
  if (!account?.password) {
    throw new AppError(
      "VALIDATION_ERROR",
      "Akun ini tidak memiliki kata sandi. Minta admin menyetel ulang kata sandi.",
    );
  }
  const valid = await verifyPassword({ password: input.currentPassword, hash: account.password });
  if (!valid) {
    throw new AppError("VALIDATION_ERROR", "Kata sandi saat ini salah.");
  }
  const passwordHash = await hashPassword(input.newPassword);
  await db.$transaction([
    db.account.update({ where: { id: account.id }, data: { password: passwordHash } }),
    db.user.update({ where: { id: input.userId }, data: { mustChangePassword: false } }),
    input.currentSessionId
      ? db.session.deleteMany({
          where: { userId: input.userId, id: { not: input.currentSessionId } },
        })
      : db.session.deleteMany({ where: { userId: input.userId } }),
  ]);
  await log({
    actorUserId: input.userId,
    action: "PASSWORD_CHANGED",
    entityType: "user",
    entityId: input.userId,
    metadata: { via: "self_service" },
    request,
  });
}

// ─── Super-admin user management ─────────────────────────────────────────

export interface AdminActorContext {
  actorUserId: string;
  request?: Request | null;
}

export async function createUserByAdmin(
  input: AdminCreateUserInput,
  ctx: AdminActorContext,
): Promise<{ id: string; username: string; email: string }> {
  const email = input.email.trim().toLowerCase();
  const username = input.username.trim().toLowerCase();
  const duplicate = await db.user.findFirst({
    where: { OR: [{ email }, { username }] },
    select: { email: true, username: true },
  });
  if (duplicate) {
    throw new AppError(
      "CONFLICT",
      duplicate.email === email ? "Email sudah digunakan oleh user lain." : "Username sudah dipakai user lain.",
    );
  }

  const passwordHash = await hashPassword(input.tempPassword);
  let created: user;
  try {
    created = await db.$transaction(async (tx) => {
      const u = await tx.user.create({
        data: {
          email,
          username,
          name: input.name?.trim() || username,
          platformRole: input.platformRole,
          role: adminRoleForPlatform(input.platformRole),
          mustChangePassword: true,
          status: "ACTIVE",
        },
      });
      await tx.account.create({
        data: { accountId: u.id, providerId: "credential", userId: u.id, password: passwordHash },
      });
      return u;
    });
  } catch (error) {
    if ((error as { code?: string }).code === "P2002") {
      throw new AppError("CONFLICT", "Username atau email sudah digunakan.");
    }
    throw error;
  }

  await log({
    actorUserId: ctx.actorUserId,
    action: "USER_CREATED",
    entityType: "user",
    entityId: created.id,
    metadata: { username, email, platformRole: input.platformRole },
    request: ctx.request,
  });
  return { id: created.id, username: created.username ?? username, email: created.email };
}

export interface ListUsersQuery {
  page: number;
  pageSize: number;
  q?: string | undefined;
  status?: UserStatus | undefined;
  platformRole?: PlatformRole | undefined;
}

export async function listUsers(query: ListUsersQuery) {
  const requestedPage = Number.isFinite(query.page) ? Math.max(1, Math.trunc(query.page)) : 1;
  const requestedPageSize = Number.isFinite(query.pageSize) ? Math.trunc(query.pageSize) : 20;
  const pageSize = Math.min(Math.max(requestedPageSize || 20, 1), 100);
  const q = (query.q ?? "").trim().slice(0, 100);
  const where: Prisma.userWhereInput = {
    AND: [
      q
        ? {
            OR: [
              { email: { contains: q, mode: "insensitive" } },
              { username: { contains: q, mode: "insensitive" } },
              { name: { contains: q, mode: "insensitive" } },
            ],
          }
        : {},
      query.status ? { status: query.status } : {},
      query.platformRole ? { platformRole: query.platformRole } : {},
    ],
  };
  const total = await db.user.count({ where });
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(requestedPage, totalPages);
  const rows = await db.user.findMany({
    where,
    orderBy: { createdAt: "desc" },
    skip: (page - 1) * pageSize,
    take: pageSize,
    include: { _count: { select: { memberships: true } } },
  });
  return {
    rows: rows.map((u) => ({
      id: u.id,
      username: u.username,
      name: u.name,
      email: u.email,
      platformRole: u.platformRole,
      status: u.status,
      mustChangePassword: u.mustChangePassword,
      createdAt: u.createdAt,
      membershipCount: u._count.memberships,
    })),
    total,
    page,
    pageSize,
    totalPages,
  };
}

/**
 * Invoice count for the admin detail page. The Invoice table arrives with
 * feature 05 — until then the query reports the genuine current count (0)
 * instead of a fabricated number.
 */
export async function countUserInvoices(userId: string): Promise<number> {
  try {
    const rows = await db.$queryRaw<{ count: bigint }[]>`
      SELECT COUNT(*)::bigint AS count FROM "Invoice" WHERE "createdById" = ${userId}`;
    return Number(rows[0]?.count ?? 0);
  } catch (error) {
    const code = (error as { code?: string }).code;
    const message = error instanceof Error ? error.message : "";
    if (code === "P2021" || code === "P2022" || /does not exist/i.test(message)) {
      return 0;
    }
    throw error;
  }
}

export async function getAdminUserDetail(userId: string) {
  const found = await db.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      username: true,
      name: true,
      email: true,
      platformRole: true,
      mustChangePassword: true,
      status: true,
      createdAt: true,
      updatedAt: true,
    },
  });
  if (!found) {
    throw new AppError("NOT_FOUND", "User tidak ditemukan.");
  }
  const [memberships, sessions, invoiceCount] = await Promise.all([
    db.membership.findMany({
      where: { userId },
      include: { organization: { select: { id: true, name: true, slug: true, status: true } } },
      orderBy: { joinedAt: "asc" },
    }),
    db.session.findMany({
      where: { userId },
      select: { id: true, ipAddress: true, userAgent: true, createdAt: true, expiresAt: true },
      orderBy: { createdAt: "desc" },
    }),
    countUserInvoices(userId),
  ]);
  return { user: found, memberships, sessions, invoiceCount };
}

export async function suspendUser(
  targetUserId: string,
  ctx: AdminActorContext,
): Promise<void> {
  const target = await db.user.findUnique({ where: { id: targetUserId } });
  if (!target) throw new AppError("NOT_FOUND", "User tidak ditemukan.");
  if (target.id === ctx.actorUserId) {
    throw new AppError("CONFLICT", "Anda tidak bisa menangguhkan akun sendiri.");
  }
  if (target.status === "SUSPENDED") {
    throw new AppError("CONFLICT", "User sudah berstatus ditangguhkan.");
  }
  const [, revoked] = await db.$transaction([
    db.user.update({
      where: { id: target.id },
      data: {
        status: "SUSPENDED",
        banned: true,
        banReason: "Ditangguhkan oleh super admin",
        banExpires: null,
      },
    }),
    db.session.deleteMany({ where: { userId: target.id } }),
  ]);
  await log({
    actorUserId: ctx.actorUserId,
    action: "USER_SUSPENDED",
    entityType: "user",
    entityId: target.id,
    metadata: { username: target.username, revokedSessions: revoked.count },
    request: ctx.request,
  });
}

export async function activateUser(targetUserId: string, ctx: AdminActorContext): Promise<void> {
  const target = await db.user.findUnique({ where: { id: targetUserId } });
  if (!target) throw new AppError("NOT_FOUND", "User tidak ditemukan.");
  if (target.status === "ACTIVE") {
    throw new AppError("CONFLICT", "User sudah berstatus aktif.");
  }
  await db.user.update({
    where: { id: target.id },
    data: { status: "ACTIVE", banned: false, banReason: null, banExpires: null },
  });
  await log({
    actorUserId: ctx.actorUserId,
    action: "USER_ACTIVATED",
    entityType: "user",
    entityId: target.id,
    metadata: { username: target.username },
    request: ctx.request,
  });
}

/**
 * Admin password reset: sets the new password directly (same hasher Better
 * Auth verifies against), forces a change on next login, and revokes every
 * session of the target user.
 */
export async function resetUserPassword(
  targetUserId: string,
  newPassword: string,
  ctx: AdminActorContext,
): Promise<void> {
  const target = await db.user.findUnique({ where: { id: targetUserId } });
  if (!target) throw new AppError("NOT_FOUND", "User tidak ditemukan.");
  const passwordHash = await hashPassword(newPassword);
  const account = await db.account.findFirst({
    where: { userId: target.id, providerId: "credential" },
  });
  if (account) {
    await db.account.update({ where: { id: account.id }, data: { password: passwordHash } });
  } else {
    await db.account.create({
      data: { accountId: target.id, providerId: "credential", userId: target.id, password: passwordHash },
    });
  }
  const [, revoked] = await db.$transaction([
    db.user.update({ where: { id: target.id }, data: { mustChangePassword: true } }),
    db.session.deleteMany({ where: { userId: target.id } }),
  ]);
  await log({
    actorUserId: ctx.actorUserId,
    action: "PASSWORD_RESET",
    entityType: "user",
    entityId: target.id,
    metadata: { username: target.username, revokedSessions: revoked.count },
    request: ctx.request,
  });
}

export async function revokeUserSession(
  targetUserId: string,
  sessionId: string,
  ctx: AdminActorContext,
): Promise<void> {
  const targetSession = await db.session.findFirst({
    where: { id: sessionId, userId: targetUserId },
  });
  if (!targetSession) {
    throw new AppError("NOT_FOUND", "Sesi tidak ditemukan.");
  }
  await db.session.delete({ where: { id: targetSession.id } });
  await log({
    actorUserId: ctx.actorUserId,
    action: "SESSION_REVOKED",
    entityType: "session",
    entityId: targetSession.id,
    metadata: { targetUserId },
    request: ctx.request,
  });
}

export async function revokeAllUserSessions(
  targetUserId: string,
  ctx: AdminActorContext,
): Promise<number> {
  const revoked = await db.session.deleteMany({ where: { userId: targetUserId } });
  await log({
    actorUserId: ctx.actorUserId,
    action: "SESSION_REVOKED",
    entityType: "session",
    entityId: targetUserId,
    metadata: { targetUserId, revoked: revoked.count },
    request: ctx.request,
  });
  return revoked.count;
}
