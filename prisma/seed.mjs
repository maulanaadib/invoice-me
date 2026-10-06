// prisma/seed.mjs — idempotent seed of the platform super admin (feature 01)
// plus the feature-03 demo workspace (organization, customer, PIC, project/PO
// reference). Plain Node ESM so `prisma db seed` works without a TS loader.
//
// Reads SEED_ADMIN_USERNAME / SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD from the
// environment (falling back to .env.local / .env), then upserts:
//   - user (SUPER_ADMIN, ACTIVE, mustChangePassword=false, admin-plugin role)
//   - credential account carrying the Better Auth password hash
//
// Feature 03 demo data (so the seeded install has a real customer list):
//   - organization "workspace-demo" with the seed admin as OWNER membership
//   - customer "PT Dharma Polimetal Tbk" (+ primary PIC)
//   - PURCHASE_ORDER project reference 5198021181
// The customer/project are created only when absent — re-running is a no-op.

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PrismaClient } from "@prisma/client";
import { hashPassword } from "better-auth/crypto";

function parseEnvFile(path) {
  if (!existsSync(path)) return {};
  const out = {};
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

// Real environment wins; .env.local wins over .env.
const root = resolve(process.cwd());
const fileEnv = {
  ...parseEnvFile(resolve(root, ".env")),
  ...parseEnvFile(resolve(root, ".env.local")),
};
for (const [key, value] of Object.entries(fileEnv)) {
  if (process.env[key] === undefined) process.env[key] = value;
}

const username = process.env.SEED_ADMIN_USERNAME;
const email = process.env.SEED_ADMIN_EMAIL;
const password = process.env.SEED_ADMIN_PASSWORD;

if (!username || !email || !password) {
  console.error(
    "[seed] SEED_ADMIN_USERNAME, SEED_ADMIN_EMAIL, and SEED_ADMIN_PASSWORD are required.",
  );
  process.exit(1);
}
if (password.length < 8) {
  console.error("[seed] SEED_ADMIN_PASSWORD must be at least 8 characters.");
  process.exit(1);
}

const prisma = new PrismaClient();

async function main() {
  const passwordHash = await hashPassword(password);

  const existing = await prisma.user.findFirst({
    where: { OR: [{ email }, { username }] },
  });

  const userData = {
    name: "Super Admin",
    email,
    emailVerified: true,
    username,
    platformRole: "SUPER_ADMIN",
    mustChangePassword: false,
    status: "ACTIVE",
    // Better Auth admin plugin mirror of platformRole (adminRoles: ["SUPER_ADMIN"]).
    role: "SUPER_ADMIN",
    banned: false,
    banReason: null,
    banExpires: null,
  };

  const user = existing
    ? await prisma.user.update({ where: { id: existing.id }, data: userData })
    : await prisma.user.create({ data: userData });

  const account = await prisma.account.findFirst({
    where: { userId: user.id, providerId: "credential" },
  });
  if (account) {
    await prisma.account.update({
      where: { id: account.id },
      data: { password: passwordHash },
    });
  } else {
    await prisma.account.create({
      data: {
        userId: user.id,
        accountId: user.id,
        providerId: "credential",
        password: passwordHash,
      },
    });
  }

  console.log(
    `[seed] super admin ready: username=${username} email=${email} (id=${user.id})`,
  );

  // ── Feature 03 demo workspace ────────────────────────────────────────────
  // A real organization with one customer, one PIC and one PO reference so a
  // freshly seeded install has something to browse and search ("Dharma").
  const orgData = { name: "Workspace Demo", slug: "workspace-demo", status: "ACTIVE" };
  const demoOrg = await prisma.organization.upsert({
    where: { slug: orgData.slug },
    update: orgData,
    create: orgData,
  });

  const membership = await prisma.membership.findUnique({
    where: {
      userId_organizationId: { userId: user.id, organizationId: demoOrg.id },
    },
  });
  if (membership) {
    await prisma.membership.update({
      where: { id: membership.id },
      data: { role: "OWNER", status: "ACTIVE" },
    });
  } else {
    await prisma.membership.create({
      data: { userId: user.id, organizationId: demoOrg.id, role: "OWNER", status: "ACTIVE" },
    });
  }

  const customerData = {
    organizationId: demoOrg.id,
    companyName: "PT Dharma Polimetal Tbk",
    legalName: "PT Dharma Polimetal Tbk",
    businessType: "Manufaktur",
    city: "Bekasi",
    province: "Jawa Barat",
    country: "Indonesia",
    isActive: true,
    deletedAt: null,
  };
  const customer = await prisma.customer.upsert({
    where: { id: "seed_customer_dharma" },
    update: customerData,
    create: { id: "seed_customer_dharma", ...customerData },
  });

  const picCount = await prisma.customerContact.count({ where: { customerId: customer.id } });
  if (picCount === 0) {
    await prisma.customerContact.create({
      data: {
        customerId: customer.id,
        name: "Bagas Prasetyo",
        title: "Procurement Manager",
        division: "Purchasing",
        isPrimary: true,
      },
    });
  }

  const projectCount = await prisma.projectReference.count({
    where: { organizationId: demoOrg.id, referenceNumber: "5198021181" },
  });
  if (projectCount === 0) {
    await prisma.projectReference.create({
      data: {
        organizationId: demoOrg.id,
        customerId: customer.id,
        referenceType: "PURCHASE_ORDER",
        referenceNumber: "5198021181",
        referenceDate: new Date(Date.UTC(2026, 8, 14)),
        title: "Pengadaan Bracket Frame Assembly",
        workValue: "487500000",
        currency: "IDR",
        startDate: new Date(Date.UTC(2026, 9, 1)),
        endDate: new Date(Date.UTC(2026, 10, 30)),
        status: "ACTIVE",
      },
    });
  }

  console.log(
    `[seed] demo workspace ready: org=${demoOrg.slug} customer=${customer.companyName} (PO 5198021181)`,
  );
}

main()
  .catch((error) => {
    console.error("[seed] failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
