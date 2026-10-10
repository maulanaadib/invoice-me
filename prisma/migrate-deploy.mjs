// prisma/migrate-deploy.mjs
// Thin wrapper so the Docker entrypoint can run `prisma migrate deploy` with
// plain Node (the standalone image ships the prisma CLI under node_modules).
// Data-model.md: "prisma migrate deploy di Docker entrypoint (production)".

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

const prismaCli = resolve(process.cwd(), "node_modules/prisma/build/index.js");

if (!existsSync(prismaCli)) {
  console.error("[migrate-deploy] prisma CLI not found at", prismaCli);
  process.exit(1);
}

const result = spawnSync(process.execPath, [prismaCli, "migrate", "deploy"], {
  stdio: "inherit",
  env: process.env,
});

process.exit(result.status ?? 0);
