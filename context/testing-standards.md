# Testing Standards

What must be tested, where, and from which slice onward. A feature spec references this instead of redefining test strategy per feature.

## Strategy

GA tier: test suite wajib per feature, bukan ditunda ke akhir. Tapi tidak over-test: unit untuk logic murni (calculation, terbilang, numbering), integration untuk service layer + DB, E2E untuk alur lengkap. Setiap feature spec section `## Check When Done` mensyaratkan test dari level yang relevan.

## Test Pyramid

| Level | What it covers | Runner | Required from |
| --- | --- | --- | --- |
| Unit | Pure logic: calculation engine, terbilang, numbering pattern, permission matrix, masking rekening | Vitest | feature 01 (permission), 04 (calculation/terbilang/numbering) |
| Integration | Service layer + Prisma + test DB: org isolation, issue flow, snapshot, payment status, revision | Vitest (+ test postgres) | feature 05 (issue flow), wajib untuk semua mutation penting |
| E2E | Alur lengkap dari login ke issue invoice + download PDF | Playwright Test | feature 06 (preview/pdf), 08 (list/actions) |
| PDF verification | File PDF valid, A4, page number, multi-page, header berulang, grand total benar, terbilang benar | Playwright + pdf-parse | feature 06, 11 (final acceptance) |
| Build | Production build + lint + typecheck | npm scripts, Docker build | feature 00, wajib setiap feature |

## What Must Be Tested First

- **Terbilang** (feature 04): nol, satu, sebelas, seratus, seribu, satu juta, 2.250.000, 4.500.000, 100.000, 1.001.000, angka besar (miliar). Wajib unit test sesuai contoh master prompt.
- **Invoice calculation** (feature 04): full tanpa pajak, DP 50%, DP 10%, pelunasan setelah DP, termin, PPN exclusive, PPN inclusive, manual tax, discount, additional charge, rounding. **Tidak boleh ada floating point error** (assert dengan decimal string).
- **Numbering** (feature 04): roman month (`INV/SB/VII/2026/001`), monthly reset, yearly reset, never reset, duplicate prevention, **concurrency** (parallel issue harus hasilkan nomor unik).
- **Permission & org isolation** (feature 01): org A tidak baca org B, viewer tidak issue, staff tidak ubah setting sensitif, super admin monitoring + audit.
- **Snapshot immutability** (feature 05): edit profile/customer/bank, assert invoice issued tidak berubah.
- **Money invariants** (architecture-context): semua persist `Decimal`, server recalculation.

These ship with tests in the same feature, never deferred.

## Naming and Location

- Unit test: co-located, `*.test.ts` di sebelah file logic (mis. `modules/invoices/calculation.test.ts`).
- Integration test: `tests/integration/<module>.test.ts`, pakai test database terpisah (schema `test` atau db terpisah via env `TEST_DATABASE_URL`).
- E2E test: `tests/e2e/<flow>.spec.ts`, Playwright dev server config menjalankan app + postgres dev.
- Test data: factory function di `tests/factories.ts` (createOrg, createUser, createCustomer, createInvoice...). Tidak hardcode id.
- Test description Bahasa Inggris (code convention), assertion message bebas.

## Definition of Done

A feature is not done because it works. It is done because it is verified against its spec.

- Setiap item `## Check When Done` terbukti (bukan klaim).
- Lint pass (`npm run lint`), typecheck pass (`npm run typecheck` = `tsc --noEmit`).
- Unit/integration test dari level yang ditentukan pyramid pass.
- Production build pass (`npm run build`).
- Progress tracker di-update: feature ke Completed, next goal diset.
- Jika ada item yang gagal, feature **tidak done**. Fix sebelum commit, atau block dan laporkan.
