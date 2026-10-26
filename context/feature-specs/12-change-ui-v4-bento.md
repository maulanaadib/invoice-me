# Change 12 - UI v4 Bento Kausal ( design system adoption )

## Goal

Mengganti arah design system aplikasi dari "modern SaaS neutral" ( zinc + accent blue, hasil Change 1–4 ) ke **v4 Bento Kausal light** yang sudah disetujui: navy `#1E3A5F` + emerald `#059669` di atas ivory `#FAF9F7`, radius 16px, soft layered shadow. Satu change, satu chat, token-first.

## What This Changes

### Design tokens ( `src/app/globals.css` + `context/ui-context.md` )

- **Status quo:** 111 CSS custom property, zinc neutral scale, accent biru `hsl(221 83% 53%)`, background pure white `hsl(0 0% 100%)`, radius dasar 0.625rem ( 10px ), shadow tint netral. Header komentar globals.css: "Neutral + Blue Accent".
- **New state:** primary navy `hsl(217 51% 24%)` ( #1E3A5F ), success emerald `hsl(160 84% 39%)` ( #059669 ), background ivory `hsl(60 9% 98%)` ( #FAF9F7 ), border `#E4E7EB`, radius dasar 16px ( skala: sm 8, md 12, lg 16, xl 20 ), layered shadow tint navy. Dark mode tetap ( tokens dark diadjust, lihat BR-2 ). Font tetap **Inter** ( keputusan engineer 2026-10-25 ).

### Dashboard ( `src/app/(dashboard)/dashboard/page.tsx` + `summary-cards.tsx` + `monthly-chart.tsx` )

- **Status quo:** 7 kartu metric flat + chart recharts + timeline, kartu `ring-border shadow-xs`.
- **New state:** layout mengikuti frame v4 `01-dashboard`: hero card navy full-width ( total ditagihkan + sparkline 12 bar ), grid bento 6 metric cards, chart card dengan legend + grouped bar, activity card dengan icon badge. Acuan visual: `design/v4/frames/01-dashboard.html`.

### Invoice list ( `src/app/(dashboard)/invoices/page.tsx` )

- **Status quo:** tabel + filter + pill status warna tailwind ad-hoc.
- **New state:** mengikuti frame v4 `02-daftar-invoice`: pill status konsisten ( ISSUED #EFF6FF/#1D4ED8, PAID #ECFDF5/#059669, OVERDUE #FEF2F2/#DC2626, DRAFT #F1F5F9/#64748B, SENT #ECFEFF/#0E7490, PARTIALLY_PAID #FFFBEB/#B45309 ), header section `tracking-widest`, tabular-nums kolom nominal. Acuan: `design/v4/frames/02-daftar-invoice.html`.

### Invoice detail + editor ( `src/app/(dashboard)/invoices/[id]/`, `invoice-editor.tsx` )

- **Status quo:** layout two-column, preview A4 putih.
- **New state:** mengikuti frame v4 `03-detail-invoice` + `04-editor-invoice`: panel kiri form, kanan A4 preview dengan shadow layered, amber pill untuk DP/partial. Acuan: `design/v4/frames/03-detail-invoice.html` + `04-editor-invoice.html`.

### Customers ( `src/app/(dashboard)/customers/page.tsx` )

- **Status quo:** tabel + search + empty state.
- **New state:** mengikuti frame v4 `05-customers`: card-based list, Bahasa Indonesia tetap, impor CSV + pagination tetap ( behavior contract tidak berubah ). Acuan: `design/v4/frames/05-customers.html`.

### Mobile responsive ( dashboard + invoice list, 390px )

- **Status quo:** belum ada layout 390px khusus.
- **New state:** breakpoint `sm` mengikuti frame v4 `06-mobile-dashboard` + `07-mobile-daftar-invoice`: single column, bottom tab bar pada mobile shell ( bila app-shell mendukung ), hero card navy, 2-col metric grid. Acuan: `design/v4/frames/06-mobile-dashboard.html` + `07-mobile-daftar-invoice.html`.

## Design

- **Token-first, bukan hardcode.** Semua warna v4 masuk sebagai CSS variable di `globals.css` → map ke Tailwind token via `@theme inline` ( pola yang sudah ada ). **Komponen tidak boleh memakai hex mentah** ( invariant ui-context lama tetap berlaku, hanya nilai yang ganti ).
- Palette: page `#FAF9F7`, card `#FFFFFF`, ink `#0F172A`, muted `#64748B`, line `#E4E7EB`, primary navy `#1E3A5F` ( surface hero `#1E3A5F`, text-on-navy putih ), success emerald `#059669`, danger `#DC2626`, warning amber `#B45309`.
- Radius: dasar 16px; bertambah dengan surface depth — inner 8–12px, outer 16px, hero 20px.
- Shadow: layered ( `0 1px 2px rgba(15,23,42,0.04), 0 4px 16px rgba(15,23,42,0.06)` ), tint navy opacity rendah.
- Typography: Inter tetap ( docker-safe, next/font google, display swap ); heading `tracking-tight` tetap. Money: `tabular-nums` ( invariant ).
- **Bahasa Indonesia, no emoji** ( invariant copy ).
- **Design reference:** `design/v4/handoff.html` ( index + 8 frame mandiri di `design/v4/frames/` ). Setiap surface section di atas menamai frame-nya.

## Implementation

1. **Tokens dulu ( `globals.css` ).** Ganti nilai `:root` ( light ) + `.dark` ( dark ) sesuai tabel BR-1. Tidak ada token baru yang ditambahkan kecuali `--radius` skala ( sm/md/lg/xl ). Update komentar header globals.css.
2. **`context/ui-context.md`** — rewrite bagian Theme ( palette table, radius, shadow, palette direction ke "Bento Kausal light ( v4 )" ), sisanya tetap.
3. **Dashboard** — terapkan hero card navy + bento grid + chart card + activity card sesuai frame 01. `summary-cards.tsx` + `monthly-chart.tsx` boleh di-restructure; data contract ( props dari server ) tidak berubah.
4. **Invoice list** — pill status palette + section header + tabular-nums. Status-to-color map jadi satu konstanta terpusat.
5. **Detail + editor** — panel layout + preview shadow sesuai frame 03/04. A4 preview inner tetap putih ( print invariant ).
6. **Customers** — card list sesuai frame 05, behavior impor CSV + pagination tetap.
7. **Mobile breakpoint** — `sm:` single column + bottom tab bar di app-shell mobile ( frame 06/07 ).
8. **E2E baru** `tests/e2e/ui-v4-tokens.spec.ts` — computed-style assertion ( lihat Check When Done ).
9. Dokumentasi review: `context/.reviews/ui-change5-v4.md` ( pattern Change 1–4 ).

## Dependencies

- Tidak ada dependency feature baru. Change ini hanya memodifikasi presentation layer.
- **Prioritas jalankan setelah Change 1–4** ( sudah merged ke `main` ) — proyek sudah GA, tidak ada konflik.
- Bundle context yang dibuat stale: `ui-context.md` ( di-rewrite di langkah 2 ), `progress-tracker.md` ( Update tracker section change ini ).

## Blast Radius

### BR-1: Token globals + 24 call site `bg-primary`/`bg-accent`

- **Konsekuensi:** `src/app/globals.css` baris 8–30 ( `:root` ) nilai zinc/biru diganti navy/emerald/ivory. 24 call site `bg-primary`/`text-primary`/`bg-accent` di `src/components` + `src/app` otomatis jadi navy ( karena component pakai token, bukan hex ). Tema dark ( `.dark` block ) juga harus diadjust.
- **Solusi:** Edit `globals.css` `:root` + `.dark` ( satu file, langkah Implementation 1 ). Tidak perlu `@selcy-sdd specs` karena feature spec ( 00–11 ) mendeskripsikan behavior, bukan visual — mereka tidak bocor nilai token.
- **Pencegahan:** Sebelum edit, ambil screenshot Playwright light + dark dari dashboard/list/editor/customers sebagai **baseline regresi**. Setelah change, bandingkan. Jalankan `npm run test` ( 723 unit+integration ) + `npm run test:e2e` ( 35 E2E ) sebelum commit — gate utama.

### BR-2: Dark mode ( `next-themes` )

- **Konsekuensi:** v4 murni light. Token dark ( `.dark` block globals.css ) harus tetap ada karena dark mode adalah feature GA ( toggle persisted, `global-error.tsx` guarded ).
- **Solusi:** Adjust nilai dark block agar selaras ( primary navy light-on-dark `hsl(217 51% 65%)`, background dark `hsl(217 33% 8%)` tint navy, bukan zinc ). **Jangan hapus** block dark atau import next-themes.
- **Pencegahan:** Verifikasi computed style di dark mode via Playwright ( token ada + kontras WCAG AA ). Jangan drop dark mode — itu keputusan engineer terpisah ( tertulis di Open Questions spec ini ).

### BR-3: Print route + PDF ( `src/app/api/print/route.ts` + pdf-service )

- **Konsekuensi:** Invoice PDF + print selalu memakai light palette + accent dari profile `primaryColor` ( di-inject inline style, bukan token global ).
- **Solusi:** **Tidak mengubah apa pun.** Token v4 tidak mengalir ke print karena print memakai own palette. Contract `snapshots.ts`/`renderer-data.ts` tidak berubah.
- **Pencegahan:** E2E acceptance 13/13 ( `tests/e2e/acceptance.spec.ts` ) harus tetap hijau — itu regression guard print/PDF. Jangan sentuh `pdf-service`.

### BR-4: Halaman tanpa mockup ( `/payments`, `/bank-accounts`, `/signers`, `/admin/*` — 14+ file )

- **Konsekuensi:** Halaman-halaman ini ( terakhir di-touch Change 4, commit `99d48a8` ) memakai `bg-background`/`text-foreground`/`bg-card` — mereka **otomatis ikut ivory/navy** tanpa mockup v4.
- **Solusi:** Biarkan ikut token ( keputusan engineer ). Tidak ada layout change di halaman ini — hanya warna.
- **Pencegahan:** Screenshot setelah change; pastikan kontras teks tetap AA ( ivory `#FAF9F7` + ink `#0F172A` = rasio tinggi, aman ). E2E admin 9 halaman ( ada di acceptance spec ) tetap hijau.

### BR-5: Feature specs 00–11 yang menyebut surface v4

- **Konsekuensi:** 9 feature spec ( 00, 01, 02, 03, 04, 06, 08, 09, 10 ) mendeskripsikan surface yang di-redesign. Mereka mendeskripsikan **behavior** ( alur, permission, data ), bukan visual.
- **Solusi:** Tidak regenerasi spec. `design/v4/handoff.html` + spec ini menjadi referensi visual baru. Spec mendeskripsikan behavior → tidak berubah.
- **Pencegahan:** Setelah change, `context/progress-tracker.md` Updated ( section Progress Tracker di bawah ). Bila ada spec yang menyebut warna spesifik ( grep `#` hex di feature-specs ), periksa — awas bocor.

### BR-6: WCAG AA / accessibility

- **Konsekuensi:** Palet v4 ( navy #1E3A5F pada ivory, emerald #059669 untuk success text ) mengganti rasio kontras yang sudah diukur Change 1–4 ( 4.83 light / 7.76 dark ).
- **Solusi:** Ulangi pengukuran AA pada token baru ( script yang dipakai Change 1–4 atau manual contrast math ). Target: ≥ 4.5 untuk body text.
- **Pencegahan:** Jalankan **sebelum** commit — masuk ke Check When Done. Emerald #059669 pada ivory #FAF9F7 ≈ 3.9 — **gunakan emerald hanya untuk teks bold/large atau icon + label, bukan body text**; body text success → `#047857` ( darker variant, ≈ 5.0 ).

## Scope Limits

- **Tidak membuat mockup v4 untuk `/payments`, `/bank-accounts`, `/signers`, `/admin/*`** — mereka ikut token otomatis ( keputusan engineer, menghemat budget pen.dev ). Bila perlu, change spec terpisah.
- **Tidak mengubah font ke Plus Jakarta Sans** — Inter tetap ( docker-safe, free, bentuk dekat ). v4 adalah arah, bukan pixel-perfect.
- **Tidak drop dark mode** — feature GA, tertunda sebagai change terpisah bila engineer mau.
- **Tidak menyentuh print/PDF palette** — contract own palette.
- **Tidak ada perubahan behavior/data** — layout + token only. Invoice status semantics, pagination, filter URL-driven, permission — semua invariant.

## Check When Done

Setiap item dapat diverifikasi dengan menjalankan sesuatu — bukan dengan membaca kode. Setidaknya satu item membuktikan behavior lama tetap berfungsi.

- [ ] `npm run build` ( production ) PASS.
- [ ] `npm run lint` 0 error ( warning pre-existing boleh ), `npm run typecheck` PASS.
- [ ] `npm run test` — **723/723** unit+integration hijau ( regression guard: behavior tidak berubah ).
- [ ] `npm run test:e2e` — **35/35** hijau termasuk `acceptance.spec.ts` 13/13 ( regression guard: print/PDF + alur master prompt 1–11 tetap ).
- [ ] E2E baru `tests/e2e/ui-v4-tokens.spec.ts` hijau: di light mode, `getComputedStyle(document.documentElement).getPropertyValue('--primary')` ter-trim = `hsl(217 51% 24%)` ( navy ); `--background` = `hsl(60 9% 98%)` ( ivory ); `--success` = `hsl(160 84% 39%)`. Token `--foreground` pada dark mode `.dark` class ter-set ( dark mode masih ada ).
- [ ] Playwright screenshot light + dark dashboard/list/editor/customers setelah change dibandingkan baseline — perubahan visual terdokumentasi di `context/.reviews/ui-change5-v4.md`.
- [ ] **WCAG AA:** contrast ratio body text ≥ 4.5 light mode ( ink #0F172A pada ivory #FAF9F7 ≈ 15.8 ✓ ); success body text ( bila ada ) memakai `#047857`; verified via screenshot + script.
- [ ] **Regresi behavior lama:** invoice list filter URL-driven masih bekerja ( `/invoices?status=PAID` menyaring ), pagination `?page=2` bekerja, dashboard summary card angka sesuai seed ( Rp 45.000.000 dari fixture ) — terverifikasi via E2E 08 slice atau manual smoke `npm run start` + browser.
- [ ] Print route smoke: `curl -sI localhost:3000/api/print/...` atau E2E acceptance — PDF tetap render dengan palette own ( bukan v4 ), PDF job SUCCESS.
- [ ] `context/ui-context.md` + `context/progress-tracker.md` Updated ( section Progress Tracker change ini ).

## Commit and Push

Change ini hanya siap di-commit setelah `Check When Done` pass dan test suite hijau. Bukan sebelum, bukan janji fix nanti.

Urutan fixed:

1. Setiap item `Check When Done` pass, termasuk regression guard.
2. Tests pass ( `npm run test` ).
3. Lint and typecheck pass ( `npm run lint`, `npm run typecheck` ).
4. Commit to branch yang bundle namai. Bundle: trunk-based pada `main` ( ai-workflow-rules.md baris 82: "Branch default: **`main`** ( solo trunk-based ). Auto-deploy Coolify aktif pada push ke `main`." ) → **commit ke `main`, jangan tanya**. Engineer sudah menjawab ini di planning time.
5. Commit message: `feat(ui): adopt v4 bento kausal design system ( navy/emerald/ivory tokens + frame layouts )`.
6. Push ke `main`. Jangan force push. Auto-deploy Coolify akan men-trigger build — pastikan 3 container healthy setelah push ( smoke `/health` ).

Bila ada langkah gagal, stop dan perbaiki sebelum commit. Test merah atau check gagal = stop condition, bukan dilewati.

## Progress Tracker

Ketika change ini landing, update `context/progress-tracker.md`. Section ini wajib: tanpa-nya chat berikutnya start buta.

- Tambah **Change 5 `12-change-ui-v4-bento`** under **Completed** saat `Check When Done` pass, termasuk regression guard.
- Tambah ke **Open Questions:** ( resolved ) v4 diadopsi sebagai source of truth UI; halaman tanpa mockup ikut token otomatis; dark mode + font Inter tetap. ( open ) Apakah perlu mockup v4 untuk `/payments`, `/bank-accounts`, `/signers`, `/admin/*`? ( open ) Apakah dark variant v4 perlu dirancang khusus?
- Tambah ke **Architecture Decisions:** v4 Bento Kausal light menggantikan "modern SaaS neutral" sebagai palette direction; navy `#1E3A5F` primary + emerald `#059669` success + ivory `#FAF9F7` page; radius 16px layered shadow; token-first via `globals.css` ( komponen tetap pakai token, tidak hardcode hex ); print/PDF palette kontrak tetap separate ( own palette + `primaryColor` profile ).
- Tambah satu baris ke **Session Notes:** UI v4 design system adopted — token global + layout 5 frame utama, dark mode + Inter tetap, 723/723 + 35/35 + E2E token baru hijau.
- Jangan sentuh row feature lain. Bila change ini ternyata menyentuh feature boundary, stop dan katakan, jangan edit spec lain.
