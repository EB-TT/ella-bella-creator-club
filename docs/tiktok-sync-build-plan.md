# Creator Club – TikTok Shop sync build plan (phase 2)

**Goal:** automatically fill and maintain the TikTok-derived creator fields (sales, units, first sale, first video, samples, collaboration status) while the team keeps owning the relationship fields (owner, next action, follow-ups, notes).

> **Hard constraint:** nothing in this build may change the **Creator Valuations** tab, its table (`creator_valuations`), its Edge Function (`valuate-creator`) or its behaviour. The sync is entirely separate – no reads from or writes to valuations.

**Starting point (2026-10-13):** Ella Bella Hair (US) is connected. Credentials and tokens are in Supabase. Granted scopes:
- `seller.authorization.info`
- `seller.order.info`
- `seller.affiliate_collaboration.read`

Signing and test calls are confirmed working.

> **Scope note (2026-10-19):** DB found the "missing" sample scope. It isn't missing – sample applications (and every other affiliate read API we need) sit under **Read Seller Affiliate Collaborations** (`seller.affiliate_collaboration.read`), which is already granted. That's why the colleague couldn't find a separate sample scope. **No new scopes and no re-authorising are needed.** The only sample API needing more is *Review a Sample Application* (approve/reject), which requires `seller.affiliate_collaboration.write` – deliberately not requested.

---

## Stack

Everything that runs ongoing is **Supabase only**. GitHub just holds the code; Vercel deploys the frontend as now.

| Layer | What | Status |
|---|---|---|
| Frontend | React + Vite on Vercel, plain CSS tokens | Existing |
| Auth | Supabase Auth, invite-only; `profiles` for owners | Existing |
| Database | Supabase Postgres, RLS | Existing + new tables below |
| TikTok connection | `tiktok-shop-setup`, `tiktok-shop-callback`, `tiktok_app_credentials`, `tiktok_shop_connections` | Done |
| Sync | New `tiktok-shop-sync` Edge Function (Deno), reusing `tiktok.ts` (signing, token refresh) | To build |
| Scheduler | `pg_cron` + `pg_net` calling the sync **hourly** | To build |
| Derived data | Postgres functions/triggers computing per-creator fields from stored TikTok data | To build |
| Phase 0 testing | Local read-only script on DB's Mac (like `tiktok-test.sh`), output kept outside the repo | To build |

```
TikTok Shop API  ──(hourly; one-off backfill)──►  tiktok-shop-sync (Edge Function)
                                                     │  upsert, no buyer PII
                                                     ▼
              tiktok_creators, tiktok_affiliate_lines, tiktok_samples,
              tiktok_target_collab_creators, tiktok_sync_state
                                                     │  recompute (end of sync; on creator insert/handle edit)
                                                     ▼
          creators (synced fields + suggestions)  ──►  app (tooltips, markers, Suggested actions, Last synced)
```

---

## APIs used

All read-only. All confirmed from TikTok's docs (downloaded 2026-10-19).

| API | Path | Scope | Paging / filters | Gives us |
|---|---|---|---|---|
| Search Seller Affiliate Orders | `POST /affiliate_seller/202410/orders/search` | affiliate read | `page_size` ≤100; filter by **create time only**, max 3-month window per request | Per SKU line: **`creator_username`**, product/SKU, quantity, price, `actual_commission_base` (net GMV), `estimated_commission_base`, `fully_return`, `settlement_status`, `content_type` + `content_id`, commission fields, collaboration IDs |
| Search Sample Applications | `POST /affiliate_seller/202508/sample_applications/search` | affiliate read | `page_size` ≤50; no date filter (filter by status/username/product) | Creator username + **open ID**, product/SKU, **status** (PENDING → AWAITING_SHIPMENT → SHIPPED → CONTENT_PENDING → COMPLETED, plus cancel reasons), `fulfillment_status`, sample **`order_id`**, tracking, creator stats (30-day GMV, followers, posts, fulfilment rate, median views) |
| Search Target Collaborations | `POST /affiliate_seller/202508/target_collaborations/search` | affiliate read | `page_size` 20/50/100; `collaboration_status` required | List of target collaborations (counts only) |
| Query Target Collaboration Detail | `GET /affiliate_seller/202508/target_collaborations/{id}` | affiliate read | one call per collaboration | **Every invited creator**: username, open ID, `showcase_product_count` (>0 = accepted), `content_product_count` (>0 = posted), status |
| Get Open Collaboration Creator Content Details | `GET /affiliate_seller/202508/open_collaborations/creator_content_details` | affiliate read | per product, `page_size` ≤100 | **Not synced** (phase 0): can't filter by creator, returns 15–24K creators per product, counts only – feeds no field |
| Get Order Detail | `GET /order/202507/orders?ids=…` | `seller.order.info` | **up to 50 order IDs per call**, comma-separated (confirmed) | Ship (`rts_time`/`collection_time`), `delivery_time` and `create_time` for **sample orders only**, via `order_id` from sample applications. Only shipped-onwards applications have a real `order_id` – the rest carry `"0"` |
| Get Order List | `POST /order/202309/orders/search` | `seller.order.info` | has **`update_time_ge`**, sortable by update time | Not synced. Kept as a fallback if Get Order Detail doesn't work. It has no sample-only filter and returns buyer PII on every order |

**Not used:**
- Get Order Price Details – affiliate orders already give net GMV.
- Anything write (Review Sample, create/edit collaborations, messaging), Product Basic, Finance.

**Assumption (agreed):** every sample appears as a sample application and as a sample order (`is_sample_order: true`). Not verified exhaustively – revisit only if the team reports missing samples.

---

## Where each field comes from

**Synced fields** – written by the sync when TikTok has data. Every one gets a **tooltip** stating its source and definition (see Tooltips).

| Field | Derived from |
|---|---|
| **GMV (USD)** | Per affiliate order line: **0 if `settlement_status = INELIGIBLE`** (cancelled/returned – TikTok sets actual to 0); `actual_commission_base` if **settled** (selling price × (quantity − returned/refunded)); otherwise `estimated_commission_base` if not fully returned; otherwise 0. Summed across **all** the creator's lines (**all-time**, history from Feb 2024). **Pre-tax**, net of refunds. A toolbar **Period** selector shows other ranges (see below). *Phase 0 finding:* `actual_commission_base` only exists once settled (~half of the last 30 days was unsettled), so actual alone undercounts. To be checked against Seller Center at the end of the build (DB has no Seller Center access now). |
| **First Sale date** | Earliest affiliate order line not fully returned (`fully_return = No`) |
| **Units Sold – Total** | Sum of `quantity` on lines not fully returned. *Caveat:* partial refunds within a line aren't itemised (TikTok deprecated those fields), so a partially refunded line still counts all its units. |
| **Units Sold – Current Product** | Same, filtered to the current product's product ID. Only calculable when Current Product came from TikTok; for a manually entered off-TikTok product it stays manual. |
| **First Video date / link** | The creator's **first ever** video (`content_type = VIDEO`) that drove a sale, any product. Link = `tiktok.com/@<username>/video/<content_id>`. Date = the video's **post time decoded from its ID** (TikTok video IDs embed their creation time in the top 32 bits – undocumented, so verify on a few videos in phase 2; fall back to the first sale time from it). Videos without sales aren't visible through the API. |
| **Other Videos** *(new field)* | For **each other product**, the first video that drove a sale of it: product, date (as above) and link. Excludes the First Video. **Most recent first.** Shown in the table under **All fields** as "N videos" (like Other Products Received) and as a list of links in the drawer. Exported as one delimited cell like Other Products Received. |
| **Current Product** | Product on the creator's latest **approved** sample application (AWAITING_SHIPMENT or later, not cancelled/rejected). **A manually entered product with a newer date wins.** |
| **Other Products Received** | Products from earlier sample applications that reached SHIPPED or later, with dates |
| **Product Sent date** | Sample order ship time (`rts_time`, else `collection_time`), via Get Order Detail |
| **Product Delivered date** | Sample order `delivery_time`, via Get Order Detail |
| **Last sale** | Latest affiliate order line not fully returned (create time) |
| **TikTok Shop eligible** | True if they appear in affiliate orders, sample applications or target collaborations. UI label becomes "Eligible" with a tick (replacing the "No" label on an unticked box). |

**New TikTok-only info** – stored in the TikTok tables (`tiktok_samples`, `tiktok_target_collab_creators`, `tiktok_creators`), shown read-only in the drawer:
- pending sample requests (status PENDING) – previously thought impossible without another scope;
- target collab status: invited / accepted (added to showcase) / posted;
- creator stats from sample applications: followers, 30-day GMV (across all shops), fulfilment rate, median video views. (`content_count` is always 0 and `tracking_number` is never returned – not used.)

**Suggestions, not automatic changes:**
- **Stage:** the sync proposes a stage and the team accepts or dismisses it in a **Suggested actions** filter. Proposed mapping, to confirm with the team after the build:
  - target collab invite accepted (showcase > 0) → Accepted (Target Collab Invite), **unless a later stage is detected**
  - sample PENDING / AWAITING_SHIPMENT → First Product
  - SHIPPED → Product Sent
  - CONTENT_PENDING → First Video
  - sample COMPLETED, or a video-attributed sale, or target collab `content_product_count` > 0 → Video Posted
  - first affiliate sale → First Sale Achieved
  
  The highest detected milestone wins, and suggestions only ever move a creator **forward**. For **auto-created** creators (no manual stage yet), the detected stage is set directly rather than suggested.
- **Tier:** a suggested tier from GMV bands, once the team sets them. After the backfill, show the team the real GMV distribution across creators to help choose the bands. Whether they want all-time or rolling GMV is also their call.
- Both are built **switchable**: suggest-only by default, with automatic application available later if the team wants it.

### Period selector (GMV and units)
- The stored GMV and Units Sold fields are **all-time**, and that's what the drawer and exports show by default.
- A toolbar **Period** selector – All time (default) / Last 7 / 30 / 90 days / This month / Custom range – recalculates the **GMV** and **Units Sold** columns (and sorting by them) for that period, from the stored affiliate lines.
- The column headers show the active period, e.g. "GMV – last 30 days". The tooltip says the values are for the selected period.
- Implemented as a read-only Postgres function (creator → GMV, units for a date range) using the same GMV definition. Saved per person with the rest of their view.

### Last sale and inactivity
- **Last sale** (sortable column) = the latest affiliate sale not fully returned.
- **No sale for** filter: 14 / 30 / 60 / 90 days, optionally combined with "no contact in X days" (Last Contact).

**Manual – never touched by the sync:** Owner, Next Action, Next Follow-up Date, Last Contact, Instagram handle, Email, Notes, Shipping Address (not synced; avoids storing addresses).

---

## How creators and TikTok data meet

**Identity:**
- Affiliate orders give **username** only.
- Sample applications and target collaborations give **username + creator open ID**.
- Matching key: **normalised username** (strip `@`, trim, lowercase). The open ID is stored when known, so a creator who changes handle can be re-linked.
- `tiktok_creators` holds one row per TikTok creator seen. `creators.tiktok_creator_id` links a CRM row to it.

**Arrival paths:**

1. **Sync-found (auto-create – decided).**
   - A creator who isn't in the CRM is **created automatically** when TikTok shows any of:
     - an **affiliate sale**;
     - a **sample shipped** or later (SHIPPED, CONTENT_PENDING, COMPLETED, and post-shipment cancellations);
     - a **pending sample request** (PENDING / AWAITING_SHIPMENT);
     - an **accepted target collab invite** (`showcase_product_count` > 0).
   - **Not** auto-created: requests cancelled before shipping (overdue, withdrawn, rejected), and invites that were never accepted (~40K invitees). Phase 0 sizing: ~770 pending requests and ~1,500 accepted invites right now, plus sellers and shipped samples – a few thousand in total.
   - Created with handle and display name from TikTok, Owner Unassigned, stage set to the highest detected milestone, and synced fields filled.
   - **Pending requests that later cancel** (most do – ~60% end OVERDUE_CANCELLED): the creator stays in the CRM with the sample status shown, and a **"Request cancelled, no other activity"** filter so the team can clear them out (soft delete).
   - They're flagged **"New from TikTok"** (a filter) so the team can triage – set owner, stage and next action.
   - Creators who are already in the CRM simply link and fill. They're never duplicated.
2. **Entered manually.** On save, a trigger normalises the handle and looks it up in `tiktok_creators`:
   - **Found:** link and fill instantly.
   - **Not found:** stays manual until TikTok activity appears, then the next sync links it.
3. **Imported from a sheet** (whether the team imports their sheet at all is decided at the end of the build). If they do, it works the same as manual entry, row by row. Imported values in synced columns are **starting values** in the app; once TikTok has data, the app shows TikTok's value instead (except Current Product, where the newer date wins). The sheet itself is never written to. The import report shows how many rows linked.

**Conflict rules (decided):**
- **TikTok wins** for synced fields where it has data. Those fields are read-only in the drawer, with a "Synced from TikTok" marker.
- Where TikTok has **no** data for a synced field (e.g. a product sent outside TikTok), the field stays editable and the **manual value is stable** – the sync never blanks it.
- **Current Product:** the most recent date wins, manual or TikTok.
- **Manual-only fields are never written** by the sync.
- **Stage/tier:** suggestions only (see above). Manual values always stick.
- **Duplicates:** unique on normalised handle and on `tiktok_creator_id`. Import reports duplicates rather than creating them.
- **Handle changes:** if TikTok shows a known open ID under a new username, the sync updates the handle. Affiliate-only creators (no open ID yet) who change handle would appear as a new auto-created creator. **Merge is deferred:** merging two TikTok identities needs the recompute to read several usernames per creator, which is a bigger change than it's worth for a rare case. For now the team edits the handle on the original creator and soft-deletes the duplicate. Revisit if duplicates turn up in practice.
- **Removed (soft-deleted) creators** stay linked and keep updating, and aren't re-created.

---

## Sync design

Runs **hourly** via `pg_cron`. Each run saves progress after every page, stops at ~80% of the Edge Function time limit, and resumes next run.

| Stream | Backfill | Ongoing |
|---|---|---|
| Affiliate orders | Walk from shop start to now in **3-month create-time windows** (API limit) | **Hourly:** last 7 days by create time. **Daily:** re-read the last 90 days to catch refunds and settlement changes (there's no update-time filter on this API). |
| Sample applications | **Per status** (unfiltered search caps at 9,999): PENDING, AWAITING_SHIPMENT and every shipped-onwards status. Never-shipped cancellations (overdue, withdrawn, rejected, seller-not-ship, deleted collab) are skipped – except to update requests already stored | **Hourly:** PENDING, AWAITING_SHIPMENT, SHIPPED, CONTENT_PENDING (~1K, ~20 pages). **Daily:** the rest of the shipped-onwards statuses, plus a status check on stored pending requests. Request date = sample order `create_time` once shipped; `first_seen_at` for pending |
| Sample order dates | Get Order Detail for all known sample `order_id`s | Hourly, for sample applications that are SHIPPED or later and still missing dates |
| Target collaborations | VALID list (~1,700), then Detail per collaboration. COMPLETED skipped | **Daily:** list VALID, then Detail **only for collaborations updated since the last run** (~170 a week). Store accepted/posted creators only, not every invitee |

**Token:** refresh if it expires within 24h, and save both new tokens before any other call. (The access token stored on 2026-10-13 expires on 2026-10-20; the first sync run refreshes it.)

**Rate limits (phase 0):** TikTok returns HTTP 429 with code `36009002` (app limit) or `36009037` (user limit) on bursts, with no warning headers. The sync paces calls (≥500 ms), retries 429s with exponential backoff (e.g. 2s, 4s, 8s, then defers to the next run), and logs them in `tiktok_sync_state`.

**PII:** store only what's listed above. No buyer names, addresses or phones; the general order list isn't synced.

---

## Tooltips

Every synced or TikTok-derived field gets a tooltip (the app already has `Tooltip.jsx`) giving its source, definition and caveats. Minimum set:
- **GMV:** "Net affiliate sales from TikTok: selling price × units, minus returns/refunds, before tax." Add "Matches Seller Center's affiliate GMV" only once phase 0 confirms it.
- **Units Sold:** includes units on partially refunded orders; fully returned orders are excluded.
- **First Sale date:** first affiliate order not fully returned.
- **First Video:** the creator's first ever video that drove a sale (videos without sales aren't visible); date is when it was posted.
- **Other Videos:** the first selling video for each other product, most recent first.
- **Product Sent / Delivered:** from TikTok's sample shipping data; manual entry where TikTok has none.
- **Current Product:** latest sample, unless a newer manual entry exists.
- **Suggested stage / tier:** what triggered the suggestion.
- **Last sale:** latest affiliate sale not fully returned.
- **GMV / Units (Period):** the period currently selected; the stored values are all-time.
- **"Synced from TikTok" marker:** last synced time, and why the field is locked.
- **Pending sample requests, target collab status, creator stats:** source and time window (e.g. "30-day GMV across all shops").

---

## Phases

### Phase 0 – Checks – **done 2026-10-19**
**Findings:**
- **Affiliate orders:** ~2,600 lines / 243 creators in 30 days; history from Feb 2024 (~30K lines – small backfill). Usernames on every line.
- **GMV:** definition D confirmed in principle – settled actual, INELIGIBLE = 0, unsettled estimated. Shop 30-day total is $62.3K vs $29.8K on settled only.
- **Samples:** 10K+ applications (search caps at 9,999). Most are OVERDUE_CANCELLED; ~770 pending. One username per open ID. Non-shipped applications have `order_id = "0"`.
- **Get Order Detail:** works – comma-separated `ids`, real IDs only.
- **Target collabs:** 1,716 valid (805 with 21+ invitees, ~40K invitees in total) and 7,288 completed; ~170 updated a week.
- **Content details:** too broad – dropped.
- **Rate limits:** 429s on bursts.
- **Timing:** the full discovery run took ~71s, so the hourly sync fits easily.

Script: `tools/tiktok-discovery/` (local, read-only).

**Original checklist (for reference):** Output is kept outside the repo, and buyer data is never saved.
1. Call **Search Seller Affiliate Orders** for the last 30 days and compute GMV variants per creator (the Seller Center comparison moves to phase 6).
2. Call **Search Sample Applications** to get the volume (total count) and real field values, including whether sample creators also appear in affiliate orders under the same username.
3. Call **Get Order Detail** for a few sample `order_id`s (batch of up to 50; confirm `ids` encoding).
4. Call **Search Target Collaborations + Detail** to check volume and whether showcase/content counts look right.
5. Check the raw **token refresh** response (the stored 2125 expiry) and any **rate-limit** headers or errors.

**Output:** a short findings note confirming or adjusting the field table, GMV definition and sync cadence.

### Phase 1 – Schema – **done 2026-10-19**
Migration 007 applied and verified (7 tables, 12 new `creators` columns, RLS on with no policies, no anon/authenticated access). Last sale and Other Videos fields are live: read-only, not importable, exported, and stripped from app saves so the app can't overwrite synced values (`useCreators.save()`).

**Additions beyond the original spec:**
- `tiktok_products` (`product_id`, `title`, `short_name`) – affiliate lines only carry product IDs, so names come from samples and collab detail. `short_name` is optional, for the team.
- `tiktok_settings` (single row) – `auto_apply_stage`, `auto_apply_tier`, `tier_bands`.
- `creators.suggestion_dismissed_value` – a dismissed suggestion isn't shown again until it changes.

**Real column names:** `tiktok_handle`, `status` (enum `creator_status`: active/removed), `first_video_date`/`first_video_link`, `first_sale_date`, `gmv`, `units_sold_current_product`, `units_sold_total`, `creator_tier`, `owner_id`, `current_product`, `other_products_received` (entries use `date_received`), `product_sent_date`, and the delivered-date column (its name was cut off in the output – confirm from 002 in phase 3). Stage is a 12-value enum; `suggested_stage`/`suggested_tier` are plain text.

**To tighten in phase 3:** handle normalisation currently strips one leading `@` and whitespace only. Also handle `@@` and pasted TikTok profile URLs before imports.

Original spec, for reference:
- `tiktok_creators`: id, `username`, `username_normalised` (unique), `open_id` (unique, nullable), `nickname`, stats (followers, 30-day GMV, fulfilment rate, median views, stats_at), `first_seen_at`, `last_seen_at`.
- `tiktok_affiliate_lines`: (order_id, sku_id) PK, `username_normalised`, product_id, sku_id, quantity, price, `actual_commission_base`, `estimated_commission_base`, currency, `fully_return`, `settlement_status`, `content_type`, `content_id`, collaboration IDs, `create_time`, `delivery_time`, `synced_at`.
- `tiktok_samples`: application id PK, creator (username/open ID), product/SKU, status, `fulfillment_status`, `order_id` (null when TikTok sends `"0"`), `requested_at` (sample order create time, else first seen), `shipped_at`, `delivered_at`, `first_seen_at`, `status_changed_at`.
- `tiktok_target_collab_creators`: (collab_id, username_normalised) PK, open ID, collab name, `showcase_product_count`, `content_product_count`, status, dates.
- `tiktok_sync_state`: one row per stream – backfill cursor/window, last run start/end, status, last error, counts.
- `creators` gets:
  - `tiktok_creator_id` (unique, nullable)
  - `handle_normalised` (unique where active)
  - `source` (`manual` / `import` / `tiktok`)
  - `new_from_tiktok` (bool)
  - `synced_fields` (jsonb)
  - `suggested_stage`, `suggested_tier`, `suggestion_reason`
  - `last_sale_at`
  - `other_videos` (jsonb array of `{product_id, product, date, url}`), added to `src/lib/fields.js` as a secondary field
  - `tiktok_synced_at`
- **RLS:** TikTok tables are service role only. Read-only views expose sync status and per-creator TikTok info to signed-in users – no PII.

### Phase 2 – Sync function, scheduling and backfill – **done 2026-10-19** (target collab detail backfill finishing)
**Result:** `tiktok-shop-sync` deployed, migration 008 applied, cron job running every 5 minutes. Affiliate (≈30K lines, from Feb 2024) and samples (6.2K pending/shipped-onwards) backfills are complete. No errors or rate limiting.

**Deviations from the spec below (as built):**
1. **JWT verification off.** Auth is an `x-sync-secret` header (`TIKTOK_SYNC_SECRET` Edge secret, and in Vault as `tiktok_sync_secret` for pg_cron), or a signed-in user's JWT. Anything else gets 401.
2. **The scheduler calls every 5 minutes, always.** The function decides what's due: backfill continuously, then hourly (55 min) and daily (23 h) passes. **Sync now must send `force: true`.**
3. **New table `tiktok_target_collabs`** (`list_update_time`, `needs_detail`) so detail is fetched only when a collab changes. A collab whose detail fails 3 times is skipped, with a warning.
4. **Commission amounts stored** on affiliate lines (estimated/actual creator, shop-ads and partner commission, plus shop-ads and partner rates), for possible commission reporting later.
5. **Per-stream leases** (`lease_until`), an equal share of the run budget per stream, and a 429 ending the whole run (the limit is per app).
6. **Only the first shop is synced** (tokens are refreshed for all).
7. **Creator conflicts** (handle vs a different open ID) are skipped and counted, not merged.
8. **Known soft spot:** a failing stream retries every 5 minutes – add back-off in phase 5.

**Findings:**
- **The refresh token is effectively non-expiring:** TikTok returns `refresh_token_expire_in = 4913951949`, a real unix timestamp in 2125. The access token lasts 7 days and the sync refreshes it, so no re-authorising is needed.
- **Video ID → post time decoding** (`content_id / 2^32`) gives plausible dates (always before the sale). DB accepted without opening the videos.

Original spec, for reference:

`tiktok-shop-sync` Edge Function implementing the streams above.
- **Auth:** JWT verification on. Called by `pg_cron` with the service role key, and by signed-in users for **Sync now**.
- **Scheduling:** enable `pg_cron` and `pg_net` and create the job here, because the backfill needs repeated runs. Run every few minutes during the backfill, then hourly.
- **Before the first backfill run:** delete the six test creators so they don't mix with real data (SQL editor only – the app can only soft-delete; valuations are unaffected):

```sql
delete from public.creators
where id in (
  '8369dd2b-fd0d-41d0-a48e-e24c3bf0d551',
  'b7f87a48-6c39-4244-b8d5-8aa6a0a7f86a',
  '2cbb26c2-4adc-4ae9-a0d7-287d7bae4041',
  '553178d2-b06e-478c-a367-d898ff6d484c',
  '6452b86d-00ef-4a5c-8ae0-ad9fb0af8a8a',
  '7cb0feaf-5bd0-4ce3-bc39-f844fe411b1f'
);
select count(*) from public.creators;  -- expect 0
```
- **Backfill mode** fills the TikTok tables until every stream is caught up, then switches to incremental. It doesn't touch `creators` – linking and auto-create arrive in phase 3 and then run over the stored data.

### Phase 3 – Derived fields, linking, auto-create – **done 2026-10-19**
**Result:** migrations 009 and 010 applied. The first full derive auto-created **5,055 creators**:

| Stage | Creators |
|---|---|
| Accepted | 260 |
| First Product | 1,063 |
| Product Sent | 25 |
| First Video | 93 |
| Video Posted | 2,349 |
| First Sale Achieved | 1,265 |

GMV reconciles exactly ($789,002.06 creators = linked lines). The derive now runs after every sync run that writes data. Re-run `select public.tiktok_derive(null);` by hand (pausing cron first) after changing tier bands, auto-apply settings or a product `short_name` – incremental runs don't notice those.

**As built (decisions made in phase 3):**
- **Sale rule:** a line counts as a sale (units, First Sale, Last sale) when it's neither INELIGIBLE (cancelled) nor fully returned. GMV per line: INELIGIBLE = 0, else actual if settled, else 0 if fully returned, else estimated.
- **Current Product, manual vs TikTok:** a trigger stamps `current_product_manual_at` whenever Current Product is edited in the app (or entered on a hand-created creator; imports aren't stamped). The newer of the manual edit and the latest approved TikTok sample wins.
- **Sent/Delivered dates** follow the current TikTok sample, including blank when it hasn't shipped (010). Untouched when Current Product is manual.
- **Other Products Received** merges: manual entries are kept, and TikTok entries (tagged `"source": "tiktok"`) are regenerated on every recompute. Phase 4 must make TikTok entries non-removable in the UI, or they reappear.
- **Other Videos:** one entry per video – `{url, date, content_id, products[], product}` – for the first selling video of each product, excluding the First Video and every product it sold; most recent first.
- **Product names are automatic:** computed from the listing title (`tiktok_auto_short_name`: strip brand/emoji, cut at the first separator, cut at " with "/" for " if long, cap at 50, keep colour variants). They're never stored, so new products are named automatically. A team-set `short_name` overrides.
- **Handle normalisation:** strips all `@`, takes the name out of pasted `tiktok.com/@…` URLs, lowercases and trims (`normalise_tiktok_handle`).
- **Stage:** auto-created creators get the highest detected milestone set directly. Later milestones become suggestions (none yet).
- **`tiktok_request_cancelled_only`** column for the "Request cancelled" filter.
- **Known edge, accepted:** "never blank" means a value TikTok no longer supports stays, e.g. First Sale date remains if a creator's only sale is later refunded.
- **App functions** (security definer, granted to `authenticated`, no PII): `creator_tiktok_period(from, to)`, `creator_tiktok_info(creator_id)`, `tiktok_sync_status()`.
- **The handle-change sync bug noted in phase 1** (normalisation) is fixed.

Original spec, for reference:
- `recompute_creator_tiktok(creator_id)` applies the field table, conflict rules and suggestion mapping.
- End of each sync:
  - auto-create creators meeting the triggers above (sale, shipped sample, pending request, accepted invite);
  - recompute only the creators touched.
- **Trigger** on `creators` insert/handle edit: normalise, link, recompute.
- Tighten `handle_normalised` (multiple `@`, pasted `tiktok.com/@…` URLs).
- `creator_tiktok_period(from, to)`: a read-only function returning GMV and units per creator for a date range, for the Period selector. It's exposed to signed-in users and returns no PII.
- Stage/tier suggestion logic, with a config switch for automatic application (off by default).

### Phase 4 – App (1–1½ days)
- **Drawer:**
  - synced fields read-only with marker and tooltip;
  - a TikTok section (pending samples, collab status, creator stats);
  - "Eligible" tick.
- **Filters:** **New from TikTok**, **Request cancelled, no other activity**, **Suggested actions** (accept/dismiss), and **No sale for X days** (optionally combined with Last Contact).
- **Column:** Last sale.
- **Period selector** in the toolbar for the GMV/Units columns (All time default, presets, custom range), with the period shown in the column headers.
- **Toolbar:** Last synced, failure/token warnings, Sync now.
- ~~Merge~~ – deferred (see conflict rules).
- **Load all creators:** the table must page through Supabase's 1,000-row default limit (5K+ creators now).
- **Performance:** paginate the table if it renders every row.
- **Tooltips** per the list above.
- **Import:** linked count.

### Phase 5 – Monitoring (¼ day)
- Switch the job from backfill cadence to hourly once caught up (if not automatic).
- Failure and token health surfaced in the app from `tiktok_sync_state`.

### Phase 6 – Test and launch (1–2 days)
- **Regression:** check the Creator Valuations tab still works unchanged (run one valuation).
- **Tooltip audit:** every synced or TikTok-derived field, column header, filter and marker has a tooltip.
- With the backfill complete, spot-check 5–10 creators' GMV, units and first sale against Seller Center (DB to get access). Adjust the GMV definition if it doesn't match – the stored lines keep both values, so it's a recompute, not a re-sync.
- Test arrival paths: auto-create from each trigger (sale, shipped sample, pending request, accepted invite), a pending request that later cancels, manual add of a known handle, manual add of an unknown handle (links on a later sync), small sheet import.
- Test refunds reducing GMV, manual-only fields untouched, manual Current Product with a newer date winning, suggestions moving forward only.
- Show the team the GMV distribution for tier bands, and the suggestions for the stage automation decision.

**Total:** ~6½–8½ working days of effort, ~1½–2 weeks elapsed (DB runs SQL, deploys and pushes between steps).

---

## Decisions

**Decided:**
- Auto-create creators with a sale, shipped sample, pending sample request or accepted target collab invite, with "New from TikTok" and "Request cancelled, no other activity" filters.
- Accepted invite → Accepted stage unless a later stage is detected.
- First Video = first ever selling video, with link; post date decoded from the video ID.
- New **Other Videos** field: the first selling video per other product, most recent first, under All fields.
- TikTok wins for synced fields with data; manual values stay where TikTok has none.
- Newer manual Current Product wins.
- Stage and tier are suggestions (Suggested actions filter), switchable to automatic later.
- GMV = settled actual, else estimated if not fully returned (net of refunds, pre-tax), explained in tooltips. Verified against Seller Center at the end of the build.
- Hourly sync; Supabase only.
- Last sale date, with a No sale for X days filter.
- GMV and Units Sold stored all-time, with a Period selector (default All time, presets, custom range) recalculating the table columns.
- All samples are assumed to appear via the sample APIs.
- Test creators are deleted before the first backfill run.
- The Creator Valuations tab, table and function are not touched.

**For the team:** see *To flag to the team when reporting* at the end.

## Open questions
- Does GMV match Seller Center? (Phase 6.)
- Exact rate limits – the backoff handles them; tune pacing from `tiktok_sync_state` logs.
- *Resolved in phase 2:* refresh token expiry (non-expiring); video ID decoding (plausible, accepted).
- *Resolved in phase 0:* `ids` encoding; sample volume; username/open ID consistency (1:1); rate-limit behaviour.

---

## To flag to the team when reporting

Design decisions made during the build that the team should know about, or confirm. Each item says what it does, and any question to ask.

**What gets filled automatically**
- **GMV** = TikTok's affiliate sales base: settled orders at their actual value, unsettled orders at TikTok's estimate, cancelled/returned orders as 0. It's pre-tax and net of refunds. *Ask:* does it match what they see in Seller Center?
- **Units Sold** excludes fully returned orders, but partially refunded orders still count every unit (TikTok doesn't itemise partial refunds).
- **First Video** = the creator's **first ever video that drove a sale**, with a link and its post date. **Other Videos** (new field) = the first selling video for each other product, most recent first. Videos that never sold aren't visible through TikTok's API.
- **Current Product** = the latest approved TikTok sample. A product entered manually with a newer date wins.
- **Product Sent / Delivered** come from TikTok's sample shipping. Products sent outside TikTok stay manual.
- **Last sale** (new field) plus a **No sale for X days** filter.
- **GMV and Units are all-time** by default. A **Period** selector in the toolbar shows any range (last 7/30/90 days, this month or custom), and the column header shows which period is active. *Ask:* is All time the right default?
- **TikTok Shop eligible** is set automatically when TikTok shows them, and the checkbox now reads "Eligible" with a tick.
- Data refreshes **hourly**.

**How creators arrive**
- Creators are **auto-created** when TikTok shows a sale, a shipped sample, a pending sample request or an accepted target collab invite. That's a few thousand to start. They arrive with **Owner Unassigned**, under a **New from TikTok** filter. *Ask:* who triages them?
- Most pending requests end up auto-cancelled by TikTok (~60% overdue). Those creators stay in the CRM, and a **Request cancelled, no other activity** filter lets the team clear them.
- Invites that were never accepted (~40K) and requests cancelled before shipping are **not** brought in.

**What the team can and can't edit**
- Once TikTok has data for a field, that field is **read-only** in the app and shows "Synced from TikTok". The team's own fields (Owner, Next Action, follow-ups, Last Contact, Notes, email, Instagram, shipping address) are never touched.
- If a sheet is imported, its values for TikTok fields are replaced in the app once TikTok has data. The sheet itself is never written to.

**Suggestions, not automatic changes** (switchable later)
- **Stage:** the app suggests the next stage from TikTok activity, e.g. accepted invite → Accepted, sample shipped → Product Sent, first sale → First Sale Achieved. Suggestions only move forward, and the team accepts or dismisses them. New auto-created creators get their stage set directly. *Ask:* is the mapping right, what does "Joined" mean, and should suggestions apply automatically?
- **Tier:** suggested from GMV bands. *Ask:* what are the bands (we'll show them the real GMV distribution), and is it all-time or rolling GMV?

**Limits to be aware of**
- No TikTok Creator Level (L0–L7) – it's based on sales across all shops.
- Creator stats (30-day GMV, followers, fulfilment rate, median views) are TikTok's cross-shop figures, shown for information only.
- Videos without sales, and samples sent outside TikTok, can't be detected.
- Product names come from TikTok's long listing titles. *Ask:* do they want short names for each product (about 20)? These can be set once and are used across the app.

**Added in phase 3**
- **Cancelled orders don't count as sales** (units, First Sale, Last sale), only fully kept or partly refunded ones.
- **Product names** are shortened automatically from TikTok's listing titles, e.g. "Keratin Hair Mask". *Ask:* do they want to rename any? That can be done per product, and it sticks.
- **Other Products Received** keeps anything they type in, alongside the products TikTok shows were sent.
- **Current Product:** whatever is newest wins – a TikTok sample, or something they typed in.
- **Starting numbers:** the first load created ~5,000 creators from TikTok history, all with Owner Unassigned under "New from TikTok". *Ask:* how do they want to triage these – by GMV, by stage, by recent activity?
- **Duplicate creators** (rare, from handle changes) are handled by editing the handle on the original and removing the duplicate. There's no merge button.

**Still to get from the team**
- The list of users to create (names, emails).
- Whether to import their Google Sheet at all.

**Possible extras to offer** (not in this build – ask if they want any)

All of these use data the sync already stores, so no new TikTok access is needed.
- **Commission paid per creator:** commission paid vs GMV, the effective commission rate, and ROI per creator.
- **Best-selling video per creator:** sales grouped by video, showing each creator's top video with its GMV and link.
- **How each creator sells:** split of sales by video / live / showcase / link, e.g. "mostly lives".
- **Sample conversion rate:** per creator and per product, how many samples were sent and how many led to sales. Shows who actually sells after getting free product.
- **Return rate per creator:** the share of their sales that got refunded or returned.
- **Creator stats for vetting sample requests:** cross-shop 30-day GMV, followers, fulfilment rate and median views, shown next to pending requests to help decide which to approve.
