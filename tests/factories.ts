// tests/factories.ts — Prisma-backed factories for integration tests.
// All rows go through the real schema; passwords use the same hasher Better
// Auth verifies against. Call resetDatabase() in beforeAll per test file.

import type {
  MembershipStatus,
  OrganizationRole,
  PlatformRole,
  UserStatus,
} from "@prisma/client";
import { hashPassword } from "better-auth/crypto";
import { adminRoleForPlatform } from "@/lib/security";
import { db } from "@/server/db";

/** Wipes all feature-01 tables (children first — FK order). */
export async function resetDatabase(): Promise<void> {
  await db.auditLog.deleteMany();
  await db.membership.deleteMany();
  await db.session.deleteMany();
  await db.verification.deleteMany();
  await db.account.deleteMany();
  await db.user.deleteMany();
  await db.organization.deleteMany();
}

let sequence = 0;
function uniqueSuffix(): string {
  sequence += 1;
  return `${Date.now().toString(36)}${sequence}`;
}

export interface TestUserOptions {
  username?: string;
  email?: string;
  name?: string;
  password?: string;
  platformRole?: PlatformRole;
  status?: UserStatus;
  mustChangePassword?: boolean;
}

export interface TestUser {
  id: string;
  username: string;
  email: string;
  password: string;
  name: string;
}

export async function createUser(options: TestUserOptions = {}): Promise<TestUser> {
  const username = options.username ?? `user${uniqueSuffix()}`;
  const email = options.email ?? `${username}@test.local`;
  const password = options.password ?? `Pwd-${uniqueSuffix()}x1`;
  const platformRole = options.platformRole ?? "USER";
  const passwordHash = await hashPassword(password);

  const user = await db.user.create({
    data: {
      username,
      email,
      name: options.name ?? username,
      emailVerified: true,
      platformRole,
      role: adminRoleForPlatform(platformRole),
      status: options.status ?? "ACTIVE",
      mustChangePassword: options.mustChangePassword ?? false,
    },
  });
  await db.account.create({
    data: {
      accountId: user.id,
      providerId: "credential",
      userId: user.id,
      password: passwordHash,
    },
  });

  return { id: user.id, username, email, password, name: user.name ?? username };
}

export async function createOrganization(name?: string): Promise<{ id: string; slug: string }> {
  const slug = `org-${uniqueSuffix()}`;
  const organization = await db.organization.create({
    data: { name: name ?? `Organisasi Uji ${uniqueSuffix()}`, slug },
  });
  return { id: organization.id, slug: organization.slug };
}

export async function addMembership(
  userId: string,
  organizationId: string,
  role: OrganizationRole,
  status: MembershipStatus = "ACTIVE",
): Promise<{ id: string }> {
  return db.membership.create({ data: { userId, organizationId, role, status } });
}
