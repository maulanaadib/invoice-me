# Architecture Standards

The shape of the system. A feature spec describes what to build; this file constrains where it goes and how it connects.

## Architecture Style

**Modular monolith** untuk app utama + **satu service terpisah `pdf-service`**.

Satu deploy, satu codebase, module boundaries enforced by convention dan lint (eslint boundary rules), bukan network. pdf-service terpisah karena Playwright Chromium butuh isolasi runtime (image berbeda, resource berbeda) — ini keputusan isolasi teknis, bukan langkah menuju microservices.

Microservices membeli independent deploy dengan menambah distributed-system failure mode yang small team tidak bisa absorb. Jadi pilihan: modular monolith.

## Module Boundaries

| Module | Owns |
| --- | --- |
| `modules/auth` | Better Auth config, session, login/logout, rate limit, lockout, force password change |
| `modules/organizations` | Organization, Membership, workspace switch, role assignment |
| `modules/permissions` | Central permission service: `can(action, resource, ctx)` — satu pintu authorization. Tidak ada string role acak di feature files. |
| `modules/customers` | Customer + CustomerContact CRUD |
| `modules/projects` | ProjectReference, perhitungan sudah/belum ditagihkan |
| `modules/invoices` | Invoice, InvoiceItem, editor, calculation engine, numbering engine, issue flow, lifecycle, revision |
| `modules/payments` | Payment record, update status invoice |
| `modules/bank-accounts` | BankAccount (encrypt at rest), Signer |
| `modules/pdf` | PDF client, PdfJob queue, InvoicePdf record |
| `modules/storage` | StorageService interface (local + S3-ready), upload validation, download authorization |
| `modules/audit` | AuditLog write helper + query |
| `modules/profiles` | InvoiceProfile, sequence config |

A feature touches one module; crossing two is a scope split, bukan design choice. `modules/permissions` dan `modules/audit` boleh diimpor oleh modul lain (cross-cutting), sisanya tidak saling impor internal.

## When To Split

- **Measured evidence only**: team boundary, scaling bottleneck yang terukur, atau independent deploy need.
- **Never anticipated scale.** Jangan pecah modul karena "nanti pasti besar".
- pdf-service sudah terpisah sekarang karena dependency Playwright berat — ini bukan split speculative, ini constraint runtime.
- Split trigger berikutnya yang paling mungkin: storage ke S3/MinIO (sudah diantisipasi via interface, bukan dengan premature extraction).

## Cross Module Contracts

- Modul memanggil modul lain **hanya** via exported service function (typed interface), same-process call, no network hop.
- Cross-cutting (`permissions`, `audit`) dipanggil di dalam service layer, tidak di route handler atau component.
- `invoices` memanggil `projects` (hitung previouslyBilled), `pdf` (trigger job), `storage` (simpan file), `audit` (catat aksi) — semua via service function.
- Event-ish: issue invoice memicu PDF job via fungsi `pdf.enqueueJob()`, bukan message broker.

## Dependency Direction

- `app/` (routes) → `modules/` (service) → `lib/` + `server/` (infra) → prisma client.
- `components/` stateless presentational, menerima props, tidak impor modul internal.
- Tidak ada cycle. Tidak ada modul mengimpor internal modul lain kecuali cross-cutting yang sudah disebut.
- Client component (`'use client'`) tidak boleh impor prisma atau service layer server-only.

## Scaling Posture

- **Apa yang diharapkan scale**: invoice list per organization (pagination server-side wajib dari feature 08), PDF generation concurrency terbatas (queue + retry), storage file count tumbuh terus (path per org/tahun).
- **Apa yang tidak di-scale untuk MVP**: realtime, read replica, caching layer, CDN, horizontal scaling app. Single instance app + single postgres cukup untuk target penggunaan.
- **Anti premature optimization**: jangan tambah caching atau queue external (BullMQ/Redis) di feature spec tanpa measured evidence. Job queue internal (table `PdfJob` + poll) cukup.
