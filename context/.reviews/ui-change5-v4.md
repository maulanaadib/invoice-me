# Review — Change 12: UI v4 Bento Kausal

Pattern: same as Change 1–4 review docs (`context/.reviews/`).

## What landed

- `src/app/globals.css`: full `:root` + `.dark` rewrite to v4 (navy/emerald/
  ivory, radius 1rem + depth scale, layered navy shadow), header comment
  updated to "Bento Kausal light v4". Invoice-preview forced-light block and
  `@media print` unchanged in spirit (own palette).
- Dashboard: hero navy card + bento 6-metric grid + chart card + activity card
  (frames 01 + 06 mobile).
- Invoice list: centralized `STATUS_PILL_CLASS`, eyebrow headers,
  tabular-nums (frame 02).
- Detail/editor: two-panel card layout, amber DP/Term pill, `xl` split
  breakpoint (frames 03/04).
- Customers: framed table + eyebrow (frame 05).
- App shell: fixed bottom tab bar `lg:hidden`, `pb-24` main clearance
  (frames 06/07).
- New E2E `tests/e2e/ui-v4-tokens.spec.ts` (3 tests, computed-style).
- `context/ui-context.md` Theme rewritten to v4 (was already staged in the
  working tree before this build began).

## Verification

- `npm run build` PASS, `npm run lint` 0 errors (12 pre-existing warnings),
  `npm run typecheck` PASS.
- `npm run test` **723/723** (regression guard: behavior unchanged).
- E2E: new token spec 3/3; acceptance 13/13 and invoice-pdf green in isolated
  runs. Full-suite runs show intermittent failures on the PDF-worker tests
  (acceptance 9/10/11, invoice-pdf) that reproduce identically on pristine
  HEAD under current machine load (parallel agent processes, load avg ~2.8);
  see Session Notes. Not attributed to this change.

## Invariants held

- No hardcoded hex outside `globals.css` except the centralized status-pill
  map (named by the spec as THE single status→colour constant) and the amber
  kind badge.
- No `src/components/ui/*` modifications.
- Print/PDF palette separate (BR-3). Dark mode kept (BR-2). Font Inter (scope
  limit). Bahasa Indonesia, no emoji. Money tabular-nums.
- Behavior/data contracts untouched: URL-driven filters, pagination,
  permissions, snapshot immutability all intact (723/723 proof).
