# Code Review: UI Change 3 — Invoice List + Invoice Editor Modernization

**Scope:** 7 files, no logic changes, presentation-only light-touch UI refresh.
**Direction:** Modern SaaS neutral (Linear/Vercel), token discipline, accessibility preserved.

---

## Verdict: CLEAN

All changes stay within the agreed scope. Token discipline is maintained (no hardcoded hex).
Invariants are intact. No layout restructure, no business logic changes, no new files.
Accessibility (focus rings, ARIA labels, roles) is untouched or improved.

---

## BLOCKING

(none)

---

## SHOULD FIX

(none)

---

## NIT

- **`invoice-preview.tsx:142`** — `shadow-xs` is added to a container that also has `overflow-hidden`. The micro-shadow will be clipped at the edges. Because `shadow-xs` is extremely subtle (`0 1px 2px`), the visual loss is negligible, but if elevation is meant to be perceived, consider removing `overflow-hidden` or placing the shadow on a wrapper that does not clip. Not blocking.

- **`invoice-preview.tsx:71`** — `DEFAULT_DATA.primaryColor` carries a literal `hsl(...)` value rather than a CSS custom property reference. The justification comment is accurate (sample document is always light), and this directly replaces the previous hardcoded `#2563eb` hex. A purist reading of "every color must be a design token" could flag it, but as a default constant for preview data it is acceptable and well-documented.

---

## What is good

1. **Token discipline** — Every changed className uses design tokens (`border-border`, `bg-card`, `text-muted-foreground`, `bg-muted/30`, `shadow-xs`, `ring-ring`, etc.). The only color literal change is the explicit replacement of `#2563eb` with its HSL token equivalent in preview defaults.

2. **Invariant preservation** —
   - Status badge rendering is untouched in the table.
   - `triggerLabel()` helper in `invoice-editor.tsx` is not in the diff; select trigger contract unchanged.
   - `__custom__` unit sentinel in `item-table.tsx` is untouched.
   - URL-driven filter/sort/pagination wiring in `invoices-table.tsx` is unchanged; only presentation classes (density, typography, transitions) were modified.

3. **Accessibility intact** —
   - `focus-visible:ring-2 focus-visible:ring-ring` preserved on `SortHeader` and `DropdownMenuTrigger`.
   - `aria-label`, `aria-hidden`, `aria-invalid`, and `role="status"` all remain.
   - Heading labels in the filter bar gain `font-medium` for better hierarchy without reducing contrast.

4. **Modern visual refinement** —
   - Consistent typographic tightening: section headings move from `text-sm tracking-wide` to `text-xs tracking-widest`, matching modern SaaS heading conventions.
   - `tabular-nums` added systematically to monetary and numeric columns improves readability.
   - `rounded-md` / `rounded-lg` / `rounded-xl` hierarchy is maintained intentionally (inner boxes → outer wrappers → cards).
   - `gap` increments (`gap-1` → `gap-1.5`, `gap-3` → `gap-4`) align with the app-shell spacing established in prior commits.

5. **Responsive safety** — Adding `flex-wrap` and `gap-3` to section headers in the editor prevents overflow on narrow viewports without altering the split-screen layout.
