# Creator Club – Phase 8 decisions (agreed 21–22 Oct 2026)

These come from the team's second round of requests and the replies agreed since. **Not built yet.** Phase 8 is split into three prompts (8a backend, 8b frontend, 8c import), written after the analytics discovery run.

## Journey (each creator sits at the highest step they qualify for)

| # | Step | Creator is here when… | Set by |
|---|---|---|---|
| 1 | **Invited** *(new)* | invited to the Creator Club | team |
| 2 | **Joined** | a CC Join Date is entered | team (automatic from the date) |
| 3 | **TT Shop Enabled** *(renamed from Accepted)* | TikTok shows them as an affiliate: a sample requested but not yet approved, an accepted collab invite, or any sale | TikTok |
| 4 | **First Product** | sample request **approved** | TikTok |
| 5 | **Product Sent** | sample shipped | TikTok |
| 6 | **First Video** | sample delivered, content due | TikTok |
| 7 | **Video Posted** | sample completed, a selling video, collab content, or any Ella Bella video in the views data | TikTok |
| 8 | **First Sale Achieved** | any sale (video or live) | TikTok |
| 9 | **Build Momentum** | 2+ videos or lives that have sold | TikTok |
| 10 | **Consistent Creator** | 5+ selling videos/lives, or sales in each of the last 3 months | TikTok |
| 11 | **Bronze** | met Consistent Creator **and** 5,000+ Ella Bella video views or $100+ GMV (below Silver) | TikTok |
| 12 | **Silver** | 20,000+ video views **or** $500+ GMV | TikTok |
| 13 | **Gold** | 100,000+ video views **or** $2,500+ GMV | TikTok |
| 14 | **Platinum** | 500,000+ video views **or** $10,000+ GMV | TikTok |

- **Removed:** First Sale (team request). Tier Up and Top Performer stay retired.
- **Views:** video views and LIVE views (via the new analytics scope); live sales already count as sales. GMV is all-time.
- **Tiers use video views only (016).** A LIVE session's views count the whole session even if Ella Bella was shown briefly, and three of the top ten creators by views were suggested Platinum on LIVE views alone with zero sales. LIVE views are still stored and shown in the drawer; live sales count through GMV as before. Total views count from 2 May 2026 (TikTok's lookback when the backfill ran).
- **Silver and above can be reached on views alone,** with no sale needed.
- **Thresholds stay in Settings** (admin), including the new views thresholds.
- **Re-place the auto-created creators once** under the new rules, but only those whose journey the team hasn't changed by hand. ~770 pending-request creators move from First Product to TT Shop Enabled.

## Views (analytics)
- **Scope** `data.shop_analytics.public.read`: granted 22 Oct 2026.
- **Endpoints:** Get Shop Video Performance List (`/analytics/202605/shop_videos/performance`) and Get Shop LIVE Performance List (`/analytics/202609/shop_lives/performance`), with `account_type=AFFILIATE_ACCOUNTS`.
- **To confirm in discovery:** whether zero-sale videos appear; history depth; whether views are per window (summed) or cumulative; LIVE coverage.

## New fields (all manual unless stated)
- **Language** – dropdown; blank = English, "Spa" = Spanish.
- **Mobile** – manual only, and **only numbers creators give us directly**. Not from TikTok order data.
- **CC Join Date** – a date; entering it sets Joined.
- **Discord handle** – text.
- **Last Engaged** – a date, from the engagement log.

## Columns and table
- **Next Action** shows the suggested next journey step (dashed, one-click accept), falling back to the free text.
- **Column picker:** each person chooses which fields show as columns (e.g. Email, TikTok Shop Eligible). It replaces the Key/All fields toggle.
- **Columns can be dragged to reorder.** Both settings are saved per person.

## Engagement
- **Not automatic:** no TikTok or Instagram API exposes our likes and comments on creators' videos. Instagram isn't connected.
- **The drawer lists each creator's Ella Bella videos,** with **Liked** and **Commented** checkboxes. Ticking logs the date. Link, date and "features Ella Bella" fill in automatically.
- **"Last Engaged" column and filter** (e.g. not engaged in 14 days).
- **Until views data is in,** the video list only holds videos that sold.

## Import of the team's sheet (phase 5b, now unblocked)
- **One row per creator, matched by TikTok handle.** TikTok wins its fields; team fields fill only when empty; journey only moves forward; preview before writing; **backup SQL before importing**.
- **Mappings from their sheet:**
  - "Next Action" ("6. Video Posted") → journey step;
  - "Status": Invited → Invited, Bronze → ignored (tiers come from data);
  - "TT Shop Enabled" (Yes / Not Yet) → informs that step;
  - "Lang" Spa → Spanish;
  - "WhatsApp" → Mobile;
  - "Join Date" → CC Join Date;
  - "Discord" → Discord handle;
  - "Product Delivered" (Yes, no date) → no date written;
  - video link columns → only where TikTok has none;
  - "Assigned To" (Megs, Cha, Bell) → owners. **Logins needed before import.**
- **Notes:** one cell holding a dated log ("12-Oct: …") is split into separate dated note entries. Duplicates are skipped.
- **Outreach columns (U–Z)** are empty and ignored. Ask the team what they're for.

## Decisions to explain to the team
- **Views-only Silver:** creators can tier on Ella Bella video views without sales.
- **LIVE views don't count towards tiers** (they cover the whole session). They stay visible in the drawer.
- **Stale TikTok values are cleared** when the data disappears (e.g. a sales line reattributed after a handle change): GMV, units, first and last sale, first video and other videos that TikTok filled earlier are emptied. Values the team entered by hand are never touched.
- **A handle change on a sales-only creator can create a duplicate** (the sales appear under the new username) until the two are merged by hand.
- **Pending sample requests** sit at TT Shop Enabled until approved.
- **Joined vs TT Shop Enabled** are kept separate (Creator Club membership vs TikTok Shop affiliate status). "TT Shop Enabled" was chosen over the team's suggested "TT Shop Status".
- **LIVE views count the whole session,** even if Ella Bella was only shown briefly.
- **Engagement is semi-automatic** (checkboxes), not automatic. Instagram isn't connected.
- **Mobile is manual,** from creators directly. TikTok Shop's terms limit order data (including sample-order phone numbers) to fulfilling orders.
- **Data location:** the US shop's data is hosted in London (Supabase eu-west-2). The TikTok terms restrict moving shop data across jurisdictions. Ella Bella to confirm. The fix, if needed, is a one-off move to a US Supabase project.
- **Creators' stages were re-placed once** under the new rules (only those the team hadn't edited).
