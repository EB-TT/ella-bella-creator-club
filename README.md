# ella bella creator club

Internal tool for tracking TikTok/Instagram creator relationships for the Ella Bella
Amazon FBA brand. Separate app, repo, Supabase project and Vercel project from
Ella Bella Ops.

This is the manual MVP: every field is entered by the team. There is no TikTok Shop
API integration, no automation and no derived fields — those come later.

## Stack

React + Vite · Supabase (Postgres + Auth) · plain CSS custom properties ·
`papaparse` (CSV) · `recharts` (stage funnel) · `lucide-react` (icons)

## Setup

```bash
npm install
cp .env.example .env   # then fill in the two values from Supabase → Settings → API
npm run dev
```

Apply `supabase/migrations/001_creators.sql` in the Supabase SQL editor before first run.

Accounts are created by an admin in the Supabase dashboard (Authentication → Users).
There is no public sign-up, by design.

## What it does

- **Active tab** — sortable table of active creators, overdue follow-ups highlighted in red
- **Stage funnel** — count per journey stage; click a bar to filter the table
- **Detail drawer** — every field editable inline, plus a timestamped notes feed
- **CSV import/export** — in-app, using the team member's own session (no dashboard access needed)
- **Removed tab** — soft-deleted creators with who/when, and a restore action

Nothing is ever hard-deleted: removal sets `status = 'removed'` and records
`removed_by` / `removed_at`.

## Conventions

- Add a field in one place: `src/lib/fields.js`. The table, detail panel, CSV import
  mapping and CSV export all derive from `FIELDS`.
- Theming is `theme-light` / `theme-dark` on `<html>`, persisted in `localStorage`,
  light by default. Tokens live in `src/styles/tokens.css` and match Ops.
- Use the spacing scale (`--sp-1` … `--sp-8`) rather than literal pixel values.
