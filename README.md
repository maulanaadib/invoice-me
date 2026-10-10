This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

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
2. **Stop the app** — a restore replaces the database, so the app must be
   down: `docker compose stop app` (or stop the Coolify service).
3. **Restore** — `scripts/restore.sh <backup-dir>`. The script asks you to
   **type the database name** as confirmation (pipe it in automation:
   `echo "invoice_me" | scripts/restore.sh <dir>`). Then it:
   - snapshots the current database + storage to
     `$BACKUP_DEST/pre-restore/<timestamp>*` **before changing anything**;
   - proves the dump restores into the isolated `RESTORE_TEST_DATABASE`
     first — a broken dump aborts here with production untouched;
   - overwrites the database, extracts the storage archive, and verifies
     every restored file against `storage-files.sha256`.
4. **Start the app** — `docker compose start app`, then check `/health` and
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

## Backup and restore

Two companion scripts protect the whole application state — the PostgreSQL
database and the storage volume (`uploads/` and official `invoices/` PDFs
under `STORAGE_ROOT`):

```bash
scripts/backup.sh                    # one full backup run
scripts/restore.sh --dry-run <dir>   # verify a backup — changes nothing
scripts/restore.sh <dir>             # real restore (requires downtime)
```

### Where the output goes

Each run of `scripts/backup.sh` writes exactly one directory under
`BACKUP_DEST` (default `/backups`; a relative path is resolved against the
repo root):

```
/backups/2026-10-10T03-15-00Z/
  db.dump               pg_dump --format=custom --no-owner --no-acl
  storage.tar.gz        tar.gz of $STORAGE_ROOT/{uploads,invoices}
  storage-files.sha256  sha256 of every file inside the storage archive
  manifest.json         run metadata (timestamp, database, sizes, hashes)
  manifest.sha256       sha256 of the artifacts + manifest.json
```

The manifest is self-verified before the run is accepted, so a corrupt run is
thrown away instead of being kept as a "backup". Structured JSON logs go to
stderr (passwords and URLs are never logged); human prompts go to stdout.

Configuration (env vars; the scripts load `.env` / `.env.local` themselves,
and values already set by the caller win):

| Variable | Default | Meaning |
| --- | --- | --- |
| `BACKUP_DEST` | `/backups` | Where backup directories are written |
| `BACKUP_RETENTION_DAYS` | `30` | Backups older than this are deleted after each successful run |
| `BACKUP_EXTERNAL_PATH` | *(unset)* | Optional NAS/external directory for a copy of every backup |
| `STORAGE_ROOT` | from env files | Storage volume that gets archived |
| `PG_CONTAINER` | *(auto)* | Postgres container name, when `pg_dump` is not on the host `PATH` |

Exit codes: `0` success · `1` partial (a usable backup was kept, but a
best-effort step failed — storage archive, external copy or retention) ·
`2` fatal (no usable backup).

### Scheduling

The scripts are self-contained (they resolve their own env file and relative
paths), so they can run unattended:

- **Coolify scheduled task** — add a Scheduled Task on the app service that
  runs `scripts/backup.sh` (for example daily at 03:00). The task only needs
  the repo/working directory and the `BACKUP_DEST` volume mounted; no long
  running process is involved.
- **Host cron** — classic crontab entry on the machine running the stack:

  ```cron
  0 3 * * * cd /path/to/invoice-me && scripts/backup.sh >> /var/log/invoice-me-backup.log 2>&1
  ```

Rotate according to `BACKUP_RETENTION_DAYS` (default: keep 30 days); every
run also deletes backups and pre-restore snapshots older than that and logs
what it removed.

### A backup on the same disk is not a final backup

`BACKUP_DEST` lives on the same machine/volume as the database and uploads.
That protects you against a mistaken delete or a bad migration — it does
**not** protect you against disk failure, host loss, ransomware, or losing
the whole box. Treat local backups as a working copy only.

### Copying to a NAS or external disk (`BACKUP_EXTERNAL_PATH`)

Set `BACKUP_EXTERNAL_PATH` to a directory on another device (NAS mount,
external disk, another host) and every run is copied there with `rsync`
(falling back to `cp -a` when `rsync` is unavailable):

```bash
BACKUP_EXTERNAL_PATH=/mnt/nas/invoice-me-backups scripts/backup.sh
```

A failed copy never destroys the local backup — the run exits `1` (partial)
and the local directory stays intact. Alternatively, sync the whole
destination yourself from a separate cron entry:

```cron
30 3 * * * rsync -a /backups/ /mnt/nas/invoice-me-backups/
```

### Restoring

1. **Verify first** (no changes at all):

   ```bash
   scripts/restore.sh --dry-run /backups/2026-10-10T03-15-00Z
   ```

   This checks `manifest.sha256` and every file inside `storage.tar.gz`.
   A tampered or corrupt backup fails with exit code `2`.
2. **Restore** during a maintenance window, in this order — **stop app →
   restore → start app** (the database and the files must not be written
   while they are replaced):

   ```bash
   scripts/restore.sh /backups/2026-10-10T03-15-00Z
   ```

   The script snapshots the current state to `$BACKUP_DEST/pre-restore/`
   before touching anything, proves the dump restores into an isolated
   scratch database (`RESTORE_TEST_DATABASE`, default
   `invoice_me_restore_check`), and only then overwrites production. It
   then re-verifies the checksums of the restored data. Any failure rolls
   back from the pre-restore snapshot and exits `2`.
3. The script asks you to **type the target database name exactly** to
   confirm — piped input works for automation, but a wrong answer aborts
   before any change (exit `1`).

### Troubleshooting

- **`pg_dump` / `pg_restore` version mismatch** — the dump is custom format
  (`-Fc`), which older clients cannot read: `pg_restore: error: input file is
  too complex` or `unsupported version` means the client is older than the
  server. Restore with a client ≥ the server's major version (or run the
  script where the matching `pg_restore` exists — it automatically falls
  back to `docker exec` in the postgres container). Never dump with a client
  much newer than the server you restore into.
- **Permissions** — `BACKUP_DEST` must be writable by the user running the
  script (`fatal: BACKUP_DEST tidak bisa ditulis`); on Coolify make sure the
  volume/directory is mounted into the task and owned by the runtime user.
  The same applies to `STORAGE_ROOT` (read) and `BACKUP_EXTERNAL_PATH`
  (write) — an unwritable external path makes the run exit `1`, not `0`.
- **`pg_dump tidak ditemukan`** — install `postgresql-client` on the host,
  set `PG_CONTAINER` to the postgres container name, or set `PG_DUMP_BIN` to
  an explicit binary/command.
- **Exit code 1 vs 2** — `1` means a usable backup exists but a best-effort
  step failed (check the JSON log for the `warn` event); `2` means no usable
  backup was produced and the partial directory was removed.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
