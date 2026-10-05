# Code Standards

## General

- **TypeScript strict mode**, zero `any`. Jika butuh escape hatch, tulis komentar dengan alasan dan gunakan branded type / generic constraint.
- Semua domain logic di **service layer** (`src/modules/*/service.ts`), bukan di React component atau route handler.
- **Naming**: file `kebab-case.ts`, component `PascalCase.tsx`, hook `useXxx.ts`, type/interface `PascalCase`. Constant `UPPER_SNAKE`.
- **Bahasa**: UI string Bahasa Indonesia; code (identifier, komentar, commit message) English. Locale format `id-ID`, timezone `Asia/Jakarta` (DB UTC).
- **Dead code dilarang.** Tidak ada `TODO` tanpa ticket, tidak ada tombol palsu, tidak ada halaman dummy, tidak ada data statis yang menyamar sebagai fitur.

## TypeScript

- `strict: true`, `noUncheckedIndexedAccess: true` jika kompatibel dengan Next/Prisma.
- **Branded types** untuk ID: `type InvoiceId = string & { __brand: 'InvoiceId' }`.
- **Result pattern** untuk service return yang bisa gagal: `{ ok, data } | { ok: false, error }` (sama dengan error-handling.md shape).
- **Zod schema sebagai source of truth** tipe input: `type CreateInvoiceInput = z.infer<typeof createInvoiceSchema>`.
- **No `any`**, no `as unknown as X` tanpa komentar. Prefer type narrowing / discriminated union.
- Decimal: import dari `decimal.js`, **bukan** Prisma Decimal di domain logic (Prisma Decimal hanya di mapper layer ke persist).

## Next.js (App Router)

- **Server components default**; `'use client'` hanya untuk interaktif (form, table state, preview).
- Route handler (`route.ts`) tipis: validate (Zod) → call service → map ke `ApiResponse` shape.
- **Server actions** boleh untuk form mutation sederhana; service layer masih paling dalam.
- **`print/invoices/[id]` route internal**: hanya bisa diakses dengan signed short-lived token, bukan cookie session (pdf-service fetch ini).
- Loading state via `loading.tsx`, error via `error.tsx`, not-found via `not-found.tsx`.
- **Layout**: root layout (html, theme provider, fonts), `(auth)` group untuk login, `(dashboard)` group untuk app, `admin` segment untuk super admin.
- **Metadata**: Indonesian title/description per route; `robots.txt` noindex untuk app routes (auth-walled).

## Styling

- Tailwind CSS + shadcn/ui. Pakai token CSS variable (ui-context.md), **no hardcoded hex**.
- `cn()` helper (clsx + tailwind-merge) untuk conditional class.
- **Print CSS**: `@media print` terpisah, selalu light, A4 portrait, no nav/chrome.
- Responsive: mobile-first; invoice editor jadi tab Form/Preview di tablet/mobile.

## API Routes

- Semua response pakai `ApiResponse<T>` shape (error-handling.md).
- **Method dispatch** eksplisit (`GET`/`POST`/...), unknown method → 405.
- **Auth check di route** (middleware atau layout guard) + **authorization di service**.
- Error dari service (`AppError`) dipetakan di satu `withErrorHandler` wrapper, tidak di setiap route.

## Data and Storage

- **Prisma single instance** (`src/server/db.ts`), tidak di-init per request.
- **Transaction** untuk mutation penting: issue invoice, numbering allocation, payment status update, revision.
- **Isolation level**: issue flow pakai `Serializable` jika perlu anti-race numbering, dengan retry on conflict.
- Decimal column untuk semua nominal (`@db.Decimal(18, 2)`); percentage `Decimal(5, 2)`.
- **Soft delete** hanya untuk Customer (`deletedAt`); invoice tidak pernah hard-delete issued, draft bisa hapus.
- Upload: `StorageService.upload(file, { orgId, kind })` → `{ path, size, mimeType, sha256 }`. Path dari orgId + random filename.
- Download: `StorageService.read(path)` + authorization check sebelum stream + `Content-Disposition`.

## File Organization

```
src/
├── app/                    # routes (thin)
│   ├── (auth)/
│   ├── (dashboard)/
│   ├── admin/
│   ├── api/
│   └── print/
├── components/
│   ├── ui/                 # shadcn foundation (DO NOT MODIFY)
│   ├── invoice/            # InvoiceRenderer, editor components
│   ├── forms/
│   ├── tables/
│   └── layout/
├── modules/                # domain (service layer) — satu feature satu module
│   ├── auth/
│   ├── organizations/
│   ├── permissions/
│   ├── profiles/
│   ├── customers/
│   ├── projects/
│   ├── invoices/
│   ├── payments/
│   ├── bank-accounts/
│   ├── pdf/
│   ├── storage/
│   └── audit/
├── lib/                    # infra helpers (decimal, terbilang, date, crypto)
├── server/                 # db, env, auth config (server-only)
├── styles/
└── types/
pdf-service/
├── src/
├── Dockerfile
└── package.json
prisma/
├── schema.prisma
├── migrations/
└── seed.ts
tests/
├── integration/
├── e2e/
└── factories.ts
scripts/
├── backup.sh
├── restore.sh
└── healthcheck.sh
docker-compose.yml
docker-compose.dev.yml
Dockerfile
Dockerfile.pdf
.env.example
README.md
```
