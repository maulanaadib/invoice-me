# Feature 04: Invoice Engine Core

## Goal

Bangun inti produk: editor invoice split-screen dengan live preview A4, dynamic item table, kalkulasi decimal untuk 4 jenis penagihan, terbilang Bahasa Indonesia, dan numbering engine anti-race. Setelah feature ini, user bisa membuat draft invoice lengkap dengan perhitungan benar.

## Design

- **Editor** (`/invoices/new`, `/invoices/[id]/edit`): layout **split-screen desktop** — kiri form, kanan sticky live preview A4. Tablet/mobile: tab `Form` / `Preview`. Satu source komponen render (`InvoiceRenderer`) untuk preview dan print route (feature 06).
- **Form section/step** (master prompt bagian 11): (1) Profile invoice, (2) Jenis penagihan, (3) Informasi invoice, (4) Customer/PIC, (5) Project/PO, (6) Item pekerjaan, (7) Pajak dan ringkasan, (8) Pembayaran (pilihan rekening), (9) Catatan, (10) Meterai dan tanda tangan, (11) Preview dan terbitkan.
- **Autosave draft** dengan debounce + indikator "tersimpan"; warning saat leaving page dengan unsaved changes (`beforeunload` + route block).
- **Item table dinamis**: No, Deskripsi, detail/subdeskripsi opsional, Qty, Unit, Unit price, Discount opsional, Amount, urutan. Fitur: add, remove, duplicate, **drag reorder** (library DnD stabil: `@dnd-kit/core` + `@dnd-kit/sortable`), tab/keyboard navigation, unit preset (Unit, Pcs, Set, Lot, Paket, Jasa, Jam, Hari, Bulan, custom), validasi qty > 0 dan price >= 0.
- **Jenis invoice** (`InvoiceType`):
  - `FULL` — billingBase = workValue.
  - `DOWN_PAYMENT` — input persentase (mis. 50%) **atau** nominal manual. billingBase = workValue × pct / 100. **Qty & unit price tetap menunjukkan nilai asli** (mis. 5 × Rp900.000), tidak diubah setengah. Badge: `DOWN PAYMENT 50%`.
  - `SETTLEMENT` — billingBase = max(workValue − previouslyBilled, 0). previouslyBilled hanya dari invoice ISSUED non-CANCELLED non-REVISED yang terlink project. Tampil: nilai pekerjaan, sudah ditagihkan, sisa/pelunasan, total ditagihkan sekarang.
  - `TERM` — nama termin, nomor termin, persentase atau nominal manual, catatan. Badge: `TERMIN 2 — 40%`.
  - `CUSTOM` — label + billing base manual, butuh permission + alasan jika melebihi workValue.
- **Kalkulasi** (`modules/invoices/calculation.ts`, decimal.js, dirancang untuk **dipanggil ulang server-side saat issue**):
  - `lineAmount = quantity × unitPrice − lineDiscount`
  - `itemsSubtotal = Σ lineAmount`
  - `workValue = itemsSubtotal` (override manual hanya via toggle + alasan, permission)
  - DP: `billingBase = workValue × percentage / 100` atau `manualBillingAmount`
  - Settlement: `billingBase = max(workValue − previouslyBilled, 0)`
  - Pajak mode: `NONE`, `EXCLUSIVE` (taxAmount = taxableBase × pct / 100), `INCLUSIVE` (pisahkan pajak dari nilai termasuk pajak dengan formula decimal benar), `MANUAL` (input nominal).
  - `grandTotal = billingBase − invoiceDiscount + additionalCharge + taxAmount + roundingAdjustment`
- **Terbilang** (`lib/terbilang.ts`): Bahasa Indonesia, input grandTotal. Sumber kebenaran: master prompt — 2.250.000 → "Dua juta dua ratus lima puluh ribu rupiah", 4.500.000 → "Empat juta lima ratus ribu rupiah", 100.000 → "Seratus ribu rupiah", 1.000.000 → "Satu juta rupiah", 1.001.000 → "Satu juta seribu rupiah". Prefix "Dua juta...", suffix "rupiah". Tidak ada "satu" di depan juta (1.000.000 = "Satu juta rupiah" — terbilang natural).
- **Numbering engine** (`modules/invoices/numbering.ts`): parse pattern `INV/{CODE}/{ROMAN_MONTH}/{YYYY}/{SEQ:3}` → `INV/SB/VII/2026/001`. Token: `{CODE}`, `{TYPE}`, `{DD}`, `{MM}`, `{ROMAN_MONTH}`, `{YY}`, `{YYYY}`, `{SEQ:2}`, `{SEQ:3}`, `{SEQ:4}`, `{SEQ:5}`. Reset policy MONTHLY/YEARLY/NEVER. Draft pakai `numberPreview` (nomor sementara), nomor final hanya saat ISSUED (feature 05).
- **Form mengirim nominal sebagai string decimal** (bukan number); client hitung preview pakai decimal.js juga agar preview = hasil server.

## Implementation

1. **Schema migration**: `Invoice`, `InvoiceItem` + enum `InvoiceType`, `InvoiceStatus`, `TaxMode` (stampMode & referenceType sudah dari feature 02/03 kalau dipakai — buat yang belum). Migration `invoice-engine`.
2. **`modules/invoices/calculation.ts`** + unit test ekstensif (lihat Check When Done).
3. **`lib/terbilang.ts`** + unit test ekstensif.
4. **`modules/invoices/numbering.ts`** + unit test (pattern parse, preview, reset policy).
5. **`modules/invoices/service.ts`**: createDraft, updateDraft (autosave), getDraft, list drafts; server-side recalculation pada setiap save (total yang disimpan = hasil server, bukan client).
6. **Editor UI**: split-screen layout, section navigation, item table dengan `@dnd-kit`, currency input (format id-ID, simpan string), percent input, badging jenis invoice di preview.
7. **InvoiceRenderer** (`components/invoice/InvoiceRenderer.tsx`): **satu komponen** dipakai preview + print route. Props: invoice data (client-safe). Style print A4 portrait, light. **Render PDF penuh + print route di feature 06**; di sini renderer sudah mengikuti tata letak Corporate Blue (header kiri-kanan, bill-to, item table, ringkasan, footer) untuk preview.
8. **Prefill from project**: panggil `modules/projects/prefill` (dari feature 03 contract) — customer, reference, workValue, items copy.
9. **Permission**: STAFF+ create/edit draft; VIEWER tidak. OWNER/ADMIN bisa hapus draft. Issue adalah feature 05.

## Dependencies

- Feature 01 (auth, permission, audit), Feature 02 (profile, bank, signer, storage), Feature 03 (customer, PIC, project).
- `decimal.js`, `@dnd-kit/*` (library DnD stabil).

## Scope Limits

- **Tidak** issue invoice (alokasi nomor final, snapshot, lock) — feature 05. Tombol "Issue Invoice" ada di UI tapi memanggil feature 05 endpoint; **jangan implement di sini** — tombol disabled dengan tooltip "Tersedia setelah feature 05" adalah placeholder jujur yang **tidak diperbolehkan** (aturan no-tombol-palsu). Konsekuensinya: di feature 04 hanya ada tombol **Save Draft** dan **Preview**. Tombol **Issue Invoice** adalah scope feature 05.
- **Tidak** generate PDF — feature 06. Preview di sini adalah HTML render, bukan PDF.
- **Tidak** ada status flow (SENT/PAID) — feature 05/07.
- **Tidak** ada revision flow — feature 05.
- **Tidak** ada invoice list dengan row actions penuh — feature 08 (list minimal draft bisa ada di feature 04 untuk navigasi, tanpa filter lengkap).
- **Tidak** ada meterai e-meterai gambar nyata — placeholder layout saja.
- Currency IDR saja.

## Check When Done

- [ ] Editor split-screen: kiri form, kanan preview A4 yang update real-time sesuai input.
- [ ] Item table: add/remove/duplicate/drag reorder bekerja; keyboard tab navigation; unit preset dropdown + custom.
- [ ] Validasi: qty <= 0 ditolak, unit price negatif ditolak, max item (default 50, configurable).
- [ ] Autosave draft berfungsi (debounce ~1s), indikator "tersimpan" tampil, warning saat leave dengan unsaved.
- [ ] **Kalkulasi unit test lulus (decimal, no floating point error)**:
  - full tanpa pajak: items 5 × 900.000 → grandTotal = 4.500.000.
  - DP 50%: workValue 4.500.000 → billingBase 2.250.000, grandTotal 2.250.000; qty/price tetap 5 × 900.000.
  - DP 10%: 450.000.
  - pelunasan setelah DP: previouslyBilled 2.250.000 → billingBase 2.250.000.
  - termin 40%: 1.800.000.
  - PPN exclusive 11%: taxAmount = base × 0.11.
  - PPN inclusive: base 2.250.000 include 11% → taxAmount = 223.423 (rounded per formula), base net = 2.026.577 — assert formula decimal benar.
  - manual tax: input nominal.
  - discount + additional + rounding.
- [ ] **Terbilang unit test lulus**: nol → "Nol rupiah"; 2.250.000 → "Dua juta dua ratus lima puluh ribu rupiah"; 4.500.000 → "Empat juta lima ratus ribu rupiah"; 100.000 → "Seratus ribu rupiah"; 1.000.000 → "Satu juta rupiah"; 1.001.000 → "Satu juta seribu rupiah"; angka besar (1.500.000.000) benar.
- [ ] **Numbering unit test lulus**: pattern `INV/{CODE}/{ROMAN_MONTH}/{YYYY}/{SEQ:3}` → `INV/SB/VII/2026/001`; `{MM}`, `{DD}`, `{YY}`, `{SEQ:2|4|5}` benar; reset MONTHLY/YEARLY/NEVER sequenceKey benar.
- [ ] Preview invoice DP menampilkan badge `DOWN PAYMENT 50%`, item 5 × Rp900.000, nilai pekerjaan Rp4.500.000, total ditagihkan Rp2.250.000, terbilang benar.
- [ ] Prefill dari project: customer + reference + workValue + items terisi.
- [ ] Settlement menampilkan: nilai pekerjaan, sudah ditagihkan, sisa, total ditagihkan sekarang.
- [ ] Permission: VIEWER tidak bisa create/edit draft.
- [ ] Org isolation: draft org A tidak bisa diakses user org B (404).
- [ ] Audit log: invoice draft created/updated tercatat.
- [ ] Integration test: create draft → autosave → reload → data konsisten.
- [ ] Lint, typecheck, production build lulus.

## Commit and Push

1. Every item in `Check When Done` passes.
2. Tests pass (`npm run test`).
3. Lint and typecheck pass (`npm run lint`, `npm run typecheck` → `tsc --noEmit`).
4. Ask which branch: **`main`** (recommended) atau new branch. Never commit silently.
5. Commit: `feat(04): invoice engine core — editor, calculation, terbilang, numbering`.
6. Push. Never force push.

## Progress Tracker

When this feature lands, update `context/progress-tracker.md`:

- Move `invoice-engine-core` from **Next Up** to **In Progress** at build start, then to **Completed** when `Check When Done` passes.
- Add to **Open Questions**: apakah max item 50 sudah tepat; apakah override workValue manual perlu permission khusus (saat ini toggle + alasan).
- Add to **Architecture Decisions**: decimal.js + server recalculation invariant; terbilang natural (no "satu juta" prefix); numbering preview vs final; satu InvoiceRenderer untuk preview + print; tombol Issue di-scope ke feature 05 (feature 04 hanya Save Draft + Preview).
- Add one line to **Session Notes**: "Feature 04 done: editor split-screen, item table DnD, calculation decimal, terbilang, numbering preview, autosave draft."
- Do not touch other features' rows.
