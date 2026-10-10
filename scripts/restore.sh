#!/usr/bin/env bash
# Feature 11B — restore PostgreSQL + storage from a backup directory produced
# by scripts/backup.sh. Full details in README "Backup and restore".
#
# Usage:
#   scripts/restore.sh --dry-run <backup-dir>    verify only — no changes at all
#   scripts/restore.sh <backup-dir>              full restore (with downtime)
#
# The real restore runs in this order:
#   1. Verify manifest.sha256 in the backup dir (tampered/corrupt → exit 2).
#   2. Verify every file inside storage.tar.gz against storage-files.sha256.
#   3. Explicit confirmation: type the target database name exactly
#      (piped input works for automation; wrong piped answer → abort, exit 1).
#   4. Snapshot the CURRENT state to $BACKUP_DEST/pre-restore/<timestamp>/
#      (database dump + storage archive) BEFORE any change. Snapshot failure
#      aborts the restore with zero changes (exit 2).
#   5. Prove the dump restores into an isolated scratch database
#      ($RESTORE_TEST_DATABASE, default invoice_me_restore_check) — the
#      production database is only dropped after this succeeds.
#   6. Overwrite the production database, extract storage (current files are
#      moved into the pre-restore snapshot dir first), then verify checksums
#      post-restore. ANY failure → rollback from the snapshot + exit 2.
#
# Exit codes: 0 success (a passing --dry-run included) · 1 aborted before any
# change (declined confirmation, missing tool) · 2 fatal (verification or
# restore failure — rolled back when possible, snapshot kept for manual
# recovery either way).
#
# Downtime rule (README): stop app → restore → start app.
# Structured JSON logs go to stderr; human-facing prompts/progress go to
# stdout. Passwords and URLs are never logged.
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
  printf '{"level": "%s", "module": "restore", "at": "%s", "msg": "%s"%s}\n' \
    "$level" "$at" "$(json_escape "$msg")" "$extra" >&2
}

# ─── Configuration ───────────────────────────────────────────────────────────

DRY_RUN=false
BACKUP_DIR=""
for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=true ;;
    -h|--help)
      printf 'Usage: scripts/restore.sh [--dry-run] <backup-dir>\n'
      exit 0
      ;;
    -*) printf 'ERROR: opsi tidak dikenal: %s\n' "$arg" >&2; exit 1 ;;
    *)
      if [ -n "$BACKUP_DIR" ]; then
        printf 'ERROR: hanya satu direktori backup yang boleh diberikan.\n' >&2
        exit 1
      fi
      BACKUP_DIR="$arg"
      ;;
  esac
done

if [ -z "$BACKUP_DIR" ]; then
  printf 'ERROR: direktori backup belum diberikan.\n' >&2
  printf 'Usage: scripts/restore.sh [--dry-run] <backup-dir>\n' >&2
  exit 1
fi
[[ "$BACKUP_DIR" != /* ]] && BACKUP_DIR="$ROOT_DIR/$BACKUP_DIR"
if [ ! -d "$BACKUP_DIR" ]; then
  printf 'ERROR: direktori backup tidak ditemukan: %s\n' "$BACKUP_DIR" >&2
  exit 1
fi

STORAGE_ROOT="${STORAGE_ROOT:-}"
[[ "$STORAGE_ROOT" != /* && -n "$STORAGE_ROOT" ]] && STORAGE_ROOT="$ROOT_DIR/$STORAGE_ROOT"
BACKUP_DEST="${BACKUP_DEST:-/backups}"
[[ "$BACKUP_DEST" != /* ]] && BACKUP_DEST="$ROOT_DIR/$BACKUP_DEST"
RESTORE_TEST_DATABASE="${RESTORE_TEST_DATABASE:-invoice_me_restore_check}"

if [ -z "${DATABASE_URL:-}" ]; then
  printf 'ERROR: DATABASE_URL tidak di-set (dari .env / .env.local).\n' >&2
  exit 1
fi
# The app's Prisma URLs carry `?schema=public`; libpq (pg_dump/psql) rejects
# unknown URI parameters, so every tool invocation gets the query-free URL.
DB_CLEAN="${DATABASE_URL%%\?*}"
DB_NAME="${DB_CLEAN##*/}"
if ! [[ "$DB_NAME" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]]; then
  printf 'ERROR: nama database tidak valid di DATABASE_URL: %s\n' "$DB_NAME" >&2
  exit 1
fi
DB_HOSTPORT="$(printf '%s' "$DB_CLEAN" | sed -E 's#^[^@]*@##; s#/.*##')"
DB_ADMIN_URL="${DB_CLEAN%/*}/postgres"
DB_PASSWORD=""
if [[ "$DB_CLEAN" =~ ://[^:/]+:([^@/]+)@ ]]; then DB_PASSWORD="${BASH_REMATCH[1]}"; fi

# Never let a URL or password reach a log line (error-handling.md).
redact() {
  local text="$1"
  text="${text//$DB_CLEAN/[DATABASE_URL]}"
  [ -n "$DB_PASSWORD" ] && text="${text//$DB_PASSWORD/[REDACTED]}"
  printf '%s' "$text"
}

# ─── PostgreSQL tool resolution (same order as backup.sh) ────────────────────

PG_DUMP=() PG_DUMP_VIA=""
PG_RESTORE=() PG_RESTORE_VIA=""
PSQL=() PSQL_VIA=""
DETECTED_PG_CONTAINER=""

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

# resolve_pg_tool <pg_dump|pg_restore|psql> — fills PG_TOOL/PG_TOOL_VIA.
PG_TOOL=() PG_TOOL_VIA=""
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
  if [ -z "$container" ]; then
    if [ -z "$DETECTED_PG_CONTAINER" ]; then
      DETECTED_PG_CONTAINER="$(detect_pg_container || true)"
    fi
    container="$DETECTED_PG_CONTAINER"
  fi
  if [ -n "$container" ]; then
    PG_TOOL=(docker exec -i "$container" "$bin")
    PG_TOOL_VIA="docker:$container"
    return 0
  fi
  return 1
}

# ─── Pre-flight verification (read-only, safe in every mode) ─────────────────

for required in manifest.sha256 manifest.json db.dump; do
  if [ ! -f "$BACKUP_DIR/$required" ]; then
    printf 'ERROR: %s tidak ada di %s — ini bukan backup scripts/backup.sh.\n' \
      "$required" "$BACKUP_DIR" >&2
    log_event error "backup tidak lengkap" "missing=$required" "backupDir=$BACKUP_DIR"
    exit 2
  fi
done

if ( cd "$BACKUP_DIR" && sha256sum -c --quiet manifest.sha256 >/dev/null 2>&1 ); then
  log_event info "manifest checksum valid" "backupDir=$BACKUP_DIR"
else
  printf 'VERIFIKASI GAGAL: checksum manifest tidak cocok (backup rusak atau dimanipulasi).\n' >&2
  printf 'Tidak ada perubahan yang dilakukan.\n' >&2
  log_event error "checksum manifest GAGAL — backup ditolak" "backupDir=$BACKUP_DIR"
  exit 2
fi

STORAGE_ARCHIVE="$BACKUP_DIR/storage.tar.gz"
STORAGE_MANIFEST="$BACKUP_DIR/storage-files.sha256"
# absent = backup without storage (partial backup) · empty = storage was empty
# at backup time · files = real content to verify and extract.
STORAGE_STATE="absent"
STORAGE_MANIFEST_USABLE=false
ARCHIVE_LIST=""
VERIFY_MEMBERS=0
VERIFY_DIR=""
trap '[ -z "$VERIFY_DIR" ] || rm -rf "$VERIFY_DIR"' EXIT

if [ -f "$STORAGE_ARCHIVE" ]; then
  if [ -z "$STORAGE_ROOT" ]; then
    printf 'ERROR: STORAGE_ROOT tidak di-set — archive storage ada di backup ini.\n' >&2
    log_event error "STORAGE_ROOT wajib untuk backup yang memuat storage" "backupDir=$BACKUP_DIR"
    exit 2
  fi
  STORAGE_STATE="empty"
  if ! ARCHIVE_LIST="$(tar -tzf "$STORAGE_ARCHIVE" 2>/dev/null)"; then
    printf 'VERIFIKASI GAGAL: %s bukan archive tar.gz yang valid.\n' "$STORAGE_ARCHIVE" >&2
    log_event error "archive storage rusak" "backupDir=$BACKUP_DIR"
    exit 2
  fi
  if [ -n "$ARCHIVE_LIST" ]; then
    STORAGE_STATE="files"
    # Count file members only (tar listing also contains directory entries).
    VERIFY_MEMBERS="$(printf '%s\n' "$ARCHIVE_LIST" | grep -cv '/$' || true)"
    if [ -f "$STORAGE_MANIFEST" ] && [ -s "$STORAGE_MANIFEST" ]; then
      STORAGE_MANIFEST_USABLE=true
      VERIFY_DIR="$(mktemp -d)"
      if ! tar -xzf "$STORAGE_ARCHIVE" -C "$VERIFY_DIR" 2>/dev/null; then
        printf 'VERIFIKASI GAGAL: archive storage gagal diekstrak untuk verifikasi.\n' >&2
        log_event error "ekstraksi verifikasi archive gagal" "backupDir=$BACKUP_DIR"
        exit 2
      fi
      if ! ( cd "$VERIFY_DIR" && sha256sum -c --quiet "$STORAGE_MANIFEST" >/dev/null 2>&1 ); then
        printf 'VERIFIKASI GAGAL: file di dalam storage.tar.gz tidak cocok dengan checksum manifest.\n' >&2
        printf 'Tidak ada perubahan yang dilakukan.\n' >&2
        log_event error "checksum isi archive storage GAGAL — backup ditolak" \
          "backupDir=$BACKUP_DIR" "members=$VERIFY_MEMBERS"
        exit 2
      fi
    else
      log_event warn "storage-files.sha256 tidak ada/tidak berisi — isi archive tidak bisa diverifikasi per-file" \
        "backupDir=$BACKUP_DIR"
    fi
  fi
fi

if [ "$DRY_RUN" = "true" ]; then
  case "$STORAGE_STATE" in
    files)
      printf 'Dry-run OK: manifest valid, %s file storage terverifikasi checksumnya.\n' \
        "$VERIFY_MEMBERS"
      ;;
    empty) printf 'Dry-run OK: manifest valid, archive storage kosong (storage kosong saat backup).\n' ;;
    absent) printf 'Dry-run OK: manifest valid, backup ini tidak memuat archive storage.\n' ;;
  esac
  printf 'Dry-run selesai — TIDAK ADA perubahan yang dilakukan.\n'
  log_event info "dry-run selesai — semua checksum valid" "backupDir=$BACKUP_DIR" \
    "storageState=$STORAGE_STATE" "members=$VERIFY_MEMBERS"
  [ -n "$VERIFY_DIR" ] && rm -rf "$VERIFY_DIR"
  exit 0
fi

[ -n "$VERIFY_DIR" ] && rm -rf "$VERIFY_DIR"

# ─── Tools required for the real restore ─────────────────────────────────────

require_tool() {
  local bin="$1" via_var="$2"
  if ! resolve_pg_tool "$bin"; then
    printf 'ERROR: %s tidak ditemukan di PATH dan fallback docker exec juga gagal.\n' "$bin" >&2
    printf 'Petunjuk: install postgresql-client, atau set PG_CONTAINER ke nama container postgres.\n' >&2
    log_event error "alat postgres tidak ditemukan" "tool=$bin" "databaseHost=$DB_HOSTPORT"
    exit 1
  fi
  case "$via_var" in
    PG_DUMP_VIA) PG_DUMP=("${PG_TOOL[@]}"); PG_DUMP_VIA="$PG_TOOL_VIA" ;;
    PG_RESTORE_VIA) PG_RESTORE=("${PG_TOOL[@]}"); PG_RESTORE_VIA="$PG_TOOL_VIA" ;;
    PSQL_VIA) PSQL=("${PG_TOOL[@]}"); PSQL_VIA="$PG_TOOL_VIA" ;;
  esac
}

require_tool pg_dump PG_DUMP_VIA
require_tool pg_restore PG_RESTORE_VIA
require_tool psql PSQL_VIA

# ─── Explicit confirmation — type the database name ──────────────────────────

printf 'Backup : %s\n' "$BACKUP_DIR"
printf 'Target : database "%s" (%s), storage "%s"\n' "$DB_NAME" "$DB_HOSTPORT" "${STORAGE_ROOT:-<unset>}"
if [ "$STORAGE_STATE" = "absent" ]; then
  printf 'Catatan: backup ini TANPA archive storage — hanya database yang direstore.\n'
fi
while true; do
  printf 'Restore akan MENGANTIKAN isi database "%s". Ketik nama database untuk konfirmasi: ' "$DB_NAME"
  CONFIRM=""
  if ! IFS= read -r CONFIRM; then
    printf '\nDibatalkan: tidak ada jawaban (EOF).\n'
    log_event warn "restore dibatalkan — EOF pada prompt konfirmasi" "database=$DB_NAME"
    exit 1
  fi
  [ "$CONFIRM" = "$DB_NAME" ] && break
  if [ -z "$CONFIRM" ]; then
    printf 'Dibatalkan oleh operator.\n'
    log_event warn "restore dibatalkan oleh operator" "database=$DB_NAME"
    exit 1
  fi
  if [ -t 0 ]; then
    printf 'Nama database tidak cocok. Coba lagi.\n'
    log_event warn "konfirmasi tidak cocok — prompt diulang" "database=$DB_NAME"
    continue
  fi
  printf 'Dibatalkan: jawaban tidak cocok ("%s" ≠ "%s").\n' "$CONFIRM" "$DB_NAME"
  log_event warn "restore dibatalkan — konfirmasi tidak cocok" "database=$DB_NAME"
  exit 1
done

# ─── Safety net: snapshot the CURRENT state before any change ────────────────

PRE_REASON="$(date -u +%Y-%m-%dT%H-%M-%SZ)"
PRE_DIR="$BACKUP_DEST/pre-restore/$PRE_REASON"
PRE_STORAGE_DIR="$PRE_DIR-storage"
mkdir -p "$PRE_DIR" "$PRE_STORAGE_DIR" 2>/dev/null || {
  printf 'ERROR: tidak bisa membuat snapshot pra-restore di %s.\n' "$PRE_DIR" >&2
  log_event error "snapshot pra-restore gagal dibuat" "snapshotDir=$PRE_DIR"
  exit 2
}

printf 'Menyimpan snapshot keadaan saat ini ke %s ...\n' "$PRE_DIR"
if ! "${PG_DUMP[@]}" -Fc --no-owner --no-acl "$DB_CLEAN" > "$PRE_DIR/db.dump" 2>/dev/null; then
  printf 'ERROR: snapshot database saat ini gagal — restore DIBATALKAN, tidak ada perubahan.\n' >&2
  log_event error "snapshot database pra-restore gagal" "tool=$PG_DUMP_VIA"
  exit 2
fi
PRE_MEMBERS=()
[ -d "$STORAGE_ROOT/uploads" ] && PRE_MEMBERS+=("uploads")
[ -d "$STORAGE_ROOT/invoices" ] && PRE_MEMBERS+=("invoices")
if [ "${#PRE_MEMBERS[@]}" -gt 0 ]; then
  if ! tar -czf "$PRE_DIR/storage.tar.gz" -C "$STORAGE_ROOT" "${PRE_MEMBERS[@]}" 2>/dev/null; then
    printf 'ERROR: snapshot storage saat ini gagal — restore DIBATALKAN, tidak ada perubahan.\n' >&2
    log_event error "snapshot storage pra-restore gagal" "snapshotDir=$PRE_DIR"
    exit 2
  fi
else
  tar --files-from /dev/null -czf "$PRE_DIR/storage.tar.gz"
fi
( cd "$PRE_DIR" && sha256sum db.dump storage.tar.gz > snapshot.sha256 )
log_event info "snapshot pra-restore dibuat" "snapshotDir=$PRE_DIR"

# rollback_and_fail <reason> — restore the pre-restore state, then exit 2.
rollback_and_fail() {
  local reason="$1" rc=0 sub
  log_event warn "restore gagal — rollback ke kondisi pra-restore" \
    "reason=$reason" "snapshotDir=$PRE_DIR"
  if ! "${PSQL[@]}" "$DB_ADMIN_URL" -c "DROP DATABASE IF EXISTS \"$DB_NAME\" WITH (FORCE)" \
      >/dev/null 2>&1; then rc=1; fi
  if [ "$rc" -eq 0 ]; then
    if ! "${PSQL[@]}" "$DB_ADMIN_URL" -c "CREATE DATABASE \"$DB_NAME\"" >/dev/null 2>&1; then
      rc=1
    fi
  fi
  if [ "$rc" -eq 0 ]; then
    if ! "${PG_RESTORE[@]}" --exit-on-error --no-owner --no-acl \
        -d "$DB_CLEAN" < "$PRE_DIR/db.dump" >/dev/null 2>&1; then
      rc=1
    fi
  fi
  for sub in uploads invoices; do
    if [ -e "$PRE_STORAGE_DIR/$sub" ]; then
      rm -rf "$STORAGE_ROOT/$sub"
      mv "$PRE_STORAGE_DIR/$sub" "$STORAGE_ROOT/$sub" || rc=1
    fi
  done
  if [ "$rc" -ne 0 ]; then
    printf 'ROLLBACK TIDAK SEMPURNA — pulihkan manual dari snapshot: %s\n' "$PRE_DIR" >&2
    log_event error "rollback tidak sempurna — pulihkan manual" "snapshotDir=$PRE_DIR"
  else
    printf 'Rollback selesai: database dan storage kembali ke keadaan sebelum restore.\n'
    log_event info "rollback selesai" "snapshotDir=$PRE_DIR"
  fi
  printf 'RESTORE GAGAL: %s\n' "$reason" >&2
  exit 2
}

# ─── Step 1: prove the dump restores into an isolated scratch database ───────

printf 'Memverifikasi dump ke database test terisolasi "%s" ...\n' "$RESTORE_TEST_DATABASE"
if ! "${PSQL[@]}" "$DB_ADMIN_URL" -c "DROP DATABASE IF EXISTS \"$RESTORE_TEST_DATABASE\" WITH (FORCE)" \
    >/dev/null 2>&1; then
  printf 'ERROR: tidak bisa menyiapkan database test (butuh hak CREATE DATABASE) — tidak ada perubahan.\n' >&2
  log_event error "persiapan database test gagal" "testDatabase=$RESTORE_TEST_DATABASE" \
    "tool=$PSQL_VIA"
  exit 2
fi
if ! "${PSQL[@]}" "$DB_ADMIN_URL" -c "CREATE DATABASE \"$RESTORE_TEST_DATABASE\"" >/dev/null 2>&1; then
  printf 'ERROR: tidak bisa membuat database test (butuh hak CREATE DATABASE) — tidak ada perubahan.\n' >&2
  log_event error "pembuatan database test gagal" "testDatabase=$RESTORE_TEST_DATABASE" \
    "tool=$PSQL_VIA"
  exit 2
fi
SCRATCH_ERR="$(mktemp)"
if ! "${PG_RESTORE[@]}" --exit-on-error --no-owner --no-acl \
    -d "${DB_CLEAN%/*}/$RESTORE_TEST_DATABASE" < "$BACKUP_DIR/db.dump" 2> "$SCRATCH_ERR"; then
  log_event error "restore ke database test gagal — dump tidak valid, produksi tidak disentuh" \
    "testDatabase=$RESTORE_TEST_DATABASE" "error=$(redact "$(head -c 500 "$SCRATCH_ERR")")"
  rm -f "$SCRATCH_ERR"
  "${PSQL[@]}" "$DB_ADMIN_URL" -c "DROP DATABASE IF EXISTS \"$RESTORE_TEST_DATABASE\" WITH (FORCE)" \
    >/dev/null 2>&1 || true
  printf 'ERROR: dump tidak bisa direstore ke database test — produksi TIDAK disentuh.\n' >&2
  exit 2
fi
rm -f "$SCRATCH_ERR"
log_event info "dump terbukti restorable di database test terisolasi" \
  "testDatabase=$RESTORE_TEST_DATABASE"

# The scratch database must be gone before the production drop (a connected
# database cannot be dropped).
"${PSQL[@]}" "$DB_ADMIN_URL" -c "DROP DATABASE IF EXISTS \"$RESTORE_TEST_DATABASE\" WITH (FORCE)" \
  >/dev/null 2>&1 || true

# ─── Step 2: overwrite the production database ───────────────────────────────

printf 'Mengembalikan database "%s" dari backup ...\n' "$DB_NAME"
if ! "${PSQL[@]}" "$DB_ADMIN_URL" -c "DROP DATABASE IF EXISTS \"$DB_NAME\" WITH (FORCE)" \
    >/dev/null 2>&1; then
  printf 'ERROR: tidak bisa menghapus database lama (masih ada koneksi? stop app dulu) — tidak ada perubahan.\n' >&2
  log_event error "drop database produksi gagal — stop app dulu" "database=$DB_NAME"
  exit 2
fi
if ! "${PSQL[@]}" "$DB_ADMIN_URL" -c "CREATE DATABASE \"$DB_NAME\"" >/dev/null 2>&1; then
  rollback_and_fail "CREATE DATABASE produksi gagal setelah DROP"
fi
PROD_ERR="$(mktemp)"
if ! "${PG_RESTORE[@]}" --exit-on-error --no-owner --no-acl \
    -d "$DB_CLEAN" < "$BACKUP_DIR/db.dump" 2> "$PROD_ERR"; then
  PROD_REASON="$(redact "$(head -c 500 "$PROD_ERR")")"
  rm -f "$PROD_ERR"
  rollback_and_fail "pg_restore database produksi gagal: $PROD_REASON"
fi
rm -f "$PROD_ERR"
log_event info "restore database selesai" "database=$DB_NAME"

# ─── Step 3: extract storage (current files moved into the snapshot first) ───

if [ "$STORAGE_STATE" = "files" ]; then
  mkdir -p "$STORAGE_ROOT"
  for sub in uploads invoices; do
    if [ -e "$STORAGE_ROOT/$sub" ]; then
      rm -rf "$PRE_STORAGE_DIR/$sub"
      mv "$STORAGE_ROOT/$sub" "$PRE_STORAGE_DIR/$sub"
    fi
  done
  if ! tar -xzf "$STORAGE_ARCHIVE" -C "$STORAGE_ROOT"; then
    rollback_and_fail "ekstraksi storage.tar.gz gagal"
  fi
  log_event info "restore file storage selesai" "storageRoot=$STORAGE_ROOT" \
    "members=$VERIFY_MEMBERS"
elif [ "$STORAGE_STATE" = "empty" ]; then
  for sub in uploads invoices; do
    if [ -e "$STORAGE_ROOT/$sub" ]; then
      rm -rf "$PRE_STORAGE_DIR/$sub"
      mv "$STORAGE_ROOT/$sub" "$PRE_STORAGE_DIR/$sub"
    fi
  done
  log_event info "backup berasal dari storage kosong — storage kosong direstore" \
    "storageRoot=$STORAGE_ROOT"
else
  log_event warn "backup tanpa archive storage — storage dibiarkan apa adanya" \
    "storageRoot=$STORAGE_ROOT"
fi

# ─── Step 4: post-restore verification — corruption must fail (exit 2) ───────

if ! ( cd "$BACKUP_DIR" && sha256sum -c --quiet manifest.sha256 >/dev/null 2>&1 ); then
  rollback_and_fail "backup berubah selama proses restore (manifest checksum)"
fi
if [ "$STORAGE_MANIFEST_USABLE" = "true" ]; then
  if ! ( cd "$STORAGE_ROOT" && sha256sum -c --quiet "$STORAGE_MANIFEST" >/dev/null 2>&1 ); then
    rollback_and_fail "checksum file storage yang sudah direstore tidak cocok (file korup)"
  fi
  log_event info "verifikasi checksum pasca-restore valid" "members=$VERIFY_MEMBERS" \
    "storageRoot=$STORAGE_ROOT"
elif [ "$STORAGE_STATE" = "files" ]; then
  log_event warn "storage-files.sha256 tidak ada/tidak berisi — verifikasi checksum per-file dilewati" \
    "backupDir=$BACKUP_DIR"
fi
DB_TABLES="$("${PSQL[@]}" "$DB_CLEAN" -tAc "SELECT count(*) FROM pg_catalog.pg_tables WHERE schemaname = 'public'" 2>/dev/null | tr -d '[:space:]')" \
  || rollback_and_fail "probe koneksi ke database hasil restore gagal"
log_event info "probe database hasil restore valid" "database=$DB_NAME" "publicTables=$DB_TABLES"

# ─── Summary ─────────────────────────────────────────────────────────────────

log_event info "restore selesai dan terverifikasi" "backupDir=$BACKUP_DIR" \
  "database=$DB_NAME" "storageRoot=$STORAGE_ROOT" "storageState=$STORAGE_STATE" \
  "members=$VERIFY_MEMBERS" "snapshotDir=$PRE_DIR" "snapshotStorageDir=$PRE_STORAGE_DIR"

printf '\nRestore selesai dan terverifikasi.\n'
printf '1. Start kembali aplikasi (mis. docker compose start app).\n'
printf '2. Periksa /health dan login — pastikan aplikasi normal.\n'
printf '3. Snapshot keadaan SEBELUM restore tersimpan di: %s\n' "$PRE_DIR"
printf '   (storage lama di %s). Hapus setelah yakin — keduanya ikut rotasi retention.\n' \
  "$PRE_STORAGE_DIR"
exit 0
