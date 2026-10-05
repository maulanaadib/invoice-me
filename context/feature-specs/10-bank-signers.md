# Feature 10: Bank Accounts & Signers

## Goal

Lengkapi modul bank account dan signer: CRUD multi-account, encrypt at rest untuk nomor rekening, masking, snapshot ke invoice, token notes. Setelah feature ini, user bisa mengelola beberapa rekening dan penanda tangan, dan invoice bisa memilih rekening saat dibuat.

## Design

- **BankAccount CRUD** (`/bank-accounts`): nama bank, kode bank opsional, nomor rekening, nama pemilik, cabang opsional, mata uang (IDR default), status default, status aktif.
- **Nomor rekening**:
  - **Encrypt at rest** (AES-256-GCM, key `BANK_ACCOUNT_ENCRYPTION_KEY` dari env) — implementasi dasar di feature 02, di sini lengkapi untuk multi-account + rotation scenario.
  - Simpan `accountNumberEncrypted` + `accountNumberLast4`.
  - **Masking di UI**: list/menu tampil `**** **** 3449`; nomor lengkap hanya di invoice (snapshot) dan halaman berizin (detail bank dengan permission).
  - Rotation key: re-encrypt semua nomor rekening saat key berubah (script migration `scripts/rotate-bank-key.sh` atau service function — bukan UI).
- **Signer CRUD** (`/signers`): nama, jabatan, lokasi penanda tanganan, gambar tanda tangan opsional (upload, reuse storage), status default, aktif.
- **Pemilihan di invoice** (editor feature 04 integration): field `bankAccountId` + `signerId` di form invoice (section Pembayaran / Meterai dan Tanda Tangan), pilih dari list rekening/signer org, **snapshot** disimpan saat issue (feature 05).
- **Token notes** (dari master prompt bagian 14): catatan default di invoice profile bisa memakai token — di feature ini, token **resolve di service layer** saat render invoice (preview + PDF):
  - `{INVOICE_NUMBER}`, `{REFERENCE_NUMBER}`, `{CUSTOMER_NAME}`, `{WORK_VALUE}`, `{BILLING_PERCENT}`, `{GRAND_TOTAL}`.
  - Contoh resolve: `Penagihan Down Payment 50% dari nilai PO sebesar Rp4.500.000. Mohon cantumkan nomor PO 5198021181 pada berita transfer.`
  - Token resolve dari data invoice + format id-ID.
- **Permission**: STAFF+ kelola bank account & signer; VIEWER read-only (nomor masked).

## Implementation

1. **Schema**: field `BankAccount` lengkap (dari feature 02 dasar) + `Signer` + relasi invoice snapshot. Migration `bank-signers`.
2. **`modules/bank-accounts/service.ts`**: CRUD multi-account, encrypt/decrypt, masking helper, set default, list dengan pagination.
3. **`modules/signers/service.ts`**: CRUD + upload signature image (reuse StorageService).
4. **`lib/tokens.ts`**: `resolveNotesTokens(template, invoice)` — replace token dengan nilai formatted id-ID. Unit test.
5. **UI**: `/bank-accounts` list (masked) + form (input nomor rekening show/hide), `/signers` list + form (upload gambar).
6. **Invoice editor integration**: select rekening + signer (API route list options, org scoped).
7. **Audit**: bank account created/updated, signer created/updated.
8. **Key rotation script**: `scripts/rotate-bank-key.sh` — decrypt dengan old key, encrypt dengan new key, update semua row. Dokumentasi di README.

## Dependencies

- Feature 02 (encryption dasar, storage, profile), Feature 04 (invoice editor), Feature 05 (snapshot).

## Scope Limits

- **Tidak** ada QRIS — defer (field opsional disiapkan di schema, tidak diimplementasikan).
- **Tidak** ada validasi nomor rekening ke bank (tidak integrate bank API) — hanya format bebas.
- **Tidak** ada multi-currency conversion — IDR saja.
- **Tidak** ada importer bank account CSV — defer.
- **Tidak** ada signature pad (draw tanda tangan) — upload gambar saja.

## Check When Done

- [ ] CRUD bank account multi-account berfungsi; set default bekerja.
- [ ] Nomor rekening disimpan encrypted (cek DB raw: ciphertext ≠ plaintext, last4 terisi).
- [ ] List bank account menampilkan masked (`**** **** 3449`); detail menampilkan nomor lengkap hanya dengan permission.
- [ ] Key rotation script: jalankan dengan old/new key → semua nomor rekening masih bisa di-decrypt dengan new key.
- [ ] CRUD signer berfungsi; upload gambar tanda tangan (PNG/JPEG, max 2MB, MIME sniff).
- [ ] Invoice editor: select rekening + signer dari list org-scoped; invoice menyimpan `bankAccountId` + `signerId`.
- [ ] Snapshot: issue invoice → `bankSnapshot` + `signerSnapshot` terisi; edit bank/signer kemudian → invoice issued tidak berubah.
- [ ] **Token notes**: `{INVOICE_NUMBER}` di notes profile resolve ke nomor invoice; `{WORK_VALUE}` → `Rp4.500.000` (format id-ID); `{CUSTOMER_NAME}` → nama customer; `{BILLING_PERCENT}` → `50%`; `{GRAND_TOTAL}` → `Rp2.250.000`.
- [ ] Token unknown (mis. `{FOOBAR}`) dibiarkan literal atau dihapus — **pilih: dibiarkan literal dengan warning di preview** (tidak silently berubah).
- [ ] VIEWER tidak bisa CRUD; melihat nomor masked.
- [ ] Audit log: bank account + signer created/updated tercatat.
- [ ] Org isolation: bank account org A tidak bisa diakses org B.
- [ ] Unit test: encryption roundtrip, masking, token resolve (semua token + unknown token).
- [ ] Integration test: CRUD bank + signer dengan test DB.
- [ ] Lint, typecheck, production build lulus.

## Commit and Push

1. Every item in `Check When Done` passes.
2. Tests pass (`npm run test`).
3. Lint and typecheck pass (`npm run lint`, `npm run typecheck`).
4. Ask which branch: **`main`** (recommended) atau new branch. Never commit silently.
5. Commit: `feat(10): bank accounts multi-account + encryption rotation + signers + token notes`.
6. Push. Never force push.

## Progress Tracker

When this feature lands, update `context/progress-tracker.md`:

- Move `bank-signers` from **Next Up** to **In Progress** at build start, then to **Completed** when `Check When Done` passes.
- Add to **Open Questions**: apakah QRIS perlu sebelum GA; apakah signature pad (draw) perlu.
- Add to **Architecture Decisions**: AES-256-GCM encryption + rotation script; token resolve di service layer (format id-ID); unknown token dibiarkan literal.
- Add one line to **Session Notes**: "Feature 10 done: bank account multi-account + key rotation, signer CRUD, invoice integration + snapshot, token notes resolve."
- Do not touch other features' rows.
