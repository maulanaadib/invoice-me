# Feature 02: Onboarding & Invoice Profile

## Goal

Setelah user pertama login, pandu mereka menyiapkan organization dan invoice profile melalui wizard 12 langkah. Setelah feature ini, user memiliki profile invoice siap dipakai (logo, warna brand, nomor invoice, meterai default) dan bisa mulai membuat customer/invoice.

## Design

- **Onboarding wizard** (`/onboarding`), 12 langkah sesuai master prompt bagian 5:
  1. Buat atau pilih organization (jika super admin create user tanpa org, atau user pertama).
  2. Isi profil perusahaan (nama legal, alamat, kontak).
  3. Upload logo.
  4. Pilih warna utama (color picker).
  5. Isi kontak (WhatsApp, telepon, fax, email, website).
  6. Tambah rekening bank.
  7. Tambah penanda tangan.
  8. Buat invoice profile (nama profile, kode singkat seperti `SB`).
  9. Atur pola nomor invoice (dengan live preview nomor).
  10. Pilih preferensi meterai.
  11. Tampilkan preview invoice contoh (render InvoiceRenderer placeholder dengan data yang baru diisi — render penuh feature 06; di sini preview sederhana dengan token terisi).
  12. Selesaikan onboarding (tandai `user.onboardingComplete`, redirect dashboard).
- **Resume**: onboarding bisa dilanjutkan jika belum selesai (state per langkah disimpan, redirect ke langkah terakhir).
- **InvoiceProfile** sesuai `data-model.md`: code, logoPath, primaryColor, numberPattern, sequenceResetPolicy, defaultTaxMode, defaultStampMode, defaultNotes, templateKey, settings.
- **Numbering preview**: parse `numberPattern` dengan token (`{CODE}`, `{ROMAN_MONTH}`, `{YYYY}`, `{SEQ:3}`, dst) dan tampilkan preview real-time. Validasi pattern.
- **Logo upload**: PNG/JPEG/WebP, maks 2 MB (`UPLOAD_MAX_MB`), validasi MIME dari isi file (magic bytes), filename random, resize/optimize (Gunakan `sharp`), preview crop/fit.
- **Meterai preference**: pilih `NONE`/`E_METERAI`/`PHYSICAL`/`BLANK_SPACE` + disclaimer "aplikasi hanya mengatur layout placeholder, belum melakukan pembubuhan e-meterai resmi".
- **Rekening bank** (langkah 6): form bank + nomor rekening + atas nama. Nomor rekening **encrypt at rest** (`BANK_ACCOUNT_ENCRYPTION_KEY`), tampil masked. Modul `bank-accounts` dibuat di sini, di-fitur 10 dilengkapi CRUD multi-account.
- **Penanda tangan** (langkah 7): nama, jabatan, lokasi, upload gambar tanda tangan opsional. Modul `signers` dibuat di sini.

## Implementation

1. **Schema migration**: `InvoiceProfile`, `InvoiceSequence`, `BankAccount`, `Signer` + field User `onboardingComplete`. Migration `onboarding-profile`.
2. **`modules/profiles/service.ts`**: createProfile, updateProfile, validateNumberPattern, previewNumber(pattern, ctx) → string.
3. **`modules/storage`**: `StorageService` interface + `LocalStorageService` implementasi. `upload(file, { orgId, kind })` → validate (MIME sniff via `file-type`, size), random filename (`crypto.randomUUID` + ext), path traversal safe, return `{ path, size, mimeType, sha256 }`. Dependency injection siap S3/MinIO.
4. **`modules/bank-accounts/service.ts`**: encrypt/decrypt nomor rekening (AES-256-GCM via `node:crypto`), masking helper (`**** **** 3449`), last4.
5. **`modules/signers/service.ts`**: CRUD signer + upload signature image.
6. **Onboarding page**: multi-step form (React Hook Form + Zod per step), progress indicator, autosave per langkah (simpan state ke table atau localStorage + server autosave), resume detection.
7. **Onboarding guard**: middleware/layout cek `onboardingComplete=false` → redirect `/onboarding` (dengan skip untuk super admin route admin).
8. **Color picker** component (custom atau shadcn-compatible), preview warna langsung di preview invoice.
9. **Sharp** untuk image resize/optimize logo + signature.
10. **Unit test**: number pattern preview (semua token + invalid pattern), masking rekening, encryption roundtrip.

## Dependencies

- Feature 01 (auth, org, permission, audit, layout shell).
- `data-model.md` untuk InvoiceProfile/InvoiceSequence/BankAccount/Signer.
- Feature 06 (InvoiceRenderer) — **untuk langkah 11 preview**, pakai preview sederhana sendiri dulu (data profile + customer dummy), bukan render PDF penuh. Tidak cross-boundary.

## Scope Limits

- **Tidak** membuat customer/PO — feature 03.
- **Tidak** render invoice penuh / PDF — feature 06.
- **Tidak** membuat lebih dari satu bank account / signer di onboarding (CRUD multi-account lengkap feature 10; onboarding hanya 1 default).
- **Tidak** ada QRIS — defer.
- **Tidak** ada multi-currency — IDR saja.
- **Tidak** ada template picker — Corporate Blue satu template (`templateKey` field disiapkan, pilihan template defer).
- Logo upload hanya validasi + simpan; crop UI interaktif opsional (fit preview sederhana cukup).

## Check When Done

- [ ] User baru (dibuat admin) login → redirect ke onboarding otomatis.
- [ ] Wizard 12 langkah bisa diselesaikan end-to-end.
- [ ] Onboarding bisa di-close di tengah dan resume dari langkah terakhir.
- [ ] Logo upload: PNG/JPEG/WebP diterima, file > 2MB ditolak dengan pesan jelas, MIME palsu (ext .png tapi isi PDF) ditolak.
- [ ] Logo disimpan dengan random filename, path tidak mengandung input user langsung.
- [ ] Numbering preview menampilkan `INV/SB/VII/2026/001` untuk pattern `INV/{CODE}/{ROMAN_MONTH}/{YYYY}/{SEQ:3}`.
- [ ] Pattern invalid (token tidak dikenal) ditolak dengan pesan jelas.
- [ ] Nomor rekening disimpan encrypted di DB (cek DB raw value ≠ plaintext), tampil masked di UI.
- [ ] Warna utama dipilih → preview invoice contoh berubah accent color.
- [ ] Disclaimer meterai tampil di langkah meterai.
- [ ] Setelah selesai, `onboardingComplete=true`, redirect dashboard, tidak bisa kembali ke wizard (kecuali edit profile).
- [ ] Edit profile (`/profiles/[id]`) bisa mengubah field profile + logo + pattern.
- [ ] StorageService path traversal aman (test: upload dengan filename `../../etc/passwd` ditangani).
- [ ] Audit log: profile changed tercatat.
- [ ] Unit test: number pattern, masking, encryption roundtrip, MIME validation.
- [ ] Lint, typecheck, production build lulus.

## Commit and Push

1. Every item in `Check When Done` passes.
2. Tests pass (`npm run test`).
3. Lint and typecheck pass (`npm run lint`, `npm run typecheck`).
4. Ask which branch: **`main`** (recommended) atau new branch. Never commit silently.
5. Commit: `feat(02): onboarding wizard + invoice profile + storage + bank account encryption + signer`.
6. Push. Never force push.

## Progress Tracker

When this feature lands, update `context/progress-tracker.md`:

- Move `onboarding-profile` from **Next Up** to **In Progress** at build start, then to **Completed** when `Check When Done` passes.
- Add to **Open Questions**: apakah QRIS perlu field sebelum GA (saat ini opsional); apakah crop logo interaktif perlu sebelum GA.
- Add to **Architecture Decisions**: StorageService interface (local, S3-ready); AES-256-GCM encryption rekening; number pattern token parser.
- Add one line to **Session Notes**: "Feature 02 done: onboarding 12 langkah, InvoiceProfile, logo upload MIME-sniffed, numbering preview, bank encryption, signer."
- Do not touch other features' rows.
