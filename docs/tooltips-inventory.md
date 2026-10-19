# Creator Club – tooltip and hint inventory (creators side)

Phase 6 audit input. Read-only inventory of every tooltip and hint on the creators side of the app, taken from the code as it stands on `main`. **Out of scope:** the Creator Valuations tab (`Valuation*`, `CreatorValuations`, `useValuations`, `valuationBenchmarks.js`), plus login, TikTok setup and confirm-modal copy.

## How to read this

- **Text is verbatim**, in code spans. A real tooltip is the `Tooltip` bubble (hover or keyboard focus). A native `title=` attribute is marked **(native title)**; it behaves differently (slow, no keyboard, no touch). Inline text under a field is marked **(inline)**.
- **Missing? = NONE** means the element has no tooltip or hint of any kind.
- Where a bubble stacks two texts, they are separated by `⏎⏎` (a blank line in the bubble).
- Source paths, abbreviated:
  - `tiktok.js` = `src/lib/tiktok.js` (`TIKTOK_HINTS` = all tooltip copy there)
  - `fields.js` = `src/lib/fields.js` (`hint` on a `FIELDS` entry)
  - `SyncMarker.jsx`, `CreatorTable.jsx`, `CreatorDetail.jsx`, `TikTokSection.jsx`, `SuggestionBar.jsx`, `ProductsList.jsx`, `FiltersMenu.jsx`, `PeriodSelector.jsx`, `SyncStatus.jsx`, `Pagination.jsx`, `StageFunnel.jsx`, `FieldInput.jsx`, `ImportModal.jsx`, `NotesFeed.jsx` = `src/components/…`
  - `App.jsx` = `src/App.jsx`; `useTikTokSync.js` = `src/hooks/useTikTokSync.js`

### How header and drawer tooltips are built

- **Table header** (`CreatorTable.jsx`): tip = `TIKTOK_HINTS[field.key]`, else `field.hint`, else nothing. For GMV and Units Sold (Total) (`PERIOD_FIELDS`) the tip is always `TIKTOK_HINTS.period` ⏎⏎ the field hint, and the label gains the period when one is active (e.g. `GMV – last 30 days`).
- **Drawer label** (`SyncMarker.jsx · FieldLabel`): an ⓘ icon with `TIKTOK_HINTS[field.key]` only (it does **not** read `field.hint`), plus the "Synced from TikTok" marker when `synced_fields[key]` is true. GMV and Units Sold (Total) also get a ` · All time` sub-label with its own tooltip.
- The header and the drawer ⓘ therefore show the same definition text for every TikTok-derived field.

---

## 1. Table column headers

Display order. **Key fields** = the first nine; **All fields** = the same nine, then the rest, in `FIELDS` order. Removed tab adds `Removed by`, `Removed at` and an unlabelled Restore column (no tooltips, `App.jsx · removedColumns`).

| # | Element | Where | Tooltip or hint text | Source | Missing? |
|---|---|---|---|---|---|
| 1 | Name (Key + All) | Table header | — | — | **NONE** |
| 2 | Stage (Key + All) | Table header | — | — | **NONE** |
| 3 | Next Action (Key + All) | Table header | — | — | **NONE** |
| 4 | Current Product (Key + All) | Table header | `From the latest approved TikTok sample, unless someone entered a newer product here.` | `tiktok.js · TIKTOK_HINTS.current_product` | |
| 5 | Next Follow-up (Key + All) | Table header | — | — | **NONE** |
| 6 | Owner (Key + All) | Table header | — | — | **NONE** |
| 7 | GMV (Key + All). Label becomes `GMV – <period>` when a period is active | Table header | `Values for the selected period, calculated from TikTok sales. Stored totals are all-time.`⏎⏎`Net affiliate sales from TikTok: selling price × units, minus returns and refunds, before tax. Cancelled orders count as 0. Unsettled orders use TikTok's estimate.` | `tiktok.js · TIKTOK_HINTS.period` + `TIKTOK_HINTS.gmv` | |
| 8 | Creator Tier (Key + All) | Table header | — | — | **NONE** |
| 9 | Last Contact (Key + All) | Table header | — | — | **NONE** |
| 10 | TikTok Handle (All) | Table header | — | — | **NONE** |
| 11 | Instagram Handle (All) | Table header | — | — | **NONE** |
| 12 | Email (All) | Table header | — | — | **NONE** |
| 13 | TikTok Shop Eligible (All) | Table header | `Set automatically once TikTok shows any affiliate activity.` | `tiktok.js · TIKTOK_HINTS.tiktok_shop_eligible` | |
| 14 | Shipping Address (All) | Table header | `Only needed for creators who are not TikTok Shop Affiliates.` | `fields.js · shipping_address.hint` (header falls back to `field.hint`) | |
| 15 | Other Products Received (All) | Table header | `Products from earlier TikTok samples that shipped, plus anything entered here. TikTok entries are managed by the sync and cannot be removed.` | `tiktok.js · TIKTOK_HINTS.other_products_received` | |
| 16 | Other Videos (All) | Table header | `For each other product, the first video that sold it. Each video is listed once with the products it sold. Most recent first.` | `tiktok.js · TIKTOK_HINTS.other_videos` | |
| 17 | Product Sent (All) | Table header | `From TikTok's shipping for the current sample. Blank until it ships.` | `tiktok.js · TIKTOK_HINTS.product_sent_date` | |
| 18 | Product Delivered (All) | Table header | `From TikTok's shipping for the current sample. Blank until it ships.` | `tiktok.js · TIKTOK_HINTS.product_delivery_date` | |
| 19 | First Video Date (All) | Table header | `The creator's first video that drove a sale, and when it was posted. Videos without sales aren't visible to TikTok's API.` | `tiktok.js · TIKTOK_HINTS.first_video_date` | |
| 20 | First Video Link (All) | Table header | `The creator's first video that drove a sale, and when it was posted. Videos without sales aren't visible to TikTok's API.` | `tiktok.js · TIKTOK_HINTS.first_video_link` | |
| 21 | First Sale Date (All) | Table header | `First TikTok affiliate sale that wasn't cancelled or fully returned.` | `tiktok.js · TIKTOK_HINTS.first_sale_date` | |
| 22 | Units Sold (Current Product) (All). Does **not** follow the Period selector | Table header | `Units on TikTok affiliate orders for the current product that weren't cancelled or fully returned. Partly refunded orders still count every unit.` | `tiktok.js · TIKTOK_HINTS.units_sold_current_product` | |
| 23 | Units Sold (Total) (All). Label becomes `Units Sold (Total) – <period>` when a period is active | Table header | `Values for the selected period, calculated from TikTok sales. Stored totals are all-time.`⏎⏎`Units on TikTok affiliate orders that weren't cancelled or fully returned. Partly refunded orders still count every unit.` | `tiktok.js · TIKTOK_HINTS.period` + `TIKTOK_HINTS.units_sold_total` | |
| 24 | Last Sale (All) | Table header | `Latest TikTok affiliate sale that wasn't cancelled or fully returned.` | `tiktok.js · TIKTOK_HINTS.last_sale_at` | |
| 25 | Products / Other Videos cell contents (`N products`, `N videos`) | Table cell | The full list as a **(native title)**, e.g. `Product A (2026-08-01); Product B` / `2026-08-01 · Product A https://…` | `CreatorTable.jsx · Cell` via `fields.js · formatProducts / formatVideos` | |
| 26 | Sort arrows on sortable headers | Table header | — (state only via `aria-sort`) | `CreatorTable.jsx` | **NONE** |

---

## 2. Drawer fields

Grouped as `CreatorDetail.jsx · GROUPS`. "Label tip" is the ⓘ next to the label. Fields in `LOCKED_WHEN_SYNCED` become read-only once TikTok has filled them for that creator; **Last Sale** and **Other Videos** are always read-only.

| Element | Where | Tooltip or hint text | Source | Missing? |
|---|---|---|---|---|
| **Group: Creator** | | | | |
| Name | Drawer · Creator | — | — | **NONE** |
| TikTok Handle | Drawer · Creator | — (the TikTok section says `Not linked to TikTok – set their TikTok handle to link them.` – see §3) | — | **NONE** |
| Instagram Handle | Drawer · Creator | — | — | **NONE** |
| Email | Drawer · Creator | — | — | **NONE** |
| TikTok Shop Eligible (checkbox label `Eligible`) | Drawer · Creator, label tip | `Set automatically once TikTok shows any affiliate activity.` | `tiktok.js · TIKTOK_HINTS.tiktok_shop_eligible` | |
| Shipping Address | Drawer · Creator, label tip | — (label has no ⓘ; the text is shown inline, §7) | — | **NONE** (tooltip); inline hint present |
| **Group: Journey** | | | | |
| Stage | Drawer · Journey | — | — | **NONE** |
| Owner (dropdown, first option `Unassigned`) | Drawer · Journey | — | — | **NONE** |
| Next Action | Drawer · Journey | — | — | **NONE** |
| Next Follow-up | Drawer · Journey | — | — | **NONE** |
| Last Contact | Drawer · Journey | — | — | **NONE** |
| **Group: Product & content** | | | | |
| Current Product | Drawer · Product & content, label tip | `From the latest approved TikTok sample, unless someone entered a newer product here.` | `tiktok.js · TIKTOK_HINTS.current_product` | |
| Other Products Received | Drawer · Product & content, label tip | `Products from earlier TikTok samples that shipped, plus anything entered here. TikTok entries are managed by the sync and cannot be removed.` | `tiktok.js · TIKTOK_HINTS.other_products_received` | |
| Product Sent | Drawer · Product & content, label tip | `From TikTok's shipping for the current sample. Blank until it ships.` | `tiktok.js · TIKTOK_HINTS.product_sent_date` | |
| Product Delivered | Drawer · Product & content, label tip | `From TikTok's shipping for the current sample. Blank until it ships.` | `tiktok.js · TIKTOK_HINTS.product_delivery_date` | |
| First Video Date | Drawer · Product & content, label tip | `The creator's first video that drove a sale, and when it was posted. Videos without sales aren't visible to TikTok's API.` | `tiktok.js · TIKTOK_HINTS.first_video_date` | |
| First Video Link | Drawer · Product & content, label tip | `The creator's first video that drove a sale, and when it was posted. Videos without sales aren't visible to TikTok's API.` | `tiktok.js · TIKTOK_HINTS.first_video_link` | |
| Other Videos (empty state `None recorded.`) | Drawer · Product & content, label tip | `For each other product, the first video that sold it. Each video is listed once with the products it sold. Most recent first.` | `tiktok.js · TIKTOK_HINTS.other_videos` | |
| **Group: Performance** | | | | |
| First Sale Date | Drawer · Performance, label tip | `First TikTok affiliate sale that wasn't cancelled or fully returned.` | `tiktok.js · TIKTOK_HINTS.first_sale_date` | |
| Last Sale | Drawer · Performance, label tip | `Latest TikTok affiliate sale that wasn't cancelled or fully returned.` | `tiktok.js · TIKTOK_HINTS.last_sale_at` | |
| GMV, label `GMV · All time` | Drawer · Performance, label tip | `Net affiliate sales from TikTok: selling price × units, minus returns and refunds, before tax. Cancelled orders count as 0. Unsettled orders use TikTok's estimate.` | `tiktok.js · TIKTOK_HINTS.gmv` | |
| `· All time` sub-label (on GMV and Units Sold (Total)) | Drawer · Performance | `The drawer always shows all-time totals, whatever period is selected in the toolbar.` | `tiktok.js · TIKTOK_HINTS.allTime` | |
| Units Sold (Current Product) – no `All time` sub-label | Drawer · Performance, label tip | `Units on TikTok affiliate orders for the current product that weren't cancelled or fully returned. Partly refunded orders still count every unit.` | `tiktok.js · TIKTOK_HINTS.units_sold_current_product` | |
| Units Sold (Total), label `Units Sold (Total) · All time` | Drawer · Performance, label tip | `Units on TikTok affiliate orders that weren't cancelled or fully returned. Partly refunded orders still count every unit.` | `tiktok.js · TIKTOK_HINTS.units_sold_total` | |
| Creator Tier | Drawer · Performance | — | — | **NONE** |
| Notes (heading `Notes`, textarea placeholder `Add a note…`, empty state `No notes yet.`) | Drawer · bottom | — | `NotesFeed.jsx` | **NONE** (placeholder is the only hint) |
| Remove creator (icon button) | Drawer header | `Remove creator` **(native title)** | `CreatorDetail.jsx` | |
| Close (icon button) | Drawer header | `Close` **(native title)** | `CreatorDetail.jsx` | |
| Save changes / Discard / Close | Drawer footer | — | `CreatorDetail.jsx` | **NONE** |

---

## 3. Drawer TikTok section

`TikTokSection.jsx`. Shown for saved creators only. Headings use `InfoTip`; all copy lives in `TIKTOK_HINTS`.

| Element | Where | Tooltip or hint text | Source | Missing? |
|---|---|---|---|---|
| Section heading `TikTok` | Drawer · TikTok | — | `TikTokSection.jsx` | **NONE** |
| State: not linked (**inline**) | Drawer · TikTok | `Not linked to TikTok – set their TikTok handle to link them.` | `TikTokSection.jsx` | |
| State: loading (**inline**) | Drawer · TikTok | `Loading TikTok data…` | `TikTokSection.jsx` | |
| State: error | Drawer · TikTok | The error message from `creator_tiktok_info`, shown in an alert | `TikTokSection.jsx` | |
| Pending sample requests (heading ⓘ) | Drawer · TikTok | `Sample requests TikTok shows as still open: requested, or approved and awaiting shipment.` | `tiktok.js · TIKTOK_HINTS.pendingSamples` | |
| – each pending row: product, status, `Requested <date>`; empty state `None.` | Drawer · TikTok | — | `TikTokSection.jsx`, status words from `tiktok.js · sampleStatus` | **NONE** |
| Recent samples (heading ⓘ) | Drawer · TikTok | `The creator's latest sample applications on TikTok, with request, shipping and delivery dates.` | `tiktok.js · TIKTOK_HINTS.recentSamples` | |
| – each sample row: product, status, `Requested … · Shipped … · Delivered …`; empty state `None.` | Drawer · TikTok | — | `TikTokSection.jsx` | **NONE** |
| – sample status wording | Drawer · TikTok | `Requested`, `Approved, awaiting shipment`, `Shipped`, `Delivered, awaiting content`, `Completed`, `Cancelled (request expired)`, `Cancelled (withdrawn by creator)`, `Cancelled (rejected)`, `Cancelled (shipping)`, `Cancelled (couldn’t be fulfilled)`, `Cancelled (by TikTok)` | `tiktok.js · SAMPLE_STATUS` | n/a (labels, not tooltips) |
| Target collabs (heading ⓘ) | Drawer · TikTok | `Target collaborations that include this creator. Accepted means they added products to their showcase; posted means they made content for them.` | `tiktok.js · TIKTOK_HINTS.targetCollabs` | |
| – each collab row: name, `Accepted <date>`, `N in showcase · N posted`; empty state `None.` | Drawer · TikTok | — | `TikTokSection.jsx` | **NONE** |
| TikTok stats across all shops (heading ⓘ) | Drawer · TikTok | `TikTok's figures for this creator across all shops, not just ours. For information only; refreshed with samples.` | `tiktok.js · TIKTOK_HINTS.creatorStats` | |
| Followers | Drawer · TikTok stats | `Their TikTok follower count, from their latest sample application.` | `tiktok.js · TIKTOK_HINTS.statFollowers` | |
| 30-day GMV | Drawer · TikTok stats | `Their sales over the last 30 days across all shops on TikTok, not just ours.` | `tiktok.js · TIKTOK_HINTS.statGmv30d` | |
| Fulfilment rate | Drawer · TikTok stats | `Their sample fulfilment rate over the past 90 days across all shops. Blank if they haven't allowed TikTok to share it.` | `tiktok.js · TIKTOK_HINTS.statFulfilment` | |
| Median video views | Drawer · TikTok stats | `The median views on their videos, as reported by TikTok.` | `tiktok.js · TIKTOK_HINTS.statViews` | |
| `Stats as of <date> · last synced <date time>` (**inline**) | Drawer · TikTok stats | (text itself; no tooltip) | `TikTokSection.jsx` | **NONE** (tooltip) |

---

## 4. Bars

All three use the `suggestion` bar style at the top of the drawer.

| Element | Where | Tooltip or hint text | Source | Missing? |
|---|---|---|---|---|
| New from TikTok – bar text | Drawer, top (creators with `new_from_tiktok`) | `New from TikTok – created automatically and not yet reviewed.` | `CreatorDetail.jsx` | |
| New from TikTok – ⓘ | Drawer, top | `Created automatically from TikTok activity and not yet reviewed. Clears when an owner is assigned or it's marked as reviewed.` | `tiktok.js · TIKTOK_HINTS.newFromTiktok` | |
| Mark as reviewed (button) | New from TikTok bar | — | `CreatorDetail.jsx` | **NONE** |
| Suggested stage – bar text `Suggested stage: <stage> – <reason>` (stage shortened, e.g. `Accepted`) | Drawer, top | The reason text comes from the database (`suggestion_reason`); no fixed copy | `SuggestionBar.jsx`, `tiktok.js · splitReason` | |
| Suggested tier – bar text `Suggested tier: <tier> – <reason>` | Drawer, top | As above | `SuggestionBar.jsx` | |
| Suggested stage / tier – ⓘ (same text on both bars) | Drawer, top | `TikTok activity suggests a later stage or a higher tier. Accept or dismiss in the drawer.` | `tiktok.js · TIKTOK_HINTS.suggested` | |
| Accept / Dismiss (buttons) | Suggestion bars | — | `SuggestionBar.jsx` | **NONE** |
| Updated in the background – bar text (only while there are unsaved edits and the row changed) | Drawer, top | `Updated in the background – your unsaved edits are kept; other fields show the latest values.` | `CreatorDetail.jsx` | no ⓘ, text is self-explanatory |

---

## 5. Toolbar and controls

Top bar and the two toolbar rows in `App.jsx`. Filter chips (second row) reuse the filter hints; each chip's × has `aria-label="Remove filter: <label>"` only.

| Element | Where | Tooltip or hint text | Source | Missing? |
|---|---|---|---|---|
| Tabs `Active (n)`, `Removed (n)` | Top bar | — | `App.jsx` | **NONE** |
| Theme toggle | Top bar | `Switch to light` / `Switch to dark` **(native title)** | `App.jsx` | |
| Sign out | Top bar | `Sign out` **(native title)** | `App.jsx` | |
| Search | Toolbar | Placeholder: `Search name, handle, owner…` | `App.jsx` | |
| Owner filter (options `All owners`, `Unassigned`, each person) | Toolbar | — (`aria-label="Filter by owner"` only) | `App.jsx` | **NONE** |
| My creators – normal | Toolbar | — | `App.jsx` | **NONE** |
| My creators – disabled (no profile) | Toolbar | `No team profile for your account yet` **(native title)** | `App.jsx` | |
| Filters button (`Filters (n)`) | Toolbar | — | `FiltersMenu.jsx` | **NONE** |
| Filter option: New from TikTok | Filters menu, ⓘ | `Created automatically from TikTok activity and not yet reviewed. Clears when an owner is assigned or it's marked as reviewed.` | `tiktok.js · TIKTOK_HINTS.newFromTiktok` | |
| Filter option: Request cancelled, no other activity | Filters menu, ⓘ | `Their only TikTok activity was a sample request that was cancelled before shipping.` | `tiktok.js · TIKTOK_HINTS.requestCancelledOnly` | |
| Filter option: Suggested actions | Filters menu, ⓘ | `TikTok activity suggests a later stage or a higher tier. Accept or dismiss in the drawer.` | `tiktok.js · TIKTOK_HINTS.suggested` | |
| Filter option: No sale for (select: `Any`, `14 days`, `30 days`, `60 days`, `90 days`, `Never sold`) | Filters menu, ⓘ | `Creators whose latest TikTok sale (Last sale) is older than the chosen number of days, or who haven't sold yet.` | `tiktok.js · TIKTOK_HINTS.noSale` | |
| Filter option: …and no contact in X days (checkbox; disabled until a day count is chosen) | Filters menu, ⓘ | `Only creators whose Last Contact is also older than that number of days, or empty.` | `tiktok.js · TIKTOK_HINTS.noContact` | disabled state has no explanation |
| Clear filters (menu and meta row) | Filters menu / meta row | — | `FiltersMenu.jsx`, `App.jsx` | **NONE** |
| Filter chips: New from TikTok / Request cancelled, no other activity / Suggested actions / No sale for N days / Never sold / No contact in N days | Meta row | Same hint as the matching filter option (bubble on the chip) | `App.jsx · Chip` with `TIKTOK_HINTS.*` | |
| Stage chip `Stage: <stage> ✕` (from clicking the funnel) | Toolbar | — | `App.jsx` | **NONE** |
| Overdue pill `N overdue follow-up(s)` | Toolbar | — | `App.jsx` | **NONE** |
| Key fields / All fields toggle | Toolbar | — (the button text is the *other* mode, not the current one) | `App.jsx` | **NONE** |
| Import | Toolbar | — | `App.jsx` | **NONE** |
| Import dialog intro (**inline**) | Import dialog | `Upload a CSV or Excel (.xlsx) file with a header row. Columns are matched automatically where the names line up — check the mapping below and adjust anything that is wrong. Rows without a name are skipped. Owner must match a team member's name and Creator Tier must be Bronze, Silver, Gold or Platinum; anything else is left blank.` | `ImportModal.jsx` | |
| Export Excel | Toolbar | — (disabled when nothing is shown) | `App.jsx` | **NONE** |
| Export CSV | Toolbar | — (disabled when nothing is shown) | `App.jsx` | **NONE** |
| New creator | Toolbar | — | `App.jsx` | **NONE** |
| Count `Showing X of Y` | Meta row | — | `App.jsx` | **NONE** |
| Period selector – label `GMV / Units` | Meta row | `Values for the selected period, calculated from TikTok sales. Stored totals are all-time.` | `tiktok.js · TIKTOK_HINTS.period` | |
| Period selector – dropdown (`All time`, `Last 7 days`, `Last 30 days`, `Last 90 days`, `This month`, `Custom range`) | Meta row | — (`aria-label="Period for GMV and Units Sold"` only) | `PeriodSelector.jsx`, `tiktok.js · PERIOD_KINDS` | **NONE** |
| Period selector – custom From / To | Meta row | — (`aria-label` `From date` / `To date`, joined by `to`) | `PeriodSelector.jsx` | **NONE** |
| Period selector – `Loading…` | Meta row | — | `PeriodSelector.jsx` | **NONE** |
| Period error alert | Under meta row | `Couldn't load period totals: <message>` | `App.jsx` | |
| **Sync indicator – OK** (visible text) | Meta row | Text: `TikTok synced <relative time>` (e.g. `5 minutes ago`, `just now`, `3 hours ago`). Tooltip: `TikTok sync status`, then one line per stream (see "details" below) | `SyncStatus.jsx`, `tiktok.js · relativeTime` | |
| **Sync indicator – never synced** | Meta row | Text: `TikTok not synced yet`. Tooltip as above | `SyncStatus.jsx` | |
| **Sync indicator – checking** | Meta row | Text: `Checking TikTok sync…`; tooltip `Loading sync status…` | `SyncStatus.jsx` | |
| **Sync indicator – stale** (latest data sync older than 3 hours; ⚠ icon) | Meta row | Text: `TikTok data may be out of date`. Tooltip starts `TikTok sync status`⏎⏎`TikTok data may be out of date`⏎⏎ then the stream lines | `tiktok.js · TIKTOK_HINTS.syncStale`, `STALE_AFTER_MS` | no explanation of the 3-hour threshold |
| **Sync indicator – retrying** (⚠ icon) | Meta row | Text: `{stream} is retrying at {time}` (rendered as `<stream> is retrying at <time>`, + ` (+N more)`); stream underscores become spaces; `<time>` is `HH:MM` today, else date and time. Tooltip adds ` (N failure(s) in a row)` | `tiktok.js · TIKTOK_HINTS.syncRetrying`, `retryMessage` | |
| **Sync indicator – error** (a stream has `last_error`; ⚠ icon) | Meta row | **No visible text of its own** – the text stays `TikTok synced <time>`. Only the tooltip shows `error: <message>` on that stream's line | `SyncStatus.jsx · details` | tooltip only |
| **Sync indicator – token** (token status not ok, or access token expired; ⚠ icon) | Meta row | **No visible text of its own.** Tooltip shows the `token:` line plus `Access token expired <date time>` / `Access token expires <date time>` | `SyncStatus.jsx · details`, `tiktok.js · summariseSync` | tooltip only |
| **Sync indicator – status unavailable** (⚠ icon) | Meta row | Text: `TikTok sync status unavailable`; tooltip is the error message | `SyncStatus.jsx` | |
| Sync indicator – "details" tooltip line format | Tooltip | `<stream>: <last_status or "not run yet"> · last success <date time or "never"> · error: <message> · <retry text> (N failure(s) in a row)`. Streams listed as raw names: `affiliate`, `samples`, `sample_orders`, `target_collabs`, `derive`, `token` | `SyncStatus.jsx · details`, `tiktok.js · SYNC_STREAMS` | |
| Refresh | Meta row | `Reload creators from the database. Use Sync now to fetch new data from TikTok.` | `tiktok.js · TIKTOK_HINTS.refresh` | |
| Refresh – busy label | Meta row | `Refreshing…` | `SyncStatus.jsx` | |
| Sync now | Meta row | `Ask TikTok for the latest data now` **(native title)** | `SyncStatus.jsx` | |
| Sync now – busy label | Meta row | `Syncing…` | `SyncStatus.jsx` | |
| Sync notices (transient, next to the buttons) | Meta row | `Sync started` / `Couldn't start the sync: <message>` / `Sync finished – creators refreshed` / `No new data yet – the sync may still be running` | `useTikTokSync.js · say()` | |
| Pagination | Under table | Info `<first>–<last> of <total>`, `Page N of M`; buttons `First`, `Last`, and chevrons with `aria-label` `Previous page` / `Next page`. No tooltip; no page-size hint (100 per page) | `Pagination.jsx` | **NONE** |
| Funnel – heading and total | Above toolbar | `Stage funnel`, `N active creators` | `StageFunnel.jsx` | |
| Funnel – bar hover | Chart | Title `<n>. <full stage name>`, row `Creators: <count>` | `StageFunnel.jsx` | |
| Funnel – click to filter by stage | Chart | — (nothing says a bar is clickable or that clicking again clears it) | `StageFunnel.jsx` | **NONE** |
| Restore (Removed tab) | Table | — | `App.jsx` | **NONE** |

---

## 6. Markers

| Element | Where | Tooltip or hint text | Source | Missing? |
|---|---|---|---|---|
| "Synced from TikTok" marker (label `Synced from TikTok`, ↻ icon) | Drawer, beside a field's label when `synced_fields[key]` is true | Bubble = `Synced from TikTok · last synced <date time or "not yet">`⏎⏎ + the field's own hint (e.g. for GMV: `Net affiliate sales from TikTok: selling price × units, minus returns and refunds, before tax. Cancelled orders count as 0. Unsettled orders use TikTok's estimate.`). Same field hint as the ⓘ, so it repeats it. It does not say the field is locked | `SyncMarker.jsx · SyncMarker`, `TIKTOK_HINTS[fieldKey]` | |
| Marker on Current Product / Other Products Received (editable even when synced) | Drawer | Same format as above; for Current Product the line under the input explains the override (see §7) | `SyncMarker.jsx`, `tiktok.js · SYNCED_EDITABLE` | |
| Read-only fields with no marker (Last Sale, Other Videos, or any locked field for a creator TikTok has no data on) | Drawer | No marker, so nothing explains why the field is not editable | `ReadOnlyField.jsx` | **NONE** |
| TikTok entry marker `TikTok` (↻ icon) on rows in Other Products Received | Drawer · Other Products Received | `From TikTok's samples. Managed by the sync, so it can't be edited or removed here.` | `ProductsList.jsx` (hard-coded; **not** in `TIKTOK_HINTS`) | |
| Remove entry (✕ on manual rows) | Drawer · Other Products Received | `Remove entry` **(native title)** | `ProductsList.jsx` | |
| Eligible tick – table cell (✓ `Eligible`) | Table, TikTok Shop Eligible column | — (column header has the tip, see §1) | `CreatorTable.jsx · Cell` | **NONE** (on the tick) |
| Eligible tick – drawer, read-only (✓ `Eligible`, else `—`) | Drawer · Creator | — (label ⓘ has the tip, see §2) | `ReadOnlyField.jsx` | **NONE** (on the tick) |
| Eligible – drawer, unsynced (checkbox `Eligible`) | Drawer · Creator | — | `FieldInput.jsx` | **NONE** |
| ⓘ icon itself | Everywhere it appears | `aria-label="What is this?"` only (screen readers); the bubble carries the text | `SyncMarker.jsx · InfoTip` | n/a |

---

## 7. Inline hints

Text shown under or beside fields (not in a bubble).

| Element | Where | Tooltip or hint text | Source | Missing? |
|---|---|---|---|---|
| Shipping Address | Drawer · Creator, under the textarea | `Only needed for creators who are not TikTok Shop Affiliates.` | `fields.js · shipping_address.hint`, rendered by `FieldInput.jsx · Hint` | |
| Current Product override note (only when Current Product is synced) | Drawer · Product & content, under the input | `From the latest TikTok sample. Editing it here overrides TikTok until a newer sample arrives.` | `tiktok.js · TIKTOK_HINTS.currentProductEditHint` | |
| Other Products Received – add row | Drawer | Placeholders `Product`, `Date received` (aria); button `Add`; empty state `None recorded.` | `ProductsList.jsx` | |
| Other Products Received – `field.hint` slot | Drawer | Rendered if the field defines `hint`; it currently doesn't | `ProductsList.jsx` | |
| Stats as of | Drawer · TikTok | `Stats as of <date> · last synced <date time>` | `TikTokSection.jsx` | |
| Name is required | Drawer footer | `Name is required` | `CreatorDetail.jsx` | |
| Save before notes | Drawer (new creator) | `Save this creator to start adding notes.` | `CreatorDetail.jsx` | |
| Import column mapping | Import dialog | Heading `Column mapping · N row(s) found`, first option `— ignore —`; `*` on Name | `ImportModal.jsx` | |
| Empty table message | Table area | `No creators match that filter.` / `No creators yet — import a CSV or add one.` / `Nothing has been removed.` | `App.jsx` | |

---

## End lists

### A. Elements with no tooltip or hint

**Table headers (manual fields):** Name, Stage, Next Action, Next Follow-up, Owner, Creator Tier, Last Contact, TikTok Handle, Instagram Handle, Email. Sort arrows. Removed-tab columns.
**Drawer fields:** the same ten (Name, TikTok Handle, Instagram Handle, Email, Stage, Owner, Next Action, Next Follow-up, Last Contact, Creator Tier), plus a missing ⓘ on Shipping Address (inline text only).
**Drawer TikTok section:** section heading; the individual rows (pending, samples, collabs); `Stats as of` line.
**Bars:** Mark as reviewed, Accept, Dismiss (nothing says Dismiss won't re-suggest the same value).
**Toolbar:** tabs; owner filter; My creators (enabled state); Filters button; Clear filters; stage chip; overdue pill; Key/All fields toggle; Import; Export Excel; Export CSV (nothing says exports carry the whole filtered set and the active period); New creator; `Showing X of Y`; period dropdown and custom dates; pagination (no page-size hint); funnel clickability; Restore.
**Sync indicator:** the token and error states have no visible wording of their own; they show only as a ⚠ icon on an otherwise normal "synced X ago" line.
**Markers:** the Eligible tick (table, drawer); read-only fields with no "Synced from TikTok" marker (Last Sale, Other Videos, any locked field on an unlinked creator).
**Disabled states:** "…and no contact in X days" (disabled until a day count is chosen), Export (disabled when nothing is shown), Save changes (disabled until dirty and named, only "Name is required" explained).

### B. Same concept, different wording

1. **GMV and its period.**
   - Header: `Values for the selected period, calculated from TikTok sales. Stored totals are all-time.` + the GMV definition.
   - Drawer sub-label: `The drawer always shows all-time totals, whatever period is selected in the toolbar.`
   - Selector label: `GMV / Units` (aria: `Period for GMV and Units Sold`).
   - Labels: header `GMV – last 30 days`, drawer `GMV · All time`, export column `GMV – <period>`.
   - Marker: repeats the GMV definition after `Synced from TikTok · last synced …`.
2. **"GMV" means two things.** Ours is `Net affiliate sales … minus returns and refunds, before tax`; the drawer stat `30-day GMV` is `Their sales over the last 30 days across all shops` (no mention of net, returns or tax).
3. **Current Product.**
   - Label tip: `From the latest approved TikTok sample, unless someone entered a newer product here.`
   - Edit note: `From the latest TikTok sample. Editing it here overrides TikTok until a newer sample arrives.`
   - "approved" is dropped, and "newer product" becomes "newer sample".
4. **TikTok entries in Other Products Received.**
   - Field tip: `TikTok entries are managed by the sync and cannot be removed.`
   - Entry marker: `From TikTok's samples. Managed by the sync, so it can't be edited or removed here.`
   - (cannot / can't; "removed" vs "edited or removed"; the marker text is hard-coded in `ProductsList.jsx`, not in `TIKTOK_HINTS`.)
5. **Samples.** Called "sample requests" (pending tip, cancelled filter), "sample applications" (recent samples, followers), "samples" (Other Products), "the current sample" (Product Sent/Delivered); the status label `Requested` is a fourth wording.
6. **"Sale".**
   - `affiliate sale` (First Sale, Last Sale) vs `affiliate orders` (Units) vs `TikTok sale (Last sale)` in the No sale filter (lower-case "s" there; the column is `Last Sale`).
   - The filter option `Never sold` and its chip are not covered by the filter's tip.
7. **Eligible.** Tip says `any affiliate activity`; the Shipping Address hint says `TikTok Shop Affiliates`; the label is `TikTok Shop Eligible` / `Eligible`.
8. **First Video Date vs First Video Link.** Identical tip text on both, including `and when it was posted` on the link.
9. **Suggested.** One text on the filter, the chip and both bars. In the filter it reads correctly (`Accept or dismiss in the drawer`); on the bar inside the drawer it is odd. Bar title says `Suggested stage:` / `Suggested tier:`; filter says `Suggested actions`.
10. **New from TikTok.** Bar text (`created automatically and not yet reviewed`) and its tip (`Created automatically from TikTok activity and not yet reviewed. Clears when…`) say the first half twice.
11. **Last synced.** `last synced <date time>` (marker, stats line) vs `TikTok synced <relative time>` (toolbar); the tooltip uses absolute times and raw stream names (`sample_orders`, `target_collabs`) where the retry text uses spaces.
12. **Fulfilment rate.** Tip says `Blank if they haven't allowed TikTok to share it`; the UI shows `—`.
13. **Tooltip mechanism.** Bubble `Tooltip` for most; **native `title`** for Sync now, Remove entry, My creators, theme, sign out, Remove creator, Close and the products/videos cell lists.

### C. Text that contradicts or falls short of the build plan (as built)

Texts that match: Units, First Sale, Last Sale (all state "wasn't cancelled or fully returned", matching the phase 3 sale rule); First Video ("first video that drove a sale"); Other Videos (one entry per video, most recent first); Pending samples (as built it includes approved-and-awaiting-shipment; the plan's "status PENDING" is outdated, the text is right).

Gaps and conflicts:

1. **GMV tip vs the as-built rule.**
   - `Unsettled orders use TikTok's estimate` is wrong for an unsettled line that is fully returned (as built: 0).
   - It also doesn't say that settled orders use TikTok's actual figure.
   - Cancelled = 0 is correct.
2. **Marker doesn't say why a field is locked.** Plan (Tooltips): marker = "last synced time, and why the field is locked". Built: last synced time + the field definition, with no mention of locking or of manual entry.
3. **Units Sold (Current Product) vs the Period selector.**
   - Only GMV and Units Sold (Total) follow the period. The selector's tip says `Values for the selected period` and its aria label says `GMV and Units Sold`.
   - Units Sold (Current Product) stays all-time with no label or note, in the table or the drawer (no `· All time` sub-label there).
4. **Units Sold (Current Product) tip omits the plan's caveat** that it's only calculable when Current Product came from TikTok; for a manual off-TikTok product it stays manual.
5. **Product Sent / Delivered.** Plan (Tooltips) says "manual entry where TikTok has none". Built (phase 3): they follow the current TikTok sample, blank until shipped, and are left untouched when Current Product is manual. The tip covers only the first case.
6. **Eligible.** Tip says `any affiliate activity`; the rule is appearing in affiliate orders, sample applications **or** target collaborations.
7. **Current Product edit note** says `latest TikTok sample` (plan: latest **approved** sample; newer of the manual edit and that sample wins) and `until a newer sample arrives` (it's the newer of the two dates; imports aren't stamped as manual).
8. **First Sale Date** tip omits the accepted edge that the date stays if the creator's only sale is later refunded ("never blank").
9. **Target collabs.** Plan shows invited / accepted / posted. The rows always read `Accepted <date>` (`Accepted —` if not accepted) and the tip defines only accepted and posted.
10. **Suggested stage / tier.** Plan: tooltip = "what triggered the suggestion". The ⓘ is generic; the trigger exists only as the bar's reason text. The tip also says `a higher tier`, and the plan only guarantees stage suggestions move forward.
11. **Phase 6 audit requirement** ("every synced or TikTok-derived field, column header, filter and marker has a tooltip") is met for derived fields, filters and the Synced marker. Not met: the Eligible tick, token and error sync states (no wording), and the manual column headers (outside the plan's wording, but listed in A).
12. **Plan's "Import: linked count"** isn't in the Import dialog (phase 5b is on hold), so nothing there mentions TikTok linking.
