# Feature 05: Invoice Issue & Lifecycle

## Goal

Implementasi issue flow (penerbitan): validasi ulang, alokasi nomor final anti-race, snapshot immutability, lock data finansial, trigger PDF job, serta status lifecycle dan revision flow. Setelah feature ini, invoice bisa diterbitkan sebagai dokumen resmi yang tidak bisa diubah diam-diam.

## Design

- **Issue flow** (tombol "Issue Invoice" di `/invoices/[id]` atau `/invoices/[id]/edit`):
  1. Validasi ulang seluruh data (Zod + completeness: profile, customer, item ≥ 1, billingBase > 0).
  2. **Hitung ulang seluruh angka di server** (calculation engine feature 04). Total yang dikirim client diabaikan.
  3. **Alokasi nomor final** dalam transaksi dengan isolation level memadai (`Serializable`) + retry terbatas (maks 3) pada konflik sequence. Sequence increment atomik (`InvoiceSequence` row lock via `SELECT ... FOR UPDATE` atau Prisma interactive transaction).
  4. Simpan snapshot: `issuerSnapshot`, `customerSnapshot`, `contactSnapshot`, `bankSnapshot`, `signerSnapshot`, `calculationSnapshot`, `templateSnapshot`.
  5. Status `DRAFT` → `ISSUED`. `issuedAt`, `issuedById` terisi. `number` terisi final (unique per org).
  6. **Data finansial dikunci**: field workValue/billingBase/grandTotal/items tidak bisa diubah lagi. `remainingAfter` = grandTotal.
  7. Audit log `INVOICE_ISSUED` dalam transaksi yang sama.
  8. **Trigger PDF job** (PdfJob status PENDING, feature 06 yang memproses; di feature 05 hanya enqueue + status menunggu).
  9. Draft yang gagal alokasi nomor (semua retry habis) → rollback total, invoice tetap draft, error `CONFLICT`.
- **Status lifecycle** (`InvoiceStatus`): DRAFT → ISSUED → SENT → PARTIALLY_PAID → PAID; OVERDUE (cron/scheduled check atau on-read: dueDate lewat && belum lunas); CANCELLED (alasan wajib, tetap disimpan, tidak dihitung sebagai tagihan aktif); REVISED (invoice lama digantikan).
- **Create Revision**:
  1. Invoice lama ditandai `REVISED`, `replacedById` diisi.
  2. Salin data menjadi draft baru (status DRAFT), `revisedFromId` = invoice lama.
  3. Relasi parent/replacement tersimpan; audit `INVOICE_REVISED`.
  4. Invoice lama tetap bisa diaudit, tidak dihitung dua kali di previouslyBilled (REVISED di-exclude).
- **Cancel invoice** (OWNER/ADMIN): alasan wajib, status CANCELLED, audit, excluded dari previouslyBilled.
- **Mark sent** (STAFF+): status ISSUED → SENT, audit. Bisa record payment (feature 07 mengubah lebih lanjut).
- **Snapshot immutability**: edit profile/customer/bank/signer setelah issue **tidak mengubah** invoice issued (baca dari snapshot JSON, bukan relasi live).
- **PDF official tidak di-render ulang**: link ke file InvoicePdf (feature 06), bukan render ulang.
- **Permission**: STAFF+ bisa issue + mark sent; OWNER/ADMIN cancel + revise; VIEWER tidak.

## Implementation

1. **Schema**: field Invoice yang belum ada (`issuedAt`, `cancelledAt`, `cancellationReason`, `revisedFromId`, `replacedById`, snapshot columns, `remainingAfter`) — ada di feature 04 migration atau tambah migration `invoice-lifecycle`. Tambah `PdfJob` + enum `PdfJobStatus` + `InvoicePdf` minimal (storage penuh feature 06).
2. **`modules/invoices/issue-service.ts`**: `issueInvoice(invoiceId, ctx)` — transactional, retry on conflict, snapshot build, audit, enqueue job.
3. **`modules/invoices/lifecycle-service.ts`**: markSent, cancel(reason), createRevision, recomputeOverdue (on-read + scheduled).
4. **`modules/projects/service.ts`**: implement `billedToDate(projectId)` sekarang (invoice table ada) + tampilkan di project detail (feature 03 placeholder diisi nyata).
5. **`modules/pdf/service.ts`** (client side): `enqueuePdfJob(invoiceId, ctx)` → create PdfJob PENDING. Worker memproses di feature 06.
6. **UI**: halaman `/invoices/[id]` detail + tombol Issue/Cancel/Revise/Mark Sent + confirmation dialog destruktif. `/invoices/[id]/edit` untuk draft only (redirect jika ISSUED).
7. **OVERDUE computation** (on-read): on-read check `dueDate < now && status in [ISSUED, SENT, PARTIALLY_PAID]` → tampilkan badge OVERDUE; scheduled job harian update status (cron di app atau Coolify scheduled task — pilih cron internal Next.js tidak ada, pakai route + Coolify/cron host; defer ke feature 11, di sini on-read saja).
7. **Unit test**: numbering concurrency (parallel 10 issue → 10 nomor unik berurutan), revision double-count exclusion, previouslyBilled excludes draft/cancelled/revised.
8. **Integration test**: issue flow end-to-end dengan test DB, snapshot immutability (edit profile → invoice issued tidak berubah).

## Dependencies

- Feature 04 (invoice engine, calculation, numbering, InvoiceRenderer).
- Feature 03 (projects, untuk billedToDate).
- `data-model.md` untuk snapshot columns + PdfJob.

## Scope Limits

- **Tidak** render PDF / pdf-service worker — feature 06. Hanya enqueue PdfJob PENDING + tampilkan status "PDF menunggu" yang honest (bukan fake download).
- **Tidak** record payment / status PAID — feature 07.
- **Tidak** ada invoice list row actions penuh — feature 08.
- **Tidak** ada scheduled job OVERDUE otomatis — feature 11 (on-read check saja di sini).
- **Tidak** ada email "invoice sent" — defer.

## Check When Done

- [ ] Issue flow: draft lengkap → issue → status ISSUED, nomor final `INV/SB/VII/2026/001` terisi, snapshot tersimpan.
- [ ] **Concurrency test**: 10 issue paralel di profile+bulan yang sama → 10 nomor unik (001–010), tidak ada duplikat, tidak ada invoice setengah jadi.
- [ ] Retry pada konflik sequence bekerja (simulasi: 2 issue bersamaan, salah satu retry).
- [ ] Invoice issued tidak bisa diedit (route edit redirect ke detail; mutation service tolak dengan `LOCKED` error).
- [ ] Snapshot immutability integration test: edit profile (nama/alamat/logo), edit customer, edit bank → tampilkan invoice issued, isinya **tidak berubah** (baca dari snapshot).
- [ ] Cancel: alasan wajib, status CANCELLED, excluded dari previouslyBilled.
- [ ] Revision: invoice lama REVISED + relasi replacement; draft baru dari salinan; previouslyBilled tidak double-count (invoice REVISED di-exclude).
- [ ] Mark sent: status SENT, audit.
- [ ] OVERDUE on-read: invoice lewat due date tampil badge OVERDUE.
- [ ] billedToDate di project detail sekarang menampilkan angka nyata (feature 03 placeholder diisi).
- [ ] Audit log: INVOICE_ISSUED, INVOICE_SENT, INVOICE_CANCELLED, INVOICE_REVISED tercatat.
- [ ] Permission: STAFF bisa issue, tidak bisa cancel/revise (OWNER/ADMIN only); VIEWER tidak bisa issue.
- [ ] Org isolation: issue invoice org A dari session org B → 404.
- [ ] Unit test: numbering concurrency, revision exclusion, previouslyBilled rules.
- [ ] Integration test: issue flow + snapshot immutability.
- [ ] Lint, typecheck, production build lulus.

## Commit and Push

1. Every item in `Check When Done` passes.
2. Tests pass (`npm run test`).
4. Lint and typecheck pass (`npm run lint`, `npm run typecheck`).
5. Ask which branch: **`main`** (recommended) atau new branch. Never commit silently.
6. Commit: `feat(05): invoice issue flow, numbering allocation anti-race, snapshot immutability, lifecycle, revision`.
7. Push. Never force push.

## Progress Tracker

When this feature lands, update `context/progress-tracker.md`:

- Move `invoice-issue-lifecycle` from **Next Up** to **In Progress** at build start, then to **Completed** when `Check When Done` passes.
- Add to **Open Questions**: apakah OVERDUE scheduled job perlu cron host (feature 11) atau on-read saja cukup.
- Add to **Architecture Decisions**: Serializable isolation + retry untuk numbering; snapshot read-after-issue; REVISED excluded dari previouslyBilled; PdfJob enqueue-only di feature 05.
- Add one line to **Session Notes**: "Feature 05 done: issue flow anti-race, snapshot, lifecycle, revision, cancel, mark sent, overdue on-read, billedToDate."
- Do not touch other features' rows.
