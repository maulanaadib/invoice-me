# invoice-me

Platform invoice self-hosted multi-tenant untuk membuat, mengelola, dan
mengekspor invoice profesional (Down Payment, Pelunasan, Full, Termin) dengan
live preview A4 dan ekspor PDF. Dibangun untuk pemakaian internal
multi-organization, dirancang untuk bisa dipublikasikan sebagai SaaS
self-hosted.

## Stack

- **Next.js** (App Router) + TypeScript strict + Tailwind + shadcn/ui
- **Prisma** + **PostgreSQL 16**
- **Better Auth** (username/email, tanpa pendaftaran publik)
- **decimal.js** untuk uang; **Vitest** + **Playwright** untuk test
- **pdf-service terpisah** (Playwright Chromium, request internal bertanda tangan)
- **Docker Compose** (app + postgres + pdf-service), deploy target **Coolify**

## Dokumen Legal

Halaman publik `/privacy` (Kebijakan Privasi, UU PDP) dan `/terms`
(Syarat & Ketentuan) tersedia tanpa login. Banner cookie consent muncul
di setiap halaman (hanya cookie sesi esensial yang aktif saat ini).

## Deployment di Coolify

### Prasyarat

- Server dengan **Docker** + **Docker Compose** (Coolify sudah menyediakannya).
- Domain atau IP yang bisa diakses (untuk `APP_URL`).
- Akses GitHub ke repo `maulanaadib/invoice-me`.

### Langkah

1. **Create project** di Coolify → beri nama `invoice-me`.
2. **Link repo** `maulanaadib/invoice-me`, branch `main`.
3. **Pilih Docker Compose** sebagai sumber (bukan Dockerfile langsung) —
   `docker-compose.yml` ada di root repo. Coolify akan mem-build 3 service:
   `app`, `postgres`, `pdf-service`.
4. **Set environment variables** (lihat tabel di bawah) di dashboard Coolify —
   jangan commit nilai produksi ke repo.
5. **Deploy** — Coolify akan `docker compose up -d --build` dari bersih.
6. **Verify** — buka `https://<domain-anda>/health` → harus merespons
   `{ "status": "ok", ... }` (200). Cek juga `docker compose ps` → semua
   service `healthy`.
7. **First login** — buka `https://<domain-anda>/login`, masuk dengan akun
   super admin (dibuat dari `SEED_ADMIN_*`), **segera ganti password**.
8. **Backup & maintenance** — lihat bagian terkait di README ini.

### Environment Variables (Produksi)

Semua nilai di-set di dashboard Coolify, tidak di repo.

| Variable | Value | Notes |
| --- | --- | --- |
| `NODE_ENV` | `production` | |
| `APP_URL` | `https://<domain>` | Public base URL |
| `APP_PORT` | `3000` | |
| `DATABASE_URL` | `postgresql://<user>:<pass>@postgres:5432/invoice_me?schema=public` | |
| `BETTER_AUTH_SECRET` | `openssl rand -base64 32` | |
| `BETTER_AUTH_URL` | `https://<domain>` | Sama dengan APP_URL |
| `INTERNAL_PDF_SECRET` | `openssl rand -base64 32` | |
| `INTERNAL_APP_URL` | `http://app:3000` | |
| `PDF_SERVICE_URL` | `http://pdf-service:3001` | |
| `PDF_WORKER_ENABLED` | `true` | |
| `STORAGE_ROOT` | `/data` | |
| `UPLOAD_MAX_MB` | `2` | |
| `DEFAULT_TIMEZONE` | `Asia/Jakarta` | |
| `SEED_ADMIN_USERNAME` | `admin` | Set sekali, ganti setelah login |
| `SEED_ADMIN_EMAIL` | `admin@example.com` | |
| `SEED_ADMIN_PASSWORD` | `openssl rand -base64 16` | **Ganti setelah first login** |
| `BANK_ACCOUNT_ENCRYPTION_KEY` | `openssl rand -base64 32` | AES-256-GCM |
| `GLITCHTIP_DSN` | *(opsional)* | Self-hosted GlitchTip |
| `CLOUDFLARE_TUNNEL_TOKEN` | *(opsional)* | Hanya untuk profile `cloudflared` |

Script-only (tidak dibaca app):

| Variable | Default | Notes |
| --- | --- | --- |
| `BACKUP_DEST` | `/backups` | Mount sebagai volume persistent |
| `BACKUP_RETENTION_DAYS` | `30` | |
| `BACKUP_EXTERNAL_PATH` | *(unset)* | NAS/external mount — **sangat disarankan** |
| `PG_CONTAINER` | *(auto)* | Container postgres untuk fallback `docker exec` |
| `RESTORE_TEST_DATABASE` | `invoice_me_restore_check` | |

### Migration & Seed

- **Migration** dijalankan otomatis saat container app start (`prisma migrate deploy`
  di entrypoint) — lihat `docker-entrypoint.sh`.
- **Seed** (`prisma/seed.mjs`) juga dijalankan otomatis saat
  `SEED_ADMIN_PASSWORD` ter-set. Seed **idempotent** — run ulang tidak error,
  tidak duplikat. Berisi: super admin + acceptance sample (Sigit Berkarya,
  profile SB, customer PT Dharma Polimetal Tbk, PO 5198021181,
  invoice DP 50% `INV/SB/VII/2026/001`).
- Jika `SEED_ADMIN_PASSWORD` kosong, seed dilewati (production tanpa
  credentials seed tetap boot normal — migration tetap jalan).

### First Login

1. Buka `https://<domain>/login`.
2. Masuk dengan `SEED_ADMIN_USERNAME` / `SEED_ADMIN_PASSWORD`.
3. **Segera ganti password** via menu profil → Ubah Kata Sandi.
4. Buat organisasi & profil invoice via onboarding wizard (12 langkah).

## Local Development

```bash
# 1. Install dependencies
npm install

# 2. Copy .env.example → .env.local, isi nilai dev
cp .env.example .env.local

# 3. Start postgres (compose dev)
docker compose -f docker-compose.dev.yml up -d

# 4. Jalankan migration
npx prisma migrate deploy

# 5. (Opsional) Seed data acceptance
node prisma/seed.mjs

# 6. Start dev server
npm run dev
```

Buka [http://localhost:3000](http://localhost:3000).

### Menjalankan Test

```bash
npm run test        # Vitest unit + integration
npm run test:e2e    # Playwright E2E (butuh dev server + postgres)
```

Test environment (`tests/test.env`) memakai database terpisah
`invoice_me_test` — test tidak pernah menyentuh database dev.

## Backup and Restore

Lihat bagian **Backup and Restore** di bawah untuk panduan lengkap
(README 11B). Singkatnya:

```bash
scripts/backup.sh                      # buat backup
scripts/restore.sh --dry-run <dir>     # verifikasi, tanpa perubahan
scripts/restore.sh --test-db <dir>     # latihan restore ke DB terisolasi
scripts/restore.sh <dir>               # restore nyata (butuh downtime)
```

## Rotating the Bank Account Encryption Key

Lihat bagian **Rotating the Bank Account Encryption Key** di bawah
(README fitur 10).

## Maintenance Jobs

`scripts/maintenance.sh` (feature 11A): orphan file cleanup + overdue
recompute batched. Idempoten, output JSON terstruktur.

```bash
scripts/maintenance.sh
```

Scheduling via Coolify Scheduled Task atau host cron — lihat
bagian Maintenance di bawah.

## Troubleshooting

- **App tidak start** — cek `docker compose logs app` → biasanya env var
  wajib hilang (fail-fast di `src/server/env.ts`).
- **PDF gagal render** — pastikan `INTERNAL_PDF_SECRET` sama antara app dan
  pdf-service; cek `docker compose logs pdf-service`.
- **Migration error** — cek `docker compose logs app` saat startup;
  `prisma migrate deploy` log muncul di entrypoint.
- **Backup gagal** — lihat exit code & JSON log di stderr; pastikan
  `BACKUP_DEST` writable dan `postgresql-client` / `PG_CONTAINER` ter-configure.

---

## Rotating the bank account encryption key

Bank account numbers are encrypted at rest (AES-256-GCM) with a key derived
from `BANK_ACCOUNT_ENCRYPTION_KEY` (SHA-256 of the secret, stored value format
`iv:tag:ciphertext`). To rotate the key — for example after a secret leak or a
scheduled rotation in Coolify:

```bash
# 1. Pick a new secret (≥ 32 characters) and re-encrypt every stored number:
NEW_BANK_ACCOUNT_ENCRYPTION_KEY="<new-secret-with-at-least-32-chars>" \
  scripts/rotate-bank-key.sh

# 2. Put the new secret in your environment as BANK_ACCOUNT_ENCRYPTION_KEY
#    (Coolify dashboard in production, .env.local in development) and restart
#    the app.
```

The script reads `DATABASE_URL` and the current key from the app's env files
(`.env` / `.env.local`); set `OLD_BANK_ACCOUNT_ENCRYPTION_KEY` explicitly if
your old key is not in those files. It decrypts each row with the old key,
re-encrypts with the new key, verifies the round-trip **before** writing, and
never prints a plaintext number or a key. Rows already on the new key are
skipped, so the script is safe to re-run. This is a maintenance script — the
app itself has no UI for rotation.

## Backup and restore

Two scripts back up and restore the entire instance: the PostgreSQL database
**and** the file storage (uploads + generated invoice PDFs).

```bash
scripts/backup.sh                      # create a backup
scripts/restore.sh --dry-run <dir>     # verify a backup, change nothing
scripts/restore.sh --test-db <dir>     # restore into an isolated check DB only
scripts/restore.sh <dir>               # full restore (with downtime)
```

### What a backup contains

Each run writes one timestamped directory (ISO-8601 UTC) under `BACKUP_DEST`
(default `/backups`):

```
/backups/2026-10-10T02-00-00Z/
├── db.dump               # pg_dump --format=custom (compressed, --no-owner --no-acl)
├── storage.tar.gz        # tar.gz of $STORAGE_ROOT/{uploads,invoices}
├── storage-files.sha256  # sha256 of every file inside the storage archive
├── manifest.json         # metadata: timestamp, database, sizes, per-file sha256
└── manifest.sha256       # sha256 of all of the above (the tamper seal)
```

`manifest.sha256` covers every artifact **and** `manifest.json` itself, so any
modification — of a file or of the manifest — is detected before a restore
touches anything.

### Configuration

All optional; the scripts read the same `.env` / `.env.local` the app reads,
and variables set by the caller always win.

| Variable | Default | Purpose |
| --- | --- | --- |
| `BACKUP_DEST` | `/backups` | Where backup directories are written (mount this as a persistent volume). |
| `BACKUP_RETENTION_DAYS` | `30` | Backups older than this are deleted on each successful run (minimum 1). Applies to pre-restore snapshots too. |
| `BACKUP_EXTERNAL_PATH` | *(unset)* | If set, every backup is also copied there (rsync when available, `cp -a` otherwise) — see "a second copy" below. |
| `PG_CONTAINER` | *(auto)* | Postgres container name for the `docker exec` fallback; auto-detected from `DATABASE_URL` when unset. |
| `PG_DUMP_BIN` / `PG_RESTORE_BIN` / `PSQL_BIN` | *(unset)* | Full command overrides when the tools live somewhere unusual. |
| `RESTORE_TEST_DATABASE` | `invoice_me_restore_check` | Isolated database used to prove a dump restores before production is touched. |

The scripts need `pg_dump` / `pg_restore` / `psql`. They resolve the tools in
this order: explicit `PG_*_BIN` override → binaries on the host `PATH` →
`docker exec` into the postgres container (matching the published port for
`localhost` URLs, the container name otherwise). On a host that only has
Docker — the usual ZimaOS/Coolify situation — the fallback means the scripts
work out of the box.

### Scheduling

**Host cron (recommended on ZimaOS/Coolify hosts):**

```cron
# Daily at 02:00 — scripts resolve pg tools via docker exec automatically.
0 2 * * * cd /path/to/invoice-me && BACKUP_DEST=/backups scripts/backup.sh >> /var/log/invoice-me-backup.log 2>&1
```

**Coolify scheduled task:** create a "Command" task (daily) running
`scripts/backup.sh` from the repository checkout on the host. Note the task
must run somewhere the scripts exist **and** PostgreSQL tools are reachable —
the app image does not ship `postgresql-client`; either run the task via host
cron as above, or add `postgresql-client` to the image (deploy concern,
feature 11C).

### A backup on the same disk is not a final backup

If the host disk dies, both the database volume **and** `/backups` die with
it. Always copy backups to another device — a NAS, another machine, or object
storage. Set `BACKUP_EXTERNAL_PATH` to a mount on another device and every
run is copied there automatically; alternatively pull from elsewhere:

```bash
# From your NAS, every night: pull the newest backup off the app host.
rsync -av --delete host:/backups/ /mnt/nas/invoice-me-backups/
```

Check that the external copy actually arrives (monitor the
`backup disalin ke penyimpanan eksternal` log line, or the exit code — a
failed external copy makes the run exit `1` instead of `0`).

### Restoring

1. **Verify first** — `scripts/restore.sh --dry-run <backup-dir>` checks every
   checksum (manifest + each file inside the storage archive) and changes
   nothing. Run it whenever you suspect a backup, and periodically to prove
   your backups are restorable.
2. **(Optional) rehearse into an isolated database** —
   `scripts/restore.sh --test-db <backup-dir>` rebuilds the check database
   (`RESTORE_TEST_DATABASE`, default `invoice_me_restore_check`) from the dump
   and extracts storage into a temporary directory, verifying both. The
   production database and `STORAGE_ROOT` are never touched; the check
   database is kept afterwards so you can inspect it.
3. **Stop the app** — a restore replaces the database, so the app must be
   down: `docker compose stop app` (or stop the Coolify service).
4. **Restore** — `scripts/restore.sh <backup-dir>`. The script asks you to
   **type the database name** as confirmation (pipe it in automation:
   `echo "invoice_me" | scripts/restore.sh <dir>`). Then it:
   - snapshots the current database + storage to
     `$BACKUP_DEST/pre-restore/<timestamp>*` **before changing anything**;
   - proves the dump restores into the isolated `RESTORE_TEST_DATABASE`
     first — a broken dump aborts here with production untouched;
   - overwrites the database, extracts the storage archive, and verifies
     every restored file against `storage-files.sha256`.
5. **Start the app** — `docker compose start app`, then check `/health` and
   log in.

Exit codes: `0` success · `1` aborted before any change (declined
confirmation, tool missing) · `2` fatal — a failed verification or restore is
**rolled back** from the pre-restore snapshot automatically; if the rollback
itself cannot complete, the script prints the snapshot path for manual
recovery. The snapshot is kept after a successful restore and follows the
same retention rotation; delete it once you have confirmed the app is
healthy.

### Troubleshooting

- **`pg_restore: error: invalid URI query parameter: "schema"`** — you are
  invoking the tools by hand with the app's Prisma URL. The scripts strip
  `?schema=public` automatically; when calling `pg_dump`/`psql` yourself, use
  the URL without the query string.
- **`pg_dump: error: server version mismatch` / `pg_restore: error: aborting
  because of server version mismatch`** — the client is newer than the server
  (PostgreSQL refuses a dump from a newer major client). Use tools matching
  the server (this project runs PostgreSQL 16): the `docker exec` fallback
  uses the container's own client and never hits this.
- **`permission denied to create database`** — the restore verifies dumps in
  an isolated database and rebuilds the target database, so the `DATABASE_URL`
  role needs `CREATEDB` (the default compose/Coolify role has it).
- **`pg_dump: command not found` and the docker fallback also fails** — no
  `postgresql-client` on the host and no reachable postgres container. Install
  the client, or set `PG_CONTAINER` (or `PG_DUMP_BIN`) explicitly.
- **`BACKUP_DEST tidak bisa ditulis`** — the directory does not exist or the
  user running the script cannot write there; on Docker hosts mount it as a
  volume and mind the file permissions.

## Maintenance Jobs

`scripts/maintenance.sh` (feature 11A) performs two idempotent sweeps:

1. **Orphan file cleanup** — walks `STORAGE_ROOT` (`uploads/` + `invoices/`)
   and deletes files not referenced by any database column (`UploadRecord.path`,
   `InvoicePdf.storagePath`, `Invoice.pdfPath`, `ProjectReference.attachmentPath`,
   `InvoiceProfile.logoPath`, `Signer.signatureImagePath`, `Payment.proofPath`).
   Hidden files (`.health-check`) are skipped; per-file failures do not abort
   the sweep.
2. **Overdue recompute (batched)** — updates `status` from `ISSUED`/`SENT`/
   `PARTIALLY_PAID` to `OVERDUE` where `dueDate < startOfTodayJakarta`, in
   batches of 100, stopping on no-progress/partial batch.

Output: JSON per event to stderr. Exit codes: `0` success, `1` partial,
`1` fatal. Idempotent — a second run reports `deleted:0, updated:0`.

### Scheduling

**Coolify scheduled task** or **host cron** (daily, e.g. 03:30):

```cron
30 3 * * * cd /path/to/invoice-me && scripts/maintenance.sh >> /var/log/invoice-me-maintenance.log 2>&1
```

## Learn More

- [Next.js Documentation](https://nextjs.org/docs) — learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) — an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) — your feedback and contributions are welcome!
