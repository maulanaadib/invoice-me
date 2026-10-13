# UI Context

## Theme

Dark + light mode via `next-themes`, **print selalu light** (media print selalu memakai light tokens). Toggle di topbar, persisted.

All colors are defined as CSS custom properties in `globals.css` and mapped to Tailwind tokens via `@theme inline`. Components must use these tokens — no hardcoded hex values or raw Tailwind color classes like `zinc-*`.

| Role | CSS Variable | Hex / Value (light) | Hex (dark) |
| --- | --- | --- | --- |
| Background | `--background` | `hsl(0 0% 100%)` | `hsl(240 10% 3.9%)` |
| Foreground | `--foreground` | `hsl(240 10% 3.9%)` | `hsl(240 5% 96%)` |
| Card | `--card` | `hsl(0 0% 100%)` | `hsl(240 10% 5.5%)` |
| Primary (accent) | `--primary` | `hsl(221 83% 53%)` (blue accent) | `hsl(217 91% 60%)` |
| Primary Foreground | `--primary-foreground` | `hsl(0 0% 100%)` | `hsl(240 10% 3.9%)` |
| Secondary | `--secondary` | `hsl(240 4.8% 95.9%)` | `hsl(240 3.7% 15.9%)` |
| Muted | `--muted` | `hsl(240 4.8% 95.9%)` | `hsl(240 3.7% 15.9%)` |
| Destructive | `--destructive` | `hsl(0 72% 51%)` | `hsl(0 63% 45%)` |
| Success | `--success` | `hsl(142 71% 45%)` | `hsl(142 69% 45%)` |
| Warning | `--warning` | `hsl(38 92% 50%)` | `hsl(38 92% 50%)` |
| Border | `--border` | `hsl(240 5.9% 90%)` | `hsl(240 3.7% 18%)` |
| Ring | `--ring` | `hsl(221 83% 53%)` | `hsl(217 91% 60%)` |

Palette direction: **modern SaaS neutral** (Linear/Vercel-style) — netral zinc scale untuk semua surface/teks, biru hanya sebagai accent (`primary`/`ring`). Radius dasar `--radius: 0.625rem` (10px); skala radius: `sm` 6px, `md` 8px, `lg` 10px, `xl` 16px. Shadow subtle (`--shadow-xs`…`--shadow-xl`, tint netral `hsl(240 10% 3.9%)`, opacity rendah) — tidak ada drop shadow berat. Heading (`h1`–`h4`) memakai `tracking-tight`; body `antialiased`.

Tailwind utility names map to these variables. Components pakai `bg-background`, `text-foreground`, `bg-primary` dll. **Invoice preview/PDF selalu pakai light palette + accent dari profile `primaryColor`** (di-inject via inline style, bukan override global token).

## Typography

| Role | Font | CSS Variable |
| --- | --- | --- |
| UI sans | Inter (variable font, self-hosted di `public/fonts` atau `next/font` Google fallback) | `--font-sans` |
| Mono (angka di tabel invoice) | font-mono stack (ui-monospace, SFMono, Menlo, monospace) | `--font-mono` |
| Print serif (invoice header opsional) | system serif stack | `--font-print` |

Font loading: `next/font/google` untuk Inter (subset latin), `display: swap`. **Font harus tersedia di Docker container** — Inter open-source aman. Tidak ada font proprietary.

## Border Radius

Radius increases with surface depth — smaller for inner elements, larger for outer containers.

| Context | Class |
| --- | --- |
| Inner controls (input, button sm, badge) | `rounded-md` (8px) |
| Buttons / default controls | `rounded-lg` (10px) |
| Cards / dialogs / sheets | `rounded-xl` (16px) |
| Invoice preview A4 | `rounded-none` (dokumen, tajam) |

Spacing scale: Tailwind default (4px base). Konsisten pakai token, tidak ada nilai padding/margin arbitrer.

## Component Conventions

- **shadcn/ui** sebagai foundation: Button, Input, Select, Dialog, Sheet, Table, Toast, DropdownMenu, Command, Tooltip, Badge, Card, Form (React Hook Form + Zod resolver), Calendar/DatePicker, Checkbox, Textarea, Separator, Avatar, Tabs, Progress, Skeleton. **Tidak memodifikasi file foundation** (aturan ai-workflow-rules), kecuali task eksplisit meminta.
- **Status invoice badge** selalu teks + warna + ikon (tidak andalkan warna saja): DRAFT (netral), ISSUED (primary), SENT (info), PARTIALLY_PAID (warning), PAID (success), OVERDUE (destructive), CANCELLED (muted), REVISED (muted + strikethrough).
- **Currency input** render `Rp 4.500.000` (locale id-ID), simpan value sebagai string decimal mentah (`4500000`).
- **Percent input** render `50%`, simpan `50`.
- **Logo uploader**: preview crop/fit, validasi MIME + size, progress state.
- **Live A4 preview**: komponen `InvoiceRenderer` (satu source untuk preview + print route), sticky di kanan desktop, tab di mobile.
- **Sidebar collapsible** + topbar workspace switcher + breadcrumb + command search (`Cmd+K`).
- **Table** (TanStack Table): sorting, pagination server-side, row actions dropdown, confirmation dialog untuk aksi destruktif.
- **Accessibility**: WCAG 2.1 AA — label form (`htmlFor`), keyboard navigation, focus-visible ring, color contrast, `aria-*` di custom components, status badge tidak andalkan warna saja.
- **Empty state** dan **loading skeleton** wajib di setiap view table.
