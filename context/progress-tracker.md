# Progress Tracker

Update this file whenever the current phase, active feature, or implementation state changes.

## Current Phase

- Feature 00 committed dan di-push ke main (6536704). Feature 01 (auth-multi-tenant) selesai: Check When Done lulus, di-commit ke main. Feature 02 (onboarding-profile) selesai: Check When Done lulus, E2E 3/3, unit+integration 97/97. Feature 03 (customers-projects) selesai: Check When Done lulus, integration 110/110, lint 0 error, typecheck, production build lulus. Feature 04 (invoice-engine-core) selesai: Check When Done lulus, unit+integration 186/186, lint 0 error, typecheck, production build, /health 200. Commit 209c193 + 8739210 di main lokal.

## Current Goal

- Implement feature 04: invoice-engine-core — selesai (numbering engine anti-race, kalkulasi decimal 4 jenis penagihan, terbilang Bahasa Indonesia, editor split-screen + live preview A4, autosave draft, navigation blocker, TaxMode MANUAL). Fix orchestrator: 3 bug React 19/typecheck di invoice-editor + admin/organizations force-dynamic. Next: feature 05 (invoice-issue-lifecycle).

## Completed

- Feature 00: project-setup — scaffold Next.js + Prisma + Better Auth + Docker Compose; boilerplate cleanup; `/health`, env validation, pino logger, pdf-service skeleton. Verify checklist semua lolos (lint, typecheck, build, dev postgres reachable + `prisma db push`, production compose 3 service healthy). Committed as `6536704` dan di-push ke `main`. Builder model: MiMo-V2.6-Flash (verified working).
- Feature 01: auth-multi-tenant — Better Auth (username/email, admin plugin, public registration dimatikan), lockout 5x escalating in-memory, force password change setelah admin create/reset, Organization + Membership, permission service di `modules/permissions`, audit write helper di `modules/audit`, super admin user management (`/admin/users`), workspace switcher via `session.activeOrganizationId`, route guard `src/proxy.ts`, seed super admin idempotent. Verifikasi lulus: lint, typecheck, production build, test (unit + integration dengan test DB).
- Feature 02: onboarding-profile — wizard 12 langkah (`/onboarding`) dengan resume dari langkah terakhir + guard redirect untuk user yang belum onboarding, InvoiceProfile + InvoiceSequence + BankAccount + Signer (migration `onboarding_profile`), StorageService interface + LocalStorageService (MIME sniff via `file-type`, random filename, path-traversal safe, sha256), AES-256-GCM encrypt-at-rest nomor rekening + masking, number pattern token parser (`{CODE}` `{ROMAN_MONTH}` `{YYYY}` `{SEQ:3}` dll) dengan live preview, edit profile di `/profiles/[id]`, audit PROFILE_CHANGED. Verifikasi lulus: E2E 3/3 (wizard end-to-end + close/resume + edit profile), unit+integration 97/97, lint (0 error), typecheck, production build.
- Feature 03: customers-projects — Customer + PIC (CustomerContact) CRUD dengan soft delete & PIC primary eksklusif (migration `customers-projects`), ProjectReference CRUD semua referenceType + upload lampiran PO (PDF/image, MIME sniff dari isi file, maks 2 MB, filename random), halaman `/customers` list + `/customers/new` + `/customers/[id]` (edit + tab PIC) + `/projects` list + `/projects/new` + `/projects/[id]` (detail + attachment), form React Hook Form + Zod, list server-side pagination + search (TanStack Table, URL-driven), NPWP masked untuk VIEWER (tidak pernah masuk log/audit metadata), `prefillFromProject` dengan item list kosong (jujur, tanpa work item), placeholder jujur "sudah ditagihkan" di project detail, audit CUSTOMER_CREATED/UPDATED/DELETED + PROJECT_CREATED/UPDATED, org isolation 404 (IDOR guard), VIEWER 403 / STAFF boleh. Verifikasi lulus: integration 110/110 (13 skenario fitur 03 termasuk search "Dharma", upload >2MB & MIME palsu ditolak), lint (0 error), typecheck, production build.

## In Progress

## Next Up

- Feature 04: invoice-engine-core
- Feature 05: invoice-issue-lifecycle
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
- Number pattern token parser (`modules/profiles/number-pattern`) satu source of truth untuk validasi + preview — dipakai server action dan client preview (token: `{CODE}` `{YYYY}` `{YY}` `{MM}` `{ROMAN_MONTH}` `{SEQ:n}`, tepat satu SEQ wajib).
- Soft delete customer: `deletedAt` hanya di tabel Customer (fitur 03) — row dan PIC tetap tersimpan untuk audit, semua read path menyaringnya.
- billedToDate defer ke feature 05 (fitur 03): project detail menampilkan placeholder jujur, tidak forward-reference tabel Invoice.

## Session Notes

- The full SDD context bundle was generated by `/sdd-selcy`. Build one feature per chat, and update this file at the end of every chat before closing it.
- Spec bundle di-generate dari master prompt InvoiceFlow + penyesuaian: deploy target Coolify (bukan ZimaOS), repo maulanaadib/invoice-me.
- Feature 00 fixes saat Verify: (1) `env.ts` — `GLITCHTIP_DSN` string kosong dari compose di-preprocess jadi undefined; (2) `Dockerfile` — copy `libssl.so.3`/`libcrypto.so.3` dari stage `node:22-bookworm` (build env tanpa apt) + mkdir/chown `/data` untuk user nextjs. Catatan: `docker compose build app` memakai `.next/standalone` hasil `npm run build` di host — selalu `npm run build` dulu sebelum build image.
- Commit/push feature 00 sengaja ditunda — reserved untuk engineer. Deploy Coolify (First Deploy di spec) juga menunggu engineer.
- Feature 01 done: login (username/email), lockout, force-change, org+membership, permission service, super admin user mgmt.
- Feature 02 done: onboarding 12 langkah, InvoiceProfile, logo upload MIME-sniffed, numbering preview, bank encryption, signer. Verify fixes saat gate: (1) `crypto.test.ts` — assertion "ciphertext hex tidak mengandung digit-run plaintext" diganti dengan cek ciphertext bytes (hex pasti mengandung hex digit, assertion lama flaky); (2) step-9 numbering — `useActionState` tidak ada setter di React 19, error server yang lama dipakai flag `dismissed` agar hilang saat field diedit.
- Feature 03 done: customer+PIC CRUD, project/PO CRUD, PO attachment upload, org-scoped.
