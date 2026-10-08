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

/** Wipes all tables (children first — FK order, feature 02/03 models included). */
export async function resetDatabase(): Promise<void> {
  await db.auditLog.deleteMany();
  await db.uploadRecord.deleteMany(); // Feature 09 — before Organization (FK)
  await db.payment.deleteMany(); // Feature 07 — before Invoice (Restrict on user)
  await db.invoiceItem.deleteMany(); // Feature 04 — cascade-safe order
  await db.invoice.deleteMany();
  await db.invoiceSequence.deleteMany();
  await db.invoiceProfile.deleteMany(); // SetNull clears bank/signer FK links
  await db.bankAccount.deleteMany();
  await db.signer.deleteMany();
  await db.projectReference.deleteMany(); // Customer → Restrict, delete first
  await db.customerContact.deleteMany();
  await db.customer.deleteMany();
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
  /**
   * Defaults to TRUE so feature-01 tests keep their "straight to dashboard"
   * expectation; onboarding tests opt in with false (the DB default for
   * admin-created users is false).
   */
  onboardingComplete?: boolean;
  onboardingStep?: number;
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
      onboardingComplete: options.onboardingComplete ?? true,
      onboardingStep: options.onboardingStep ?? 1,
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
