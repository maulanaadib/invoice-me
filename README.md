# invoice-me

**InvoiceFlow** — platform invoice self-hosted multi-tenant. Membuat, mengelola, dan mengekspor invoice profesional (Down Payment, Pelunasan, Full, Termin) dengan live preview A4 dan ekspor PDF.

## Status

Spec-driven development (SDD). Context bundle + 12 feature specs sudah ada di `context/`. Build berjalan satu feature pada satu waktu.

## Stack

- Next.js App Router + TypeScript strict + Tailwind + shadcn/ui
- Prisma + PostgreSQL 16
- Better Auth (username/email, no public registration)
- decimal.js (uang), Vitest + Playwright (test)
- pdf-service terpisah (Playwright Chromium)
- Docker Compose (app + postgres + pdf-service), deploy target Coolify

## Struktur

```
context/                  # SDD bundle (contracts — jangan diedit sembarangan)
├── AGENTS.md             # baca ini pertama
├── feature-specs/        # 12 feature spec (00-11)
└── *.md                  # context files (product, architecture, security, ...)
```

## Cara build

Satu feature per chat:

```bash
# baca context/AGENTS.md dulu, lalu satu feature spec
# /selcy 00-project-setup
```

Update `context/progress-tracker.md` di akhir setiap chat.

## Bahasa

UI: Bahasa Indonesia. Locale `id-ID`. Timezone `Asia/Jakarta` (DB UTC). Code & identifier: English.
