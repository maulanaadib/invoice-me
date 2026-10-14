# UI Review: Change 4 — Presentation refresh (Customers, Profiles, Admin)

**Scope:** 14 files (Customers: 2, Profiles: 1, Admin: 11)
**Type:** Presentation-only spacing/gap, radius, border, shadow, typography refresh
**Review date:** 2026-10-14
**Base:** HEAD (main)

---

## Verdict: CLEAN

---

## Observed changes

All diffs fall strictly into presentation tokens — no logic, wiring, data-fetching, or copy changes.

### 1. Page-level spacing uniformity
- `gap-6` → `gap-8` on root page wrappers (customers, profiles, audit-logs, invoices, orgs/[id], orgs, admin overview, pdf-jobs, settings, storage, system, users, users/[id])
- `gap-1` → `gap-1.5` on title/description header blocks
- `gap-3` → `gap-4` on flex wrap header bars (customers, users, orgs)

### 2. Card shadow/ring treatment
- All `<Card>` surfaces inside admin + dashboard pages now receive `className="ring-border shadow-xs"` (consistent with C2/C3 dashboard card pattern)
- Table wrapper `<div>` surfaces gain `bg-card shadow-xs`

### 3. Table density & typography tokens
- New local constants `HEAD_CLASS` and `CELL_CLASS` in 6 admin list pages plus organizations detail
  - `HEAD_CLASS = "h-10 px-3 text-xs font-medium tracking-wide text-muted-foreground"`
  - `CELL_CLASS = "py-2.5 px-3"`
- All `<TableHead>` and `<TableCell>` nodes refactored to use these shared tokens
- Dates/numbers/IDs consistently switched to `font-mono tabular-nums`
- Numeric count cells now have explicit `tabular-nums` (organizations member count, customer PIC count, etc.)

### 4. Radius/border adjustments
- Empty-state dashed placeholders: `rounded-lg` → `rounded-md`
- Inline list items in user detail (memberships, invoices-per-org): `rounded-lg` → `rounded-md`

### 5. Customers table column cells
- `contactCount` cell now wraps value in a styled `<span>` instead of raw string
- `createdAt` cell gains `whitespace-nowrap font-mono tabular-nums`
- Table header/cell className set inline (no local const here — header uses `text-xs font-medium tracking-wide text-muted-foreground`, cell uses `py-2.5 px-3`)

---

## Invariants verified

| Invariant | Result |
|---|---|
| No new files | ✅ 14 modified, 0 untracked |
| No `src/components/ui/*` edits | ✅ untouched |
| No business logic changes | ✅ no function body changes; all `const`, `export`, `import`, control-flow, conditional renders identical |
| No data-fetching changes | ✅ same server function calls and params |
| No URL-driven state wiring changes | ✅ customers-table form/pagination wiring identical; audit-logs filter form still `method="get"` with same `name` attrs |
| No pagination logic changes | ✅ admin page pagination remaining identical |
| No `onSubmit`/`href`/`name`/`value`/`redirect` changes | ✅ none found in diff |
| No hardcoded hex/HSL colors | ✅ all colors are Tailwind tokens (`border-border`, `bg-card`, `text-muted-foreground`, `text-destructive`, etc.) |
| Accessibility preserved | ✅ no `aria-*` or `role` removed or altered |
| Indonesian copy unchanged | ✅ every sentence preserved character-for-character |

---

## BLOCKING

*None.*

---

## SHOULD FIX

*None.*

---

## NIT

### `HEAD_CLASS` / `CELL_CLASS` duplication across 6 files

The same two class-name constants are copied into 6 files:
- `src/app/admin/audit-logs/page.tsx`
- `src/app/admin/invoices/page.tsx`
- `src/app/admin/organizations/[id]/page.tsx`
- `src/app/admin/organizations/page.tsx`
- `src/app/admin/pdf-jobs/page.tsx`
- `src/app/admin/storage/page.tsx`
- `src/app/admin/system/page.tsx`

This is acceptable for a presentation-only light-touch pass (no new files allowed per rules). Future consolidation into a shared table-style utility or wrapper component would reduce drift, but that is explicitly out of scope for this change series.

---

## What is good

- **Consistent with C2/C3 grammar.** `ring-border shadow-xs`, `font-mono tabular-nums`, `bg-card`, and `gap-8` page rhythm all follow the token discipline established in the previous changes.
- **No logic bleed.** The diff is pure className surgery; grep confirms zero accidental changes to event handlers, hrefs, names, or routing.
- **Accessibility maintained.** Focus rings, summary/details patterns, and semantic table structure untouched.
- **Copy fidelity.** No Indonesian strings were altered, ensuring no localization regression.
- **Admin parity.** Every admin list/detail page now shares the same visual density and typography, which closes the visual gap between dashboard (C3) and admin surfaces.
