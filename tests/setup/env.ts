// tests/setup/env.ts
// Environment loader for the test harness. Precedence:
//   1. tests/test.env  (always wins — hermetic test DB + test secrets)
//   2. real process.env (only where test.env is silent)
//   3. .env.local / .env (developer fallbacks)
// Tests/test.env defines DATABASE_URL, BETTER_AUTH_*, INTERNAL_PDF_SECRET, etc.
// so src/server/env.ts can parse safely inside workers.

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

export function parseEnvFile(filePath: string): Record<string, string> {
  if (!existsSync(filePath)) return {};
  const out: Record<string, string> = {};
  for (const line of readFileSync(filePath, "utf8").split(/\r?\n/)) {
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

/**
 * Applies test environment to process.env (idempotent — safe in globalSetup,
 * per-worker setupFiles, and direct calls). Returns the merged file values.
 */
export function loadTestEnv(): Record<string, string> {
  const root = process.cwd();
  const vars = {
    ...parseEnvFile(resolve(root, ".env")),
    ...parseEnvFile(resolve(root, ".env.local")),
    ...parseEnvFile(resolve(root, "tests/test.env")),
  };
  for (const [key, value] of Object.entries(vars)) {
    // DATABASE_URL is forced so tests never touch the dev database.
    if (key === "DATABASE_URL" || process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
  return vars;
}
