# Architecture Context

## Stack

| Layer | Technology | Role |
| --- | --- | --- |
| Runtime | Node.js 22 LTS (major pinned) | Server runtime, image base `node:22-bookworm-slim` |
| Language | TypeScript 5.x, strict mode | Zero `any`, validasi boundary Zod |
| Framework | Next.js (App Router) | Modular monolith: SSR dashboard, server components + client islands, API route handlers |
| UI | Tailwind CSS + shadcn/ui (Radix primitives) | Component foundation, dark/light mode, print CSS |
| ORM | Prisma | Schema, migration, typed query layer |
| Database | PostgreSQL 16 | Single source of truth, Decimal columns untuk uang |
| Auth | Better Auth (email+password, username plugin, admin plugin) | Session cookie HttpOnly+Secure+SameSite |
| Money | decimal.js | Kalkulasi domain; Prisma Decimal untuk persist |
| Tables | TanStack Table | Invoice list client-side state, server-side data |
| Forms | React Hook Form + Zod | Editor invoice + semua form |
| Tests | Vitest (unit/integration), Playwright Test (E2E + PDF verification) | Test pyramid |
| PDF | pdf-service terpisah (Node + Playwright Chromium) | Render HTML/CSS print → PDF A4 |
| Storage | Local persistent volume `/data` | uploads + generated PDF, interface siap S3/MinIO |
| Logging | pino → JSON structured stdout | Docker logs, no secret/PII |
| Error tracking | GlitchTip (self-hosted Sentry-compatible) | Application error monitoring |
| Hosting | Coolify + Docker Compose | app + postgres + pdf-service, optional cloudflared profile |

## System Boundaries

- **Client (browser)** — hanya UI + form state. Tidak ada secret, tidak ada logika finansial final. Semua kalkulasi final di server.
- **App (Next.js monolith)** — seluruh domain: auth, org, invoice engine, numbering, snapshot, audit, storage client, PDF client. Boundary satu-satunya ke luar: postgres, pdf-service, filesystem `/data`.
- **pdf-service** — container Node terpisah, Playwright Chromium headless. Route render ditandatangani `INTERNAL_PDF_SECRET`, hanya reachable di internal Docker network. Menerima HTML + payload, mengembalikan file metadata + SHA-256. Tidak boleh diakses publik.
- **postgres** — internal network only, tidak diekspos ke internet.
- **`/data` volume** — shared antara app dan pdf-service untuk tulis PDF; app-only untuk uploads.
- **Coolify** — orchestration: build dari repo `maulanaadib/invoice-me` branch main, set env vars, auto-deploy on push.

## Storage Model

- `/data/uploads/organizations/{organizationId}/{logos|signatures|references|payment-proofs}/{randomFilename}` — upload dari user (logo, tanda tangan, PO reference, bukti pembayaran).
- `/data/invoices/organizations/{organizationId}/{year}/{safeInvoiceFilename}.pdf` — PDF resmi yang sudah di-generate.
- Path TIDAK boleh berasal langsung dari input user. `organizationId` diverifikasi dari session, filename random (crypto.randomUUID), validasi path traversal.
- File download wajib lewat authorization + content-disposition. Simpan MIME, size, hash (SHA-256) di `InvoicePdf` / upload record.
- Hapus file orphan via maintenance job.
- `StorageService` interface harus dapat diganti ke S3/MinIO tanpa mengubah pemanggil (dependency injection).

## Auth and Collaboration Model

- **Identity**: Better Auth user, login dengan username **atau** email + password. Public registration dimatikan.
- **Platform role**: `SUPER_ADMIN` — dapat lihat seluruh user, organization, invoice (untuk support), audit log platform. Setiap aksi super admin tercatat.
- **Organization role**: `OWNER`, `ADMIN`, `STAFF`, `VIEWER` via Membership.
- **Scoping**: setiap query/mutation bisnis WAJIB di-scope oleh `organizationId` dari session membership aktif. Tidak ada query bisnis tanpa org scope. Cegah IDOR: id resource yang direquest diverifikasi kepemilikannya.
- **Session**: cookie HttpOnly, Secure di production, SameSite. Remember session opsional.
- **Workspace switcher**: user dengan multiple membership dapat switch organization aktif di session.

## Invariants

1. **Uang adalah Decimal.** Semua nominal disimpan `Decimal` (Prisma) dan dikalkulasi dengan decimal.js. Tidak pernah `number` floating point. Form mengirim string decimal.
2. **Server recalculation.** Grand total dan semua turunan dihitung ulang server-side saat issue. Client hanya menampilkan preview.
3. **Nomor invoice unik per organization.** Unique constraint `(organizationId, number)`. Nomor final hanya dialokasikan saat ISSUED, dalam transaksi dengan retry pada konflik.
4. **Snapshot immutability.** Saat ISSUED, snapshot (issuer, customer, contact, bank, signer, calculation, template) disimpan. Edit profile/customer/bank kemudian tidak mengubah invoice issued.
5. **Invoice issued tidak bisa diedit diam-diam.** Edit hanya via Create Revision (invoice lama → REVISED, draft baru dengan relasi parent).
6. **Draft tidak dihitung sebagai tagihan.** `previouslyBilled` hanya menghitung invoice ISSUED yang tidak CANCELLED dan tidak REVISED.
7. **Org isolation.** Tidak ada query lintas organization untuk data bisnis. Super admin adalah satu-satunya pengecualian, dan setiap view-nya teraudit.
8. **Timestamp UTC.** DB menyimpan UTC; tampilan dan laporan pakai Asia/Jakarta, locale id-ID.
9. **PDF official tidak di-render ulang dengan profile terbaru.** PDF resmi disimpan file; perubahan template tidak mengubah PDF lama.
10. **No public PDF service.** pdf-service hanya reachable internal, request ditandatangani secret dengan masa kedaluwarsa pendek.

## Environment Variables

The canonical list, decided once in Stage 5c so every feature uses the same names. A feature that needs a new variable adds a row here first, it never invents a name in its own spec.

| Variable | Purpose | Dev value | Production value |
| --- | --- | --- | --- |
| `NODE_ENV` | Environment mode | `development` | `production` |
| `APP_URL` | Public base URL app | `http://localhost:3000` | not provisioned yet (set in Coolify) |
| `APP_PORT` | Port host mapping | `3000` | not provisioned yet (set in Coolify) |
| `DATABASE_URL` | PostgreSQL connection string | `postgresql://invoice:invoice@localhost:5432/invoice_me?schema=public` | not provisioned yet (Coolify managed postgres) |
| `TEST_ADMIN_DATABASE_URL` | Optional admin Postgres URL untuk vitest globalSetup membuat DB test (default: turunan `DATABASE_URL` di `tests/test.env` → db `postgres`) | tidak di-set (pakai default) | not applicable (harness test saja, tidak masuk env.ts) |
| `BETTER_AUTH_SECRET` | Session signing secret | generated local, `.env.local` only | not provisioned yet (Coolify env) |
| `BETTER_AUTH_URL` | Base URL untuk auth callbacks | `http://localhost:3000` | not provisioned yet |
| `INTERNAL_PDF_SECRET` | Shared secret untuk request ke pdf-service | dev random di `.env.local` | not provisioned yet |
| `INTERNAL_APP_URL` | URL internal app dari pdf-service (fetch print route) | `http://localhost:3000` (host-to-host dev) | `http://app:3000` (Docker internal) |
| `PDF_SERVICE_URL` | URL internal app → pdf-service (worker memanggil `POST /render`) | `http://localhost:3090` (dev host; 3001 dipakai compose) | `http://pdf-service:3001` (Docker internal) |
| `PDF_WORKER_ENABLED` | Saklar worker antrean PdfJob di proses app (interval poll) | `true` | `true` (single instance MVP) |
| `STORAGE_ROOT` | Root volume persistent | `./.data` (dev) | `/data` |
| `UPLOAD_MAX_MB` | Max upload size (logo/signature/PO/proof) | `2` | `2` |
| `DEFAULT_TIMEZONE` | Timezone bisnis default | `Asia/Jakarta` | `Asia/Jakarta` |
| `SEED_ADMIN_USERNAME` | Seed super admin username | `superadmin` | not provisioned yet (set sekali, ganti password) |
| `SEED_ADMIN_EMAIL` | Seed super admin email | `admin@example.test` | not provisioned yet |
| `SEED_ADMIN_PASSWORD` | Seed super admin password | generated dev random | not provisioned yet (ganti setelah login pertama) |
| `BANK_ACCOUNT_ENCRYPTION_KEY` | Key encrypt nomor rekening at rest | dev key di `.env.local` | not provisioned yet (rotate di Coolify) |
| `GLITCHTIP_DSN` | Error tracking DSN | `none` (disabled in dev) | not provisioned yet (self-hosted GlitchTip) |
| `CLOUDFLARE_TUNNEL_TOKEN` | Optional cloudflared tunnel | not set | not provisioned yet (optional profile) |

Rules:
- Dev values live in the dev env file Stage 5c named (`.env.local` for Next.js), which is gitignored.
- Production values live on the hosting dashboard, never in the repo.
- A variable with no production value yet is written `not provisioned yet`, never left blank, so a missing secret is visible instead of silently `undefined`.
- Env validation saat startup: app fail-fast jika variable wajib hilang (Zod schema env).
- Test env: harness vitest memuat `tests/test.env`; `DATABASE_URL` di sana selalu menang — test tidak pernah menyentuh database dev. Variabel test tidak masuk zod schema aplikasi.
