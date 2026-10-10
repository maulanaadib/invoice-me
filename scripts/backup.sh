#!/usr/bin/env bash
# Feature 11B — full backup: PostgreSQL dump + storage archive (uploads +
# official PDFs) + sha256 manifest + retention rotation + optional external
# copy. Companion script: scripts/restore.sh.
#
# Usage (full details in README "Backup and restore"):
#   scripts/backup.sh
#   BACKUP_DEST=/backups BACKUP_RETENTION_DAYS=30 scripts/backup.sh
#
# Every run writes ONE directory:
#   $BACKUP_DEST/<ISO-8601 UTC>/
#     db.dump               pg_dump --format=custom --no-owner --no-acl
#     storage.tar.gz        tar.gz of $STORAGE_ROOT/{uploads,invoices}
#     storage-files.sha256  sha256 of every file inside the storage archive
#     manifest.json         run metadata (timestamp, database, sizes, hashes)
#     manifest.sha256       sha256 of the artifacts + manifest.json
#
# Exit codes: 0 success · 1 partial (a usable backup was kept, but a
# best-effort step failed — storage archive, external copy or retention) ·
# 2 fatal (no usable backup). Structured JSON logs go to stderr; passwords
# and URLs are never logged.
#
# PostgreSQL tools resolve in order: PG_DUMP_BIN override → host `pg_dump` →
# `docker exec` into the postgres container (PG_CONTAINER, or auto-detected
# from the DATABASE_URL host/port). DATABASE_URL and STORAGE_ROOT come from
# the app's env files (.env / .env.local); variables already set by the
# caller win, so you can point a run at another database:
#   DATABASE_URL=... STORAGE_ROOT=/data BACKUP_DEST=/backups scripts/backup.sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"

CALLER_DATABASE_URL="${DATABASE_URL:-}"
CALLER_STORAGE_ROOT="${STORAGE_ROOT:-}"
CALLER_BACKUP_DEST="${BACKUP_DEST:-}"

set -a
[ -f "$ROOT_DIR/.env" ] && . "$ROOT_DIR/.env"
[ -f "$ROOT_DIR/.env.local" ] && . "$ROOT_DIR/.env.local"
set +a

[ -n "$CALLER_DATABASE_URL" ] && DATABASE_URL="$CALLER_DATABASE_URL"
[ -n "$CALLER_STORAGE_ROOT" ] && STORAGE_ROOT="$CALLER_STORAGE_ROOT"
[ -n "$CALLER_BACKUP_DEST" ] && BACKUP_DEST="$CALLER_BACKUP_DEST"
export DATABASE_URL

# ─── Structured logging (one JSON object per line, stderr only) ──────────────

json_escape() {
  local s="$1"
  s="${s//\\/\\\\}"
  s="${s//\"/\\\"}"
  s="${s//$'\n'/\\n}"
  s="${s//$'\t'/\\t}"
  s="${s//$'\r'/\\r}"
  printf '%s' "$s"
}

# log_event <level> <msg> [key=value ...]
log_event() {
  local level="$1" msg="$2"
  shift 2
  local at pair key value extra=""
  at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  for pair in "$@"; do
    key="${pair%%=*}"
    value="${pair#*=}"
    if [[ "$value" =~ ^[0-9]+$ ]] || [ "$value" = "true" ] || [ "$value" = "false" ]; then
      extra+=", \"$key\": $value"
    else
      extra+=", \"$key\": \"$(json_escape "$value")\""
    fi
  done
  printf '{"level": "%s", "module": "backup", "at": "%s", "msg": "%s"%s}\n' \
    "$level" "$at" "$(json_escape "$msg")" "$extra" >&2
}

RUN_DIR=""
PARTIAL=0

# fatal <msg> [key=value ...] — no usable backup; remove the partial run dir.
fatal() {
  log_event error "$@"
  [ -n "$RUN_DIR" ] && [ -d "$RUN_DIR" ] && rm -rf "$RUN_DIR"
  exit 2
}

# partial <msg> [key=value ...] — usable backup kept, exit code becomes 1.
partial() {
  PARTIAL=1
  log_event warn "$@"
}

# ─── Configuration ───────────────────────────────────────────────────────────

BACKUP_DEST="${BACKUP_DEST:-/backups}"
BACKUP_RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-30}"
BACKUP_EXTERNAL_PATH="${BACKUP_EXTERNAL_PATH:-}"
STORAGE_ROOT="${STORAGE_ROOT:-}"

# Cron and Coolify do not run from the repo root — resolve relative paths
# against it so the same command works everywhere.
[[ "$BACKUP_DEST" != /* ]] && BACKUP_DEST="$ROOT_DIR/$BACKUP_DEST"
[[ "$STORAGE_ROOT" != /* ]] && STORAGE_ROOT="$ROOT_DIR/$STORAGE_ROOT"
[[ "$BACKUP_EXTERNAL_PATH" != /* && -n "$BACKUP_EXTERNAL_PATH" ]] && \
  BACKUP_EXTERNAL_PATH="$ROOT_DIR/$BACKUP_EXTERNAL_PATH"

[ -n "${DATABASE_URL:-}" ] || fatal "DATABASE_URL tidak di-set (dari .env / .env.local)"
[ -n "$STORAGE_ROOT" ] || fatal "STORAGE_ROOT tidak di-set (dari .env / .env.local)"
if ! [[ "$BACKUP_RETENTION_DAYS" =~ ^[1-9][0-9]*$ ]]; then
  fatal "BACKUP_RETENTION_DAYS harus bilangan bulat >= 1" "value=$BACKUP_RETENTION_DAYS"
fi

# The app's Prisma URLs carry `?schema=public`; libpq (pg_dump/psql) rejects
# unknown URI parameters, so every tool invocation gets the query-free URL.
DB_CLEAN="${DATABASE_URL%%\?*}"
DB_NAME="${DB_CLEAN##*/}"
[[ "$DB_NAME" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]] || \
  fatal "nama database tidak valid di DATABASE_URL" "database=$DB_NAME"
DB_HOSTPORT="$(printf '%s' "$DB_CLEAN" | sed -E 's#^[^@]*@##; s#/.*##')"
DB_PASSWORD=""
if [[ "$DB_CLEAN" =~ ://[^:/]+:([^@/]+)@ ]]; then DB_PASSWORD="${BASH_REMATCH[1]}"; fi

# Never let a URL or password reach a log line (error-handling.md).
redact() {
  local text="$1"
  text="${text//$DB_CLEAN/[DATABASE_URL]}"
  [ -n "$DB_PASSWORD" ] && text="${text//$DB_PASSWORD/[REDACTED]}"
  printf '%s' "$text"
}

# ─── PostgreSQL tool resolution ──────────────────────────────────────────────

PG_TOOL=()
PG_TOOL_VIA=""

# detect_pg_container — pick the running postgres container that serves
# DATABASE_URL: publish-port match for localhost, name match otherwise, and a
# single running postgres-image container as the last resort.
detect_pg_container() {
  command -v docker >/dev/null 2>&1 || return 1
  local host port names count esc
  host="${DB_HOSTPORT%%:*}"
  if [ "$host" = "$DB_HOSTPORT" ]; then port=5432; else port="${DB_HOSTPORT##*:}"; fi
  case "$host" in
    localhost|127.0.0.1|::1|\[::1\])
      names="$(docker ps --format '{{.Names}}\t{{.Ports}}' \
        | awk -F'\t' -v p=":$port->" 'index($2, p) { print $1 }')"
      ;;
    *)
      esc="$(printf '%s' "$host" | sed 's/[][\.*^$+?(){}|]/\\&/g')"
      names="$(docker ps --format '{{.Names}}' | grep -Ei -- "$esc" || true)"
      if [ -z "$names" ]; then
        names="$(docker ps --format '{{.Names}}' | grep -E -- "-${esc}(-[0-9]+)?$" || true)"
      fi
      ;;
  esac
  if [ -z "$names" ]; then
    names="$(docker ps --format '{{.Names}}\t{{.Image}}' \
      | awk -F'\t' '$2 ~ /^postgres([:@/]|$)/ { print $1 }')"
    count="$(printf '%s\n' "$names" | grep -c . || true)"
    [ "$count" = "1" ] || return 1
  fi
  printf '%s\n' "$names" | head -n1
}

# resolve_pg_tool <pg_dump|pg_restore|psql> — fills PG_TOOL (array) and
# PG_TOOL_VIA (description logged in the manifest).
resolve_pg_tool() {
  local bin="$1" override="" container=""
  case "$bin" in
    pg_dump) override="${PG_DUMP_BIN:-}" ;;
    pg_restore) override="${PG_RESTORE_BIN:-}" ;;
    psql) override="${PSQL_BIN:-}" ;;
  esac
  if [ -n "$override" ]; then
    read -r -a PG_TOOL <<< "$override"
    PG_TOOL_VIA="override:$bin"
    return 0
  fi
  if command -v "$bin" >/dev/null 2>&1; then
    PG_TOOL=("$bin")
    PG_TOOL_VIA="host:$bin"
    return 0
  fi
  container="${PG_CONTAINER:-}"
  [ -n "$container" ] || container="$(detect_pg_container || true)"
  if [ -n "$container" ]; then
    PG_TOOL=(docker exec -i "$container" "$bin")
    PG_TOOL_VIA="docker:$container"
    return 0
  fi
  return 1
}

# ─── Storage helpers ─────────────────────────────────────────────────────────

# stamp_epoch "2026-08-01T00-00-00Z" → unix seconds (backup dir naming scheme;
# a "-N" collision suffix is tolerated). Returns 1 for foreign names.
stamp_epoch() {
  local name="$1" normalized
  if [[ "$name" =~ ^([0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}-[0-9]{2}-[0-9]{2}Z)(-[0-9]+)?$ ]]; then
    name="${BASH_REMATCH[1]}"
  else
    return 1
  fi
  normalized="$(printf '%s' "$name" | sed -E 's/T([0-9]{2})-([0-9]{2})-([0-9]{2})Z$/ \1:\2:\3/')"
  date -u -d "$normalized" +%s
}

# rotate_backups — delete backup dirs (and pre-restore snapshots) older than
# BACKUP_RETENTION_DAYS. Age comes from the ISO timestamp in the directory
# name (mtime is only a fallback for foreign names).
rotate_backups() {
  local cutoff dir name epoch
  cutoff=$(( $(date -u +%s) - BACKUP_RETENTION_DAYS * 86400 ))
  while IFS= read -r dir; do
    [ -n "$dir" ] || continue
    name="$(basename "$dir")"
    # Only directories this script created are ever rotated — a foreign
    # directory in BACKUP_DEST is never deleted.
    epoch="$(stamp_epoch "$name" || true)"
    [ -n "$epoch" ] || continue
    if [ "$epoch" -lt "$cutoff" ]; then
      if rm -rf "$dir"; then
        log_event info "backup lama dihapus (retention)" \
          "dir=$name" "ageDays=$(( ($(date -u +%s) - epoch) / 86400 ))" \
          "retentionDays=$BACKUP_RETENTION_DAYS"
      else
        partial "gagal menghapus backup lama" "dir=$dir"
      fi
    fi
  done < <(find "$BACKUP_DEST" -mindepth 1 -maxdepth 1 -type d ! -name 'pre-restore' | sort)

  if [ -d "$BACKUP_DEST/pre-restore" ]; then
    while IFS= read -r dir; do
      [ -n "$dir" ] || continue
      epoch="$(stat -c %Y "$dir")"
      if [ "$epoch" -lt "$cutoff" ]; then
        if rm -rf "$dir"; then
          log_event info "snapshot pra-restore lama dihapus (retention)" \
            "dir=$(basename "$dir")" "retentionDays=$BACKUP_RETENTION_DAYS"
        else
          partial "gagal menghapus snapshot pra-restore" "path=$dir"
        fi
      fi
    done < <(find "$BACKUP_DEST/pre-restore" -mindepth 1 -maxdepth 1 | sort)
  fi
}

# ─── Run ─────────────────────────────────────────────────────────────────────

mkdir -p "$BACKUP_DEST"
[ -d "$BACKUP_DEST" ] && [ -w "$BACKUP_DEST" ] || \
  fatal "BACKUP_DEST tidak bisa ditulis" "backupDest=$BACKUP_DEST"

STAMP="$(date -u +%Y-%m-%dT%H-%M-%SZ)"
RUN_DIR="$BACKUP_DEST/$STAMP"
COLLISION=0
while [ -e "$RUN_DIR" ]; do
  COLLISION=$((COLLISION + 1))
  RUN_DIR="$BACKUP_DEST/$STAMP-$COLLISION"
done
mkdir "$RUN_DIR"

resolve_pg_tool pg_dump || fatal "pg_dump tidak ditemukan di PATH, dan fallback docker exec tidak berhasil" \
  "hint=install postgresql-client, atau set PG_CONTAINER ke nama container postgres, atau set PG_DUMP_BIN" \
  "databaseHost=$DB_HOSTPORT"
PG_TOOL_VERSION="$("${PG_TOOL[@]}" --version 2>/dev/null | head -n1 || true)"
[ -n "$PG_TOOL_VERSION" ] || PG_TOOL_VERSION="unknown"

log_event info "backup dimulai" "runDir=$RUN_DIR" "database=$DB_NAME" \
  "databaseHost=$DB_HOSTPORT" "storageRoot=$STORAGE_ROOT" "pgTool=$PG_TOOL_VIA"

# 1. Database dump (compressed custom format, portable --no-owner --no-acl).
DUMP_ERR="$(mktemp)"
DUMP_OK=true
if ! "${PG_TOOL[@]}" -Fc --no-owner --no-acl "$DB_CLEAN" > "$RUN_DIR/db.dump.tmp" 2> "$DUMP_ERR"; then
  DUMP_OK=false
fi
if [ "$DUMP_OK" != "true" ]; then
  log_event error "pg_dump gagal — tidak ada backup yang bisa disimpan" \
    "tool=$PG_TOOL_VIA" "error=$(redact "$(head -c 1000 "$DUMP_ERR")")"
  rm -f "$DUMP_ERR"
  fatal "pg_dump gagal" "database=$DB_NAME"
fi
if [ -s "$DUMP_ERR" ]; then
  log_event warn "pg_dump menulis peringatan" "error=$(redact "$(head -c 1000 "$DUMP_ERR")")"
fi
rm -f "$DUMP_ERR"
mv "$RUN_DIR/db.dump.tmp" "$RUN_DIR/db.dump"
DB_DUMP_BYTES="$(stat -c%s "$RUN_DIR/db.dump")"

# 2. Storage archive + per-file checksums.
STORAGE_OK=true
STORAGE_ERROR=""
STORAGE_FILE_COUNT=0
STORAGE_TOTAL_BYTES=0
STORAGE_MEMBERS=()
[ -d "$STORAGE_ROOT/uploads" ] && STORAGE_MEMBERS+=("uploads")
[ -d "$STORAGE_ROOT/invoices" ] && STORAGE_MEMBERS+=("invoices")

: > "$RUN_DIR/storage-files.sha256"
if [ "${#STORAGE_MEMBERS[@]}" -gt 0 ]; then
  if ! ( cd "$STORAGE_ROOT" \
      && find "${STORAGE_MEMBERS[@]}" -type f -print0 \
        | LC_ALL=C sort -z \
        | xargs -0 -r sha256sum ) > "$RUN_DIR/storage-files.sha256"; then
    STORAGE_OK=false
    STORAGE_ERROR="gagal menghitung checksum file storage"
  fi
fi

if [ "$STORAGE_OK" = "true" ]; then
  if [ "${#STORAGE_MEMBERS[@]}" -gt 0 ]; then
    if ! tar -czf "$RUN_DIR/storage.tar.gz.tmp" -C "$STORAGE_ROOT" "${STORAGE_MEMBERS[@]}"; then
      STORAGE_OK=false
      STORAGE_ERROR="gagal membuat archive storage (tar)"
    else
      mv "$RUN_DIR/storage.tar.gz.tmp" "$RUN_DIR/storage.tar.gz"
    fi
  else
    # Empty storage must still produce a valid (empty) archive — Check When
    # Done: "Backup dengan DB kosong + storage kosong tetap sukses".
    tar --files-from /dev/null -czf "$RUN_DIR/storage.tar.gz"
  fi
fi
[ "$STORAGE_OK" = "true" ] || rm -f "$RUN_DIR/storage.tar.gz.tmp"

if [ "$STORAGE_OK" = "true" ]; then
  STORAGE_FILE_COUNT="$(grep -c . "$RUN_DIR/storage-files.sha256" || true)"
  if [ "$STORAGE_FILE_COUNT" -gt 0 ]; then
    while IFS= read -r rel; do
      [ -n "$rel" ] || continue
      STORAGE_TOTAL_BYTES=$(( STORAGE_TOTAL_BYTES + $(stat -c%s "$STORAGE_ROOT/$rel") ))
    done < <(cut -c67- "$RUN_DIR/storage-files.sha256")
  fi
else
  rm -f "$RUN_DIR/storage-files.sha256"
  partial "archive storage gagal — backup database tetap disimpan tanpa file storage" \
    "error=$STORAGE_ERROR"
fi

# 3. manifest.json (metadata + per-artifact sha256) and manifest.sha256.
MANIFEST_FILES=("db.dump")
[ -f "$RUN_DIR/storage.tar.gz" ] && MANIFEST_FILES+=("storage.tar.gz" "storage-files.sha256")

{
  printf '{\n'
  printf '  "schema": 1,\n'
  printf '  "createdAt": "%s",\n' "$STAMP"
  printf '  "database": "%s",\n' "$(json_escape "$DB_NAME")"
  printf '  "databaseHost": "%s",\n' "$(json_escape "$DB_HOSTPORT")"
  printf '  "storageRoot": "%s",\n' "$(json_escape "$STORAGE_ROOT")"
  printf '  "retentionDays": %s,\n' "$BACKUP_RETENTION_DAYS"
  printf '  "pgTool": "%s",\n' "$(json_escape "$PG_TOOL_VIA ($PG_TOOL_VERSION)")"
  printf '  "storage": {\n'
  printf '    "ok": %s,\n' "$STORAGE_OK"
  printf '    "fileCount": %s,\n' "$STORAGE_FILE_COUNT"
  printf '    "totalBytes": %s,\n' "$STORAGE_TOTAL_BYTES"
  if [ -n "$STORAGE_ERROR" ]; then
    printf '    "error": "%s"\n' "$(json_escape "$STORAGE_ERROR")"
  else
    printf '    "error": null\n'
  fi
  printf '  },\n'
  printf '  "files": [\n'
  for i in "${!MANIFEST_FILES[@]}"; do
    artifact="${MANIFEST_FILES[$i]}"
    sep=","
    [ "$i" -eq $(( ${#MANIFEST_FILES[@]} - 1 )) ] && sep=""
    printf '    {"name": "%s", "sizeBytes": %s, "sha256": "%s"}%s\n' \
      "$artifact" \
      "$(stat -c%s "$RUN_DIR/$artifact")" \
      "$(sha256sum "$RUN_DIR/$artifact" | cut -c1-64)" \
      "$sep"
  done
  printf '  ]\n'
  printf '}\n'
} > "$RUN_DIR/manifest.json"

( cd "$RUN_DIR" && sha256sum "${MANIFEST_FILES[@]}" manifest.json > manifest.sha256 )

# Self-check: a backup that fails its own manifest check is not a backup.
if ! ( cd "$RUN_DIR" && sha256sum -c --quiet manifest.sha256 >/dev/null 2>&1 ); then
  fatal "verifikasi internal manifest gagal — backup dibuang" "runDir=$RUN_DIR"
fi

# 4. Optional external copy (same-disk backups are not a final backup).
COPIED=false
if [ -n "$BACKUP_EXTERNAL_PATH" ]; then
  if mkdir -p "$BACKUP_EXTERNAL_PATH/$STAMP" 2>/dev/null; then
    COPY_OK=false
    if command -v rsync >/dev/null 2>&1; then
      rsync -a "$RUN_DIR/" "$BACKUP_EXTERNAL_PATH/$STAMP/" && COPY_OK=true || COPY_OK=false
    else
      cp -a "$RUN_DIR/." "$BACKUP_EXTERNAL_PATH/$STAMP/" && COPY_OK=true || COPY_OK=false
    fi
    if [ "$COPY_OK" = "true" ]; then
      COPIED=true
      log_event info "backup disalin ke penyimpanan eksternal" \
        "externalPath=$BACKUP_EXTERNAL_PATH/$STAMP"
    else
      partial "penyalinan backup eksternal gagal — backup lokal tetap utuh" \
        "externalPath=$BACKUP_EXTERNAL_PATH"
    fi
  else
    partial "tujuan backup eksternal tidak bisa dibuat — backup lokal tetap utuh" \
      "externalPath=$BACKUP_EXTERNAL_PATH"
  fi
fi

# 5. Retention rotation (only after a verified backup exists).
rotate_backups

log_event info "backup selesai" \
  "runDir=$RUN_DIR" "database=$DB_NAME" "dbDumpBytes=$DB_DUMP_BYTES" \
  "storageOk=$STORAGE_OK" "storageFileCount=$STORAGE_FILE_COUNT" \
  "storageTotalBytes=$STORAGE_TOTAL_BYTES" "externalCopied=$COPIED" \
  "retentionDays=$BACKUP_RETENTION_DAYS"

if [ "$PARTIAL" = "1" ]; then
  exit 1
fi
exit 0
