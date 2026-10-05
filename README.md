# invoice-me

**InvoiceFlow** — platform invoice self-hosted multi-tenant untuk membuat, mengelola, dan mengekspor invoice profesional (Down Payment, Pelunasan, Full, Termin) dengan live preview A4 dan ekspor PDF.

Dibangun untuk pemakaian internal multi-organization, dirancang untuk bisa dipublikasikan sebagai SaaS self-hosted.

## Fitur

- Invoice 4 jenis penagihan: DP, Pelunasan, Full, Termin (+ Custom)
- Perhitungan otomatis dengan decimal arithmetic (PPN exclusive/inclusive/manual, terbilang Bahasa Indonesia)
- Multi-tenant: beberapa perusahaan dalam satu instance tanpa data bocor
- Multi profile invoice per organization (logo, warna brand, nomor invoice, meterai)
- Customer & PIC, Project/PO sebagai dasar penagihan, pelacakan sudah/belum ditagihkan
- Editor split-screen dengan live preview A4, autosave draft
- PDF profesional A4 multi-page via pdf-service terpisah (Playwright Chromium)
- Status lifecycle: DRAFT → ISSUED → SENT → PARTIALLY_PAID → PAID / OVERDUE / CANCELLED / REVISED
- Revision flow tanpa double-count tagihan
- Super admin panel + audit log lengkap
- Pembuatan invoice cepat (< 5 menit dari PO)

## Stack

- **Frontend**: Next.js App Router, TypeScript strict, Tailwind CSS, shadcn/ui
- **Backend**: Prisma ORM, PostgreSQL 16, Better Auth (username/email, no public registration)
- **Money**: decimal.js + Prisma Decimal (server recalculation, no floating point)
- **PDF**: pdf-service terpisah (Node + Playwright Chromium), request signed internal
- **Test**: Vitest (unit/integration), Playwright Test (E2E + PDF verification)
- **Deploy**: Docker Compose (app + postgres + pdf-service), target Coolify

## Cara menjalankan (development)

```bash
# 1. Install dependency
npm install

# 2. Jalankan PostgreSQL dev
docker compose -f docker-compose.dev.yml up -d

# 3. Setup environment
cp .env.example .env.local
# isi value lokal (DATABASE_URL, BETTER_AUTH_SECRET, INTERNAL_PDF_SECRET, dst.)

# 4. Migration + seed
npx prisma migrate dev
npx prisma db seed

# 5. Run dev server
npm run dev
```

Buka `http://localhost:3000`. Login seed super admin dari env `SEED_ADMIN_*` (ganti password setelah login pertama).

## Cara menjalankan (Docker / Coolify)

```bash
# Production compose (app + postgres + pdf-service)
docker compose up -d --build

# Atau via Coolify: link repo ini, set env vars dari .env.example, deploy
```

Env vars wajib ada di `context/architecture-context.md` (bagian Environment Variables). Validasi saat startup: app fail-fast kalau ada variable wajib hilang.

## Backup & restore

```bash
scripts/backup.sh    # pg_dump + archive uploads/PDF + checksum + retention
scripts/restore.sh   # konfirmasi eksplisit + restore DB + verifikasi checksum
```

Backup di disk yang sama **bukan backup final**. Opsi copy ke NAS/external ada di bagian Backup (rsync ke path configurable).

## Testing

```bash
npm run test         # unit + integration (Vitest)
npm run test:e2e     # E2E (Playwright)
npm run lint         # ESLint
npm run typecheck    # tsc --noEmit
npm run build        # production build
```

Yang diuji pertama: terbilang, kalkulasi invoice (no floating point error), numbering engine anti-race, org isolation, snapshot immutability.

## Bahasa & locale

UI Bahasa Indonesia. Locale `id-ID` untuk angka & tanggal. Timezone bisnis `Asia/Jakarta`, timestamp database UTC.

## Dokumentasi arsitektur

Ada di folder `context/` — product context, architecture, security, data model, UI, testing standards, dan 12 feature spec. Entry point: `AGENTS.md` di root.

## Lisensi

Private. Belum dipublikasikan.
