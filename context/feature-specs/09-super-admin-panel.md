# Feature 09: Super Admin Panel

## Goal

Bangun panel super admin lengkap (`/admin/*`): overview, user management detail, organization monitoring, invoice monitoring dengan audit-on-view, PDF jobs, audit logs, storage usage, system health. Setelah feature ini, super admin bisa mengelola seluruh platform self-hosted.

## Design

- **Route terpisah dan dilindungi** `/admin/*` — hanya `SUPER_ADMIN` platform role (middleware + layout guard). Setiap view sensitif + download teraudit.
- **Overview** (`/admin`): total user, user aktif, user suspended, total organization, invoice hari ini, invoice bulan ini, nilai invoice bulan ini, PDF success/fail, storage usage, login failure count.
- **Users** (`/admin/users`): dari feature 01 + detail `/admin/users/[id]` — membership view, invoice count per org, revoke session, force password change, assign platform role. (CRUD user dasar sudah di feature 01; di sini tambah detail + metrics.)
- **Organizations** (`/admin/organizations`): list + detail `/admin/organizations/[id]` — membership, invoice count, storage usage, last activity, suspend organization.
- **Invoices** (`/admin/invoices`): list seluruh invoice lintas org (untuk support), detail `/admin/invoices/[id]` — **setiap view sensitif tercatat** (`ADMIN_VIEWED_INVOICE`), download PDF juga teraudit (`PDF_DOWNLOADED` dengan metadata admin).
- **PDF Jobs** (`/admin/pdf-jobs`): list job (invoice, status, duration, error), retry failed job (re-enqueue), created at.
- **Audit Logs** (`/admin/audit-logs`): list dengan filter (action, actor, org, date range), pagination, detail metadata (sudah disanitasi).
- **Storage** (`/admin/storage`): usage per org (agregat size uploads + pdf), file count, opsi cleanup orphan file (maintenance) — defer cleanup job otomatis ke feature 11, di sini hanya visibility.
- **System Health** (`/admin/system`): status db, storage writable, pdf-service reachable, env check (tanpa value secret), version info.
- **Settings** (`/admin/settings`): platform settings minimal (default timezone, upload max mb override via env tampil read-only) — defer konfigurasi runtime ke luar MVP.

## Implementation

1. **`modules/admin/service.ts`**: query aggregates lintas org (super admin scope only), storage usage aggregation, system health probe.
2. **Middleware guard** `/admin/*`: cek `platformRole === SUPER_ADMIN` (dari feature 01), else redirect `/unauthorized`.
3. **Audit-on-view wrapper**: `adminViewInvoice(invoiceId, ctx)` → log `ADMIN_VIEWED_INVOICE` sebelum return data.
4. **UI**: admin layout (sidebar terpisah dari dashboard user), table + filter per halaman, detail page, retry button untuk PDF job.
5. **Permission**: semua route + service cek platform role eksplisit (defense in depth: middleware + layout + service).
6. **Storage aggregation**: sum `sizeBytes` InvoicePdf + scan uploads dir per org (atau track di metadata — pilih: sum dari record DB yang ada sizeBytes, uploads via AuditLog/Dashboard metadata atau table upload record jika ada; **tambah table `UploadRecord`** minimal di feature ini untuk track uploads: orgId, path, sizeBytes, mimeType, kind, createdAt. Atau simpler: hanya sum InvoicePdf size + uploads scan filesystem. **Pilih: sum dari DB record (InvoicePdf) + UploadRecord table untuk uploads.**)

## Dependencies

- Feature 01 (user management dasar, permission, audit), Feature 05 (invoice lifecycle, PdfJob), Feature 06 (InvoicePdf, storage), Feature 07 (payment), Feature 08 (table pattern).
- `data-model.md` untuk AuditLog + PdfJob + InvoicePdf.

## Scope Limits

- **Tidak** ada impersonate user (login as) — defer (sensitif, butuh audit ketat).
- **Tidak** ada platform settings runtime editable — read-only view (values dari env).
- **Tidak** ada cleanup orphan file otomatis — feature 11 (script maintenance).
- **Tidak** ada suspend organization **full data isolation effect** — suspend hanya block login/new mutation, data tetap ada (defer data freeze behavior).
- **Tidak** ada export audit log CSV — defer.
- **Tidak** ada multi-instance admin (admin portal terpisah) — `/admin/*` di app utama.

## Check When Done

- [ ] Non-admin (USER platform role) akses `/admin/*` → redirect `/unauthorized`.
- [ ] Overview cards menampilkan angka benar (seed: total user ≥ 1, total org ≥ 1, invoice bulan ini ≥ 1 setelah seed acceptance).
- [ ] User detail: membership list, invoice count per org, revoke session bekerja, force password change bekerja, assign platform role bekerja.
- [ ] Organization detail: membership, invoice count, storage usage, last activity, suspend organization → user org tersebut tidak bisa login/mutasi baru.
- [ ] Invoice monitoring: super admin bisa lihat invoice org lain; **setiap view tercatat `ADMIN_VIEWED_INVOICE` di audit log**.
- [ ] Download PDF dari admin panel → audit `PDF_DOWNLOADED` dengan metadata actor admin.
- [ ] PDF jobs list: status, duration, error message jelas; retry failed job → re-enqueue, attempt bertambah.
- [ ] Audit logs: filter action + actor + org + date range berfungsi; pagination; metadata disanitasi (no secret).
- [ ] Storage usage: angka per org tampil (InvoicePdf + UploadRecord sum).
- [ ] System health: db / storage / pdf-service status tampil, env secret tidak tampil value.
- [ ] Permission check defense-in-depth: middleware + layout + service semua tolak non-admin (test service layer langsung).
- [ ] Unit test: admin service authorization (non-admin → throw FORBIDDEN).
- [ ] Integration test: admin view invoice → audit record ada.
- [ ] Lint, typecheck, production build lulus.

## Commit and Push

1. Every item in `Check When Done` passes.
2. Tests pass (`npm run test`).
3. Lint and typecheck pass (`npm run lint`, `npm run typecheck`).
4. Ask which branch: **`main`** (recommended) atau new branch. Never commit silently.
5. Commit: `feat(09): super admin panel — overview, users, orgs, invoices audit-view, pdf jobs, audit logs, storage, health`.
6. Push. Never force push.

## Progress Tracker

When this feature lands, update `context/progress-tracker.md`:

- Move `super-admin-panel` from **Next Up** to **In Progress** at build start, then to **Completed** when `Check When Done` passes.
- Add to **Open Questions**: apakah perlu impersonate user untuk support; apakah suspend org perlu data freeze; apakah audit log perlu retention policy.
- Add to **Architecture Decisions**: audit-on-view untuk admin invoice access; UploadRecord table untuk storage aggregation; admin guard defense-in-depth (middleware + layout + service).
- Add one line to **Session Notes**: "Feature 09 done: super admin panel lengkap dengan audit-on-view, pdf jobs retry, storage usage, system health."
- Do not touch other features' rows.
