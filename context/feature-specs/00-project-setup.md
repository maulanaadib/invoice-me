# invoice-me Project Setup

## Goal

Stand up the raw project from the stack decision and clean the framework boilerplate, so feature 01 builds into a real project instead of a template. No product behavior lives in this file.

## Scaffold

Initialize the project with the framework's own initializer for the stack Stage 3 chose. Keep the repo the initializer creates. Install only what the first slice needs, not every library the stack names.

1. `npx create-next-app@latest . --typescript --tailwind --eslint --app --src-dir --import-alias "@/*" --use-npm` (repo sudah ada README + git, jangan `git init` ulang; pakai existing repo).
2. Pastikan `tsconfig.json` strict mode aktif (`"strict": true`).
3. Inisialisasi shadcn/ui: `npx shadcn@latest init` (style default, base color slate, CSS variables yes). Tambahkan komponen dasar yang dipakai placeholder + layout: `button`, `card`, `input`, `label`, `avatar`, `dropdown-menu`, `separator`, `skeleton`, `toast`, `sheet`, `dialog`, `badge`, `table`, `form`, `select`, `tabs`, `tooltip`, `command`, `calendar`, `checkbox`, `textarea`, `progress`.
4. Install dependency foundation (hanya yang dipakai slice ini + feature 01): `prisma`, `@prisma/client`, `better-auth`, `decimal.js`, `zod`, `react-hook-form`, `@hookform/resolvers`, `@tanstack/react-table`, `lucide-react`, `next-themes`, `pino`.
5. Dev dependency: `vitest`, `@playwright/test`, `prettier`, dan type package sesuai kebutuhan.
6. Buat struktur folder kontrak dari `code-standards.md`: `src/modules/`, `src/lib/`, `src/server/`, `src/components/{ui,invoice,forms,tables,layout}`, `src/types/`, `tests/integration`, `tests/e2e`, `pdf-service/src`, `scripts/`, `prisma/`.
7. Setup `next/font` Inter (`--font-sans`) + mono stack. Font open-source, tersedia di container.
8. Buat `src/server/env.ts`: Zod schema env validation, fail-fast saat startup untuk variable wajib (`DATABASE_URL`, `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `INTERNAL_PDF_SECRET`, `STORAGE_ROOT`). Optional: `GLITCHTIP_DSN` (none = disabled), `SEED_*`, `CLOUDFLARE_TUNNEL_TOKEN`.
9. Buat `src/server/db.ts`: single PrismaClient instance (globalThis guard untuk dev hot reload).
10. Buat `prisma/schema.prisma` dengan datasource postgres + generator client + enum `PlatformRole`, `UserStatus` (minimal untuk feature 01; feature lain menambah entity via migration masing-masing — **jangan** membuat seluruh schema di feature ini).
11. Buat `src/server/auth.ts`: Better Auth config (email+password plugin, username plugin, admin plugin placeholder — detail login flow di feature 01). Hanya export `auth` handler + helpers.
12. Buat root layout: theme provider (`next-themes`), font, metadata Bahasa Indonesia, `globals.css` dengan CSS variable tokens dari `ui-context.md`.
13. Buat placeholder page `(dashboard)`: render sederhana "invoice-me" + tombol dummy yang **tidak** menyamar sebagai fitur (hanya label "Setup complete — feature 01 builds here"). Root page redirect ke `/dashboard` (atau `/login` setelah feature 01).
14. Buat `/health` route: cek db reachable + storage writable, return JSON `{ status: "ok" | "degraded", checks: {...} }`. Tidak membocorkan secret.
15. Buat pino logger `src/server/logger.ts`: JSON structured ke stdout, redact path untuk secret/PII.
16. Setup GlitchTip SDK (`sentry` compatible atau `@sentry/nextjs` bila GlitchTip compatible) — aktif hanya jika `GLITCHTIP_DSN` set.

## Docker & pdf-service skeleton

17. `Dockerfile` multi-stage production (deps → build → runner), base `node:22-bookworm-slim`, standalone output Next.js.
18. `Dockerfile.pdf`: base `node:22-bookworm-slim` + Playwright Chromium system deps install, copy `pdf-service/`.
19. `docker-compose.yml`: service `app`, `postgres` (image `postgres:16-alpine`), `pdf-service`. Internal network untuk postgres + pdf-service (tidak expose port). Volume: `postgres-data`, `uploads`, `invoices`. Healthcheck setiap service. `depends_on` dengan `condition: service_healthy`. Restart `unless-stopped`. Profile `cloudflared` opsional (token dari env).
20. `docker-compose.dev.yml`: postgres saja untuk dev lokal (app jalan via `npm run dev`), volume `.data` untuk `STORAGE_ROOT`.
21. `.env.example` berisi **seluruh** env var table dari `architecture-context.md` dengan contoh value aman + komentar.
22. `scripts/healthcheck.sh` (dipanggil Docker healthcheck app: curl `/health`), `scripts/backup.sh` + `scripts/restore.sh` placeholder (diisi penuh di feature 11 — **di sini hanya stub dengan komentar jelas**, bukan tombol palsu).
23. `pdf-service/`: `package.json` (Node 22, `express`/`next` minimal — pilih HTTP server minimal), `/health` endpoint, `/render` route dengan signed token verification (HMAC `INTERNAL_PDF_SECRET` + expiry check), Playwright launch config, konfigurasi untuk write PDF ke shared volume. **Render penuh HTML→PDF diisi di feature 06**; di sini hanya skeleton + health + signature verification yang bekerja.
24. `.dockerignore`, `.gitignore` (termasuk `.env.local`, `.data/`, `node_modules`, `.next`, `test-results`, `playwright-report`).
25. `README.md` diperluas: cara menjalankan dev (`docker compose -f docker-compose.dev.yml up -d` + `npm i` + `npx prisma migrate dev` + `npm run dev`), cara Docker production, daftar env var, link ke dokumentasi context bundle.

## Boilerplate Cleanup

What to delete, what to simplify, what the placeholder page renders.

- Hapus halaman default `create-next-app` (gambar/logo Next.js yang berputar, konten boilerplate).
- Hapus `public/` asset default (svg Next.js) yang tidak dipakai.
- Sederhanakan `app/page.tsx` jadi redirect ke `/dashboard`.
- Bersihkan `globals.css` dari demo style `create-next-app`; ganti dengan token CSS variable dari `ui-context.md` (`:root` + `.dark`).
- Hapus ESLint config bawaan yang konflik dengan prettier; setup prettier + eslint config yang sesuai.
- Pastikan tidak ada `useRef`/demo code yang tidak terpakai.

## Verify

A dev server or build runs, and the placeholder page renders. Nothing else is verified here.

- `npm run dev` jalan, `http://localhost:3000` render placeholder (redirect ke `/dashboard`).
- `npm run build` lulus (production build).
- `npm run lint` + `npm run typecheck` (`tsc --noEmit`) lulus.
- `docker compose -f docker-compose.dev.yml up -d` postgres reachable; app connect DB sukses (Prisma bisa `db push` ke dev schema).
- `docker compose up -d --build` (production compose) ketiga service healthy: `/health` app 200, postgres healthy, pdf-service `/health` 200.
- Next.js docs di `node_modules/next/dist/docs/` dibaca sebelum menulis kode Next.js (aturan `AGENTS.md`).

## GitHub Repository

Create the remote and push the first commit.

The engineer already created the repo: `https://github.com/maulanaadib/invoice-me` (sudah berisi README + first commit di branch main).

- Repo lokal sudah di-init di `/root/workspaces/agent-build/invoice-me` dengan remote `origin` = `https://github.com/maulanaadib/invoice-me.git` (dikonfigurasi oleh orchestrator).
- Jangan `git init` ulang, jangan overwrite branch main yang ada. Tambah commit di atasnya.
- Push scaffold + cleanup sebagai **satu commit** (bukan banyak).

## First Deploy

Stage 5c decided the first deploy happens here (auto-deploy on push ke main via Coolify).

Langkah (butuh interaksi engineer untuk nilai production):

1. Create project di Coolify, link ke repo `maulanaadib/invoice-me`, branch `main`, build type Docker Compose (atau Dockerfile + compose resource).
2. Set setiap env var dari `architecture-context.md` env table dengan production value: `NODE_ENV=production`, `APP_URL`, `APP_PORT`, `DATABASE_URL` (postgres managed Coolify atau service compose), `BETTER_AUTH_SECRET` (generate), `BETTER_AUTH_URL`, `INTERNAL_PDF_SECRET` (generate), `INTERNAL_APP_URL=http://app:3000`, `STORAGE_ROOT=/data`, `SEED_ADMIN_*`.
3. Trigger build, tunggu sampai selesai.
4. Buka deployed URL, konfirmasi placeholder page render + `/health` 200.

Rules:
- Production env values dari engineer, tidak diarang. Tanya per nama dari env table.
- Jika ada value belum siap (DB belum diprovision, key belum di-generate), tanya apakah deploy ditunda seluruhnya — bukan kirim placeholder value.
- Build gagal di sini murah: app masih placeholder. Fix di feature ini.

## Commit and Push

This feature is only ready to commit after `Verify` passes and the first deploy succeeds.

The order is fixed:

1. `Verify` passes: dev server/build runs, placeholder renders.
2. First deploy (Coolify) berhasil dan URL merespons.
3. Lint and typecheck pass (`npm run lint`, `npm run typecheck`).
4. Ask the engineer which branch to commit to, as a decision panel:
   - **`main`** (recommended — solo trunk-based, auto-deploy Coolify aktif)
   - **a new branch** (jika engineer mau review dulu)
   Never commit silently, never pick the branch without asking.
5. Commit the scaffold, boilerplate cleanup, and first deploy as one commit: `feat(00): project setup — Next.js + Prisma + Better Auth + Docker Compose scaffold`.
6. Push to the chosen branch. Never force push.

## Scope Limits

No product features, no business data models, no route protection, no UI beyond the placeholder. Specifically:

- **Tidak** membuat seluruh `prisma/schema.prisma` — hanya enum + model Better Auth inti. Entity bisnis (Organization, Invoice, dst) dibuat di feature masing-masing via migration.
- **Tidak** implementasi login/logout UI — feature 01.
- **Tidak** implementasi render HTML→PDF di pdf-service — feature 06. Hanya skeleton + signature verification + health.
- **Tidak** membuat backup/restore script berfungsi penuh — feature 11 (stub di sini dengan komentar jelas).
- **Tidak** ada dashboard card, invoice editor, atau komponen bisnis lain.
- Setiap komponen shadcn yang di-init hanya yang dipakai di placeholder/layout + yang sudah pasti untuk feature 01; selebihnya tambah per feature.
