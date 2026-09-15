# Ella Bella Ops — Style System Audit

**Date:** 2026-09-15
**Scope:** read-only audit of `dashboard/` (the Ella Bella Ops React frontend). No files were modified.
**Purpose:** extract the full style system so the new **Ella Bella Creator Club** app can start from a visually matching base.

**Where everything lives:** essentially all of it is in **one file** — `dashboard/src/index.css` (2,654 lines). `dashboard/src/App.css` is a one-line stub (`/* styles consolidated in index.css */`). There is no Tailwind config, no theme object, no CSS-in-JS. Fonts are loaded in `dashboard/index.html`. Theme state lives in `dashboard/src/App.jsx`.

---

## 1. Colour system — light and dark

### How mode-switching is implemented

Plain **CSS custom properties, swapped by a class on `<html>`**. No Tailwind `dark:`, no media query, no context provider.

- `dashboard/src/App.jsx:716` — `useState(() => localStorage.getItem('eb_theme') ?? 'light')` (**light is the default**)
- `dashboard/src/App.jsx:749-751` — effect writes `localStorage.setItem('eb_theme', theme)` and sets `document.documentElement.className = \`theme-${theme}\``
- `dashboard/src/App.jsx:1549` — the root div *also* gets `className={\`app theme-${theme}\`}`, so the tokens are defined twice over (belt and braces; the `<html>` class is what covers portals/modals)
- `dashboard/src/index.css:9` — `:root, .theme-light { … }`
- `dashboard/src/index.css:68` — `.theme-dark { … }`
- Each block also sets `color-scheme: light` / `dark`.

Note: `prefers-color-scheme` is **not** respected — the app always opens light unless localStorage says otherwise. Worth reconsidering for Creator Club.

### Token table

| Token | Light | Dark | Role |
|---|---|---|---|
| `--bg-page` | `#F7F6FB` | `#0f1117` | Page background |
| `--bg-card` | `#FFFFFF` | `#1a1d27` | Card / panel surface |
| `--bg-card-alt` | `#F0EDF9` | `#12151f` | Secondary/inset surface, totals row |
| `--border` | `#E8E5F4` | `#2a2d3a` | Default border / hairline |
| `--border-hover` | `#C4B5FD` | `rgba(59,130,246,0.26)` | Hover border, input border |
| `--text-1` | `#1A1530` | `#f0f0f5` | Primary text |
| `--text-2` | `#6B7280` | `#9ca3af` | Secondary text (table body) |
| `--text-3` | `#9CA3AF` | `#6b7280` | Muted / labels / captions |
| `--accent` | `#7C3AED` | `#A78BFA` | **Brand violet** |
| `--accent-light` | `#EDE9FE` | `#1e1a36` | Accent tint background |
| `--accent-mid` | `#C4B5FD` | `#7C3AED` | Accent border |
| `--accent-dim` | `rgba(124,58,237,0.12)` | `rgba(167,139,250,0.15)` | Row hover, focus ring, glow |
| `--green` | `#059669` | `#34d399` | Success / positive money |
| `--amber` | `#D97706` | `#fbbf24` | Warning / estimated |
| `--red` | `#DC2626` | `#f87171` | Danger / negative |
| `--warning-bg` / `--warning-border` | `#FFFBEB` / `#FCD34D` | `#1f1a0e` / `#92400e` | Amber banner |
| `--danger-bg` / `--danger-border` | `#FEF2F2` / `#FECACA` | `#1f0e0e` / `#7f1d1d` | Red banner |
| `--green-bg` / `-border` | `rgba(5,150,105,0.08)` / `0.28` | `rgba(52,211,153,0.10)` / `0.28` | Green pill |
| `--amber-bg` / `-border` | `rgba(217,119,6,0.08)` / `0.28` | `rgba(251,191,36,0.10)` / `0.28` | Amber pill |
| `--red-bg` / `-border` | `rgba(220,38,38,0.08)` / `0.28` | `rgba(248,113,113,0.10)` / `0.28` | Red pill |
| `--header-bg` | `rgba(247,246,251,0.9)` | `rgba(10,10,15,0.88)` | Sticky translucent header |
| `--card-shadow` | `0 1px 4px rgba(26,21,48,.08), 0 0 0 1px rgba(124,58,237,.04)` | `0 1px 4px rgba(0,0,0,.6), 0 0 32px rgba(59,130,246,.04)` | Card elevation |
| `--card-glow` | `0 0 32px rgba(124,58,237,0.08)` | `0 0 32px rgba(59,130,246,0.1)` | Hover glow |
| `--conn-live-bg` / `-border` | `rgba(5,150,105,.06)` / `.18` | `rgba(34,197,94,.07)` / `.18` | "All sources live" bar |
| `--atn-bg` / `--atn-border` | `#FEF2F2` / `rgba(220,38,38,.2)` | `#1a0a0a` / `rgba(239,68,68,.2)` | Attention panel |

**Platform/channel colours** (used for per-channel series and pills):

| Token | Light | Dark |
|---|---|---|
| `--platform-amazon` | `#7C3AED` | `#A78BFA` |
| `--platform-non-amazon` | `#D97706` | `#FBBF24` |
| `--platform-tiktok` | `#F97316` | `#FB923C` |
| `--platform-walmart` | `#2563EB` | `#60A5FA` |
| `--platform-shopify` | `#16a34a` | `#16a34a` |

**Legacy aliases** — the file carries a second set of names kept for older components: `--bg`, `--surface`, `--surface-2`, `--surface-3`, `--text`. In light mode these mirror the new tokens; in dark mode `--bg: #0a0a0f` / `--surface: #0f0f18` are **darker than** `--bg-page`/`--bg-card`, so the two systems disagree. **Recommendation for Creator Club: adopt only the `--bg-*` / `--text-N` set and drop the aliases.**

### Things to carry over deliberately

- **Semantic colour is applied as a tinted pill**, never as a filled block: `background: var(--x-bg)`, `color: var(--x)`, `border: 1px solid var(--x-border)` (`index.css:922-925`).
- **A low-alpha tint over near-black does not read in dark mode.** `index.css:998-1042` documents this: a 10%-alpha amber over `#0f0f18` is visually identical to the bare surface, so the filled/outlined distinction collapsed. The fix was to give dark-mode filled badges a **solid** fill with dark text (`.theme-dark .fee-badge--est { background: var(--amber); color: #17130a; }`). Build this into the Creator Club palette from the start rather than rediscovering it.
- Two colours are **hardcoded, not tokenised**: the cyan "basis" badge (`#0E7490` light / `#22D3EE` dark, `index.css:985-1042`) and chart series arrays (`InventoryChart.jsx:8` `ASIN_COLORS` blues, `:16` `OVERDUE_COLOR #a855f7`, `RevenueChart.jsx:120` `#f59e0b`). Tokenise these in the new app.

---

## 2. Typography

- **Single family, body and headings alike.**
  `--font: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif`
  `--font-mono: 'SF Mono', 'Fira Code', 'Fira Mono', monospace` — used only for ASIN codes (`.product-asin`).
- **Loading:** Google Fonts `<link>` in `dashboard/index.html`, with `preconnect` to both `fonts.googleapis.com` and `fonts.gstatic.com`:
  `https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap`
  Only weights **400 / 500 / 600 / 700** are loaded — nothing else is available.
- **Root size is 14px**, not 16px (`html { font-size: 14px }`), plus `-webkit-font-smoothing: antialiased`. All sizes below are absolute `px`; there is no `rem` scale.

| Size | Weight | Used for |
|---|---|---|
| 28px | 700, `-0.03em` | KPI card value, login brand |
| 22px | 700 | KPI value at ≤700px |
| 16px | 600 | Primary button, text input |
| 15px | 700, `-0.02em` | Brand wordmark; mock-banner title |
| 14px | 600 | Days-remaining figure |
| 13px | 400–600 | Body default, table body, card title (600), tooltip value |
| 12px | 400 | Freshness, connection bar, dense table product cell |
| 11px | 500–700 | Card labels, pills, legends, ASIN mono |
| 10px | 600–700, `0.07em`, uppercase | **Table headers**, badges, sub-lines |
| 9px | 700, `0.04em` | Fee-status micro-badges |

**Idioms worth copying:**
- Small text gets **positive letter-spacing + uppercase** (`0.04–0.08em`); large text gets **negative** tracking (`-0.01` to `-0.03em`).
- Every numeric cell and value carries `font-variant-numeric: tabular-nums`.
- Label/value pairing is consistent: 10–11px uppercase muted label above a large bold `--text-1` figure.

---

## 3. Layout & spacing

- **Scale is a 4px-ish ladder, used loosely:** 2, 3, 4, 6, 8, 10, 12, 14, 16, 20, 22, 24, 28, 32, 64. No spacing tokens exist — values are literal throughout. **Define a token scale in Creator Club.**
- **Page shell:** sticky `56px` header, `.main` with `padding: 28px 22px`, `gap: 20px`, `max-width: 1440px`, `margin: 0 auto`. `min-height: 100dvh` (dvh, not vh) on `body`/`.app`.
- **Border radius** — slightly rounded, and pills are fully round:

  | Token/value | Use |
  |---|---|
  | `--radius: 12px` | Cards, panels, modals, banners |
  | `--radius-sm: 8px` | Buttons, inputs, icon buttons, tooltips |
  | `16px` | Login card (the one outlier) |
  | `20px` | Status badges / pills / tabs (full round) |
  | `10px` | Micro fee badges |
  | `4px` | Skeletons |

- **Card / panel treatment** (`.card`, `index.css:374`):
  `background: var(--bg-card)` + `1px solid var(--border)` + `border-radius: 12px` + `box-shadow: var(--card-shadow)` + `overflow: hidden`.
  Hover: `border-color: var(--border-hover)` and `box-shadow: var(--card-shadow), var(--card-glow)` over `0.2s`. Card headers are `padding: 20px 22px 16px` with a bottom hairline and `flex-wrap: wrap`.
- **Density: two registers.** Dashboard cards are spacious (20–22px padding, 28px KPI values). The Performance data table is deliberately compact — a `.table--sticky` variant cuts horizontal cell padding from 20px to **7px** and is documented as being at its legibility floor. Creator Club should pick one register per surface the same way.
- **Breakpoints:** `1100px` (4-col grids → 2-col, chart rows stack), `700px` (page padding → 16px, modals become bottom sheets, 2-col grids), `320px` (single column).
- **Motion:** three keyframes only — `fadeUp` (0.25s, page mount), `pulse` (1.5s, skeletons), `spin` (refresh icon). Transitions are `0.1–0.2s`.

---

## 4. Component patterns worth reusing

**Table** (`.table`, `index.css:508`)
- `width: 100%`, `border-collapse: collapse`, `font-size: 13px`.
- `th`: 10px / 600 / uppercase / `0.07em` / `--text-3` / left-aligned / `padding: 12px 20px` / `nowrap`.
- `td`: `padding: 14px 20px`, `--text-2`, `tabular-nums`, `vertical-align: middle`.
- Rows separated by `1px solid var(--border)`, last row's removed.
- **Row hover is `background: var(--accent-dim)`** — a translucent violet wash.
- `.num` class right-aligns both `th` and `td`.
- Sticky variant (`.table--sticky`) is opt-in: `border-collapse: separate` (mandatory for sticky cells to keep their own borders), row rules reinstated as **inset box-shadows**, frozen columns re-composite the translucent hover as `linear-gradient(var(--accent-dim), var(--accent-dim)), var(--bg-card)` over the opaque base. Copy that trick if Creator Club ever freezes a column.

**Buttons**
- `.btn-primary` — full-width, `height: 52px`, 16px/600, `#fff` on `var(--accent)`, `radius-sm`; hover `opacity: 0.9` + `box-shadow: 0 0 24px var(--accent-dim)`; active `transform: scale(0.98)`; disabled `opacity: 0.35`.
- `.btn-ghost` — 13px/500, `--text-2`, `6px 12px`, hover fills `--surface-3` and darkens text.
- `.btn-icon` — 32×32 flex-centred square, `radius-sm`, same hover.
- Global reset: `button { border: none; background: none; cursor: pointer; font-family: var(--font) }`.

**Status pills** (`.badge`, `index.css:912`)
`inline-flex`, `10px/700`, `letter-spacing: 0.07em`, `padding: 3px 9px`, `border-radius: 20px`, `nowrap`; four variants `green / amber / red / unknown`, each `--x-bg` + `--x` + `1px solid --x-border`.
A second, smaller family (`.fee-badge`, 9px, `border-radius: 10px`, `line-height: 15px`, `cursor: help`) sits inline beside numbers in table cells, with a **filled = fully estimated / outlined = partly settled** convention and a legend row above the table. Semantic separation is enforced by hue: **amber = settlement state, violet = blended source, cyan = time basis.**

**Nav** — there is **no sidebar.** Navigation is two pill tabs (`.platform-tab`) inside the sticky header, left-aligned after the wordmark. Active = solid `--accent` with white text; inactive = `--bg-card-alt` with `--text-2`, hovering to `--accent-light` + `--accent` text. The same `.platform-tab` class does double duty for in-card channel switchers.

Header structure: `ella bella` wordmark · 1px separator · "Ops Dashboard" label · tabs — then right-aligned: relative freshness timestamp, theme toggle, refresh, "Sign out". Backdrop is `blur(24px) saturate(180%)` over the translucent `--header-bg`.

**Theme toggle** — a plain `.btn-icon` in the header showing a **sun when dark, moon when light** (i.e. the destination, not the current state), with `title="Switch to light/dark mode"` and `aria-label="Toggle theme"` (`App.jsx:1574-1581`). No dropdown, no system option.

**Modal** (`.modal-backdrop` / `.modal-panel`) — `rgba(0,0,0,0.5)` + `backdrop-filter: blur(6px)`, panel `max-width: 900px`, `max-height: calc(100dvh - 40px)`, `radius`, `box-shadow: 0 24px 80px rgba(0,0,0,.2), var(--card-glow)`, sticky header inside, slide-in animation; becomes a bottom sheet under 700px.

**Status banner** (`.conn-status`) — two states with genuinely different weights: a slim green `8px 28px` bar when everything is live, and a prominent amber `18px 28px 20px` banner with a 2px border when anything is mock. Plus a `compact` variant for dense pages. Good pattern: **severity changes the banner's physical size, not just its colour.**

**Inputs** — `height: 52px`, `padding: 14px 44px 14px 18px`, 16px text, `--surface-3` fill, `--border-hover` border, `radius-sm`; focus = `border-color: var(--accent)` + `box-shadow: 0 0 0 3px var(--accent-dim)`; error swaps both to red.

**Skeletons** — `.skel` / `.chart-skeleton`: `--surface-3`, `border-radius: 4px`, `animation: pulse 1.5s ease-in-out infinite` (opacity 0.5 ↔ 0.18).

---

## 5. Tech stack relevant to styling

| | |
|---|---|
| Framework | React 18.3 |
| Build | Vite 5.4 (`@vitejs/plugin-react`), ESM |
| Styling | **Plain CSS, hand-written, one global file** (`src/index.css`). No Tailwind, no CSS modules, no styled-components, no PostCSS config. |
| Component library | **None.** Every component is hand-rolled. No shadcn/ui, no MUI, no Radix. |
| Icons | **None installed.** Icons are hand-written inline `<svg>` React components (`RefreshIcon`, `SunIcon`, `MoonIcon` in `App.jsx:484-517`), 15×15, `viewBox="0 0 24 24"`, `fill="none"`, `stroke="currentColor"`, `strokeWidth` 2–2.2, round caps and joins — i.e. **Feather/lucide geometry, copied by hand**. Some status glyphs are literal unicode characters (`✓`, `◑`, `≠`). |
| Charts | `recharts` 3.8 + `d3-sankey`. Tooltips are custom-styled via `.chart-tooltip`. |
| Other | `@supabase/supabase-js`, `papaparse`, `xlsx` (export) |
| Theming | CSS custom properties + a `theme-light` / `theme-dark` class on `<html>`, persisted in `localStorage` under key `eb_theme` |

**Recommendations for Creator Club**, given it is a fresh build:
1. Keep the **token names and values verbatim** — that is what makes the two apps look like one family.
2. Installing `lucide-react` gives the same visual geometry the inline SVGs already imitate, for free.
3. Drop the legacy `--bg` / `--surface` / `--text` aliases; they contradict the primary tokens in dark mode.
4. Add a **spacing scale** and tokenise the cyan and chart colours — both are gaps in the current system rather than choices.
5. If using Tailwind, map the tokens into `theme.extend.colors` as `var(--…)` references and switch modes with `darkMode: ['class', '.theme-dark']` so the class contract stays identical.

---

*Read-only audit. No application files were modified.*