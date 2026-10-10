#!/usr/bin/env bash
# Feature 11A — maintenance job entry point: orphan file cleanup + batched
# OVERDUE recompute (structured JSON log on stdout/stderr).
#
# Usage (full details in README "Maintenance jobs"):
#   scripts/maintenance.sh
#
# DATABASE_URL and STORAGE_ROOT come from the app's env files (.env /
# .env.local), and variables already set by the caller win — so you can point
# a run at another database or storage root:
#   DATABASE_URL=... STORAGE_ROOT=/data scripts/maintenance.sh
#
# Scheduling (Coolify scheduled task or host cron) is deployment
# configuration — feature 11C. This feature ships the script only.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"

CALLER_DATABASE_URL="${DATABASE_URL:-}"
CALLER_STORAGE_ROOT="${STORAGE_ROOT:-}"

set -a
[ -f "$ROOT_DIR/.env" ] && . "$ROOT_DIR/.env"
[ -f "$ROOT_DIR/.env.local" ] && . "$ROOT_DIR/.env.local"
set +a

[ -n "$CALLER_DATABASE_URL" ] && DATABASE_URL="$CALLER_DATABASE_URL"
[ -n "$CALLER_STORAGE_ROOT" ] && STORAGE_ROOT="$CALLER_STORAGE_ROOT"
export DATABASE_URL STORAGE_ROOT

exec node "$SCRIPT_DIR/maintenance.mjs" "$@"
