# TikTok Shop discovery (Phase 0)

A local, **read-only** script that confirms the real shape of TikTok Shop's data before any schema or sync is built. See `docs/tiktok-sync-build-plan.md` ("APIs used", "Where each field comes from", "Phase 0").

It changes nothing in TikTok, Supabase or the app. It never saves buyer data (names, addresses, phones), and it never prints or writes the app key, app secret, tokens or shop cipher.

## Setup

```sh
cd tools/tiktok-discovery
npm install
cp .env.example .env
```

Fill in `.env` with the values from this query, run in the Supabase SQL editor:

```sql
select c.app_key, c.app_secret, s.access_token, s.refresh_token, s.shop_cipher
from public.tiktok_app_credentials c, public.tiktok_shop_connections s;
```

| `.env` variable | SQL column |
|---|---|
| `TIKTOK_APP_KEY` | `app_key` |
| `TIKTOK_APP_SECRET` | `app_secret` |
| `TIKTOK_ACCESS_TOKEN` | `access_token` |
| `TIKTOK_REFRESH_TOKEN` | `refresh_token` |
| `TIKTOK_SHOP_CIPHER` | `shop_cipher` |

`.env` is gitignored. Don't commit it or paste it anywhere.

## Run

```sh
npx tsx run.ts                  # all sections
npx tsx run.ts --only samples   # one of: affiliate, samples, orderdetail, collabs, content, analytics
npx tsx run.ts --refresh        # opt-in token refresh (see below)
npm run typecheck               # type-check only; makes no API calls
```

Read the results in **`output/findings.md`**. It's safe to paste back into planning: it holds counts, distributions, creator usernames and stats, errors and rate-limit headers, and no credentials or buyer data.

Also written: `output/samples/<section>.json`, up to 3 sanitised example items per section to show field shapes. Nothing else is written, and no raw responses or order data are cached.

Notes on `--only`:
- `--only` re-runs just that section and updates its part of `findings.md`, leaving the other sections as they were.
- `orderdetail` and `content` need IDs from sample applications, so they run `samples` first automatically.
- Username matching between sections (samples vs affiliate, collabs vs both) only works when those sections run in the same invocation. Run everything once for the full picture.

Requests are paced at least 300 ms apart, and a section stops cleanly on the first non-zero TikTok `code`, recording the error. A full run makes a few hundred calls at most (the affiliate history walk, the sample scan and the full VALID collaboration list are the bulk).

`findings.md` ends with a **Timing** table (calls, API seconds, wall seconds, average ms per call per section), for sizing the hourly sync against the Edge Function time limit. With `--only`, rows for sections you didn't re-run are kept from their last run.

If Get Order Detail returns nothing under any `ids` encoding, the `orderdetail` section falls back to Get Order List (last 30 days, up to 10 pages) and reports counts only. Only eight timing/flag fields are kept from each order; the rest is dropped as each page is read.

## The `analytics` section (video and LIVE views)

Checks whether tiers can qualify on views: Get Shop Video Performance List (`/analytics/202605/shop_videos/performance`) and Get Shop LIVE Performance List (`/analytics/202609/shop_lives/performance`). It needs the scope **`data.shop_analytics.public.read`**, so the shop must have re-authorised with it and `.env` must hold the token issued after that.

```sh
npx tsx run.ts --only analytics
```

Each endpoint starts with a one-call access check (last 30 days, `AFFILIATE_ACCOUNTS`, `page_size=1`). If it fails, the section reports the HTTP status, TikTok code, message and request ID and skips that endpoint. A permissions error most likely means `.env` still holds the pre-re-authorisation access token: re-run the Setup SQL and refresh `.env`.

If access works it reports: video volume per `account_type` (60 days); zero-GMV videos, views percentiles, distinct creators and field inventory (affiliate videos, top 2,000 by views); history depth in 60-day windows back to 2024-02-01; whether `views` is per window or cumulative (videos in two adjacent windows); and for LIVE sessions the same counts, distributions, identity and history (one full-range call first, then 60-day windows if rejected).

Before paging the video list, the section probes nine request shapes (page size, window, sort, `currency`) one call at a time, because the page_size=100 views-sorted list returned HTTP 500 / code 36009003. It records each result with its request ID and pages with the best shape that works (views sort first, then the longest window, then the largest page size). If none work it says so and lists the request IDs for TikTok support. A page that fails after earlier pages succeeded is retried after 2 s, 4 s and 8 s, and the retries are reported.

Creator-identity matching and the "posting vs selling" count use the affiliate and samples sections' results, so they only appear when those ran in the same invocation. `--only analytics` on its own skips them; run everything once (`npx tsx run.ts`) for those lines.

## The access token expires 2026-10-20 10:39 UTC

After that, every section will fail with an auth error. Either:
- run `npx tsx run.ts --refresh` and **apply the SQL it prints straight away**, then update `.env`; or
- wait until the phase 2 sync is refreshing tokens.

### Why `--refresh` is opt-in

Refreshing swaps both tokens, and TikTok may invalidate the old ones immediately. If the new tokens aren't saved to Supabase straight away, the stored connection stops working and the shop would need re-authorising. So:
- it never runs by default, and runs on its own (not combined with other sections);
- it asks you to type `yes` first;
- it prints the new tokens to your terminal **only** (never to disk) as a ready-to-run `update public.tiktok_shop_connections …` statement, plus the raw expiry fields and whether they look like timestamps or durations. This is the only place the script prints credentials, on purpose.

After running it: apply the SQL at once, update `TIKTOK_ACCESS_TOKEN` and `TIKTOK_REFRESH_TOKEN` in `.env`, and clear your terminal scrollback.

## Privacy

- `output/` may contain creator usernames, nicknames and stats. **Delete `output/` when finished.**
- Order Detail is reduced to seven timing/flag fields before anything is kept. Sample files are also scrubbed of fields that look like address, phone, email, recipient, buyer or payment data, and URLs are stripped of their query strings.
- All terminal and file output passes through a redactor that masks the five credential values and signature/token query parameters.
- The repo is public: `.env`, `output/` and `node_modules/` are all gitignored in this folder.
