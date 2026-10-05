# Feature 07: Payments

## Goal

Bangun modul pembayaran: catat pembayaran manual, update status invoice otomatis (PARTIALLY_PAID / PAID), upload bukti pembayaran, riwayat pembayaran per invoice. Setelah feature ini, user bisa melacak pembayaran invoice tanpa aplikasi menjadi payment gateway.

## Design

- **Record payment** (`/invoices/[id]` → action "Record Payment" / `/payments`): tanggal pembayaran, nominal, metode (BANK_TRANSFER / CASH / QRIS / OTHER), nomor referensi opsional, bukti pembayaran opsional (upload image/PDF), catatan, recorded by.
- **Update status otomatis**:
  - `totalPaid == 0` → status sebelumnya (DRAFT/ISSUED/SENT).
  - `0 < totalPaid < grandTotal` → `PARTIALLY_PAID`.
  - `totalPaid >= grandTotal` → `PAID`.
  - Hanya berlaku untuk invoice ISSUED/SENT/PARTIALLY_PAID/PAID. Tidak untuk DRAFT/CANCELLED/REVISED.
- **Validasi overpayment**: pembayaran lebih besar dari sisa → warning/konfirmasi sesuai permission (STAFF perlu konfirmasi, OWNER/ADMIN bisa override dengan alasan).
- **Riwayat pembayaran**: list per invoice (tanggal, nominal, metode, referensi, bukti link, recorded by, catatan).
- **Permission**: STAFF+ record payment; VIEWER read-only. Delete payment (reversal) OWNER/ADMIN only, dengan audit.
- **Snapshot**: nominal pembayaran tidak memengaruhi snapshot invoice (snapshot adalah data invoice, bukan pembayaran). `amountPaid` + `remainingAfter` di invoice live-updated.
- **Halaman `/payments`**: list semua pembayaran org (server-side pagination, filter by invoice/customer/date).

## Implementation

1. **Schema**: `Payment` + enum `PaymentMethod` + index. Migration `payments`.
2. **`modules/payments/service.ts`**: `recordPayment(invoiceId, input, ctx)` — transactional (insert payment + update invoice amountPaid/remainingAfter/status + audit `PAYMENT_RECORDED`). `deletePayment` (reversal, OWNER/ADMIN, recompute status).
3. **Status recompute helper**: `recomputePaymentStatus(invoice)` — pure function, unit test.
4. **UI**: record payment dialog (form RHF + Zod, currency input, date picker, upload bukti), riwayat table di invoice detail, halaman `/payments` list.
5. **Upload bukti**: reuse `StorageService` (kind `payment-proofs`), MIME sniff, max 2MB.
6. **Audit**: PAYMENT_RECORDED (+ reversal audit sebagai PAYMENT_RECORDED metadata reversal, atau action terpisah — pakai metadata `{ reversed: true }`).
7. **Invoice list badges** (persiapan feature 08): status PARTIALLY_PAID / PAID tampil benar.

## Dependencies

- Feature 05 (invoice lifecycle, status), Feature 06 (PDF download tetap ada), Feature 02 (storage).

## Scope Limits

- **Tidak** ada payment gateway / otomatisasi pembayaran — aplikasi hanya catat manual.
- **Tidak** ada rekonsiliasi bank / match otomatis — defer.
- **Tidak** ada QRIS payment processing — QRIS hanya opsi di metode (string), bukan integrasi.
- **Tidak** ada laporan keuangan / jurnal — out of scope produk.
- **Tidak** ada notifikasi email "payment received" — defer.

## Check When Done

- [ ] Record payment pada invoice ISSUED Rp1.000.000 (grandTotal 2.250.000) → status PARTIALLY_PAID, amountPaid 1.000.000, remainingAfter 1.250.000.
- [ ] Record payment kedua Rp1.250.000 → status PAID, remainingAfter 0.
- [ ] Record payment pada invoice DRAFT → ditolak (error validasi).
- [ ] Record payment pada invoice CANCELLED → ditolak.
- [ ] Overpayment: nominal > sisa → warning konfirmasi; STAFF konfirmasi; OWNER/ADMIN bisa override dengan alasan.
- [ ] Upload bukti: image/PDF diterima, >2MB ditolak, MIME palsu ditolak, filename random.
- [ ] Delete payment (reversal): OWNER/ADMIN bisa, status invoice recompute, audit tercatat.
- [ ] VIEWER tidak bisa record payment; STAFF bisa.
- [ ] Status PAID/PARTIALLY_PAID di invoice detail + preview tampil benar (badge).
- [ ] Halaman `/payments`: list server-side pagination + filter invoice/customer/date berfungsi.
- [ ] Riwayat pembayaran per invoice lengkap (tanggal, nominal, metode, referensi, bukti, recorded by).
- [ ] Audit log PAYMENT_RECORDED + reversal tercatat; metadata tidak mengandung nomor rekening.
- [ ] Org isolation: payment org A tidak bisa diakses org B.
- [ ] Unit test: recomputePaymentStatus (0, partial, full, overpayment, draft reject, cancelled reject).
- [ ] Integration test: record payment flow end-to-end dengan test DB.
- [ ] Lint, typecheck, production build lulus.

## Commit and Push

1. Every item in `Check When Done` passes.
2. Tests pass (`npm run test`).
3. Lint and typecheck pass (`npm run lint`, `npm run typecheck`).
4. Ask which branch: **`main`** (recommended) atau new branch. Never commit silently.
5. Commit: `feat(07): payments — record payment, status recompute, proof upload, history`.
6. Push. Never force push.

## Progress Tracker

When this feature lands, update `context/progress-tracker.md`:

- Move `payments` from **Next Up** to **In Progress** at build start, then to **Completed** when `Check When Done` passes.
- Add to **Open Questions**: apakah reversal perlu alasan wajib (saat ini hanya audit); apakah metode pembayaran perlu configurable per org.
- Add to **Architecture Decisions**: status recompute pure function; transactional payment record; reversal = OWNER/ADMIN + audit metadata.
- Add one line to **Session Notes**: "Feature 07 done: record payment, status PARTIALLY_PAID/PAID, proof upload, reversal, /payments list."
- Do not touch other features' rows.
