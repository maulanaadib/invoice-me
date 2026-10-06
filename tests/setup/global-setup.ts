// tests/setup/global-setup.ts
// Vitest global setup: ensure the hermetic test database exists, point every
// worker at it (process.env changes propagate to test workers), and apply
// pending migrations with `prisma migrate deploy`.

import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { PrismaClient } from "@prisma/client";
import { loadTestEnv } from "./env";

const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;

function databaseNameOf(url: string): string {
  const pathname = new URL(url).pathname;
  const name = pathname.replace(/^\//, "");
  if (!name || !IDENTIFIER.test(name)) {
    throw new Error(`Invalid test database name in DATABASE_URL: "${name}"`);
  }
  return name;
}

function adminUrlFor(testUrl: string): string {
  const url = new URL(testUrl);
  url.pathname = "/postgres";
  url.search = "";
  return url.toString();
}

export default async function globalSetup(): Promise<void> {
  const vars = loadTestEnv();
  const testUrl = vars.DATABASE_URL;
  if (!testUrl) throw new Error("tests/test.env must define DATABASE_URL");

  // Point all workers (they inherit this process env) at the test database.
  process.env.DATABASE_URL = testUrl;

  const dbName = databaseNameOf(testUrl);
  const adminUrl = process.env.TEST_ADMIN_DATABASE_URL ?? adminUrlFor(testUrl);

  // 1. Create the test database when missing (admin connection to /postgres).
  process.env.DATABASE_URL = adminUrl;
  const admin = new PrismaClient();
  try {
    const found = await admin.$queryRaw<Array<{ exists: boolean }>>`
      SELECT EXISTS(SELECT 1 FROM pg_database WHERE datname = ${dbName}) AS "exists"`;
    if (!found[0]?.exists) {
      await admin.$executeRawUnsafe(`CREATE DATABASE "${dbName}"`);
      console.log(`[test] created database ${dbName}`);
    }
  } finally {
    await admin.$disconnect();
    process.env.DATABASE_URL = testUrl;
  }

  // 2. Apply schema migrations to the test database (idempotent).
  const prismaCli = resolve(process.cwd(), "node_modules/prisma/build/index.js");
  if (!existsSync(prismaCli)) {
    throw new Error("Prisma CLI not found — run npm install first.");
  }
  execFileSync(process.execPath, [prismaCli, "migrate", "deploy"], {
    cwd: process.cwd(),
    env: { ...process.env, DATABASE_URL: testUrl },
    stdio: "inherit",
  });
}
