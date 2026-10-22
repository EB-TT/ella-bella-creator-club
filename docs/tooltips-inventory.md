# Creator Club – tooltip and hint inventory (creators side)

Read-only inventory of every tooltip and hint on the creators side of the app, regenerated from the code as it stands after phase 8c (journey, column picker, engagement, settings, import). **Out of scope:** the Creator Valuations tab (`Valuation*`, `CreatorValuations`, `useValuations`, `valuationBenchmarks.js`), plus login, TikTok setup and confirm-modal copy.

## How to read this

- **Text is verbatim**, in code spans. A real tooltip is the `Tooltip` bubble (hover or keyboard focus). Inline text under a field is marked **(inline)**. There are no native `title=` tooltips on the creators side except the full title shown on a video row (§3a).
- **Missing? = NONE** means the element has no tooltip or hint of any kind.
- `{time}`, `{stream}`, `{days}`, `{date}`, `{n}`, `{m}` are filled in by the component.
- Source paths, abbreviated:
  - `tiktok.js` = `src/lib/tiktok.js` (`TIKTOK_HINTS` = all tooltip copy there)
  - `fields.js` = `src/lib/fields.js`; `importSheet.js` = `src/lib/importSheet.js`
  - `SyncMarker.jsx`, `ReadOnlyField.jsx`, `CreatorTable.jsx`, `CreatorDetail.jsx`, `TikTokSection.jsx`, `Engagement.jsx`, `SuggestionBar.jsx`, `Pill.jsx`, `JourneyInput.jsx`, `ProductsList.jsx`, `FiltersMenu.jsx`, `ColumnsMenu.jsx`, `PeriodSelector.jsx`, `SyncStatus.jsx`, `Pagination.jsx`, `StageFunnel.jsx`, `SettingsPage.jsx`, `FieldInput.jsx`, `ImportModal.jsx` = `src/components/…`
  - `App.jsx` = `src/App.jsx`

### How header and drawer tooltips are built

- **Table header** (`CreatorTable.jsx`): tip = `TIKTOK_HINTS[field.key]`, else `field.hint`, then a second line `Drag headers to reorder.` on every header except Name (`TIKTOK_HINTS.dragReorder`). GMV and Units Sold (Total) gain the date range in the label when one is active (e.g. `GMV – last 30 days`); the tip is unchanged.
- **Drawer label** (`SyncMarker.jsx · FieldLabel`): an ⓘ with `TIKTOK_HINTS[field.key]`. For a TikTok-owned read-only field (`ReadOnlyField`) that TikTok has **not** filled for this creator, the ⓘ reads `Filled automatically from TikTok.` instead. Last Engaged is read-only but not TikTok-owned (`notTikTok`), so it keeps its own text. The "Synced from TikTok" marker shows only when `synced_fields[key]` is true. GMV and Units Sold (Total) also get a ` · All time` sub-label with its own tooltip.
- The header and the drawer ⓘ therefore show the same text for a field, except for the unsynced read-only case above.

---

## 1. Table column headers

Default (key fields) order is the first block; the Columns button (§5) can show any of the others, in any order, saved per person. **Name** is always first and can't be moved. With `JOURNEY_MERGED = true` (as shipped) Stage and Creator Tier are replaced by **Journey**; with it `false` the two come back and Journey goes. The Removed tab adds `Removed by`, `Removed at` and an unlabelled Restore column (no tooltips on the three headers).

| # | Element | Tooltip text | Source | Missing? |
|---|---|---|---|---|
| 1 | Name (always first) | `Display name. Edit freely.` | `TIKTOK_HINTS.name` | |
| 2 | Journey (key field) | `Stage, or tier once earned. Hover the funnel for details.` + drag line | `TIKTOK_HINTS.journey` | |
| 2b | Stage (only when `JOURNEY_MERGED` is false) | `Journey stage. TikTok can suggest a later one.` | `TIKTOK_HINTS.stage` | |
| 3 | Next Action (key field) | `What the owner plans next.` | `TIKTOK_HINTS.next_action` | |
| 4 | Current Product (key field) | `Latest approved TikTok sample, unless the team entered something newer.` | `TIKTOK_HINTS.current_product` | |
| 5 | Next Follow-up (key field) | `When to follow up. Red when overdue.` | `TIKTOK_HINTS.next_follow_up_date` | |
| 6 | Owner (key field) | `Team member responsible.` | `TIKTOK_HINTS.owner_id` | |
| 7 | GMV (key field) | `TikTok sales, net of returns, before tax. Unsettled sales are estimates.` | `TIKTOK_HINTS.gmv` | |
| 8 | Creator Tier (key field, `JOURNEY_MERGED` false only) | `Bronze to Platinum. Set by the team.` | `TIKTOK_HINTS.creator_tier` | |
| 9 | Last Contact (key field) | `Last time the team got in touch.` | `TIKTOK_HINTS.last_contact` | |
| 10 | TikTok Handle | `Links them to TikTok data. Changing it re-links.` | `TIKTOK_HINTS.tiktok_handle` | |
| 11 | Instagram Handle | `Entered by the team.` | `TIKTOK_HINTS.instagram_handle` | |
| 12 | Email | `Entered by the team.` | `TIKTOK_HINTS.email` | |
| 13 | Mobile | `Only numbers the creator gave you directly.` | `TIKTOK_HINTS.mobile` | |
| 14 | Discord | `Their Discord username, entered by the team.` | `TIKTOK_HINTS.discord_handle` | |
| 15 | Language | `Blank counts as English.` (blank cells show `English`) | `TIKTOK_HINTS.language` | |
| 16 | CC Join Date | `Entering a date moves them to Joined.` | `TIKTOK_HINTS.cc_join_date` | |
| 17 | TikTok Shop Eligible | `Set automatically once TikTok shows any activity.` | `TIKTOK_HINTS.tiktok_shop_eligible` | |
| 18 | Shipping Address | `Only needed for creators who aren't TikTok Shop affiliates.` | `fields.js · shipping_address.hint` = `TIKTOK_HINTS.shippingAddress` | |
| 19 | Other Products Received | `Earlier products sent. TikTok entries are added automatically.` | `TIKTOK_HINTS.other_products_received` | |
| 20 | Other Videos | `First selling video for each other product, newest first.` | `TIKTOK_HINTS.other_videos` | |
| 21 | Product Sent | `From TikTok shipping for the current sample. Blank until shipped.` | `TIKTOK_HINTS.product_sent_date` | |
| 22 | Product Delivered | `From TikTok shipping for the current sample. Blank until shipped.` | `TIKTOK_HINTS.product_delivery_date` | |
| 23 | First Video Date | `When their first selling video was posted.` | `TIKTOK_HINTS.first_video_date` | |
| 24 | First Video Link | `Their first video that drove a sale.` | `TIKTOK_HINTS.first_video_link` | |
| 25 | First Sale Date | `First TikTok sale that wasn't cancelled or returned.` | `TIKTOK_HINTS.first_sale_date` | |
| 26 | Units Sold (Current Product) | `Units of the current product, all time. TikTok samples only.` | `TIKTOK_HINTS.units_sold_current_product` | |
| 27 | Units Sold (Total) | `Units sold on TikTok, excluding cancelled and returned sales.` | `TIKTOK_HINTS.units_sold_total` | |
| 28 | Last Sale | `Latest TikTok sale that wasn't cancelled or returned.` | `TIKTOK_HINTS.last_sale_at` | |
| 29 | Ella Bella Views | `Video and LIVE views since late June 2026. Ignores date range.` | `TIKTOK_HINTS.ella_bella_views` | |
| 30 | Last Engaged | `Latest like or comment logged on their videos.` | `TIKTOK_HINTS.last_engaged_at` | |
| 31 | Eligible tick in the cell (✓ `Eligible`) | `Set automatically once TikTok shows any activity.` | `CreatorTable.jsx · Cell` | |
| 32 | Products / Other Videos cells (`N products`, `N videos`) | The full list, as a bubble (e.g. `Product A (01 Aug 2026)` per line) | `CreatorTable.jsx · Cell` | |
| 33 | Journey cell: dashed pill after the position (`Gold → Platinum`) | `Suggested from TikTok data. Not applied yet.`; its ✓ (on hover) `Accept this suggestion.` | `TIKTOK_HINTS.suggestedPill / quickAccept`, `Pill.jsx` | |
| 34 | Next Action cell: dashed `→ <step>` pill (only with a pending suggestion, `JOURNEY_MERGED` true) then the free text, muted | `Suggested next step from TikTok. ✓ to accept.`; its ✓ `Accept this suggestion.` | `TIKTOK_HINTS.nextActionSuggestion / quickAccept`, `Pill.jsx · NextActionCell` | |
| 35 | Sort arrows | — (state via `aria-sort`) | `CreatorTable.jsx` | **NONE** |
| 36 | Removed by / Removed at / Restore column headers | — | `App.jsx · removedColumns` | **NONE** |

---

## 2. Drawer fields

Grouped as `CreatorDetail.jsx · GROUPS`. "Label tip" is the ⓘ next to the label; its text is the same as the table header (§1) unless noted. Fields in `LOCKED_WHEN_SYNCED` become read-only once TikTok has filled them for that creator; **Last Sale**, **Other Videos**, **Ella Bella Views** and **Last Engaged** are always read-only.

| Element | Where | Tooltip or hint text | Source | Missing? |
|---|---|---|---|---|
| **Group: Creator** | | | | |
| Name, TikTok Handle, Instagram Handle, Email | Drawer · Creator, label tip | As §1 rows 1, 10, 11, 12 | `TIKTOK_HINTS` | |
| Mobile, Discord | Drawer · Creator, label tip | As §1 rows 13, 14 | `TIKTOK_HINTS` | |
| TikTok Shop Eligible (checkbox label `Eligible`) | Drawer · Creator, label tip | `Set automatically once TikTok shows any activity.` | `TIKTOK_HINTS.tiktok_shop_eligible` | |
| Shipping Address | Drawer · Creator | Label tip `Only needed for creators who aren't TikTok Shop affiliates.` and the same text **(inline)** under the textarea | `TIKTOK_HINTS.shippingAddress` | |
| **Group: Journey** | | | | |
| Journey (dropdown; `Stage` and `Creator Tier` when `JOURNEY_MERGED` is false) | Drawer · Journey, label tip | `Stage, or tier once earned. Hover the funnel for details.` | `TIKTOK_HINTS.journey` | |
| Journey – move back to a stage that removes a tier **(inline)** | Under the dropdown | `Move back to <stage>? This removes their tier.` with `Move back` / `Cancel` | `TIKTOK_HINTS.journeyClearsTier`, `JourneyInput.jsx` | |
| Journey – current position pill (`Gold → Platinum`) | Under the dropdown | As §1 row 33 | `Pill.jsx · JourneyCell` | |
| Language (dropdown, blank option `English`) | Drawer · Journey, label tip | `Blank counts as English.` | `TIKTOK_HINTS.language` | |
| CC Join Date | Drawer · Journey, label tip | `Entering a date moves them to Joined.` | `TIKTOK_HINTS.cc_join_date` | |
| Owner, Next Follow-up, Last Contact | Drawer · Journey, label tip | As §1 rows 6, 5, 9 | `TIKTOK_HINTS` | |
| Next Action (label tip) | Drawer · Journey | `What the owner plans next.` | `TIKTOK_HINTS.next_action` | |
| Next Action – suggested next step, above the input (only with a pending suggestion) | Drawer · Journey | Dashed `→ <step>` pill with `Suggested next step from TikTok. ✓ to accept.`; its always-visible ✓ `Accept this suggestion.` | `TIKTOK_HINTS.nextActionSuggestion / quickAccept` | |
| Last Engaged (read-only) | Drawer · Journey, label tip | `Latest like or comment logged on their videos.` | `TIKTOK_HINTS.last_engaged_at` | |
| **Group: Product & content** | | | | |
| Current Product | Label tip | `Latest approved TikTok sample, unless the team entered something newer.` | `TIKTOK_HINTS.current_product` | |
| Other Products Received | Label tip | `Earlier products sent. TikTok entries are added automatically.` | `TIKTOK_HINTS.other_products_received` | |
| Product Sent, Product Delivered | Label tip | `From TikTok shipping for the current sample. Blank until shipped.` | `TIKTOK_HINTS` | |
| First Video Date, First Video Link | Label tip | `When their first selling video was posted.` / `Their first video that drove a sale.` | `TIKTOK_HINTS` | |
| Other Videos (empty state `None recorded.`) | Label tip | `First selling video for each other product, newest first.` | `TIKTOK_HINTS.other_videos` | |
| **Group: Performance** | | | | |
| First Sale Date, Last Sale | Label tip | As §1 rows 25, 28 | `TIKTOK_HINTS` | |
| GMV, label `GMV · All time` | Label tip | `TikTok sales, net of returns, before tax. Unsettled sales are estimates.` | `TIKTOK_HINTS.gmv` | |
| `· All time` sub-label (GMV, Units Sold (Total)) | Sub-label | `The drawer always shows all-time totals, whatever date range is selected.` | `TIKTOK_HINTS.allTime` | |
| Units Sold (Current Product) | Label tip | `Units of the current product, all time. TikTok samples only.` | `TIKTOK_HINTS.units_sold_current_product` | |
| Units Sold (Total), label `Units Sold (Total) · All time` | Label tip | `Units sold on TikTok, excluding cancelled and returned sales.` | `TIKTOK_HINTS.units_sold_total` | |
| Ella Bella Views (read-only, with thousands separators) | Label tip | `Video and LIVE views since late June 2026. Ignores date range.` (or `Filled automatically from TikTok.` until TikTok has filled it) | `TIKTOK_HINTS.ella_bella_views` | |
| Creator Tier (only when `JOURNEY_MERGED` is false) | Label tip | `Bronze to Platinum. Set by the team.` | `TIKTOK_HINTS.creator_tier` | |
| **Read-only field TikTok hasn't filled for this creator** (e.g. Last Sale, Other Videos, or a locked field on an unlinked creator) | Label tip | `Filled automatically from TikTok.` (replaces the field definition; no marker) | `TIKTOK_HINTS.filledFromTiktok`, `ReadOnlyField.jsx` | |
| Eligible tick, read-only (✓ `Eligible`) | Drawer · Creator | `Set automatically once TikTok shows any activity.` | `ReadOnlyField.jsx` | |
| Notes (heading `Notes`, placeholder `Add a note…`, empty state `No notes yet.`) | Drawer · bottom | — | `NotesFeed.jsx` | **NONE** (placeholder is the only hint) |
| Remove creator (icon button) | Drawer header | `Remove creator` | `TIKTOK_HINTS.removeCreator` | |
| Close (icon button) | Drawer header | `Close` | `TIKTOK_HINTS.closeDrawer` | |
| Save changes / Discard / Close | Drawer footer | — | `CreatorDetail.jsx` | **NONE** |

---

## 3. Drawer TikTok section

`TikTokSection.jsx` and `Engagement.jsx`. Shown for saved creators only. Headings use `InfoTip`.

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
| – each row: name, `Accepted <date>`, `N in showcase · N posted`; empty `None.` | Drawer · TikTok | — | `TikTokSection.jsx` | **NONE** |
| TikTok stats across all shops (heading ⓘ) | Drawer · TikTok | `TikTok figures across all shops.` | `TIKTOK_HINTS.creatorStats` | |
| Followers | Drawer · TikTok stats | `TikTok followers.` | `TIKTOK_HINTS.statFollowers` | |
| 30-day GMV | Drawer · TikTok stats | `Sales across all shops, last 30 days. — if not shared.` | `TIKTOK_HINTS.statGmv30d` | |
| Fulfilment rate | Drawer · TikTok stats | `Sample fulfilment rate, last 90 days. — if not shared.` | `TIKTOK_HINTS.statFulfilment` | |
| Median video views | Drawer · TikTok stats | `Shoppable videos, last 30 days. — if not shared.` | `TIKTOK_HINTS.statViews` | |
| `Stats as of <date> · last synced <date time>` | Drawer · TikTok stats | `When TikTok last sent these.` | `TIKTOK_HINTS.statsAsOf` | |
| Video views, LIVE views (shown once the creator has either) | Drawer · TikTok, below the stats | `Views of their Ella Bella videos, all time.` / `Views of their LIVE sessions, whole session.` | `TIKTOK_HINTS.statVideoViews / statLiveViews` | |

### 3a. Engagement (videos, LIVE sessions, log by link)

Shown for every saved creator, linked or not (a pasted link can be logged before they are linked).

| Element | Where | Tooltip or hint text | Source | Missing? |
|---|---|---|---|---|
| Videos (heading ⓘ) | Drawer · TikTok | `Their Ella Bella videos, newest first.` | `TIKTOK_HINTS.videosList` | |
| States: loading / empty **(inline)** | Drawer · TikTok | `Loading videos…` / `No Ella Bella videos found yet.` | `Engagement.jsx` | |
| Video row: title (or products), date · products · `N views` | Drawer · TikTok | The full title as a native browser `title` on the truncated line | `Engagement.jsx · VideoRow` | |
| Link row tag `Link` | Drawer · TikTok | `Logged by pasting a link.`; a link row logged as not featuring Ella Bella adds `Doesn’t feature Ella Bella` **(inline)** | `TIKTOK_HINTS.videoLinkSource` | |
| Open on TikTok (icon) | Video row | `Open on TikTok.` | `TIKTOK_HINTS.videoOpen` | |
| Liked (checkbox) | Video row | `Tick once you have liked this video.`; when ticked, `Liked 3 Oct` **(inline)** under the box | `TIKTOK_HINTS.videoLiked` | |
| Commented (checkbox) | Video row | `Tick once you have commented on it.`; when ticked, `Commented 3 Oct` **(inline)** | `TIKTOK_HINTS.videoCommented` | |
| `Show all N` / `Show fewer` | Under the list (more than 10 videos) | — | `Engagement.jsx` | **NONE** |
| LIVE sessions (heading ⓘ; only when there are some) | Drawer · TikTok | `Their LIVE sessions with total views.` | `TIKTOK_HINTS.livesList` | |
| – each row: date, `N views` | Drawer · TikTok | — | `Engagement.jsx` | **NONE** |
| Log engagement by link (heading ⓘ) | Drawer · TikTok | `Log a like or comment on a video not listed.` | `TIKTOK_HINTS.logByLink` | |
| – URL input (placeholder `https://www.tiktok.com/@creator/video/…`), Liked, Commented | Log form | — (`aria-label` `Video link`) | `Engagement.jsx · LinkForm` | **NONE** |
| – Features Ella Bella (on by default) | Log form | `Tick if the video shows Ella Bella.` | `TIKTOK_HINTS.logFeatures` | |
| – Log it (button); problems **(inline)** | Log form | `Paste the full link, starting with https://` / `Tick Liked, Commented or both.` | `Engagement.jsx` | **NONE** (button) |

---

## 4. Bars

| Element | Where | Tooltip or hint text | Source | Missing? |
|---|---|---|---|---|
| New from TikTok – bar text | Drawer, top (`new_from_tiktok`) | `New from TikTok – created automatically and not yet reviewed.` **(inline)** | `CreatorDetail.jsx` | |
| New from TikTok – ⓘ | Drawer, top | `Auto-created from TikTok. Clears when an owner is assigned.` | `TIKTOK_HINTS.newFromTiktokBar` | |
| Mark as reviewed (button) | New from TikTok bar | `Clear the New from TikTok flag.` | `TIKTOK_HINTS.markReviewed` | |
| Journey suggestion – bar text `Suggested journey step: <step> – <reason>` (`JOURNEY_MERGED` true) | Drawer, top | Reason comes from the database (`suggestion_reason`) | `SuggestionBar.jsx · JourneySuggestionBar` | |
| Journey suggestion – ⓘ | Drawer, top | `TikTok data points to a later step.` | `TIKTOK_HINTS.suggestedJourneyBar` | |
| Suggested stage – bar text `Suggested stage: <stage> – <reason>` (`JOURNEY_MERGED` false) | Drawer, top | Reason comes from the database | `SuggestionBar.jsx` | |
| Suggested stage – ⓘ | Drawer, top | `TikTok shows a later stage.` | `TIKTOK_HINTS.suggestedStageBar` | |
| Suggested tier – bar text `Suggested tier: <tier> – <reason>` (`JOURNEY_MERGED` false) | Drawer, top | As above | `SuggestionBar.jsx` | |
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
| Tab `Creator Valuations` | Top bar | — (out of scope) | `App.jsx` | n/a |
| Theme toggle | Top bar | `Switch to light` / `Switch to dark` | `TIKTOK_HINTS.themeLight / themeDark` | |
| Settings (icon, admins only) | Top bar | `Settings: tiers, journey rules, automation, products.` | `TIKTOK_HINTS.settingsButton` | |
| Sign out | Top bar | `Sign out` | `TIKTOK_HINTS.signOut` | |
| Date range dropdown (`All time`, `Last 7 days`, `Last 30 days`, `Last 90 days`, `This month`, `Custom range`) | Top bar | `Applies to GMV and Units Sold (Total) only.` | `TIKTOK_HINTS.dateRange` | |
| Custom From / To dates | Top bar | — (`aria-label` `From date` / `To date`, joined by `to`) | `PeriodSelector.jsx` | **NONE** |
| Date range `Loading…` | Top bar | — | `PeriodSelector.jsx` | **NONE** |
| Sync indicator – headline and text: see §5a | Top bar | | `SyncStatus.jsx` | |
| Refresh (icon button) | Top bar | `Reload data.` | `TIKTOK_HINTS.refresh` | |
| Search box (placeholder `Search name, handle, owner…`) | Toolbar | — (placeholder only) | `App.jsx` | **NONE** |
| Owner filter (`All owners`, `Unassigned`, each person) | Toolbar | — (`aria-label="Filter by owner"` only) | `App.jsx` | **NONE** |
| My creators – normal | Toolbar | `Only creators you own.` | `TIKTOK_HINTS.myCreators` | |
| My creators – disabled (no profile) | Toolbar | `No team profile for your account yet` | `TIKTOK_HINTS.myCreatorsDisabled` | |
| Filters button (`Filters (n)`) | Toolbar | `More ways to narrow the list.` | `TIKTOK_HINTS.filtersButton` | |
| Filters menu: `Stage: <stage>` / `Journey: <step>` row with ✕ (set by clicking a funnel bar) | Filters menu | `Click × to show all stages.` / `Click × to show every step.` | `TIKTOK_HINTS.stageFilter / journeyFilter` | |
| Filter: Overdue follow-ups (ⓘ) | Filters menu | `Follow-up date has passed.` | `TIKTOK_HINTS.overdue` | |
| Filter: New from TikTok (ⓘ) | Filters menu | `Auto-created from TikTok. Clears when an owner is assigned.` | `TIKTOK_HINTS.newFromTiktok` | |
| Filter: Request cancelled, no other activity (ⓘ) | Filters menu | `Only activity was a cancelled sample request.` | `TIKTOK_HINTS.requestCancelledOnly` | |
| Filter: Suggested actions (ⓘ) | Filters menu | `Creators with a stage or tier suggestion.` | `TIKTOK_HINTS.suggested` | |
| Filter: No sale for (select: `Any`, `14 days`, `30 days`, `60 days`, `90 days`, `Never sold`) (ⓘ) | Filters menu | `No TikTok sale in {days} days, or never.` (`X` until a day count is chosen); `No TikTok sale ever.` for Never sold | `TIKTOK_HINTS.noSale / neverSold`, `noSaleHint` | |
| Filter: …and no contact in X days (ⓘ) | Filters menu | `Also no contact in that time.`; disabled: `Pick a No sale period first.` | `TIKTOK_HINTS.noContact / noContactDisabled` | |
| Filter: Not engaged for (select: `Any`, `14 days`, `30 days`, `60 days`) (ⓘ) | Filters menu | `No like or comment logged in {days} days, or ever.` (`X` until a day count is chosen). Counts in the badge; cleared by Clear filters | `TIKTOK_HINTS.notEngaged`, `notEngagedHint` | |
| Filter: Language: Spanish (ⓘ) | Filters menu | `Only creators set to Spanish.` | `TIKTOK_HINTS.languageFilter` | |
| Clear filters | Filters menu | `Remove all filters.` | `TIKTOK_HINTS.clearFilters` | |
| Columns button | Toolbar (replaces the Key / All fields toggle) | `Choose which columns to show.` | `TIKTOK_HINTS.columnsButton` | |
| Columns menu: Name (ticked, locked; `Always first` **(inline)**) | Columns menu | — | `ColumnsMenu.jsx` | **NONE** |
| Columns menu: one tick per field (ⓘ) | Columns menu | The field's own tip (§1); no ⓘ where the field has none | `TIKTOK_HINTS[field.key]` | |
| Columns menu: Reset to default | Columns menu | `Back to the key fields.` | `TIKTOK_HINTS.columnsReset` | |
| Columns menu: Show all | Columns menu | `Show every column.` | `TIKTOK_HINTS.columnsShowAll` | |
| Columns menu footer note **(inline)** | Columns menu | `Drag headers to reorder.` | `TIKTOK_HINTS.dragReorder` | |
| Import | Toolbar | `Match a sheet to creators by handle. Fills empty fields only.` | `TIKTOK_HINTS.import` | |
| Import dialog: see §8 | Import dialog | | `ImportModal.jsx` | |
| Export Excel / Export CSV (visible columns, in order) | Toolbar | `Download what's shown.`; disabled: `Nothing to export.` | `TIKTOK_HINTS.export / exportDisabled` | |
| New creator | Toolbar | `Add a creator by hand.` | `TIKTOK_HINTS.newCreator` | |
| Period error alert | Under toolbar | `Couldn't load period totals: <message>` | `App.jsx` | |
| Pagination info `<first>–<last> of <total>` (`(filtered from N)` when filtered) | Under table | `Matching creators out of all active.` / `…out of all removed.` | `TIKTOK_HINTS.countActive / countRemoved` (`pagination` = `100 per page.` is the fallback) | |
| Pagination buttons (`First`, `Last`, chevrons) | Under table | — (`aria-label` `Previous page` / `Next page` on chevrons) | `Pagination.jsx` | **NONE** |
| Funnel heading `Journey` (`JOURNEY_MERGED` true) | Above toolbar | `Each creator's place in the journey. Hover a bar for details.` | `TIKTOK_HINTS.funnelJourney` | |
| Funnel heading `Stage funnel` (`JOURNEY_MERGED` false) | Above toolbar | `Click a bar to filter by stage.` | `TIKTOK_HINTS.funnel` | |
| Funnel – total `N active creators` (plus `· N on retired stages not shown`) | Funnel | — | `StageFunnel.jsx` | |
| Funnel bar hover – stage (Invited, Joined, TT Shop Enabled, First Product, Product Sent, First Video, Video Posted, First Sale Achieved, Build Momentum, Consistent Creator) | Chart | `<n>. <stage>`, `<count> creators`, `Means: …`, `Moves here when: …` – texts in §5b | `TIKTOK_HINTS.journeySteps`, `tiktok.js · stepText` | |
| Funnel bar hover – tier (Bronze, Silver, Gold, Platinum) | Chart | `<count> with this tier · <n> suggested`, then `Ella Bella views <n>+ or <All-time / Last 30 days / Last 90 days> GMV $<n>+` (from Settings); Bronze adds `Bronze also needs Consistent Creator.`; with suggestions adds `Suggested creators are also counted at their current step.` | `tiktok.js · tierBandText`, `TIKTOK_HINTS.tierBronzeNote / funnelSuggestedNote` | |
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

A stream whose status is `waiting_for_scope` (the two analytics streams before TikTok grants access) is **not** a warning: it never causes ⚠, `Retrying` or `Sync error`, and it is left out of the error list.

Tooltip body after the headline (`SyncStatus.jsx · details`):

1. One line per stream (`Sales`, `Samples`, `Sample shipping`, `Collaborations`, `Creator updates`, `Video views`, `LIVE views`, `TikTok connection`): `<Stream>: <last_status or "not run yet"> · last success <date time or "never"> · <retry text if a retry is scheduled>`. A stream waiting for access reads just `<Stream>: Waiting for TikTok access`.
2. A blank line, then each stream's last error, shortened to one line (100 characters): `<Stream>: <message>`. Only streams with an error appear.
3. A blank line, then `TikTok connection valid until {date}` from the token row's `access_token_expires_at`. Absent when the token row has no expiry.

### 5b. Funnel step texts (`TIKTOK_HINTS.journeySteps`)

Shown in the funnel hover as `Means:` and `Moves here when:`. `{n}` and `{m}` come from the journey rules in Settings.

| Step | Means | Moves here when |
|---|---|---|
| Invited | `Invited to the Creator Club.` | `Set by the team.` |
| Joined | `In the club, nothing started yet.` | `Set by the team, or automatically when a CC Join Date is entered.` |
| TT Shop Enabled | `TikTok Shop affiliate.` | `A sample is requested, a collab is accepted, or any sale.` |
| First Product | `A sample has been approved.` | `A sample request is approved.` |
| Product Sent | `Their sample has shipped.` | `The sample ships.` |
| First Video | `Sample delivered, content now due.` | `The sample is delivered.` |
| Video Posted | `They have posted content.` | `Sample completed, a video sale, collab content, or any Ella Bella video.` |
| First Sale Achieved | `They have made a sale.` | `TikTok shows any sale, video or LIVE.` |
| Build Momentum | `Selling through several videos or lives.` | `{n}+ videos or lives have sold.` |
| Consistent Creator | `Selling steadily over time.` | `{n}+ videos or lives sold, or sales in each of the last {m} months.` |

First Sale, Tier Up and Top Performer are retired: hidden from the funnel, dropdowns and filters unless a creator is currently on one, and they have no hover text.

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

## 7. Settings page (admins)

`SettingsPage.jsx`. A non-admin who lands here sees it read-only with a `Read only` pill.

| Element | Where | Tooltip or hint text | Source | Missing? |
|---|---|---|---|---|
| Back to creators (button) | Settings, top | `Back to the creators list.` | `TIKTOK_HINTS.settingsBack` | |
| `Read only` pill | Settings, top (non-admins) | `Only admins can change these.` | `TIKTOK_HINTS.settingsReadOnly` | |
| Tier bands (heading ⓘ) | Settings · Tier bands | `Either measure qualifies. Bronze also needs Consistent Creator.` | `TIKTOK_HINTS.settingsTierBands` | |
| Based on (select) | Tier bands | `Which GMV decides a creator’s tier.` | `TIKTOK_HINTS.settingsBasis` | |
| `<Tier> – minimum GMV ($)` (Bronze, Silver, Gold, Platinum) | Tier bands | `Lowest GMV that earns this tier.` | `TIKTOK_HINTS.settingsMinGmv` | |
| `<Tier> – minimum views` | Tier bands | `Lowest Ella Bella views that earn this tier.` | `TIKTOK_HINTS.settingsMinViews` | |
| Band problems **(inline)**, as alerts | Tier bands | The same checks as the database, e.g. `Minimum views must go up at each tier: Silver must be above the tier before it.` | `SettingsPage.jsx · bandProblem` | |
| With these values (ⓘ) – counts per tier and `No tier` | Tier bands | `Creators per tier by GMV or views. Not saved yet.` | `TIKTOK_HINTS.settingsPreview` | |
| Preview note **(inline)** | Under the counts | `Approximate: Bronze uses stage as a stand-in for Consistent Creator.` | `TIKTOK_HINTS.settingsPreviewNote` | |
| Build Momentum – videos or lives that sold | Journey rules | `Videos or lives that sold, for Build Momentum.` | `TIKTOK_HINTS.settingsBmContent` | |
| Consistent Creator – videos or lives that sold | Journey rules | `Videos or lives that sold, for Consistent Creator.` | `TIKTOK_HINTS.settingsCcContent` | |
| …or sales in each of the last (months) | Journey rules | `Or sales in each of this many recent months.` | `TIKTOK_HINTS.settingsCcMonths` | |
| Apply stage suggestions automatically (ⓘ) | Automation | `Moves stages forward without anyone approving.`; warning **(inline)** `Changes creators without review.` | `TIKTOK_HINTS.settingsAutoStage / settingsAutoWarn` | |
| Apply tier suggestions automatically (ⓘ) | Automation | `Sets tiers without anyone approving them.`; warning **(inline)** `Changes creators without review.` | `TIKTOK_HINTS.settingsAutoTier / settingsAutoWarn` | |
| Save settings | Settings | `Saves, then updates every creator.` | `TIKTOK_HINTS.settingsSave` | |
| Products (heading ⓘ) | Settings · Products | `Automatic names come from the TikTok listing title.` | `TIKTOK_HINTS.settingsProducts` | |
| Product name input | Products | `Your name for this product. Empty uses the automatic one.` | `TIKTOK_HINTS.settingsProductName` | |
| Product Save | Products | `Saves, then updates creators.` | `TIKTOK_HINTS.settingsProductSave` | |
| Accept all tier suggestions | Bulk actions | `Applies every suggested tier. Admins only.` | `TIKTOK_HINTS.bulkTier` | |
| Accept all stage suggestions | Bulk actions | `Applies every suggested stage. Admins only.` | `TIKTOK_HINTS.bulkStage` | |

---

## 8. Import dialog

`ImportModal.jsx`, with the mapping and wording from `importSheet.js`. Steps: upload → map columns → preview → import → done.

| Element | Where | Tooltip or hint text | Source | Missing? |
|---|---|---|---|---|
| Intro **(inline)** | All steps | `TikTok data always wins. The import only fills empty fields and never moves anyone backwards. Rows are matched by TikTok handle; nothing is saved until you have seen the preview and confirmed.` | `ImportModal.jsx` | |
| File input | Upload | — (`.csv`, `.xlsx`, `.xls`) | `ImportModal.jsx` | **NONE** |
| Template CSV / Excel (buttons) | Upload | `Our column names, with how to fill them in.` | `TIKTOK_HINTS.importTemplate` | |
| Template note **(inline)** | Upload | `Your own sheet works as it is. Or start from our template:` | `ImportModal.jsx` | |
| Column mapping heading | Map | `Column mapping · <file> · N row(s) found`; first select option `— ignore —`; `*` on TikTok Handle | `ImportModal.jsx` | |
| Missing handle alert | Map | `Pick the TikTok Handle column. Rows are matched on it.` | `ImportModal.jsx` | |
| Mapping ⓘ: TikTok Handle | Map | `Matches each row to a creator. Required.` | `TIKTOK_HINTS.importTargets.tiktok_handle` | |
| Mapping ⓘ: Name | Map | `Fills the name only if it is empty.` | `importTargets.name` | |
| Mapping ⓘ: Email, Instagram Handle, Discord, Shipping Address, Next Follow-up | Map | `Fills only if empty.` | `importTargets.*` | |
| Mapping ⓘ: Language | Map | `Spanish or English. Fills only if empty.` | `importTargets.language` | |
| Mapping ⓘ: Mobile | Map | `Fills only if empty. Only numbers creators gave you.` | `importTargets.mobile` | |
| Mapping ⓘ: CC Join Date | Map | `Fills only if empty. Also moves Invited to Joined.` | `importTargets.cc_join_date` | |
| Mapping ⓘ: Owner | Map | `Matched to a team member by name. Fills only if empty.` | `importTargets.owner_id` | |
| Mapping ⓘ: Next Action / journey step | Map | `Old numbers and names work. Only moves forward.` | `importTargets.stage_next` | |
| Mapping ⓘ: Status | Map | `Invited sets that stage. Other values are ignored.` | `importTargets.status` | |
| Mapping ⓘ: TT Shop Enabled? | Map | `Yes counts as at least TT Shop Enabled.` | `importTargets.tt_shop` | |
| Mapping ⓘ: Current Product | Map | `Only if empty and TikTok has not filled it.` | `importTargets.current_product` | |
| Mapping ⓘ: Other Products Received | Map | `Added as manual entries. Repeats are skipped.` | `importTargets.other_products_received` | |
| Mapping ⓘ: Video link / Video link (TT Shop) | Map | `Earliest link fills an empty First Video Link.` / `Same rule as the other video link column.` | `importTargets.video_link_a / video_link_b` | |
| Mapping ⓘ: Notes | Map | `Dated lines become dated notes. Repeats are skipped.` | `importTargets.notes` | |
| Ignored columns (heading ⓘ) | Map | `These columns aren't imported.` | `TIKTOK_HINTS.importIgnored` | |
| – each ignored column and its reason **(inline)** | Map | `Repeats an earlier column. The first one is used.` / `Yes/No with no date, so there is nothing to write.` (Product Delivered) / `Empty column.` / `TikTok fills this. TikTok data always wins.` / `Not used by the import.` | `importSheet.js · ignoredReason` | |
| Preview (button) | Map | `Check the whole file. Nothing is saved.` | `TIKTOK_HINTS.importPreviewButton` | |
| Preview heading (ⓘ) `Preview · nothing is saved yet` | Preview | `Checks every row. Nothing is saved yet.` | `TIKTOK_HINTS.importPreview` | |
| Summary counts and notes **(inline)** | Preview, Done | Rows in the file; existing creators to update (updated); new creators to add (added); rows skipped; empty fields filled; left alone: already filled; left alone: TikTok has it; stages moved forward; stages already there or later; notes added; notes already there; values not understood. Notes list the skip reasons and owner names with no team member yet | `ImportModal.jsx · Summary` | |
| Show (select: `All rows`, `Existing creators`, `New creators`, `Skipped`, `Needs a look`) (ⓘ) | Preview | `Show one kind of row.` | `TIKTOK_HINTS.importFilter` | |
| Download report | Preview, Done | `Download the row-by-row results.` (Done: no tooltip) | `TIKTOK_HINTS.importReport` | **NONE** on Done |
| Row table (Row, Handle, Action, Filled in, Left alone, Notes) | Preview | — | `ImportModal.jsx · ReportTable` | **NONE** |
| Import N rows (button) | Preview | `Applies the preview, 500 rows at a time.` | `TIKTOK_HINTS.importRun` | |
| Progress **(inline)** | Import | `Importing batch X of Y…` | `ImportModal.jsx` | |
| Batch failure alert | Import | `Batch N of M failed: <message> Batches 1–K were applied. Running the import again is safe: it only fills empty fields.` (or `Nothing was imported.`) | `ImportModal.jsx` | |
| Done alert | Done | `Imported: N updated, M added.` | `ImportModal.jsx` | |

---

## 9. Inline hints

Text shown under or beside fields (not in a bubble).

| Element | Where | Text | Source |
|---|---|---|---|
| Shipping Address | Drawer · Creator, under the textarea | `Only needed for creators who aren't TikTok Shop affiliates.` | `fields.js · shipping_address.hint`, `FieldInput.jsx · Hint` |
| Current Product override note (only when synced) | Drawer · Product & content, under the input | `Editing overrides TikTok until a newer sample arrives.` | `TIKTOK_HINTS.currentProductEditHint` |
| Other Products Received – add row | Drawer | Placeholders `Product`, `Date received`; button `Add`; empty state `None recorded.` | `ProductsList.jsx` |
| Stats as of | Drawer · TikTok | `Stats as of <date> · last synced <date time>` | `TikTokSection.jsx` |
| Name is required | Drawer footer | `Name is required` | `CreatorDetail.jsx` |
| Save before notes | Drawer (new creator) | `Save this creator to start adding notes.` | `CreatorDetail.jsx` |
| Empty table message | Table area | `No creators match that filter.` / `No creators yet — import a CSV or add one.` / `Nothing has been removed.` | `App.jsx` |

---

## End lists

### A. Elements with no tooltip or hint

- **Table:** sort arrows; Removed-tab column headers (`Removed by`, `Removed at`, Restore).
- **Drawer:** Notes (placeholder only); Save changes / Discard / Close; each pending-sample, recent-sample and collab row; each LIVE session row; `Show all N`; the Log it button and the link URL input.
- **Toolbar and header:** search box and owner filter (placeholder or label only, by design); custom From / To dates (label only, by design); date range `Loading…`; pagination buttons; the Name row in the Columns menu.
- **Import dialog:** the file input, the row table, and Download report on the Done step.
- **Disabled states:** Save changes (disabled until dirty and named; only `Name is required` is explained); the Preview and Import buttons keep their tooltip while disabled and don't say why.

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
10. **Views.** `Ella Bella Views` (field) vs `Video views` / `LIVE views` (drawer) vs `Median video views` (TikTok stats, a different measure: shoppable videos, last 30 days). The date range ignores the first three, and only the field tip says so.
11. **Suggestion wording.** `Suggested journey step` (bar), `Suggested next step from TikTok` (Next Action pill), `Suggested from TikTok data. Not applied yet.` (Journey pill) and `Suggested actions` (filter) all describe the same suggestion.
12. **Stage vs step vs journey.** The merged field is `Journey`, its values are `steps` in the funnel and bar and `stages` in the import, Settings and the old tips (`TikTok shows a later stage.`).
13. **"Fills only if empty".** The import tips say it six different ways (`Fills only if empty.`, `Fills the name only if it is empty.`, `Only if empty and TikTok has not filled it.`).

### C. Text that falls short of, or differs from, the build plan (as built)

1. **GMV tip.** `Unsettled sales are estimates.` doesn't say that settled orders use TikTok's actual figure, or that an unsettled fully returned line counts as 0.
2. **Units Sold (Current Product).** `TikTok samples only.` is shorter than the rule (units from sample orders for the current product); nothing says partly refunded orders still count every unit.
3. **Sync Now.** Removed in phase 6; the hourly sync plus Refresh cover it. The tooltip for Refresh (`Reload data.`) no longer mentions it.
4. **Sync error with a long message.** The tooltip lists only the first line, cut at 100 characters; the full text is in `tiktok_sync_status`.
5. **Ella Bella Views.** The tip says `since late June 2026`; the real start is the analytics floor found by the sync (about 120–180 days back), so the date can differ.
6. **Export.** `Download what's shown.` is now literally true of the columns (visible columns, in order), but Notes and Status are still added to every export.
7. **Tier bar hover.** Shows both thresholds as minimums (`or`), where earlier versions showed a GMV range. The Bronze line is a separate sentence, not part of the band text.
8. **Next Action tooltip on the pill.** `✓ to accept` describes a tick that only appears on hover in the table.
