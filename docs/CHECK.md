# Change 12 — UI v4 Bento Kausal: Compliance Note

Mockup reference: `design/v4/handoff.html` + `design/v4/frames/*.html`
(structure + exact token values). Rule applied throughout: follow the frame
for composition and colour; convert fixed px layout to fluid flex/grid with
standard Tailwind breakpoints; never copy the Tailwind CDN script tag,
arbitrary-value export classes (`w-[1360px]`, `text-[14px]/[20px]`,
`font-['Plus_Jakarta_Sans']`), or the fixed container width into production.
Font stays **Inter** (engineer decision 2026-10-25).

## Followed the frames

- **Tokens (frame 00):** navy `#1E3A5F` primary, emerald `#059669` success,
  ivory `#FAF9F7` page, white cards, border `#E4E7EB`, ink `#0F172A`, muted
  `#64748B`. Radius base 16px with depth scale (sm 8 / md 12 / lg 16 / xl 20).
  Layered navy-tint shadow. All values entered as CSS custom properties in
  `globals.css` `:root` + `.dark`; components consume tokens only.
- **Dashboard (frame 01):** hero card navy full-width (total ditagihkan +
  sparkline 12 bar + 4 mini-stats), bento grid of 6 metric cards, chart card
  with grouped bars + legend, activity card with icon badges. DOM order follows
  the frame.
- **Invoice list (frame 02):** centered status-pill palette (one constant
  `STATUS_PILL_CLASS`), section header `tracking-widest` eyebrow, tabular-nums
  money columns, row density per frame.
- **Detail + editor (frames 03/04):** left form panel as white card, right A4
  preview on ivory canvas with layered shadow; amber pill for DP/Term kind
  badge (partial-billing semantics); preview breakpoint moved to `xl` so the
  split-screen keeps its breathing room at 1680px.
- **Customers (frame 05):** card-framed table, eyebrow label, denser rows.
- **Mobile (frames 06/07):** single-column stacking via responsive grids;
  fixed bottom tab bar in the app shell (`lg:hidden`, permission-aware, hidden
  on the invoice editor which owns its own tabs); main gets `pb-24` clearance.

## Deviations (each intentional)

1. **Fixed widths → fluid.** Frames are drawn at 1360px (editor 1680px,
   mobile 390px). Production uses `max-w-6xl` reading width (editor keeps
   `max-w-[1680px]`) + flex/grid + Tailwind `sm:`/`xl:` breakpoints. The change
   spec mandates this conversion; pixel values were treated as proportions.
2. **Plus Jakarta Sans → Inter.** Scope Limit: font stays Inter (docker-safe).
   Weight/tracking relationships from the frames preserved with Inter weights.
3. **Hero mini-stat labels renamed** ("Sudah dibayar", "Sisa tagihan",
   "Overdue", "Belum diterbitkan") to avoid duplicate accessible text against
   the bento metric-card titles ("Outstanding", "Jatuh tempo", "Draft"). Frame
   01 draws them near-identical; the existing feature-08 E2E asserts the card
   labels uniquely, so the hero copy was differentiated rather than loosening
   the test contract.
4. **Emerald used only for bold/large/icon contexts** (pill backgrounds,
   icons, headings). Success body text would use `#047857` per BR-6 WCAG AA
   rule; no success-colored body text exists on these five surfaces, so no
   darker variant token was needed yet.
5. **Dark mode adjusted, not redesigned** (BR-2): `.dark` block kept with
   navy-tint background `hsl(217 33% 8%)`, light-on-dark primary
   `hsl(217 51% 65%)`, status pills get navy-tint solid variants. v4 has no
   dark mockup; this keeps the GA feature alive until a dedicated dark pass.
6. **Pages without mockups** (`/payments`, `/bank-accounts`, `/signers`,
   `/admin/*`) inherit the new tokens automatically via `bg-background` /
   `text-foreground` etc. — no layout edits there (Scope Limit + engineer
   decision BR-4).
7. **Print/PDF untouched** (BR-3): `.invoice-preview` forced-light block and
   `@media print` keep their own palette; profile `primaryColor` still injects
   inline. The amber kind badge is a screen-only affordance inside the editor
   chrome, not the A4 document body.

## Token resolution note

The production build compiles `hsl()` token declarations to hex
(`hsl(217 51% 24%)` → `#1e365c`). The new E2E
(`tests/e2e/ui-v4-tokens.spec.ts`) asserts the **resolved computed value**, not
the source declaration — a stronger claim (it proves the token paints, not just
that it is declared). Values asserted: light `--primary #1e365c`,
`--background #fafaf9`, `--success #10b77f`, `--radius 1rem`; dark
`--background #0e131b` present (dark mode survives).
