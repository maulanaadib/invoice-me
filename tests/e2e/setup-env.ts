// tests/e2e/setup-env.ts
// Loads the DEV environment (.env + .env.local) into process.env before any
// module that connects to the database is imported. E2E runs against the dev
// app (per context/testing-standards.md), so the fixture rows this spec creates
// must land in the exact same database the dev server reads — DATABASE_URL is
// forced from .env.local, everything else wins over real process.env only
// where the files define it. Must stay the FIRST import of every E2E spec:
// ESM evaluates imports in declaration order, so this runs before Prisma's
// client module (imported via tests/factories.ts) ever reads DATABASE_URL.

import path from "node:path";
import { parseEnvFile } from "../setup/env";

const root = process.cwd();
const devEnv = {
  ...parseEnvFile(path.join(root, ".env")),
  ...parseEnvFile(path.join(root, ".env.local")),
};

for (const [key, value] of Object.entries(devEnv)) {
  if (key === "DATABASE_URL" || process.env[key] === undefined) {
    process.env[key] = value;
  }
}
