# Creator Club CRM — MVP Build Plan

## Purpose
Test the creator-journey workflow with the team (Megs, Adian) on ~50 real creators before migrating all 1,000+ or building any TikTok Shop API automation. Manual data entry throughout — no external API dependency for this phase.

## Stack
- **Database:** Supabase (Postgres + auto-generated API)
- **Auth:** Supabase Auth, email/password or magic link — no public sign-up, team members added manually
- **Security:** Row Level Security enabled on all tables; only the public `anon` key used in the frontend; login required to view or edit anything
- **Frontend:** Web app (React), built via Claude Code CLI

## Journey stages
Accepted (Target Collab Invitation) → Received Product → First Video → First Sale → Build Momentum → Consistent Creator → Tier Up

## Data model

### `creators` table
| Field | Notes |
|---|---|
| Name | |
| TikTok handle | |
| Instagram handle | |
| Email | |
| TikTok Shop eligible (Y/N) | |
| Stage | one of the journey stages above |
| Next Action | free text |
| Next Follow-up Date | drives overdue highlighting |
| Owner | team member responsible |
| Product sent date | |
| Product delivery date | |
| First video date/link | |
| First sale date | |
| Units sold | |
| GMV | |
| Creator Tier | e.g. Bronze/Silver/Gold — distinct from Stage, only populated once sales exist |
| Status | active / removed — drives soft-delete behaviour |
| Removed by | populated only if Status = removed |
| Removed at | populated only if Status = removed |
| Notes | stored directly on the creator's row, not a separate table. Each entry carries author + timestamp; UI shows notes collapsed by default with a click-to-expand to view/add entries, newest first |

"Last contact" is derived automatically as the most recent note entry's timestamp per creator — not a manually-entered field.

## Tabs
- **Active** — all creators with Status = active (this is the main working view, including the table, sort, overdue highlighting, and funnel summary)
- **Removed** — creators with Status = removed, showing removal author/timestamp, with a restore action

## Features for this build

1. **Main table view** — all active creators, all fields above as columns
2. **Custom column sort** — click any column header to sort (priority: Stage, Next Follow-up Date, GMV)
3. **Overdue follow-up highlighting** — any creator with a Next Follow-up Date in the past is visually flagged (not just "due today")
4. **Detail panel** — click a creator to open full field view + the notes feed, editable inline
5. **Notes feed** — add timestamped, authored notes per creator; displayed newest-first
6. **Stage funnel view** — simple count-per-stage summary (e.g. bar chart), showing where creators are bottlenecking
7. **CSV import/export, built into the app UI** — team members must be able to import without any Supabase dashboard access; app reads CSV client-side (e.g. PapaParse), maps columns, writes to Supabase using the logged-in user's own session/RLS permissions
8. **Delete with confirmation → soft delete** — confirmation modal before removal; removed creators are flagged (Status = removed, Removed by, Removed at) rather than deleted from the database
## Explicitly out of scope for this build
- TikTok Shop API sync (manual entry only, for now)
- Bulk actions (multi-select stage updates)
- Per-owner saved views/filters
- Full audit log of every field edit (only deletion is tracked for now)
- AI-generated follow-up drafting

## Rough timeline
Target: functional, testable version within 1 day (build tomorrow), for Megs/team to start using on the initial ~50-creator import. Not expected to be fully polished — functional and testable is the bar for this phase.
