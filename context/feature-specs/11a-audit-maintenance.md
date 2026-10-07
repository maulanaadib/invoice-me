# Feature 11A: Audit Gap Fill & Maintenance Jobs

> **Parent:** Feature 11 (audit-backup-deploy-final). Bagian 1 dari 3 — li juga 11B (backup/restore) dan 11C (deploy, legal, seed, final acceptance). Setelah tiga sub-feature selesai, feature 11 complete.

## Goal

Tutup audit log ke 22 action (verifikasi + gap fill emit point di setiap modul) dan tambahkan maintenance job operasional: orphan file cleanup + recompute massal OVERDUE invoice. Setelah feature ini, audit log lengkap dan operasional harian jalan tanpa intervensi manual.

## Design

- **Audit log 22 action** — enum `AuditAction` saat ini vs daftar canonical, grep codebase untuk emit point setiap action, tambah yang terlewat:
  LOGIN_SUCCESS, LOGIN_FAILED, LOGOUT, USER_CREATED, USER_SUSPENDED, PASSWORD_RESET, ORGANIZATION_CREATED, MEMBERSHIP_CHANGED, PROFILE_CHANGED, CUSTOMER_CREATED, CUSTOMER_UPDATED, CUSTOMER_DELETED, PROJECT_CREATED, PROJECT_UPDATED, INVOICE_DRAFT_CREATED, INVOICE_UPDATED, INVOICE_ISSUED, PDF_GENERATED, PDF_DOWNLOADED, INVOICE_SENT, INVOICE_CANCELLED, INVOICE_REVISED, PAYMENT_RECORDED, ADMIN_VIEWED_INVOICE.
- **Maintenance script** (`scripts/maintenance.sh` atau internal cron-style): hapus orphan file (file di storage yang tidak ada record-nya), recompute OVERDUE status invoice massal (where due_date < now AND status in ISSUED/SENT/PARTIALLY_PAID), log output terstruktur. Schedule via Coolify scheduled task atau host cron.

## Implementation

1. **Audit gap audit**: enum `AuditAction` + grep codebase untuk emit point setiap action; tambah yang hilang. Emit point harus di tempat yang tepat (service layer, bukan UI), dengan metadata yang konsisten.
2. **Maintenance script**: orphan cleanup (scan storage vs DB record — record di context/data-model.md), overdue recompute batched (batch 100, log count), idempotent.
3. **Unit test** untuk overdue recompute (invoice tepat due_date boundary tetap ISSUED, invoice lewat jadi OVERDUE, invoice PAID/CANCELLED tidak tersentuh).
4. **Integration test** orphan cleanup (seed orphan file di storage, jalankan, verifikasi terhapus; file dengan record tetap aman).

## Dependencies

- Feature 09 (audit log viewer — menampilkan semua action dengan filter, sebagai alat verifikasi gap fill).
- `data-model.md` untuk AuditAction enum + storage layout.

## Scope Limits

- **Tidak** ubah audit log viewer UI itu sendiri — feature 09. Di sini hanya pastikan action baru muncul di viewer (test saja).
- **Tidak** ada audit retention policy — keep forever default (feature 11 scope limits).
- **Tidak** ada schedule otomatis Coolify di sini — script-nya saja, scheduling konfigurasi deploy (feature 11C).
- **Tidak** ada audit metadata PII — password/token/rekening lengkap tidak boleh masuk audit metadata (verifikasi sample tetap di 11C final acceptance).

## Check When Done

- [ ] Semua 22+ `AuditAction` punya emit point di codebase (grep bukti untuk setiap action).
- [ ] Audit log viewer feature 09 menampilkan semua action dengan filter (verifikasi dengan action yang baru ditambahkan).
- [ ] Audit metadata tidak mengandung password/token/rekening lengkap (verifikasi sample 10 log terbaru).
- [ ] Orphan cleanup: file tanpa record terhapus (test dengan seed orphan file; file dengan record tetap aman).
- [ ] Overdue recompute: invoice lewat due_date → status OVERDUE terupdate massal; invoice PAID/CANCELLED tidak tersentuh; boundary due_date tepat hari ini tetap ISSUED.
- [ ] Maintenance script idempotent (jalankan 2x, hasil sama).
- [ ] Unit test overdue recompute lulus (boundary + status filter).
- [ ] Integration test orphan cleanup lulus.
- [ ] Lint, typecheck, production build lulus.

## Commit and Push

1. Every item in `Check When Done` passes.
2. Tests pass (`npm run test`).
3. Lint and typecheck pass (`npm run lint`, `npm run typecheck`).
4. Ask which branch: **`main`** (recommended) atau new branch. Never commit silently.
5. Commit: `feat(11a): audit gap fill + maintenance jobs (orphan cleanup, overdue recompute)`.
6. Push. Never force push.

## Progress Tracker

Update `context/progress-tracker.md`: tandai 11A selesai, next 11B.
