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
| Get Open Collaboration Creator Content Details | `GET /affiliate_seller/202508/open_collaborations/creator_content_details` | affiliate read | per product, `page_size` ≤100 | Creators promoting a product, with video/live counts (no dates/links) – optional |
| Get Order Detail | `GET /order/202507/orders?ids=…` | `seller.order.info` | **up to 50 order IDs per call** | Ship (`rts_time`/`collection_time`) and `delivery_time` for **sample orders only**, via `order_id` from sample applications. Phase 0: confirm how the `ids` list is encoded in the signed query |
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
| **GMV (USD)** | Sum of `actual_commission_base` across the creator's affiliate order lines = selling price × (quantity − returned/refunded), **pre-tax**, net of refunds. This is TikTok's own affiliate sales base. Phase 0 checks it matches Seller Center. |
| **First Sale date** | Earliest affiliate order line not fully returned (`fully_return = No`) |
| **Units Sold – Total** | Sum of `quantity` on lines not fully returned. *Caveat:* partial refunds within a line aren't itemised (TikTok deprecated those fields), so a partially refunded line still counts all its units. |
| **Units Sold – Current Product** | Same, filtered to the current product's product ID. Only calculable when Current Product came from TikTok; for a manually entered off-TikTok product it stays manual. |
| **First Video date / link** | Earliest affiliate line with `content_type = VIDEO`; link = `tiktok.com/@<username>/video/<content_id>`. Tooltip: "first video that drove a sale" – not necessarily the first video posted. |
| **Current Product** | Product on the creator's latest **approved** sample application (AWAITING_SHIPMENT or later, not cancelled/rejected). **A manually entered product with a newer date wins.** |
| **Other Products Received** | Products from earlier sample applications that reached SHIPPED or later, with dates |
| **Product Sent date** | Sample order ship time (`rts_time`, else `collection_time`), via Get Order Detail |
| **Product Delivered date** | Sample order `delivery_time`, via Get Order Detail |
| **Last sale** | Latest affiliate order line not fully returned (create time) |
| **TikTok Shop eligible** | True if they appear in affiliate orders, sample applications or target collaborations. UI label becomes "Eligible" with a tick (replacing the "No" label on an unticked box). |

**New TikTok-only info** – stored in the TikTok tables (`tiktok_samples`, `tiktok_target_collab_creators`, `tiktok_creators`), shown read-only in the drawer:
- pending sample requests (status PENDING) – previously thought impossible without another scope;
- target collab status: invited / accepted (added to showcase) / posted;
- creator stats from sample applications: followers, 30-day GMV, posts, fulfilment rate, median video views.

**Suggestions, not automatic changes:**
- **Stage:** the sync proposes a stage and the team accepts or dismisses it in a **Suggested actions** filter. Proposed mapping, to confirm with the team after the build:
  - target collab invite with showcase > 0 → Accepted (Target Collab Invite)
  - sample PENDING / AWAITING_SHIPMENT → First Product
  - SHIPPED → Product Sent
  - CONTENT_PENDING → First Video
  - sample COMPLETED, or a video-attributed sale, or target collab `content_product_count` > 0 → Video Posted
  - first affiliate sale → First Sale Achieved
  
  Suggestions only ever move a creator **forward**.
- **Tier:** a suggested tier from GMV bands, once the team sets them. After the backfill, show the team the real GMV distribution across creators to help choose the bands. Whether they want all-time or rolling GMV is also their call.
- Both are built **switchable**: suggest-only by default, with automatic application available later if the team wants it.

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
   - Any creator with TikTok activity (sales, sample request, target collab invite) who isn't in the CRM is **created automatically**: handle and display name from TikTok, Owner Unassigned, synced fields filled.
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
- **Handle changes:** if TikTok shows a known open ID under a new username, the sync updates the handle. Affiliate-only creators (no open ID yet) who change handle would appear as a new auto-created creator – a "Merge" action handles the rare case.
- **Removed (soft-deleted) creators** stay linked and keep updating, and aren't re-created.

---

## Sync design

Runs **hourly** via `pg_cron`. Each run saves progress after every page, stops at ~80% of the Edge Function time limit, and resumes next run.

| Stream | Backfill | Ongoing |
|---|---|---|
| Affiliate orders | Walk from shop start to now in **3-month create-time windows** (API limit) | **Hourly:** last 7 days by create time. **Daily:** re-read the last 90 days to catch refunds and settlement changes (there's no update-time filter on this API). |
| Sample applications | Full scan | **Hourly** full scan (≤50 per page). Record `first_seen_at` per application as the request date (the API has no create time). |
| Sample order dates | Get Order Detail for all known sample `order_id`s | Hourly, for sample applications that are SHIPPED or later and still missing dates |
| Target collaborations | Search each status, then Detail per collaboration | **Daily** |
| Creator content details | – | Optional, daily, per product |

**Token:** refresh if it expires within 24h, and save both new tokens before any other call.

**PII:** store only what's listed above. No buyer names, addresses or phones; the general order list isn't synced.

---

## Tooltips

Every synced or TikTok-derived field gets a tooltip (the app already has `Tooltip.jsx`) giving its source, definition and caveats. Minimum set:
- **GMV:** "Net affiliate sales from TikTok: selling price × units, minus returns/refunds, before tax." Add "Matches Seller Center's affiliate GMV" only once phase 0 confirms it.
- **Units Sold:** includes units on partially refunded orders; fully returned orders are excluded.
- **First Sale date:** first affiliate order not fully returned.
- **First Video:** the first video that drove a sale, not necessarily the first posted.
- **Product Sent / Delivered:** from TikTok's sample shipping data; manual entry where TikTok has none.
- **Current Product:** latest sample, unless a newer manual entry exists.
- **Suggested stage / tier:** what triggered the suggestion.
- **Last sale:** latest affiliate sale not fully returned.
- **"Synced from TikTok" marker:** last synced time, and why the field is locked.
- **Pending sample requests, target collab status, creator stats:** source and time window (e.g. "30-day GMV across all shops").

---

## Phases

### Phase 0 – Checks (½ day)
A local read-only script. Output is kept outside the repo, and buyer data is never saved.
1. Call **Search Seller Affiliate Orders** for the last 30 days. Then compare one creator's summed `actual_commission_base` with Seller Center's affiliate GMV for them.
2. Call **Search Sample Applications** to get the volume (total count) and real field values, including whether sample creators also appear in affiliate orders under the same username.
3. Call **Get Order Detail** for a few sample `order_id`s (batch of up to 50; confirm `ids` encoding).
4. Call **Search Target Collaborations + Detail** to check volume and whether showcase/content counts look right.
5. Check the raw **token refresh** response (the stored 2125 expiry) and any **rate-limit** headers or errors.

**Output:** a short findings note confirming or adjusting the field table, GMV definition and sync cadence.

### Phase 1 – Schema (½ day)
Migration `007_tiktok_sync.sql`:
- `tiktok_creators`: id, `username`, `username_normalised` (unique), `open_id` (unique, nullable), `nickname`, stats (followers, 30-day GMV, posts, fulfilment rate, median views, stats_at), `first_seen_at`, `last_seen_at`.
- `tiktok_affiliate_lines`: (order_id, sku_id) PK, `username_normalised`, product_id, sku_id, quantity, price, `actual_commission_base`, `estimated_commission_base`, currency, `fully_return`, `settlement_status`, `content_type`, `content_id`, collaboration IDs, `create_time`, `delivery_time`, `synced_at`.
- `tiktok_samples`: application id PK, creator (username/open ID), product/SKU, status, `fulfillment_status`, `order_id`, `shipped_at`, `delivered_at`, `first_seen_at`, `status_changed_at`.
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
  - `tiktok_synced_at`
- **RLS:** TikTok tables are service role only. Read-only views expose sync status and per-creator TikTok info to signed-in users – no PII.

### Phase 2 – Sync function, scheduling and backfill (1½–2½ days)
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

### Phase 3 – Derived fields, linking, auto-create (1 day)
- `recompute_creator_tiktok(creator_id)` applies the field table, conflict rules and suggestion mapping.
- End of each sync:
  - auto-create creators for new `tiktok_creators` with activity;
  - recompute only the creators touched.
- **Trigger** on `creators` insert/handle edit: normalise, link, recompute.
- Stage/tier suggestion logic, with a config switch for automatic application (off by default).

### Phase 4 – App (1–1½ days)
- **Drawer:**
  - synced fields read-only with marker and tooltip;
  - a TikTok section (pending samples, collab status, creator stats);
  - "Eligible" tick.
- **Filters:** **New from TikTok**, **Suggested actions** (accept/dismiss), and **No sale for X days** (optionally combined with Last Contact).
- **Column:** Last sale.
- **Toolbar:** Last synced, failure/token warnings, Sync now.
- **Merge** action for duplicate creators.
- **Tooltips** per the list above.
- **Import:** linked count.

### Phase 5 – Monitoring (¼ day)
- Switch the job from backfill cadence to hourly once caught up (if not automatic).
- Failure and token health surfaced in the app from `tiktok_sync_state`.

### Phase 6 – Test and launch (1–2 days)
- **Regression:** check the Creator Valuations tab still works unchanged (run one valuation).
- **Tooltip audit:** every synced or TikTok-derived field, column header, filter and marker has a tooltip.
- With the backfill complete, spot-check 5–10 creators' GMV, units and first sale against Seller Center.
- Test arrival paths: auto-create, manual add of a known handle, manual add of an unknown handle (links on a later sync), small sheet import.
- Test refunds reducing GMV, manual-only fields untouched, manual Current Product with a newer date winning, suggestions moving forward only.
- Show the team the GMV distribution for tier bands, and the suggestions for the stage automation decision.

**Total:** ~6–8 working days of effort, ~1½–2 weeks elapsed (DB runs SQL, deploys and pushes between steps).

---

## Decisions

**Decided:**
- Auto-create creators from TikTok activity, with a "New from TikTok" filter.
- TikTok wins for synced fields with data; manual values stay where TikTok has none.
- Newer manual Current Product wins.
- Stage and tier are suggestions (Suggested actions filter), switchable to automatic later.
- GMV = `actual_commission_base` (net of refunds, pre-tax), explained in tooltips.
- Hourly sync; Supabase only.
- Last sale date, with a No sale for X days filter.
- All samples are assumed to appear via the sample APIs.
- Test creators are deleted before the first backfill run.
- The Creator Valuations tab, table and function are not touched.

**For the team (after the build, using real data):**
- tier bands, and all-time vs rolling GMV;
- whether to switch stage/tier suggestions to automatic, and confirm the stage mapping;
- what "Joined" means relative to TikTok events;
- the list of users to create (names, emails);
- whether to import their Google Sheet at all.

## Open questions (phase 0)
- Does GMV match Seller Center?
- `ids` list encoding for Get Order Detail.
- Sample application volume.
- Rate limits.
- Refresh token expiry.
- Whether sample/target creators' usernames match affiliate order usernames exactly.
