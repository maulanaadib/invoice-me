# Progress Tracker

Update this file whenever the current phase, active feature, or implementation state changes.

## Current Phase

- Feature 00 committed dan di-push ke main (6536704). Feature 01 (auth-multi-tenant) selesai: Check When Done lulus, di-commit ke main. Feature 02 (onboarding-profile) selesai: Check When Done lulus, E2E 3/3, unit+integration 97/97. Feature 03 (customers-projects) selesai: Check When Done lulus, integration 110/110, lint 0 error, typecheck, production build lulus. Feature 04 (invoice-engine-core) selesai penuh: semua item "Check When Done" lulus (diverifikasi orchestrator + review + test fase model berbeda), unit+integration+edge 318/318 (22 files), lint 0 error (3 pre-existing warnings), typecheck, production build lulus. Commit di main lokal: 209c193 (core) + 8739210 (React 19 fixes) + 7f0721d (tracker) + 5826ee3 (navigation blocker) + 2dabc85 (review fixes) + 1d47439 (125 edge-case test).

## Current Goal

- Implement feature 04: invoice-engine-core — selesai (numbering engine anti-race, kalkulasi decimal 4 jenis penagihan, terbilang Bahasa Indonesia, editor split-screen + live preview A4, autosave draft, navigation blocker, TaxMode MANUAL). Fix orchestrator: 3 bug React 19/typecheck di invoice-editor + admin/organizations force-dynamic. Next: feature 05 (invoice-issue-lifecycle).

## Completed

- Feature 05: invoice-issue-lifecycle — issue flow transaksional (SERIALIZABLE + `LOCK TABLE "InvoiceSequence" IN EXCLUSIVE MODE` sebagai antrean FIFO sebelum snapshot MVCC + row lock bucket + retry maks 3 → konflik sequence), alokasi nomor final anti-race, 7 snapshot immutability dibekukan saat issue, lock data finansial (`remainingAfter` = grandTotal), audit `INVOICE_ISSUED` + enqueue `PdfJob` PENDING dalam transaksi yang sama, status lifecycle (markSent/cancel dengan alasan wajib/createRevision salinan draft + relasi REVISED↔replacedById), OVERDUE on-read (badge, kolom tersimpan tak diubah), `billedToDate` nyata di detail project (placeholder fitur 03 terisi), detail `/invoices/[id]` render dari snapshot + tombol Issue/Send/Cancel/Revisi (dialog konfirmasi, alasan wajib), route edit issued redirect ke detail + `getDraft`/`updateDraft` tolak `LOCKED`, permission STAFF issue+markSent / OWNER-ADMIN cancel+revise / VIEWER hanya baca, fix bug laten `nextSequence` (raw INSERT tanpa id → 23502), migration `invoice_lifecycle`. Verifikasi lulus: unit+integration 349/349 (26 files — termasuk concurrency 10 issue paralel → `INV/SB/VII/2026/001–010` unik tanpa invoice setengah jadi), lint 0 error (2 warning lama di luar feature 05), typecheck, production build lulus.
- Feature 00: project-setup — scaffold Next.js + Prisma + Better Auth + Docker Compose; boilerplate cleanup; `/health`, env validation, pino logger, pdf-service skeleton. Verify checklist semua lolos (lint, typecheck, build, dev postgres reachable + `prisma db push`, production compose 3 service healthy). Committed as `6536704` dan di-push ke `main`. Builder model: MiMo-V2.6-Flash (verified working).
- Feature 01: auth-multi-tenant — Better Auth (username/email, admin plugin, public registration dimatikan), lockout 5x escalating in-memory, force password change setelah admin create/reset, Organization + Membership, permission service di `modules/permissions`, audit write helper di `modules/audit`, super admin user management (`/admin/users`), workspace switcher via `session.activeOrganizationId`, route guard `src/proxy.ts`, seed super admin idempotent. Verifikasi lulus: lint, typecheck, production build, test (unit + integration dengan test DB).
- Feature 02: onboarding-profile — wizard 12 langkah (`/onboarding`) dengan resume dari langkah terakhir + guard redirect untuk user yang belum onboarding, InvoiceProfile + InvoiceSequence + BankAccount + Signer (migration `onboarding_profile`), StorageService interface + LocalStorageService (MIME sniff via `file-type`, random filename, path-traversal safe, sha256), AES-256-GCM encrypt-at-rest nomor rekening + masking, number pattern token parser (`{CODE}` `{ROMAN_MONTH}` `{YYYY}` `{SEQ:3}` dll) dengan live preview, edit profile di `/profiles/[id]`, audit PROFILE_CHANGED. Verifikasi lulus: E2E 3/3 (wizard end-to-end + close/resume + edit profile), unit+integration 97/97, lint (0 error), typecheck, production build.
- Feature 03: customers-projects — Customer + PIC (CustomerContact) CRUD dengan soft delete & PIC primary eksklusif (migration `customers-projects`), ProjectReference CRUD semua referenceType + upload lampiran PO (PDF/image, MIME sniff dari isi file, maks 2 MB, filename random), halaman `/customers` list + `/customers/new` + `/customers/[id]` (edit + tab PIC) + `/projects` list + `/projects/new` + `/projects/[id]` (detail + attachment), form React Hook Form + Zod, list server-side pagination + search (TanStack Table, URL-driven), NPWP masked untuk VIEWER (tidak pernah masuk log/audit metadata), `prefillFromProject` dengan item list kosong (jujur, tanpa work item), placeholder jujur "sudah ditagihkan" di project detail, audit CUSTOMER_CREATED/UPDATED/DELETED + PROJECT_CREATED/UPDATED, org isolation 404 (IDOR guard), VIEWER 403 / STAFF boleh. Verifikasi lulus: integration 110/110 (13 skenario fitur 03 termasuk search "Dharma", upload >2MB & MIME palsu ditolak), lint (0 error), typecheck, production build.

## In Progress

## Next Up

- Feature 04: invoice-engine-core
- Feature 06: invoice-preview-pdf
- Feature 07: payments
- Feature 08: dashboard-invoice-list
- Feature 09: super-admin-panel
- Feature 10: bank-signers
- Feature 11: audit-backup-deploy-final

## Open Questions

- Apakah lockout perlu persistent across restart (table) atau in-memory cukup untuk MVP?
- Apakah email undangan membership perlu dikirim sebelum GA? (feature 01: membership status INVITED saja, tanpa email)
- Apakah QRIS perlu field sebelum GA? (saat ini opsional, defer — feature 02 scope).
- Apakah crop logo interaktif perlu sebelum GA? (saat ini hanya fit preview sederhana).
- Apakah "item pekerjaan" di project perlu sebelum GA?
- Apakah billedToDate perlu tampil di project detail sebelum feature 05?
- Apakah OVERDUE scheduled job perlu cron host (feature 11) atau on-read saja cukup?

## Architecture Decisions

- Modular monolith + pdf-service terpisah (Playwright Chromium isolasi runtime).
- decimal.js + Prisma Decimal untuk semua nominal; server recalculation wajib.
- Next.js App Router + Better Auth (username/email, no public registration).
- Docker Compose (app + postgres + pdf-service) deploy via Coolify, auto-deploy on push main.
- Tracer Bullet vertical slices, GA tier (test suite wajib per feature).
- Repository: https://github.com/maulanaadib/invoice-me, branch main, 1 commit per feature.
- Central permission matrix hanya di `modules/permissions` — role string tidak pernah di-inline di service lain.
- Semua penulisan AuditLog lewat helper `modules/audit` (sanitasi metadata otomatis, tidak pernah menyimpan password/token).
- Workspace aktif via session active org (`session.activeOrganizationId`), membership di-re-validasi setiap read (fail closed).
- StorageService interface (`modules/storage`) dengan LocalStorageService — DI siap S3/MinIO, MIME sniff dari isi file (magic bytes), filename random `crypto.randomUUID`, path traversal safe, sha256 dicatat.
- Nomor rekening encrypt at rest: AES-256-GCM (`modules/bank-accounts/crypto`), format simpanan `iv:tag:ciphertext` hex, masking `**** **** 3449` hanya dari nilai terdekripsi server-side.
- Number pattern token parser (`modules/profiles/number-pattern`) satu source of truth untuk validasi + preview — dipakai server action dan client preview (token: `{CODE}` `{TYPE}` `{YYYY}` `{YY}` `{MM}` `{DD}` `{ROMAN_MONTH}` `{SEQ:n}`, tepat satu SEQ wajib).
- Soft delete customer: `deletedAt` hanya di tabel Customer (fitur 03) — row dan PIC tetap tersimpan untuk audit, semua read path menyaringnya.
- billedToDate defer ke feature 05 (fitur 03): project detail menampilkan placeholder jujur, tidak forward-reference tabel Invoice.
- Feature 05: numbering pakai isolation SERIALIZABLE + retry (maks 3, backoff) di atas `LOCK TABLE "InvoiceSequence" IN EXCLUSIVE MODE` — antrean diambil SEBELUM snapshot MVCC dibentuk sehingga waiter bangun dengan snapshot segar (tanpa itu semua pengikut abort 40001 dan retry habis), row lock `SELECT ... FOR UPDATE` + unique constraint tetap safety net lintas instance.
- Feature 05: snapshot read-after-issue — tujuh snapshot (issuer/customer/contact/bank/signer/calculation/template) dibangun saat issue dan menjadi satu-satunya sumber baca dokumen terbit; edit profil/customer/bank sesudah issue tidak mengubah invoice (bank tersimpan dalam bentuk masked, tidak ada nomor rekening plaintext).
- Feature 05: REVISED (dan DRAFT/CANCELLED) di-exclude dari previouslyBilled/billedToDate lewat satu modul `modules/invoices/billed.ts` — pasangan revisi tidak pernah double-count.
- Feature 05: PdfJob enqueue-only — issue membuat baris PENDING dalam transaksi yang sama; worker render = feature 06 (UI hanya menampilkan status antrean yang jujur, tanpa tombol unduh palsu).

## Session Notes

- The full SDD context bundle was generated by `/sdd-selcy`. Build one feature per chat, and update this file at the end of every chat before closing it.
- Spec bundle di-generate dari master prompt InvoiceFlow + penyesuaian: deploy target Coolify (bukan ZimaOS), repo maulanaadib/invoice-me.
- Feature 00 fixes saat Verify: (1) `env.ts` — `GLITCHTIP_DSN` string kosong dari compose di-preprocess jadi undefined; (2) `Dockerfile` — copy `libssl.so.3`/`libcrypto.so.3` dari stage `node:22-bookworm` (build env tanpa apt) + mkdir/chown `/data` untuk user nextjs. Catatan: `docker compose build app` memakai `.next/standalone` hasil `npm run build` di host — selalu `npm run build` dulu sebelum build image.
- Commit/push feature 00 sengaja ditunda — reserved untuk engineer. Deploy Coolify (First Deploy di spec) juga menunggu engineer.
- Feature 01 done: login (username/email), lockout, force-change, org+membership, permission service, super admin user mgmt.
- Feature 02 done: onboarding 12 langkah, InvoiceProfile, logo upload MIME-sniffed, numbering preview, bank encryption, signer. Verify fixes saat gate: (1) `crypto.test.ts` — assertion "ciphertext hex tidak mengandung digit-run plaintext" diganti dengan cek ciphertext bytes (hex pasti mengandung hex digit, assertion lama flaky); (2) step-9 numbering — `useActionState` tidak ada setter di React 19, error server yang lama dipakai flag `dismissed` agar hilang saat field diedit.
- Feature 03 done: customer+PIC CRUD, project/PO CRUD, PO attachment upload, org-scoped.
- Feature 04 follow-up (orchestrator "Check When Done"): navigation blocker editor diaktifkan — `invoice-editor` memanggil `setBlocked(isDirty || saving)` (unblock saat clean + on unmount), sehingga `GuardedLink` shell (sidebar/user menu) dan link "Kembali ke daftar draft" kini menampilkan konfirmasi saat draft kotor; import tak terpakai `useNavigationBlocker`/`getInvoiceDraftAction`/`getEditorOptions`/`Link` dihapus (lint warning hilang). Gate: lint 0 error (sisa 3 warning lama di luar feature 04), typecheck, 186/186 test, production build lulus.
- Feature 04 review fixes (session `feat-04-invoice-engine-core-review`, 3 bug nyata + kepatuhan spec): (1) **autosave pertama selalu 400** — `invoiceItemSchema.unitPrice` kini menerima `""` dan menormalisasi jadi `"0"` di boundary server (`transform` + `pipe`, baris template item / harga yang dibersihkan user tetap lolos), regresi tercakup unit test baru `src/components/invoice/editor-state.test.ts`; (2) **prefill dari project tak reachable** — tombol "Buat invoice" di `/projects/[id]` navigasi ke `/invoices/new?project=<id>`, gate `invoice.draft.create` (VIEWER tidak melihatnya, bukan tombol palsu); (3) **blok settlement mensyaratkan project** — kini tampil tanpa project: nilai pekerjaan/sudah ditagihkan/sisa/total semua dari `calculateInvoice` (sebelumnya billed = link project atau `"0"` — mirror aturan server `computePreviouslyBilled`; sisa & total ditagihkan = billingBase, baris sama dengan renderer A4; `calculation.ts` tidak diubah); (4) **token `{TYPE}`** ditambahkan ke grammar `number-pattern` (validasi + preview, fallback enum `FULL` saat preview tanpa konteks invoice) + unit test. Gate: lint 0 error, typecheck, 190/190 test, production build lulus.
- Feature 05 done: issue flow anti-race, snapshot, lifecycle, revision, cancel, mark sent, overdue on-read, billedToDate.
- Feature 05 test audit (session `feat-05-invoice-missing-tests`): builder's edge-case coverage had gaps in invariant 4 (snapshot content), lifecycle status boundaries, on-read overdue date arithmetic, and mandatory cancel-reason validation — none of which are exercised by the builder's existing `invoice-lifecycle*.test.ts`. Added 3 new test files, 40 tests, all green; 0 implementation files touched:
  - `tests/integration/invoice-snapshot.test.ts` (10) — snapshot contents (issuer/customer/contact/bank/signer/template + calculation), draft→issue reassignment, immutability, absent-at-issue JsonNull, `fromSnapshot`/`amountPaid`. Decimal columns persist trimmed (`"4500000"`) while the engine emits `toFixed(2)` (`"4500000.00")` — assertions normalize with `.toFixed(2)`; cross-org customer reassignment is rejected by `getCustomerForScope`, so the same-org case is the only valid path.
  - `src/modules/invoices/overdue-boundary.test.ts` (13) — pure: `isPastDue` strict calendar boundary (Jakarta = UTC+7, same-Jakarta-day never overdue, absent due date never overdue), `isOverdue` status gate, `recomputeOverdue` returns the stored status when not overdue.
  - `src/modules/invoices/lifecycle-boundaries.test.ts` (17) — pure: `CANCELABLE_STATUSES`/`REVISABLE_STATUSES`/`OVERDUE_ELIGIBLE_STATUSES` are identical (`ISSUED`, `SENT`, `PARTIALLY_PAID`); `BILLED_STATUSES`/`countsTowardPreviouslyBilled`; `validateCancelReason` (empty/whitespace/`null`/`undefined` → VALIDATION_ERROR, trims, `CANCEL_REASON_MAX` = 500 with exact-boundary acceptance).
  Final `npm run test`: 30 files / 409 tests / 0 failures. `src/modules/permissions/service.test.ts` shows a diff in this workspace but it is pre-existing Feature 05 work — not touched by this audit.
