#!/bin/sh
# docker-entrypoint.sh — runs at container start (feature 11C, spec item 7):
#   1. prisma migrate deploy — forward-only migration (data-model.md rule).
#   2. prisma db seed — idempotent acceptance seed (super admin from env,
#      Sigit Berkarya org + demo data). Skipped when SEED_ADMIN_PASSWORD is
#      unset so a production instance without seed credentials boots cleanly
#      (the migration still runs; no fake data is created without the env
#      contract being met).
#   3. exec node server.js — the standalone Next.js server becomes PID 1.
set -e

# Prisma CLI: skip the telemetry/update network checks (self-hosted hosts may
# have no outbound access; they must never delay a deploy).
export CHECKPOINT_DISABLE=1

echo "[entrypoint] Applying database migrations…"
node prisma/migrate-deploy.mjs

if [ -n "$SEED_ADMIN_PASSWORD" ]; then
  echo "[entrypoint] Running acceptance seed (SEED_ADMIN_PASSWORD is set)…"
  node prisma/seed.mjs
else
  echo "[entrypoint] SEED_ADMIN_PASSWORD not set — skipping acceptance seed."
fi

echo "[entrypoint] Starting Next.js server…"
exec node server.js

