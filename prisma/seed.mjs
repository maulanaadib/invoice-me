// prisma/seed.mjs — idempotent seed of the platform super admin (feature 01).
// Plain Node ESM so `prisma db seed` works without a TS loader.
//
// Reads SEED_ADMIN_USERNAME / SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD from the
// environment (falling back to .env.local / .env), then upserts:
//   - user (SUPER_ADMIN, ACTIVE, mustChangePassword=false, admin-plugin role)
//   - credential account carrying the Better Auth password hash
//
// No organization is seeded: creating orgs is the super admin's job in the UI
// (spec: feature 01 seeds only the super admin).

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
}

main()
  .catch((error) => {
    console.error("[seed] failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
