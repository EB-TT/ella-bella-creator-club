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
npx tsx run.ts --only samples   # one of: affiliate, samples, orderdetail, collabs, content
npx tsx run.ts --refresh        # opt-in token refresh (see below)
npm run typecheck               # type-check only; makes no API calls
```

Read the results in **`output/findings.md`**. It's safe to paste back into planning: it holds counts, distributions, creator usernames and stats, errors and rate-limit headers, and no credentials or buyer data.

Also written: `output/samples/<section>.json`, up to 3 sanitised example items per section to show field shapes. Nothing else is written, and no raw responses or order data are cached.

Notes on `--only`:
- `--only` re-runs just that section and updates its part of `findings.md`, leaving the other sections as they were.
- `orderdetail` and `content` need IDs from sample applications, so they run `samples` first automatically.
- Username matching between sections (samples vs affiliate, collabs vs both) only works when those sections run in the same invocation. Run everything once for the full picture.

Requests are paced at least 300 ms apart, and a section stops cleanly on the first non-zero TikTok `code`, recording the error. A full run makes a few hundred calls at most (the affiliate history walk and sample scan are the bulk).

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
