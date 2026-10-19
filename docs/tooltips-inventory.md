# Creator Club – tooltip and hint inventory (creators side)

Read-only inventory of every tooltip and hint on the creators side of the app, regenerated from the code as it stands after phase 6b. **Out of scope:** the Creator Valuations tab (`Valuation*`, `CreatorValuations`, `useValuations`, `valuationBenchmarks.js`), plus login, TikTok setup and confirm-modal copy.

## How to read this

- **Text is verbatim**, in code spans. A real tooltip is the `Tooltip` bubble (hover or keyboard focus). Inline text under a field is marked **(inline)**. There are no native `title=` tooltips left on the creators side.
- **Missing? = NONE** means the element has no tooltip or hint of any kind.
- `{time}`, `{stream}`, `{days}`, `{date}` are filled in by the component.
- Source paths, abbreviated:
  - `tiktok.js` = `src/lib/tiktok.js` (`TIKTOK_HINTS` = all tooltip copy there)
  - `fields.js` = `src/lib/fields.js`
  - `SyncMarker.jsx`, `ReadOnlyField.jsx`, `CreatorTable.jsx`, `CreatorDetail.jsx`, `TikTokSection.jsx`, `SuggestionBar.jsx`, `ProductsList.jsx`, `FiltersMenu.jsx`, `PeriodSelector.jsx`, `SyncStatus.jsx`, `Pagination.jsx`, `StageFunnel.jsx`, `FieldInput.jsx`, `ImportModal.jsx` = `src/components/…`
  - `App.jsx` = `src/App.jsx`

### How header and drawer tooltips are built

- **Table header** (`CreatorTable.jsx`): tip = `TIKTOK_HINTS[field.key]`, else `field.hint`, else nothing. GMV and Units Sold (Total) gain the date range in the label when one is active (e.g. `GMV – last 30 days`); the tip is unchanged.
- **Drawer label** (`SyncMarker.jsx · FieldLabel`): an ⓘ with `TIKTOK_HINTS[field.key]`. For a TikTok-owned read-only field (`ReadOnlyField`) that TikTok has **not** filled for this creator, the ⓘ reads `Filled automatically from TikTok.` instead. The "Synced from TikTok" marker shows only when `synced_fields[key]` is true. GMV and Units Sold (Total) also get a ` · All time` sub-label with its own tooltip.
- The header and the drawer ⓘ therefore show the same text for a field, except for the unsynced read-only case above.

---

## 1. Table column headers

Display order. **Key fields** = the first nine; **All fields** = the same nine, then the rest. Removed tab adds `Removed by`, `Removed at` and an unlabelled Restore column (no tooltips on the three headers).

| # | Element | Tooltip text | Source | Missing? |
|---|---|---|---|---|
| 1 | Name (Key + All) | `Display name. Edit freely.` | `TIKTOK_HINTS.name` | |
| 2 | Stage (Key + All) | `Journey stage. TikTok can suggest a later one.` | `TIKTOK_HINTS.stage` | |
| 3 | Next Action (Key + All) | `What the owner plans next.` | `TIKTOK_HINTS.next_action` | |
| 4 | Current Product (Key + All) | `Latest approved TikTok sample, unless the team entered something newer.` | `TIKTOK_HINTS.current_product` | |
| 5 | Next Follow-up (Key + All) | `When to follow up. Red when overdue.` | `TIKTOK_HINTS.next_follow_up_date` | |
| 6 | Owner (Key + All) | `Team member responsible.` | `TIKTOK_HINTS.owner_id` | |
| 7 | GMV (Key + All) | `TikTok sales, net of returns, before tax. Unsettled sales are estimates.` | `TIKTOK_HINTS.gmv` | |
| 8 | Creator Tier (Key + All) | `Bronze to Platinum. Set by the team.` | `TIKTOK_HINTS.creator_tier` | |
| 9 | Last Contact (Key + All) | `Last time the team got in touch.` | `TIKTOK_HINTS.last_contact` | |
| 10 | TikTok Handle (All) | `Links them to TikTok data. Changing it re-links.` | `TIKTOK_HINTS.tiktok_handle` | |
| 11 | Instagram Handle (All) | `Entered by the team.` | `TIKTOK_HINTS.instagram_handle` | |
| 12 | Email (All) | `Entered by the team.` | `TIKTOK_HINTS.email` | |
| 13 | TikTok Shop Eligible (All) | `Set automatically once TikTok shows any activity.` | `TIKTOK_HINTS.tiktok_shop_eligible` | |
| 14 | Shipping Address (All) | `Only needed for creators who aren't TikTok Shop affiliates.` | `fields.js · shipping_address.hint` = `TIKTOK_HINTS.shippingAddress` | |
| 15 | Other Products Received (All) | `Earlier products sent. TikTok entries are added automatically.` | `TIKTOK_HINTS.other_products_received` | |
| 16 | Other Videos (All) | `First selling video for each other product, newest first.` | `TIKTOK_HINTS.other_videos` | |
| 17 | Product Sent (All) | `From TikTok shipping for the current sample. Blank until shipped.` | `TIKTOK_HINTS.product_sent_date` | |
| 18 | Product Delivered (All) | `From TikTok shipping for the current sample. Blank until shipped.` | `TIKTOK_HINTS.product_delivery_date` | |
| 19 | First Video Date (All) | `When their first selling video was posted.` | `TIKTOK_HINTS.first_video_date` | |
| 20 | First Video Link (All) | `Their first video that drove a sale.` | `TIKTOK_HINTS.first_video_link` | |
| 21 | First Sale Date (All) | `First TikTok sale that wasn't cancelled or returned.` | `TIKTOK_HINTS.first_sale_date` | |
| 22 | Units Sold (Current Product) (All) | `Units of the current product, all time. TikTok samples only.` | `TIKTOK_HINTS.units_sold_current_product` | |
| 23 | Units Sold (Total) (All) | `Units sold on TikTok, excluding cancelled and returned sales.` | `TIKTOK_HINTS.units_sold_total` | |
| 24 | Last Sale (All) | `Latest TikTok sale that wasn't cancelled or returned.` | `TIKTOK_HINTS.last_sale_at` | |
| 25 | Eligible tick in the cell (✓ `Eligible`) | `Set automatically once TikTok shows any activity.` | `CreatorTable.jsx · Cell` | |
| 26 | Products / Other Videos cells (`N products`, `N videos`) | The full list, as a bubble (e.g. `Product A (2026-08-01)` per line) | `CreatorTable.jsx · Cell` | |
| 27 | Sort arrows | — (state via `aria-sort`) | `CreatorTable.jsx` | **NONE** |
| 28 | Removed by / Removed at / Restore column headers | — | `App.jsx · removedColumns` | **NONE** |

---

## 2. Drawer fields

Grouped as `CreatorDetail.jsx · GROUPS`. "Label tip" is the ⓘ next to the label; its text is the same as the table header (§1) unless noted. Fields in `LOCKED_WHEN_SYNCED` become read-only once TikTok has filled them for that creator; **Last Sale** and **Other Videos** are always read-only.

| Element | Where | Tooltip or hint text | Source | Missing? |
|---|---|---|---|---|
| **Group: Creator** | | | | |
| Name, TikTok Handle, Instagram Handle, Email | Drawer · Creator, label tip | As §1 rows 1, 10, 11, 12 | `TIKTOK_HINTS` | |
| TikTok Shop Eligible (checkbox label `Eligible`) | Drawer · Creator, label tip | `Set automatically once TikTok shows any activity.` | `TIKTOK_HINTS.tiktok_shop_eligible` | |
| Shipping Address | Drawer · Creator | Label tip `Only needed for creators who aren't TikTok Shop affiliates.` and the same text **(inline)** under the textarea | `TIKTOK_HINTS.shippingAddress` | |
| **Group: Journey** | | | | |
| Stage, Owner, Next Action, Next Follow-up, Last Contact | Drawer · Journey, label tip | As §1 rows 2, 6, 3, 5, 9 | `TIKTOK_HINTS` | |
| **Group: Product & content** | | | | |
| Current Product | Label tip | `Latest approved TikTok sample, unless the team entered something newer.` | `TIKTOK_HINTS.current_product` | |
| Other Products Received | Label tip | `Earlier products sent. TikTok entries are added automatically.` | `TIKTOK_HINTS.other_products_received` | |
| Product Sent, Product Delivered | Label tip | `From TikTok shipping for the current sample. Blank until shipped.` | `TIKTOK_HINTS` | |
| First Video Date, First Video Link | Label tip | `When their first selling video was posted.` / `Their first video that drove a sale.` | `TIKTOK_HINTS` | |
| Other Videos (empty state `None recorded.`) | Label tip | `First selling video for each other product, newest first.` | `TIKTOK_HINTS.other_videos` | |
| **Group: Performance** | | | | |
| First Sale Date, Last Sale | Label tip | As §1 rows 21, 24 | `TIKTOK_HINTS` | |
| GMV, label `GMV · All time` | Label tip | `TikTok sales, net of returns, before tax. Unsettled sales are estimates.` | `TIKTOK_HINTS.gmv` | |
| `· All time` sub-label (GMV, Units Sold (Total)) | Sub-label | `The drawer always shows all-time totals, whatever date range is selected.` | `TIKTOK_HINTS.allTime` | |
| Units Sold (Current Product) | Label tip | `Units of the current product, all time. TikTok samples only.` | `TIKTOK_HINTS.units_sold_current_product` | |
| Units Sold (Total), label `Units Sold (Total) · All time` | Label tip | `Units sold on TikTok, excluding cancelled and returned sales.` | `TIKTOK_HINTS.units_sold_total` | |
| Creator Tier | Label tip | `Bronze to Platinum. Set by the team.` | `TIKTOK_HINTS.creator_tier` | |
| **Read-only field TikTok hasn't filled for this creator** (e.g. Last Sale, Other Videos, or a locked field on an unlinked creator) | Label tip | `Filled automatically from TikTok.` (replaces the field definition; no marker) | `TIKTOK_HINTS.filledFromTiktok`, `ReadOnlyField.jsx` | |
| Eligible tick, read-only (✓ `Eligible`) | Drawer · Creator | `Set automatically once TikTok shows any activity.` | `ReadOnlyField.jsx` | |
| Notes (heading `Notes`, placeholder `Add a note…`, empty state `No notes yet.`) | Drawer · bottom | — | `NotesFeed.jsx` | **NONE** (placeholder is the only hint) |
| Remove creator (icon button) | Drawer header | `Remove creator` | `TIKTOK_HINTS.removeCreator` | |
| Close (icon button) | Drawer header | `Close` | `TIKTOK_HINTS.closeDrawer` | |
| Save changes / Discard / Close | Drawer footer | — | `CreatorDetail.jsx` | **NONE** |

---

## 3. Drawer TikTok section

`TikTokSection.jsx`. Shown for saved creators only. Headings use `InfoTip`.

| Element | Where | Tooltip or hint text | Source | Missing? |
|---|---|---|---|---|
| Section heading `TikTok` (ⓘ) | Drawer · TikTok | `From TikTok Shop, as of the last sync.` | `TIKTOK_HINTS.tiktokSection` | |
| State: not linked **(inline)** | Drawer · TikTok | `Not linked to TikTok – set their TikTok handle to link them.` | `TikTokSection.jsx` | |
| State: loading **(inline)** | Drawer · TikTok | `Loading TikTok data…` | `TikTokSection.jsx` | |
| State: error | Drawer · TikTok | The error message from `creator_tiktok_info`, in an alert | `TikTokSection.jsx` | |
| Pending sample requests (heading ⓘ) | Drawer · TikTok | `Waiting for approval or shipping.` | `TIKTOK_HINTS.pendingSamples` | |
| – each row: product, status, `Requested <date>`; empty `None.` | Drawer · TikTok | — | `TikTokSection.jsx`, `tiktok.js · sampleStatus` | **NONE** |
| Recent samples (heading ⓘ) | Drawer · TikTok | `Latest samples with status and dates.` | `TIKTOK_HINTS.recentSamples` | |
| – each row: product, status, `Requested … · Shipped … · Delivered …`; empty `None.` | Drawer · TikTok | — | `TikTokSection.jsx` | **NONE** |
| – sample status wording | Drawer · TikTok | `Requested`, `Approved, awaiting shipment`, `Shipped`, `Delivered, awaiting content`, `Completed`, `Cancelled (request expired)`, `Cancelled (withdrawn by creator)`, `Cancelled (rejected)`, `Cancelled (shipping)`, `Cancelled (couldn’t be fulfilled)`, `Cancelled (by TikTok)` | `tiktok.js · SAMPLE_STATUS` | n/a (labels) |
| Target collabs (heading ⓘ) | Drawer · TikTok | `Collabs they accepted or posted for.` | `TIKTOK_HINTS.targetCollabs` | |
| – each row: name, `Accepted <date>`, `N in showcase · N posted`; empty `None.` (no separate "Posted" badge) | Drawer · TikTok | — | `TikTokSection.jsx` | **NONE** |
| TikTok stats across all shops (heading ⓘ) | Drawer · TikTok | `TikTok figures across all shops.` | `TIKTOK_HINTS.creatorStats` | |
| Followers | Drawer · TikTok stats | `TikTok followers.` | `TIKTOK_HINTS.statFollowers` | |
| 30-day GMV | Drawer · TikTok stats | `Sales across all shops, last 30 days. — if not shared.` | `TIKTOK_HINTS.statGmv30d` | |
| Fulfilment rate | Drawer · TikTok stats | `Sample fulfilment rate, last 90 days. — if not shared.` | `TIKTOK_HINTS.statFulfilment` | |
| Median video views | Drawer · TikTok stats | `Shoppable videos, last 30 days. — if not shared.` | `TIKTOK_HINTS.statViews` | |
| `Stats as of <date> · last synced <date time>` | Drawer · TikTok stats | `When TikTok last sent these.` | `TIKTOK_HINTS.statsAsOf` | |

---

## 4. Bars

| Element | Where | Tooltip or hint text | Source | Missing? |
|---|---|---|---|---|
| New from TikTok – bar text | Drawer, top (`new_from_tiktok`) | `New from TikTok – created automatically and not yet reviewed.` **(inline)** | `CreatorDetail.jsx` | |
| New from TikTok – ⓘ | Drawer, top | `Auto-created from TikTok. Clears when an owner is assigned.` | `TIKTOK_HINTS.newFromTiktokBar` | |
| Mark as reviewed (button) | New from TikTok bar | `Clear the New from TikTok flag.` | `TIKTOK_HINTS.markReviewed` | |
| Suggested stage – bar text `Suggested stage: <stage> – <reason>` | Drawer, top | Reason comes from the database (`suggestion_reason`) | `SuggestionBar.jsx` | |
| Suggested stage – ⓘ | Drawer, top | `TikTok shows a later stage.` | `TIKTOK_HINTS.suggestedStageBar` | |
| Suggested tier – bar text `Suggested tier: <tier> – <reason>` | Drawer, top | As above | `SuggestionBar.jsx` | |
| Suggested tier – ⓘ | Drawer, top | `GMV meets this tier's band.` | `TIKTOK_HINTS.suggestedTierBar` | |
| Accept (button) | Suggestion bars | `Apply it.` | `TIKTOK_HINTS.accept` | |
| Dismiss (button) | Suggestion bars | `Hide it. It won't come back.` | `TIKTOK_HINTS.dismiss` | |
| Updated in the background – bar (only with unsaved edits and a changed row) | Drawer, top | `Changed while you were editing. Your edits are kept.` **(inline)** | `TIKTOK_HINTS.updatedInBackgroundNote` | |

---

## 5. Toolbar, header and controls

| Element | Where | Tooltip or hint text | Source | Missing? |
|---|---|---|---|---|
| Tab `Active (n)` | Top bar | `Creators in the programme.` | `TIKTOK_HINTS.tabActive` | |
| Tab `Removed (n)` | Top bar | `Removed creators. Restore from here.` | `TIKTOK_HINTS.tabRemoved` | |
| Theme toggle | Top bar | `Switch to light` / `Switch to dark` | `TIKTOK_HINTS.themeLight / themeDark` | |
| Sign out | Top bar | `Sign out` | `TIKTOK_HINTS.signOut` | |
| Date range dropdown (`All time`, `Last 7 days`, `Last 30 days`, `Last 90 days`, `This month`, `Custom range`) | Top bar | `Applies to GMV and Units Sold (Total) only.` | `TIKTOK_HINTS.dateRange` | |
| Custom From / To dates | Top bar | — (`aria-label` `From date` / `To date`, joined by `to`) | `PeriodSelector.jsx` | **NONE** (removed in 6b) |
| Date range `Loading…` | Top bar | — | `PeriodSelector.jsx` | **NONE** |
| Sync indicator – headline and text: see §5a | Top bar | | `SyncStatus.jsx` | |
| Refresh (icon button) | Top bar | `Reload data.` | `TIKTOK_HINTS.refresh` | |
| Search box (placeholder `Search name, handle, owner…`) | Toolbar | — (placeholder only) | `App.jsx` | **NONE** (removed in 6b) |
| Owner filter (`All owners`, `Unassigned`, each person) | Toolbar | — (`aria-label="Filter by owner"` only) | `App.jsx` | **NONE** (removed in 6b) |
| My creators – normal | Toolbar | `Only creators you own.` | `TIKTOK_HINTS.myCreators` | |
| My creators – disabled (no profile) | Toolbar | `No team profile for your account yet` | `TIKTOK_HINTS.myCreatorsDisabled` | |
| Filters button (`Filters (n)`) | Toolbar | `More ways to narrow the list.` | `TIKTOK_HINTS.filtersButton` | |
| Filter: New from TikTok (ⓘ) | Filters menu | `Auto-created from TikTok. Clears when an owner is assigned.` | `TIKTOK_HINTS.newFromTiktok` | |
| Filter: Request cancelled, no other activity (ⓘ) | Filters menu | `Only activity was a cancelled sample request.` | `TIKTOK_HINTS.requestCancelledOnly` | |
| Filter: Suggested actions (ⓘ) | Filters menu | `Creators with a stage or tier suggestion.` | `TIKTOK_HINTS.suggested` | |
| Filter: No sale for (select: `Any`, `14 days`, `30 days`, `60 days`, `90 days`, `Never sold`) (ⓘ) | Filters menu | `No TikTok sale in {days} days, or never.` (`X` until a day count is chosen); `No TikTok sale ever.` for Never sold | `TIKTOK_HINTS.noSale / neverSold`, `noSaleHint` | |
| Filter: …and no contact in X days (ⓘ) | Filters menu | `Also no contact in that time.`; disabled: `Pick a No sale period first.` | `TIKTOK_HINTS.noContact / noContactDisabled` | |
| Clear filters (menu and meta row) | Filters menu / meta row | `Remove all filters.` | `TIKTOK_HINTS.clearFilters` | |
| Filter chips (New from TikTok, Request cancelled…, Suggested actions, No sale for N days, Never sold, No contact in N days) | Meta row | Same hint as the matching filter option | `App.jsx · Chip` | |
| Stage chip `Stage: <stage> ✕` | Toolbar | `Click × to show all stages.` | `TIKTOK_HINTS.stageChip` | |
| Overdue pill `N overdue follow-up(s)` | Toolbar | `Follow-up date has passed.` | `TIKTOK_HINTS.overdue` | |
| Key fields / All fields toggle | Toolbar | `Main columns or every column.` | `TIKTOK_HINTS.keyFields` | |
| Import | Toolbar | `Add creators from CSV or Excel.` | `TIKTOK_HINTS.import` | |
| Import dialog intro **(inline)** | Import dialog | `Upload a CSV or Excel (.xlsx) file with a header row. Columns are matched automatically where the names line up — check the mapping below and adjust anything that is wrong. Rows without a name are skipped. Owner must match a team member's name and Creator Tier must be Bronze, Silver, Gold or Platinum; anything else is left blank.` | `ImportModal.jsx` | |
| Export Excel / Export CSV | Toolbar | `Download what's shown.`; disabled: `Nothing to export.` | `TIKTOK_HINTS.export / exportDisabled` | |
| New creator | Toolbar | `Add a creator by hand.` | `TIKTOK_HINTS.newCreator` | |
| Count `Showing X of Y` | Meta row | `Matching creators out of all active.` / `…out of all removed.` | `TIKTOK_HINTS.countActive / countRemoved` | |
| Period error alert | Under meta row | `Couldn't load period totals: <message>` | `App.jsx` | |
| Pagination info `<first>–<last> of <total>` | Under table | `100 per page.` | `TIKTOK_HINTS.pagination` | |
| Pagination buttons (`First`, `Last`, chevrons) | Under table | — (`aria-label` `Previous page` / `Next page` on chevrons) | `Pagination.jsx` | **NONE** |
| Funnel heading `Stage funnel` | Above toolbar | `Click a bar to filter by stage.` | `TIKTOK_HINTS.funnel` | |
| Funnel – total `N active creators`; bar hover title `<n>. <full stage name>`, row `Creators: <count>` | Chart | — | `StageFunnel.jsx` | |
| Restore (Removed tab) | Table | `Move back to Active.` | `TIKTOK_HINTS.restore` | |

### 5a. Sync indicator

Visible text, most urgent first. The tooltip is the headline, then the lines described below.

| State | Visible text | Tooltip headline | Source |
|---|---|---|---|
| Connection problem (token status not ok, or access token expired) ⚠ | `Connection issue` | `TikTok connection needs attention.` | `TIKTOK_HINTS.syncToken` |
| A stream has a future `next_retry_at` ⚠ | `Retrying` | `{stream} will retry at {time}.` (`HH:MM` today, else date and time) | `TIKTOK_HINTS.syncRetrying` |
| A stream has `last_error` and no scheduled retry ⚠ | `Sync error` | `{stream} failed. Will retry on the next run.` | `TIKTOK_HINTS.syncError` |
| Latest data sync older than 3 hours ⚠ | `Sync delayed` | `No sync for 3+ hours.` | `TIKTOK_HINTS.syncStale` |
| OK | `Synced <relative time>` | `Updates hourly. Last synced {time}.` | `TIKTOK_HINTS.syncOk` |
| Never synced | `Not synced yet` | `Updates hourly. Last synced never.` | `TIKTOK_HINTS.syncOk` |
| Checking | `Checking sync…` | — (no tooltip) | `SyncStatus.jsx` |
| Status unavailable ⚠ | `Sync status unavailable` | The error message | `SyncStatus.jsx` |

Tooltip body after the headline (`SyncStatus.jsx · details`):

1. One line per stream (`Sales`, `Samples`, `Sample shipping`, `Collaborations`, `Creator updates`, `TikTok connection`): `<Stream>: <last_status or "not run yet"> · last success <date time or "never"> · <retry text if a retry is scheduled>`.
2. A blank line, then each stream's last error, shortened to one line (100 characters): `<Stream>: <message>`. Only streams with an error appear.
3. A blank line, then `TikTok connection valid until {date}` from the token row's `access_token_expires_at`. Absent when the token row has no expiry.

---

## 6. Markers

| Element | Where | Tooltip or hint text | Source | Missing? |
|---|---|---|---|---|
| "Synced from TikTok" marker (↻) – locked field | Drawer, beside a label, only when `synced_fields[key]` is true | `From TikTok – can't be edited. Synced {time}.` | `TIKTOK_HINTS.syncedLocked / syncedAt`, `SyncMarker.jsx` | |
| Same marker – Current Product / Other Products Received (editable) | Drawer | `From TikTok. Synced {time}.` | `TIKTOK_HINTS.syncedEditable`, `tiktok.js · SYNCED_EDITABLE` | |
| Read-only field not filled by TikTok | Drawer | No marker; the label ⓘ says `Filled automatically from TikTok.` | `ReadOnlyField.jsx` | |
| TikTok entry marker `TikTok` (↻) on rows in Other Products Received | Drawer | `From a TikTok sample. Can't be changed.` | `TIKTOK_HINTS.tiktokEntry` | |
| Remove entry (✕ on manual rows) | Drawer · Other Products Received | `Remove entry` | `TIKTOK_HINTS.removeEntry` | |
| Eligible – drawer, unsynced (checkbox `Eligible`) | Drawer · Creator | Label tip only | `FieldInput.jsx` | |
| ⓘ icon itself | Everywhere | `aria-label="What is this?"` (screen readers); the bubble carries the text | `SyncMarker.jsx · InfoTip` | n/a |

---

## 7. Inline hints

Text shown under or beside fields (not in a bubble).

| Element | Where | Text | Source |
|---|---|---|---|
| Shipping Address | Drawer · Creator, under the textarea | `Only needed for creators who aren't TikTok Shop affiliates.` | `fields.js · shipping_address.hint`, `FieldInput.jsx · Hint` |
| Current Product override note (only when synced) | Drawer · Product & content, under the input | `Editing overrides TikTok until a newer sample arrives.` | `TIKTOK_HINTS.currentProductEditHint` |
| Other Products Received – add row | Drawer | Placeholders `Product`, `Date received`; button `Add`; empty state `None recorded.` | `ProductsList.jsx` |
| Stats as of | Drawer · TikTok | `Stats as of <date> · last synced <date time>` | `TikTokSection.jsx` |
| Name is required | Drawer footer | `Name is required` | `CreatorDetail.jsx` |
| Save before notes | Drawer (new creator) | `Save this creator to start adding notes.` | `CreatorDetail.jsx` |
| Import column mapping | Import dialog | Heading `Column mapping · N row(s) found`, first option `— ignore —`; `*` on Name | `ImportModal.jsx` |
| Empty table message | Table area | `No creators match that filter.` / `No creators yet — import a CSV or add one.` / `Nothing has been removed.` | `App.jsx` |

---

## End lists

### A. Elements with no tooltip or hint

- **Table:** sort arrows; Removed-tab column headers (`Removed by`, `Removed at`, Restore).
- **Drawer:** Notes (placeholder only); Save changes / Discard / Close; each pending-sample, recent-sample and collab row.
- **Toolbar and header:** search box and owner filter (placeholder or label only, by design since 6b); custom From / To dates (label only, by design); date range `Loading…`; pagination buttons.
- **Disabled states:** Save changes (disabled until dirty and named; only `Name is required` is explained).

### B. Same concept, different wording

1. **Sale wording.** `TikTok sale` (First Sale, Last Sale, No sale filter) vs `sales` (GMV, 30-day GMV) vs `units sold` (Units). The filter option `Never sold` is worded `No TikTok sale ever.`
2. **"GMV" means two things.** Ours is `TikTok sales, net of returns, before tax. Unsettled sales are estimates.`; the drawer stat `30-day GMV` is `Sales across all shops, last 30 days.` (no mention of net, returns or tax).
3. **Current Product.** Field tip says `Latest approved TikTok sample, unless the team entered something newer.`; the edit note says `Editing overrides TikTok until a newer sample arrives.` ("newer something" becomes "newer sample").
4. **Samples.** Called `sample requests` (pending tip, cancelled filter), `samples` (recent samples, Other Products, shipping hints) and `sample` (Current Product); the status label `Requested` is another wording.
5. **New from TikTok.** The bar text (`created automatically and not yet reviewed`) and its tip (`Auto-created from TikTok. Clears when an owner is assigned.`) say the first half twice.
6. **Last synced.** `last synced <date time>` (stats line, marker's `Synced {time}`) vs `Synced <relative time>` (header) vs `Last synced {time}` (header tooltip).
7. **Fulfilment rate and the other stats.** Tips say `— if not shared.`; the UI shows `—`. The `—` in the tip is a dash, not a placeholder, so it can read oddly.
8. **TikTok entries in Other Products Received.** Field tip `TikTok entries are added automatically.` vs entry marker `From a TikTok sample. Can't be changed.`
9. **Eligible.** Tip says `any activity`; the Shipping Address hint says `TikTok Shop affiliates`.

### C. Text that falls short of, or differs from, the build plan (as built)

1. **GMV tip.** `Unsettled sales are estimates.` doesn't say that settled orders use TikTok's actual figure, or that an unsettled fully returned line counts as 0.
2. **Units Sold (Current Product).** `TikTok samples only.` is shorter than the rule (units from sample orders for the current product); nothing says partly refunded orders still count every unit.
3. **Sync Now.** Removed in phase 6; the hourly sync plus Refresh cover it. The tooltip for Refresh (`Reload data.`) no longer mentions it.
4. **Sync error with a long message.** The tooltip lists only the first line, cut at 100 characters; the full text is in `tiktok_sync_status`.
