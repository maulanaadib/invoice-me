#!/usr/bin/env bash
# Feature 10 — bank account key rotation entry point.
# Re-encrypts every stored account number from the OLD key to the NEW key.
# Usage (full details in README "Rotating the bank account encryption key"):
#   NEW_BANK_ACCOUNT_ENCRYPTION_KEY=<new-key> scripts/rotate-bank-key.sh
# The OLD key defaults to BANK_ACCOUNT_ENCRYPTION_KEY from the app's env files
# (override with OLD_BANK_ACCOUNT_ENCRYPTION_KEY).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"

# Same env files the app reads (DATABASE_URL lives in .env.local in dev).
# Variables already set by the caller win, so you can point the run at another
# database: DATABASE_URL=... scripts/rotate-bank-key.sh
CALLER_DATABASE_URL="${DATABASE_URL:-}"
CALLER_BANK_KEY="${BANK_ACCOUNT_ENCRYPTION_KEY:-}"

set -a
[ -f "$ROOT_DIR/.env" ] && . "$ROOT_DIR/.env"
[ -f "$ROOT_DIR/.env.local" ] && . "$ROOT_DIR/.env.local"
set +a

[ -n "$CALLER_DATABASE_URL" ] && DATABASE_URL="$CALLER_DATABASE_URL"
[ -n "$CALLER_BANK_KEY" ] && BANK_ACCOUNT_ENCRYPTION_KEY="$CALLER_BANK_KEY"
export DATABASE_URL BANK_ACCOUNT_ENCRYPTION_KEY

exec node "$SCRIPT_DIR/rotate-bank-key.mjs" "$@"
