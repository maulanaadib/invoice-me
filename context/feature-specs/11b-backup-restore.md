# Feature 11B: Backup & Restore Script

> **Parent:** Feature 11 (audit-backup-deploy-final). Bagian 2 dari 3 — li juga 11A (audit + maintenance) dan 11C (deploy, legal, seed, final acceptance). Setelah tiga sub-feature selesai, feature 11 complete.

## Goal

Backup script yang benar-benar bisa dipakai di produksi ZimaOS/Coolify: `pg_dump` compressed, archive uploads + PDFs, checksum, retention configurable, plus restore script dengan konfirmasi eksplisit dan verifikasi checksum. Setelah feature ini, data aman dan bisa direstore tanpa menebak-nebak.

## Design

- **`scripts/backup.sh`**: `pg_dump` compressed (`--format=custom` atau `gzip`), archive uploads + PDFs dari storage volume, checksum (sha256) per file + manifest, timestamp ISO 8601, retention configurable (env `BACKUP_RETENTION_DAYS`, default 30), output ke `/backups` volume.
- **`scripts/restore.sh`**: konfirmasi eksplisit (prompt "ketik nama database untuk konfirmasi"), restore db, restore file, verifikasi checksum setelah restore, petunjuk downtime + urutan service (stop app → restore → start).
- **Dokumentasi**: backup di disk ZimaOS/Coolify yang sama **bukan backup final** — beri opsi copy ke NAS/external (rsync ke path configurable via `BACKUP_EXTERNAL_PATH`).

## Implementation

1. **Backup script** full implementation (replace feature 00 stub):
   - `pg_dump` dengan `--no-owner --no-acl` (portable across instances), compressed.
   - `tar` uploads + PDFs, `sha256sum` manifest.
   - Rotation: hapus backup lebih tua dari `BACKUP_RETENTION_DAYS`, log yang dihapus.
   - Exit code jelas: 0 sukses, 1 partial, 2 fatal. Log terstruktur ke stderr.
2. **Restore script**:
   - Dry-run mode (`--dry-run`): verifikasi checksum + manifest saja, tidak ada perubahan.
   - Konfirmasi eksplisit untuk restore db (prompt interaktif; di CI/test bisa piped).
   - Restore ke test DB untuk verifikasi (isolated, bukan production).
   - Verifikasi checksum post-restore; gagal = rollback + exit 2.
3. **README dokumentasi**: section backup/restore — cara jadwalkan (Coolify scheduled task / cron), di mana output, catatan "disk yang sama bukan backup final", opsi NAS/external rsync, troubleshoot umum (pg_restore version mismatch, permission).

## Dependencies

- Feature 00 (docker-compose volumes: uploads, PDFs, postgres-data — path yang di-backup).
- `data-model.md` untuk storage layout.

## Scope Limits

- **Tidak** ada automated restore test ke DB live — hanya dry-run verify checksum + restore ke isolated test DB (verifikasi script berfungsi, bukan test production data).
- **Tidak** ada incremental backup — full backup saja (defer; dokumentasi catat sebagai open question).
- **Tidak** ada backup encryption at rest — filesystem/ZimaOS-level (defer).
- **Tidak** ada UI backup status — script + README saja.

## Check When Done

- [ ] `scripts/backup.sh` jalan: pg_dump compressed + archive uploads+PDFs + checksum + timestamp.
- [ ] Retention delete old backup berfungsi (seed 3 backup dengan timestamp berbeda, jalankan, yang lama terhapus sesuai retention).
- [ ] `scripts/restore.sh` dry-run: verifikasi checksum + konfirmasi eksplisit; restore db ke test DB berhasil (isolated test, bukan production).
- [ ] Checksum verification post-restore: file corrupt terdeteksi (test dengan manifest yang di-tamper → exit 2).
- [ ] Backup dengan DB kosong + storage kosong tetap sukses (edge case, bukan crash).
- [ ] README dokumentasi backup + catatan "backup di disk yang sama bukan backup final" + opsi NAS/external.

## Commit and Push

1. Every item in `Check When Done` passes.
2. Tests pass (`npm run test`).
3. Lint and typecheck pass (`npm run lint`, `npm run typecheck`).
4. Ask which branch: **`main`** (recommended) atau new branch. Never commit silently.
5. Commit: `feat(11b): backup/restore script with checksum verification + retention`.
6. Push. Never force push.

## Progress Tracker

Update `context/progress-tracker.md`: tandai 11B selesai, next 11C.
