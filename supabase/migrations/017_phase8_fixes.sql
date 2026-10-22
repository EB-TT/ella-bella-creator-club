-- 017: four fixes found in testing Phase 8.
--
-- 1. import_creators (015) failed at runtime: every append to a text[] variable used
--    "arr || 'literal'", and an untyped literal is read as an array literal
--    (22P02 malformed array literal: "Nothing to change."). All 33 appends now use
--    pg_catalog.array_append. Also hardened: the other_products check used AND around
--    jsonb_array_length (no short-circuit guarantee), and the notes append now tolerates a
--    non-array stored value (defensive: the column is not null). The three helpers (import_parse_date,
--    import_language, import_stage) have no array appends and are unchanged.
-- 2. tiktok_lives gains product_impressions, products_sold and product_clicks, filled
--    by the sync (streams.ts) when the live_views stream is re-paged.
-- 3. A video counts only if it features at least one product (products is a non-empty
--    array). Videos without products stay stored, and are ignored by: creator_videos(),
--    the video_views / ella_bella_views totals, the Video Posted milestone and
--    auto-create (both read tiktok_activity.ella_bella_content). A video with products
--    counts even with 0 views or no sales.
-- 4. A LIVE session counts only if our product was shown or sold: product_impressions > 0,
--    or products_sold > 0, or live_attributed_gmv > 0. A null product_impressions means
--    "not fetched yet" and counts, so nothing flickers while the refetch runs; once a row
--    is refetched the real rule applies. Where it applies: creator_videos().lives, the
--    live_views / ella_bella_views totals, Video Posted and auto-create. LIVE views still
--    do not count towards tiers (016) and live SALES still count through affiliate GMV.
--
-- Functions replaced (create or replace, same signatures and grants):
--   import_creators(jsonb, boolean)  from 015
--   creator_videos(uuid)             from 014
--   tiktok_activity(uuid[])          from 014 (only the eb CTE)
--   tiktok_recompute(uuid[])         from 016 (only the vv and lv CTEs)
-- tiktok_autocreate and tiktok_derive are unchanged: they read ella_bella_content.
-- Nothing is deleted; no data is changed by this migration. Run after 016.

begin;

-- ---------------------------------------------------------------------------
-- Columns for the LIVE sessions
-- ---------------------------------------------------------------------------

alter table public.tiktok_lives
  add column if not exists product_impressions bigint,
  add column if not exists products_sold       integer,
  add column if not exists product_clicks      bigint;

-- ---------------------------------------------------------------------------
-- What counts
-- ---------------------------------------------------------------------------

-- A video counts when its products array has at least one entry.
create or replace function public.tiktok_video_has_products(p_products jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select case when pg_catalog.jsonb_typeof(p_products) = 'array'
              then pg_catalog.jsonb_array_length(p_products) > 0
              else false end
$$;

-- A LIVE session counts when our product was shown or sold. Null impressions means
-- the session has not been refetched since 017, so it counts for now.
create or replace function public.tiktok_live_counts(p_impressions bigint, p_products_sold integer, p_gmv numeric)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_impressions is null
      or p_impressions > 0
      or coalesce(p_products_sold, 0) > 0
      or coalesce(p_gmv, 0) > 0
$$;

revoke all on function public.tiktok_video_has_products(jsonb)            from public, anon, authenticated;
revoke all on function public.tiktok_live_counts(bigint, integer, numeric) from public, anon, authenticated;
grant execute on function public.tiktok_video_has_products(jsonb)            to service_role;
grant execute on function public.tiktok_live_counts(bigint, integer, numeric) to service_role;

-- ---------------------------------------------------------------------------
-- creator_videos: as in 014, plus the two filters marked "017:"
-- ---------------------------------------------------------------------------

create or replace function public.creator_videos(p_creator_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_user   text;
  v_name   text;
  v_videos jsonb;
  v_lives  jsonb;
begin
  select tc.username_normalised, tc.username
    into v_user, v_name
    from public.creators c
    join public.tiktok_creators tc on tc.id = c.tiktok_creator_id
   where c.id = p_creator_id;

  with
  a as (
    select v.video_id, v.post_time as posted, v.title,
           coalesce((select pg_catalog.jsonb_agg(public.tiktok_product_name(p ->> 'id', p ->> 'name'))
                       from pg_catalog.jsonb_array_elements(
                              case when pg_catalog.jsonb_typeof(v.products) = 'array' then v.products else '[]'::jsonb end) p
                      where nullif(pg_catalog.btrim(coalesce(p ->> 'name', p ->> 'id')), '') is not null),
                    '[]'::jsonb) as names,
           (select coalesce(sum(w.views), 0)::bigint
              from public.tiktok_video_window_views w
             where w.video_id = v.video_id) as views
    from public.tiktok_videos v
    where v_user is not null and v.username_normalised = v_user
      -- 017: only videos that feature a product
      and public.tiktok_video_has_products(v.products)
  ),
  s as (
    select l.content_id as video_id,
           pg_catalog.to_timestamp(pg_catalog.floor(l.content_id::numeric / 4294967296)) as posted,
           null::text as title,
           coalesce(pg_catalog.jsonb_agg(distinct public.tiktok_product_name(l.product_id))
                      filter (where l.product_id is not null), '[]'::jsonb) as names,
           null::bigint as views
    from public.tiktok_affiliate_lines l
    where v_user is not null
      and l.username_normalised = v_user
      and l.content_type = 'VIDEO'
      and l.content_id ~ '^[0-9]{1,19}$'
      and public.tiktok_line_is_sale(l.settlement_status, l.fully_return)
      and not exists (select 1 from a where a.video_id = l.content_id)
    group by l.content_id
  ),
  e as (
    select * from public.creator_engagements en where en.creator_id = p_creator_id
  ),
  base as (
    select 'analytics'::text as src, a.video_id, a.posted, a.title, a.names, a.views,
           'https://www.tiktok.com/@' || v_name || '/video/' || a.video_id as url,
           (select e.id from e where e.video_id = a.video_id) as eid
    from a
    union all
    select 'sales', s.video_id, s.posted, s.title, s.names, s.views,
           'https://www.tiktok.com/@' || v_name || '/video/' || s.video_id,
           (select e.id from e where e.video_id = s.video_id)
    from s
    union all
    select 'link', null, null, null, '[]'::jsonb, null, e.video_url, e.id
    from e
    where e.video_id is null
  )
  select coalesce(
           pg_catalog.jsonb_agg(
             pg_catalog.jsonb_build_object(
               'video_id',            b.video_id,
               'source',              b.src,
               'url',                 b.url,
               'posted_at',           b.posted,
               'title',               b.title,
               'products',            b.names,
               'views',               b.views,
               'engagement_id',       e2.id,
               'liked_at',            e2.liked_at,
               'commented_at',        e2.commented_at,
               'featured_ella_bella', e2.featured_ella_bella)
             order by b.posted desc nulls last, b.video_id desc nulls last),
           '[]'::jsonb)
    into v_videos
    from base b
    left join e e2 on e2.id = b.eid;

  select coalesce(
           pg_catalog.jsonb_agg(
             pg_catalog.jsonb_build_object(
               'live_id',    l.live_id,
               'start_time', l.start_time,
               'end_time',   l.end_time,
               'views',      l.views,
               'viewers',    l.viewers)
             order by l.start_time desc nulls last, l.live_id desc),
           '[]'::jsonb)
    into v_lives
    from public.tiktok_lives l
   where v_user is not null and l.username_normalised = v_user
     -- 017: only sessions where our product was shown or sold
     and public.tiktok_live_counts(l.product_impressions, l.products_sold, l.live_attributed_gmv);

  return pg_catalog.jsonb_build_object('videos', v_videos, 'lives', v_lives);
end;
$$;

revoke all on function public.creator_videos(uuid) from public, anon;
grant execute on function public.creator_videos(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- tiktok_activity: as in 014; only the eb CTE changes ("017:").
-- ---------------------------------------------------------------------------

create or replace function public.tiktok_activity(p_tc_ids uuid[] default null)
returns table (
  tiktok_creator_id      uuid,
  has_sale               boolean,
  has_video_sale         boolean,
  approved_n             integer,
  pending_n              integer,
  cancelled_n            integer,
  collab_accepted        boolean,
  collab_posted          boolean,
  milestone              public.creator_stage,
  request_cancelled_only boolean,
  selling_content        integer,
  consistent_by_content  boolean,
  rule_months            integer,
  -- 014: has any analytics video or LIVE
  ella_bella_content     boolean,
  -- 014: Consistent Creator criteria met (by content or by months)
  consistent_met         boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  with cfg as (
    select coalesce(case when (q.r #>> '{build_momentum,min_content}') ~ '^[0-9]{1,6}$'
                         then (q.r #>> '{build_momentum,min_content}')::integer end, 2) as bm_min,
           coalesce(case when (q.r #>> '{consistent_creator,min_content}') ~ '^[0-9]{1,6}$'
                         then (q.r #>> '{consistent_creator,min_content}')::integer end, 5) as cc_min,
           coalesce(case when (q.r #>> '{consistent_creator,months}') ~ '^[0-9]{1,2}$'
                         then (q.r #>> '{consistent_creator,months}')::integer end, 3) as cc_months
    from (select (select s.stage_rules from public.tiktok_settings s where s.id) as r) q
  ),
  base as (
    select tc.id, tc.username_normalised as u, tc.open_id
    from public.tiktok_creators tc
    where p_tc_ids is null or tc.id = any (p_tc_ids)
  ),
  sl as (
    select b.id, l.content_type, l.content_id, l.create_time,
           public.tiktok_line_is_sale(l.settlement_status, l.fully_return) as is_sale
    from base b
    join public.tiktok_affiliate_lines l on l.username_normalised = b.u
  ),
  ls as (
    select sl.id,
           bool_or(sl.is_sale) as has_sale,
           bool_or(sl.is_sale and sl.content_type = 'VIDEO') as has_video_sale,
           (count(distinct sl.content_id) filter (
              where sl.is_sale and sl.content_type in ('VIDEO', 'LIVE')
                and pg_catalog.btrim(sl.content_id) <> ''))::integer as selling_content,
           (count(distinct pg_catalog.date_trunc('month', sl.create_time at time zone 'UTC')) filter (
              where sl.is_sale
                and pg_catalog.date_trunc('month', sl.create_time at time zone 'UTC')
                    >= pg_catalog.date_trunc('month', pg_catalog.now() at time zone 'UTC')
                       - pg_catalog.make_interval(months => cfg.cc_months - 1)))::integer as recent_months
    from sl cross join cfg
    group by sl.id
  ),
  sids as (
    select b.id, s.id as sid
    from base b join public.tiktok_samples s on s.username_normalised = b.u
    union
    select b.id, s.id
    from base b join public.tiktok_samples s on s.creator_open_id = b.open_id
    where b.open_id is not null
  ),
  ss as (
    select sids.id,
           (count(*) filter (where public.tiktok_sample_is_approved(s.status)))::integer as approved_n,
           (count(*) filter (where s.status = 'PENDING'))::integer as pending_n,
           (count(*) filter (where public.tiktok_sample_is_unshipped_cancel(s.status)))::integer as cancelled_n,
           max(public.tiktok_sample_stage(s.status)) as sample_stage
    from sids join public.tiktok_samples s on s.id = sids.sid
    group by sids.id
  ),
  co as (
    select b.id,
           bool_or(coalesce(k.showcase_product_count, 0) > 0) as accepted,
           bool_or(coalesce(k.content_product_count, 0) > 0)  as posted
    from base b
    join public.tiktok_target_collab_creators k on k.username_normalised = b.u
    group by b.id
  ),
  -- 014: Ella Bella videos / LIVEs from the analytics sync
  -- 017: a video counts only if it features a product; a LIVE session only if our
  -- product was shown or sold (null impressions = not fetched yet = counts)
  eb as (
    select b.id
    from base b
    where exists (select 1 from public.tiktok_videos v
                   where v.username_normalised = b.u
                     and public.tiktok_video_has_products(v.products))
       or exists (select 1 from public.tiktok_lives l
                   where l.username_normalised = b.u
                     and public.tiktok_live_counts(l.product_impressions, l.products_sold, l.live_attributed_gmv))
  ),
  x as (
    select b.id,
           coalesce(ls.has_sale, false)        as has_sale,
           coalesce(ls.has_video_sale, false)  as has_video_sale,
           coalesce(ss.approved_n, 0)          as approved_n,
           coalesce(ss.pending_n, 0)           as pending_n,
           coalesce(ss.cancelled_n, 0)         as cancelled_n,
           coalesce(co.accepted, false)        as collab_accepted,
           coalesce(co.posted, false)          as collab_posted,
           ss.sample_stage,
           coalesce(ls.selling_content, 0)     as selling_content,
           coalesce(ls.recent_months, 0)       as recent_months,
           (eb.id is not null)                 as ella_content
    from base b
    left join ls on ls.id = b.id
    left join ss on ss.id = b.id
    left join co on co.id = b.id
    left join eb on eb.id = b.id
  )
  select x.id, x.has_sale, x.has_video_sale, x.approved_n, x.pending_n, x.cancelled_n,
         x.collab_accepted, x.collab_posted,
         greatest(
           -- 014: every TikTok creator is at least TT Shop Enabled (a sample
           -- application of any status, an accepted collab invite, a sale, or
           -- any other linked TikTok data). Replaces the old "Accepted" rule.
           'TT Shop Enabled'::public.creator_stage,
           x.sample_stage,
           -- 014: plus an Ella Bella video or LIVE
           case when x.has_video_sale or x.collab_posted or x.ella_content then 'Video Posted'::public.creator_stage end,
           case when x.has_sale then 'First Sale Achieved'::public.creator_stage end,
           case when x.selling_content >= cfg.bm_min then 'Build Momentum'::public.creator_stage end,
           case when x.selling_content >= cfg.cc_min or x.recent_months >= cfg.cc_months
                then 'Consistent Creator'::public.creator_stage end
         ),
         (not x.has_sale and x.approved_n = 0 and x.pending_n = 0
            and not x.collab_accepted and x.cancelled_n > 0),
         x.selling_content,
         (x.selling_content >= cfg.cc_min),
         cfg.cc_months,
         x.ella_content,
         (x.selling_content >= cfg.cc_min or x.recent_months >= cfg.cc_months)
  from x cross join cfg
$$;

revoke all on function public.tiktok_activity(uuid[]) from public, anon, authenticated;
grant execute on function public.tiktok_activity(uuid[]) to service_role;

-- ---------------------------------------------------------------------------
-- tiktok_recompute: as in 016; only the vv and lv CTEs change ("017:").
-- ---------------------------------------------------------------------------

create or replace function public.tiktok_recompute(p_ids uuid[])
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_prev        text := coalesce(pg_catalog.current_setting('app.tiktok_sync', true), '');
  v_auto_stage  boolean := false;
  v_auto_tier   boolean := false;
  v_bands       jsonb;
  v_has_bands   boolean;
  v_basis       text;
  v_n           integer := 0;
begin
  if p_ids is null or pg_catalog.cardinality(p_ids) = 0 then
    return 0;
  end if;

  perform pg_catalog.set_config('app.tiktok_sync', 'on', true);

  select s.auto_apply_stage, s.auto_apply_tier, s.tier_bands
    into v_auto_stage, v_auto_tier, v_bands
    from public.tiktok_settings s
   where s.id;
  v_auto_stage := coalesce(v_auto_stage, false);
  v_auto_tier  := coalesce(v_auto_tier, false);
  v_has_bands  := pg_catalog.jsonb_typeof(v_bands -> 'bands') = 'array'
                  and pg_catalog.jsonb_array_length(v_bands -> 'bands') > 0;
  v_basis := coalesce(v_bands ->> 'basis', 'all_time');
  if v_basis not in ('all_time', 'last_30_days', 'last_90_days') then
    v_basis := 'all_time';
  end if;

  with
  t as (
    select c.id as cid, c.stage as cur_stage, c.creator_tier as cur_tier,
           c.current_product, c.current_product_manual_at as manual_at,
           c.suggestion_dismissed_stage as dismissed_stage,
           c.suggestion_dismissed_tier as dismissed_tier,
           c.other_products_received as opr_old,
           tc.id as tcid, tc.username, tc.username_normalised as u, tc.open_id
    from public.creators c
    join public.tiktok_creators tc on tc.id = c.tiktok_creator_id
    where c.id = any (p_ids)
  ),

  -- Affiliate lines ---------------------------------------------------------
  lns as (
    select t.cid, l.product_id, l.quantity, l.create_time, l.content_type, l.content_id,
           public.tiktok_line_gmv(l.settlement_status, l.actual_commission_base,
                                  l.estimated_commission_base, l.fully_return) as gmv,
           public.tiktok_line_is_sale(l.settlement_status, l.fully_return) as is_sale
    from t
    join public.tiktok_affiliate_lines l on l.username_normalised = t.u
  ),
  la as (
    select cid,
           count(*) as n,
           sum(gmv) as gmv,
           sum(gmv) filter (where create_time >= pg_catalog.now() - interval '30 days') as g30,
           sum(gmv) filter (where create_time >= pg_catalog.now() - interval '90 days') as g90,
           min(create_time) filter (where is_sale) as first_sale,
           max(create_time) filter (where is_sale) as last_sale,
           coalesce(sum(quantity) filter (where is_sale), 0) as units
    from lns
    group by cid
  ),
  lp as (
    select cid, product_id, sum(quantity) filter (where is_sale) as units
    from lns
    group by cid, product_id
  ),

  -- Videos: post time is decoded from the video ID (top 32 bits = unix seconds)
  vid as (
    select cid, content_id, product_id,
           pg_catalog.to_timestamp(pg_catalog.floor(content_id::numeric / 4294967296)) as posted
    from lns
    where content_type = 'VIDEO' and content_id ~ '^[0-9]{1,19}$'
  ),
  fv as (
    select distinct on (cid) cid, content_id, product_id, posted
    from vid
    order by cid, posted, content_id, product_id
  ),
  -- Products the First Video sold. They, and the First Video itself, are left out
  -- of Other Videos.
  fvp as (
    select distinct v.cid, v.product_id
    from vid v
    join fv f on f.cid = v.cid and f.content_id = v.content_id
  ),
  -- Per product, the earliest-posted video that sold it
  ov as (
    select distinct on (v.cid, v.product_id)
           v.cid, v.product_id, v.content_id, v.posted,
           public.tiktok_product_name(v.product_id) as pname
    from vid v
    join fv f on f.cid = v.cid
    where v.product_id is not null
      and v.content_id is distinct from f.content_id
      and not exists (select 1 from fvp where fvp.cid = v.cid and fvp.product_id = v.product_id)
    order by v.cid, v.product_id, v.posted, v.content_id
  ),
  -- Then one entry per video, listing the products it was first to sell
  ovv as (
    select ov.cid, ov.content_id, ov.posted,
           jsonb_agg(jsonb_build_object('product_id', ov.product_id, 'product', ov.pname)
                     order by ov.pname, ov.product_id) as products,
           string_agg(ov.pname, ', ' order by ov.pname, ov.product_id) as product
    from ov
    group by ov.cid, ov.content_id, ov.posted
  ),
  ova as (
    select ovv.cid,
           jsonb_agg(
             jsonb_build_object(
               'url',        'https://www.tiktok.com/@' || t.username || '/video/' || ovv.content_id,
               'date',       pg_catalog.to_char(ovv.posted at time zone 'UTC', 'YYYY-MM-DD'),
               'content_id', ovv.content_id,
               'products',   ovv.products,
               'product',    ovv.product
             )
             order by ovv.posted desc, ovv.content_id desc
           ) as list
    from ovv join t on t.cid = ovv.cid
    group by ovv.cid
  ),

  -- Samples -----------------------------------------------------------------
  sids as (
    select t.cid, s.id as sid
    from t join public.tiktok_samples s on s.username_normalised = t.u
    union
    select t.cid, s.id
    from t join public.tiktok_samples s on s.creator_open_id = t.open_id
    where t.open_id is not null
  ),
  ap as (
    select sids.cid, s.id, s.product_id, s.product_title,
           coalesce(s.requested_at, s.first_seen_at) as sd,
           s.shipped_at, s.collected_at, s.delivered_at
    from sids
    join public.tiktok_samples s on s.id = sids.sid
    where public.tiktok_sample_is_approved(s.status)
  ),
  cur as (
    select distinct on (cid) *
    from ap
    order by cid, sd desc, id desc
  ),
  cd0 as (
    select t.cid, t.current_product, t.manual_at,
           cur.id as sample_id, cur.product_id, cur.sd,
           public.tiktok_product_name(cur.product_id, cur.product_title) as pname,
           cur.shipped_at, cur.collected_at, cur.delivered_at
    from t left join cur on cur.cid = t.cid
  ),
  -- Current Product comes from TikTok unless a manual entry is newer than the sample
  cd1 as (
    select cd0.*,
           (cd0.sample_id is not null and cd0.pname is not null
            and not (cd0.manual_at is not null and cd0.manual_at > cd0.sd)) as tk_current
    from cd0
  ),
  cd as (
    select cd1.*,
           case when cd1.tk_current then cd1.pname else cd1.current_product end as eff_name
    from cd1
  ),
  opr_src as (
    select ap.cid, ap.id, ap.sd,
           public.tiktok_product_name(ap.product_id, ap.product_title) as nm,
           (coalesce(ap.delivered_at, ap.shipped_at, ap.sd) at time zone 'UTC')::date as dt,
           cd.tk_current, cd.sample_id as cur_id, cd.eff_name
    from ap join cd on cd.cid = ap.cid
  ),
  opr as (
    select distinct on (cid, pg_catalog.lower(pg_catalog.btrim(nm))) cid, nm, dt, sd
    from opr_src
    where nm is not null
      and not (tk_current and id = cur_id)
      and pg_catalog.lower(pg_catalog.btrim(nm))
          is distinct from pg_catalog.lower(pg_catalog.btrim(coalesce(eff_name, '')))
    order by cid, pg_catalog.lower(pg_catalog.btrim(nm)), dt desc, sd desc
  ),
  opa as (
    select cid,
           jsonb_agg(
             jsonb_build_object('product', nm, 'date_received', dt, 'source', 'tiktok')
             order by dt desc, sd desc
           ) as list
    from opr
    group by cid
  ),

  act as (
    select * from public.tiktok_activity(coalesce((select pg_catalog.array_agg(tcid) from t), '{}'::uuid[]))
  ),

  -- 014: each band has min_gmv and min_views (either may be absent)
  bands as (
    select b.tier, b.min_gmv, b.min_views, public.tiktok_tier_rank(b.tier) as rnk
    from (
      select e ->> 'tier' as tier,
             case when (e ->> 'min_gmv') ~ '^-?[0-9]+(\.[0-9]+)?$' then (e ->> 'min_gmv')::numeric end as min_gmv,
             case when (e ->> 'min_views') ~ '^[0-9]+$' then (e ->> 'min_views')::numeric end as min_views
      from jsonb_array_elements(
             case when pg_catalog.jsonb_typeof(v_bands -> 'bands') = 'array' then v_bands -> 'bands' else '[]'::jsonb end
           ) e
    ) b
    where b.tier in ('Bronze', 'Silver', 'Gold', 'Platinum')
      and (b.min_gmv is not null or b.min_views is not null)
  ),

  -- 014: views from the analytics sync (videos: sum over non-overlapping windows)
  -- 017: only videos with a product, and only LIVE sessions where our product was
  -- shown or sold. A creator who has analytics rows but none that count gets 0 (not
  -- null), so a total that earlier included non-counting rows is corrected.
  vv as (
    select t.cid,
           coalesce(sum(w.views) filter (where public.tiktok_video_has_products(tv.products)), 0)::bigint as v
    from t
    join public.tiktok_videos tv on tv.username_normalised = t.u
    left join public.tiktok_video_window_views w on w.video_id = tv.video_id
    group by t.cid
  ),
  lv as (
    select t.cid,
           coalesce(sum(l.views) filter (
                      where public.tiktok_live_counts(l.product_impressions, l.products_sold, l.live_attributed_gmv)), 0)::bigint as v
    from t
    join public.tiktok_lives l on l.username_normalised = t.u
    group by t.cid
  ),

  x as (
    select
      t.cid, t.cur_stage, t.cur_tier, t.dismissed_stage, t.dismissed_tier,
      la.n, la.gmv, la.first_sale, la.last_sale, la.units,
      case v_basis when 'last_30_days' then coalesce(la.g30, 0)
                   when 'last_90_days' then coalesce(la.g90, 0)
                   else coalesce(la.gmv, 0) end as tier_gmv,
      fv.posted as fv_posted, fv.content_id as fv_content_id,
      case when fv.cid is not null then coalesce(ova.list, '[]'::jsonb) end as other_videos,
      t.username,
      cd.tk_current, cd.eff_name, cd.pname,
      case when cd.tk_current and cd.product_id is not null
           then coalesce((select lp.units from lp where lp.cid = cd.cid and lp.product_id = cd.product_id), 0)
      end as cur_units,
      case when cd.tk_current then (coalesce(cd.shipped_at, cd.collected_at) at time zone 'UTC')::date end as sent_date,
      case when cd.tk_current then (cd.delivered_at at time zone 'UTC')::date end as delivered_date,
      case when cd.sample_id is not null then
        coalesce((select jsonb_agg(e)
                    from jsonb_array_elements(
                           case when pg_catalog.jsonb_typeof(t.opr_old) = 'array' then t.opr_old else '[]'::jsonb end
                         ) e
                   where e ->> 'source' is distinct from 'tiktok'), '[]'::jsonb)
        || coalesce(opa.list, '[]'::jsonb)
      end as opr_new,
      act.has_sale, act.has_video_sale, act.collab_posted, act.milestone, act.request_cancelled_only,
      -- 012: for the Build Momentum / Consistent Creator reasons
      act.selling_content, act.consistent_by_content, act.rule_months,
      -- 014: views, and whether Consistent Creator criteria are met
      vv.v as video_views_n, lv.v as live_views_n,
      case when vv.v is null and lv.v is null then null
           else coalesce(vv.v, 0) + coalesce(lv.v, 0) end as eb_views,
      act.ella_bella_content, act.consistent_met,
      -- 016: highest tier reached by GMV or by Ella Bella VIDEO views (LIVE views are
      -- stored but never count: a LIVE session's views cover the whole session, not
      -- just the time Ella Bella was shown). Bronze also needs the Consistent Creator
      -- criteria; Silver and above do not depend on stage.
      case when v_has_bands then
        (select b.tier from bands b
          where ((b.min_gmv is not null
                  and b.min_gmv <= (case v_basis when 'last_30_days' then coalesce(la.g30, 0)
                                                 when 'last_90_days' then coalesce(la.g90, 0)
                                                 else coalesce(la.gmv, 0) end))
              or (b.min_views is not null
                  and b.min_views <= coalesce(vv.v, 0)))
            and (b.tier <> 'Bronze' or coalesce(act.consistent_met, false))
          order by b.rnk desc limit 1)
      end as tier_cand
    from t
    left join la  on la.cid  = t.cid
    left join vv  on vv.cid  = t.cid
    left join lv  on lv.cid  = t.cid
    left join fv  on fv.cid  = t.cid
    left join ova on ova.cid = t.cid
    left join cd  on cd.cid  = t.cid
    left join opa on opa.cid = t.cid
    left join act on act.tiktok_creator_id = t.tcid
  ),

  y as (
    select x.*,
           (x.milestone is not null and x.milestone > x.cur_stage) as stage_later,
           (x.tier_cand is not null
            and public.tiktok_tier_rank(x.tier_cand) > public.tiktok_tier_rank(x.cur_tier)) as tier_later,
           -- 014: true when the winning tier is reached by GMV (else by views)
           coalesce((select b.min_gmv is not null and b.min_gmv <= x.tier_gmv
                       from bands b where b.tier = x.tier_cand), false) as tier_by_gmv
    from x
  ),

  z as (
    select y.*,
           (y.stage_later and not v_auto_stage and y.milestone::text is distinct from y.dismissed_stage) as stage_sugg,
           (y.tier_later and not v_auto_tier and y.tier_cand is distinct from y.dismissed_tier) as tier_sugg,
           case y.milestone::text
             -- 012: the two later stages
             when 'Consistent Creator' then
               case when y.consistent_by_content
                    then y.selling_content::text || ' videos or lives have sold'
                    else 'Sales in each of the last ' || y.rule_months::text || ' months' end
             when 'Build Momentum' then
               y.selling_content::text || ' videos or lives have sold'
             when 'First Sale Achieved' then
               'First sale on ' || pg_catalog.to_char(y.first_sale at time zone 'UTC', 'YYYY-MM-DD')
             when 'Video Posted' then
               case when y.has_video_sale then 'A sale came from a video'
                    when y.collab_posted  then 'Target collab content posted'
                    when y.ella_bella_content then 'Ella Bella video or live posted'
                    else 'Sample completed' end
             when 'First Video' then 'Sample content pending'
             when 'Product Sent' then 'Sample shipped'
             when 'First Product' then 'Sample approved'
             when 'TT Shop Enabled' then 'TikTok Shop activity found'
           end as stage_reason,
           -- 016: names the measure that reached the tier:
           -- "All-time GMV $612 reaches Silver" or "Ella Bella video views 23,410 reach Silver"
           case when y.tier_by_gmv then
             case v_basis when 'last_30_days' then 'Last 30 days GMV $'
                          when 'last_90_days' then 'Last 90 days GMV $'
                          else 'All-time GMV $' end
               || pg_catalog.to_char(pg_catalog.round(y.tier_gmv), 'FM999,999,999,990')
               || ' reaches ' || y.tier_cand
           else
             'Ella Bella video views ' || pg_catalog.to_char(coalesce(y.video_views_n, 0), 'FM999,999,999,990')
               || ' reach ' || y.tier_cand
           end as tier_reason
    from y
  )
  update public.creators c set
    -- 016: a value TikTok filled before (key in the old synced_fields) is cleared when
    -- TikTok has no data for it now; a value never synced is left alone (coalesce).
    -- c.synced_fields here is the value from before this update.
    gmv                         = coalesce(z.gmv, case when c.synced_fields ->> 'gmv' = 'true' then 0 else c.gmv end),
    first_sale_date             = coalesce((z.first_sale at time zone 'UTC')::date,
                                           case when c.synced_fields ->> 'first_sale_date' = 'true' then null else c.first_sale_date end),
    last_sale_at                = coalesce(z.last_sale,
                                           case when c.synced_fields ->> 'last_sale_at' = 'true' then null else c.last_sale_at end),
    units_sold_total            = coalesce(z.units, case when c.synced_fields ->> 'units_sold_total' = 'true' then 0 else c.units_sold_total end),
    first_video_date            = coalesce((z.fv_posted at time zone 'UTC')::date,
                                           case when c.synced_fields ->> 'first_video_date' = 'true' then null else c.first_video_date end),
    first_video_link            = coalesce(
                                    case when z.fv_content_id is not null
                                         then 'https://www.tiktok.com/@' || z.username || '/video/' || z.fv_content_id end,
                                    case when c.synced_fields ->> 'first_video_link' = 'true' then null else c.first_video_link end),
    other_videos                = coalesce(z.other_videos,
                                           case when c.synced_fields ->> 'other_videos' = 'true' then null else c.other_videos end),
    current_product             = case when z.tk_current then z.pname else c.current_product end,
    units_sold_current_product  = coalesce(z.cur_units, c.units_sold_current_product),
    other_products_received     = coalesce(z.opr_new, c.other_products_received),
    -- Follow the current TikTok sample, nulls included; manual Current Product leaves both alone.
    product_sent_date           = case when z.tk_current then z.sent_date else c.product_sent_date end,
    product_delivery_date       = case when z.tk_current then z.delivered_date else c.product_delivery_date end,
    tiktok_shop_eligible        = true,
    -- 014: view totals (null while the creator has no analytics rows)
    video_views                 = coalesce(z.video_views_n, c.video_views),
    live_views                  = coalesce(z.live_views_n, c.live_views),
    ella_bella_views            = coalesce(z.eb_views, c.ella_bella_views),
    tiktok_request_cancelled_only = coalesce(z.request_cancelled_only, false),
    synced_fields = (
      select coalesce(jsonb_object_agg(f.k, true), '{}'::jsonb)
      from (values
        ('gmv',                        z.gmv is not null),
        ('first_sale_date',            z.first_sale is not null),
        ('last_sale_at',               z.last_sale is not null),
        ('units_sold_total',           z.units is not null),
        ('first_video_date',           z.fv_posted is not null),
        ('first_video_link',           z.fv_content_id is not null),
        ('other_videos',               z.other_videos is not null),
        ('current_product',            coalesce(z.tk_current, false)),
        ('units_sold_current_product', z.cur_units is not null),
        ('other_products_received',    z.opr_new is not null),
        ('product_sent_date',          coalesce(z.tk_current, false)),
        ('product_delivery_date',      coalesce(z.tk_current, false)),
        ('tiktok_shop_eligible',       true),
        ('video_views',                z.video_views_n is not null),
        ('live_views',                 z.live_views_n is not null),
        ('ella_bella_views',           z.eb_views is not null)
      ) as f(k, ok)
      where f.ok
    ),
    stage            = case when z.stage_later and v_auto_stage then z.milestone else c.stage end,
    suggested_stage  = case when z.stage_sugg then z.milestone::text end,
    creator_tier     = case when z.tier_later and v_auto_tier then z.tier_cand else c.creator_tier end,
    -- With no bands set there is nothing valid to suggest, so a stale suggestion is cleared.
    suggested_tier   = case when z.tier_sugg then z.tier_cand end,
    suggestion_reason = nullif(
                          concat_ws(' · ',
                                    case when z.stage_sugg then z.stage_reason end,
                                    case when z.tier_sugg  then z.tier_reason  end),
                          ''),
    tiktok_synced_at = pg_catalog.now()
  from z
  where c.id = z.cid;

  get diagnostics v_n = row_count;

  perform pg_catalog.set_config('app.tiktok_sync', v_prev, true);
  return v_n;
end;
$$;

revoke all on function public.tiktok_recompute(uuid[]) from public, anon, authenticated;
grant execute on function public.tiktok_recompute(uuid[]) to service_role;

-- ---------------------------------------------------------------------------
-- import_creators: as in 015, every text[] append through array_append (fix 1)
-- ---------------------------------------------------------------------------

create or replace function public.import_creators(p_rows jsonb, p_dry_run boolean default true)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  c            public.creators%rowtype;
  r            jsonb;
  n            jsonb;
  el           jsonb;
  v_ord        integer;
  k            text;
  sv           text;
  ev           text;
  v_importer   text;
  v_author     text;
  v_now_iso    text;

  -- per row
  v_row_id     jsonb;
  v_handle     text;
  v_norm       text;
  v_action     text;
  v_found      boolean;
  v_filled     text[];
  v_skipped    jsonb;
  v_msgs       text[];
  v_fill       jsonb;
  v_lang       text;
  v_lang_new   text;
  v_join       date;
  v_join_new   date;
  v_follow     date;
  v_follow_new date;
  v_owner_raw  text;
  v_owner_cnt  integer;
  v_owner_id   uuid;
  v_owner_new  uuid;
  v_cand       public.creator_stage;
  v_stage_new  public.creator_stage;
  v_stage_cur  public.creator_stage;
  v_label      text;
  v_ok         boolean;
  v_prod_new   text;
  v_video_new  text;
  v_opr        jsonb;
  v_opr_names  text[];
  v_opr_new    jsonb;
  v_name       text;
  v_exist      text[];
  v_notes_new  jsonb;
  v_text       text;
  v_date       date;
  v_has_date   boolean;
  v_synced     boolean;
  v_extra      text;

  -- totals
  s_total      integer := 0;
  s_matched    integer := 0;
  s_created    integer := 0;
  s_nohandle   integer := 0;
  s_dup        integer := 0;
  s_removed    integer := 0;
  s_filled     integer := 0;
  s_already    integer := 0;
  s_tiktok     integer := 0;
  s_moved      integer := 0;
  s_notlater   integer := 0;
  s_notes      integer := 0;
  s_notes_dup  integer := 0;
  s_invalid    integer := 0;
  s_owner_rows integer := 0;
  s_owner_names text[] := '{}';
  v_seen       jsonb := '{}'::jsonb;
  v_rows       jsonb := '[]'::jsonb;
begin
  if p_rows is null or pg_catalog.jsonb_typeof(p_rows) <> 'array' then
    raise exception 'p_rows must be a JSON array of rows.';
  end if;
  if pg_catalog.jsonb_array_length(p_rows) > 5000 then
    raise exception 'Too many rows in one call (limit 5000).';
  end if;

  select p.name into v_importer from public.profiles p where p.id = auth.uid();
  v_author  := 'Import · ' || coalesce(nullif(pg_catalog.btrim(v_importer), ''), 'unknown');
  v_now_iso := pg_catalog.to_char(pg_catalog.now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');

  for r, v_ord in
    select e.value, e.ordinality::integer
      from pg_catalog.jsonb_array_elements(p_rows) with ordinality as e(value, ordinality)
  loop
    s_total   := s_total + 1;
    v_row_id  := coalesce(r -> 'row', pg_catalog.to_jsonb(v_ord));
    v_filled  := '{}';
    v_skipped := '[]'::jsonb;
    v_msgs    := '{}';
    v_fill    := '{}'::jsonb;
    v_action  := null;
    v_found   := false;

    if pg_catalog.jsonb_typeof(r) <> 'object' then
      r := '{}'::jsonb;
    end if;

    -- ---- The handle, and which kind of row this is ------------------------
    v_handle := nullif(pg_catalog.btrim(r ->> 'tiktok_handle'), '');
    if v_handle is not null then
      v_handle := coalesce((pg_catalog.regexp_match(v_handle, 'tiktok\.com/@+([^/?#\s]+)', 'i'))[1], v_handle);
      v_handle := nullif(pg_catalog.regexp_replace(pg_catalog.regexp_replace(v_handle, '[?#/].*$', ''), '^@+', ''), '');
    end if;
    v_norm := public.normalise_tiktok_handle(v_handle);

    if v_norm is null then
      v_action := 'skip';
      v_msgs := pg_catalog.array_append(v_msgs, 'No TikTok handle.'::text);
      s_nohandle := s_nohandle + 1;
    elsif v_seen ? v_norm then
      v_action := 'skip';
      v_msgs := pg_catalog.array_append(v_msgs, ('Same handle as row ' || (v_seen ->> v_norm) || '; the first one is used.'));
      s_dup := s_dup + 1;
    else
      v_seen := v_seen || pg_catalog.jsonb_build_object(v_norm, v_row_id);
      select * into c
        from public.creators x
       where x.handle_normalised = v_norm and x.status = 'active';
      v_found := found;
      if v_found then
        v_action := 'update';
      elsif exists (select 1 from public.creators x where x.handle_normalised = v_norm and x.status = 'removed') then
        v_action := 'skip';
        v_msgs := pg_catalog.array_append(v_msgs, 'This handle belongs to a removed creator. Restore them first.'::text);
        s_removed := s_removed + 1;
      else
        v_action := 'create';
      end if;
    end if;

    if v_action = 'skip' then
      v_rows := v_rows || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
        'row', v_row_id, 'handle', v_handle, 'action', 'skip',
        'filled', '[]'::jsonb, 'skipped', '[]'::jsonb, 'messages', pg_catalog.to_jsonb(v_msgs)));
      continue;
    end if;

    -- ---- Read and check the values ---------------------------------------
    v_lang := public.import_language(r ->> 'language');
    if v_lang = '?' then
      v_msgs := pg_catalog.array_append(v_msgs, ('Language "' || pg_catalog.btrim(r ->> 'language') || '" not recognised.'));
      s_invalid := s_invalid + 1;
      v_lang := null;
    end if;

    v_join := public.import_parse_date(r ->> 'cc_join_date');
    if v_join is null and nullif(pg_catalog.btrim(r ->> 'cc_join_date'), '') is not null then
      v_msgs := pg_catalog.array_append(v_msgs, ('CC Join Date "' || pg_catalog.btrim(r ->> 'cc_join_date') || '" is not a date.'));
      s_invalid := s_invalid + 1;
    end if;

    v_follow := public.import_parse_date(r ->> 'next_follow_up_date');
    if v_follow is null and nullif(pg_catalog.btrim(r ->> 'next_follow_up_date'), '') is not null then
      v_msgs := pg_catalog.array_append(v_msgs, ('Follow-up date "' || pg_catalog.btrim(r ->> 'next_follow_up_date') || '" is not a date.'));
      s_invalid := s_invalid + 1;
    end if;

    select s.label, s.ok into v_label, v_ok from public.import_stage(r ->> 'stage_candidate') s;
    v_cand := null;
    if not v_ok then
      v_msgs := pg_catalog.array_append(v_msgs, ('Stage "' || pg_catalog.btrim(r ->> 'stage_candidate') || '" not recognised.'));
      s_invalid := s_invalid + 1;
    elsif v_label is not null then
      v_cand := v_label::public.creator_stage;
    end if;

    v_owner_raw := nullif(pg_catalog.btrim(r ->> 'owner_name'), '');
    v_owner_id  := null;
    if v_owner_raw is not null then
      select pg_catalog.count(*)::integer, (pg_catalog.min(p.id::text))::uuid
        into v_owner_cnt, v_owner_id
        from public.profiles p
       where pg_catalog.lower(pg_catalog.btrim(pg_catalog.regexp_replace(p.name, '\s+', ' ', 'g')))
           = pg_catalog.lower(pg_catalog.btrim(pg_catalog.regexp_replace(v_owner_raw, '\s+', ' ', 'g')));
      if v_owner_cnt <> 1 then
        v_owner_id := null;
        s_owner_rows := s_owner_rows + 1;
        s_owner_names := pg_catalog.array_append(s_owner_names, v_owner_raw);
        v_msgs := pg_catalog.array_append(v_msgs, (case when v_owner_cnt = 0
                                  then 'No team member named "' || v_owner_raw || '" yet; owner left blank.'
                                  else 'More than one team member is named "' || v_owner_raw || '"; owner left blank.' end));
      end if;
    end if;

    -- ---- Notes (same for update and create) ------------------------------
    v_notes_new := '[]'::jsonb;
    if v_action = 'update' then
      select coalesce(pg_catalog.array_agg(pg_catalog.lower(pg_catalog.btrim(e ->> 'text'))), '{}')
        into v_exist
        from pg_catalog.jsonb_array_elements(
               case when pg_catalog.jsonb_typeof(c.notes) = 'array' then c.notes else '[]'::jsonb end) e;
    else
      v_exist := '{}';
    end if;

    v_extra := nullif(pg_catalog.btrim(r ->> 'extra_note'), '');
    for n in
      select x from pg_catalog.jsonb_array_elements(
                      case when pg_catalog.jsonb_typeof(r -> 'notes') = 'array' then r -> 'notes' else '[]'::jsonb end) x
      union all
      select pg_catalog.jsonb_build_object('date', null::text, 'text', v_extra) where v_extra is not null
    loop
      v_text := nullif(pg_catalog.btrim(n ->> 'text'), '');
      continue when v_text is null;
      if pg_catalog.lower(v_text) = any (v_exist) then
        s_notes_dup := s_notes_dup + 1;
        continue;
      end if;
      v_exist    := pg_catalog.array_append(v_exist, pg_catalog.lower(v_text));
      v_has_date := nullif(pg_catalog.btrim(n ->> 'date'), '') is not null;
      v_date     := public.import_parse_date(n ->> 'date');
      if v_has_date and v_date is null then
        v_msgs := pg_catalog.array_append(v_msgs, ('Note date "' || pg_catalog.btrim(n ->> 'date') || '" is not a date; dated now.'));
        s_invalid := s_invalid + 1;
      end if;
      v_notes_new := v_notes_new || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
        'author', v_author,
        'timestamp', case when v_date is not null
                          then pg_catalog.to_char(v_date, 'YYYY-MM-DD') || 'T12:00:00.000Z'
                          else v_now_iso end,
        'text', v_text));
      s_notes := s_notes + 1;
    end loop;

    -- ---- Other products (manual entries, no TikTok source) ---------------
    v_opr_new := null;
    -- 017: a CASE, not AND, so jsonb_array_length never sees a non-array
    if (case when pg_catalog.jsonb_typeof(r -> 'other_products') = 'array'
             then pg_catalog.jsonb_array_length(r -> 'other_products') > 0 else false end) then
      v_opr := case when v_action = 'update' and pg_catalog.jsonb_typeof(c.other_products_received) = 'array'
                    then c.other_products_received else '[]'::jsonb end;
      select coalesce(pg_catalog.array_agg(pg_catalog.lower(pg_catalog.btrim(e ->> 'product'))), '{}')
        into v_opr_names
        from pg_catalog.jsonb_array_elements(v_opr) e;
      v_opr_new := v_opr;
      for el in select x from pg_catalog.jsonb_array_elements(r -> 'other_products') x loop
        v_text := nullif(pg_catalog.btrim(
                    case when pg_catalog.jsonb_typeof(el) = 'object' then el ->> 'product' else el #>> '{}' end), '');
        continue when v_text is null;
        if pg_catalog.lower(v_text) = any (v_opr_names) then
          s_already := s_already + 1;
          v_skipped := v_skipped || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
            'field', 'other_products_received', 'reason', 'already listed: ' || v_text));
          continue;
        end if;
        v_opr_names := pg_catalog.array_append(v_opr_names, pg_catalog.lower(v_text));
        v_opr_new := v_opr_new || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
          'product', v_text,
          'date_received', case when pg_catalog.jsonb_typeof(el) = 'object'
                                then public.import_parse_date(el ->> 'date_received') end));
      end loop;
      if pg_catalog.jsonb_array_length(v_opr_new) = pg_catalog.jsonb_array_length(v_opr) then
        v_opr_new := null;
      else
        v_filled := pg_catalog.array_append(v_filled, 'other_products_received'::text);
        s_filled := s_filled + 1;
      end if;
    end if;

    if v_action = 'update' then
      -- =====================================================================
      -- Matched creator: fill what is empty, never overwrite
      -- =====================================================================
      s_matched := s_matched + 1;

      foreach k in array array['name', 'email', 'instagram_handle', 'mobile', 'discord_handle', 'shipping_address'] loop
        sv := nullif(pg_catalog.btrim(r ->> k), '');
        continue when sv is null;
        ev := nullif(pg_catalog.btrim(pg_catalog.to_jsonb(c) ->> k), '');
        -- An auto-created creator's name is their handle; that counts as empty.
        if k = 'name' and ev is not null and public.normalise_tiktok_handle(ev) = c.handle_normalised then
          ev := null;
        end if;
        if ev is null then
          v_fill   := v_fill || pg_catalog.jsonb_build_object(k, sv);
          v_filled := pg_catalog.array_append(v_filled, k);
          s_filled := s_filled + 1;
        elsif ev <> sv then
          v_skipped := v_skipped || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('field', k, 'reason', 'already filled'));
          s_already := s_already + 1;
        end if;
      end loop;

      v_lang_new := null;
      if v_lang is not null then
        if c.language is null then
          v_lang_new := v_lang; v_filled := pg_catalog.array_append(v_filled, 'language'::text); s_filled := s_filled + 1;
        elsif c.language <> v_lang then
          v_skipped := v_skipped || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('field', 'language', 'reason', 'already filled'));
          s_already := s_already + 1;
        end if;
      end if;

      v_join_new := null;
      if v_join is not null then
        if c.cc_join_date is null then
          v_join_new := v_join; v_filled := pg_catalog.array_append(v_filled, 'cc_join_date'::text); s_filled := s_filled + 1;
        elsif c.cc_join_date <> v_join then
          v_skipped := v_skipped || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('field', 'cc_join_date', 'reason', 'already filled'));
          s_already := s_already + 1;
        end if;
      end if;

      v_follow_new := null;
      if v_follow is not null then
        if c.next_follow_up_date is null then
          v_follow_new := v_follow; v_filled := pg_catalog.array_append(v_filled, 'next_follow_up_date'::text); s_filled := s_filled + 1;
        elsif c.next_follow_up_date <> v_follow then
          v_skipped := v_skipped || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('field', 'next_follow_up_date', 'reason', 'already filled'));
          s_already := s_already + 1;
        end if;
      end if;

      v_owner_new := null;
      if v_owner_id is not null then
        if c.owner_id is null then
          v_owner_new := v_owner_id; v_filled := pg_catalog.array_append(v_filled, 'owner_id'::text); s_filled := s_filled + 1;
          if c.new_from_tiktok then
            v_msgs := pg_catalog.array_append(v_msgs, 'Owner assigned, so New from TikTok is cleared.'::text);
          end if;
        elsif c.owner_id <> v_owner_id then
          v_skipped := v_skipped || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('field', 'owner_id', 'reason', 'already filled'));
          s_already := s_already + 1;
        end if;
      end if;

      -- TikTok-owned: never when TikTok fills it, only into an empty value otherwise.
      v_prod_new := null;
      sv := nullif(pg_catalog.btrim(r ->> 'current_product'), '');
      if sv is not null then
        v_synced := c.synced_fields -> 'current_product' = 'true'::jsonb;
        if v_synced then
          v_skipped := v_skipped || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('field', 'current_product', 'reason', 'TikTok has this'));
          s_tiktok := s_tiktok + 1;
        elsif nullif(pg_catalog.btrim(c.current_product), '') is not null then
          if pg_catalog.btrim(c.current_product) <> sv then
            v_skipped := v_skipped || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('field', 'current_product', 'reason', 'already filled'));
            s_already := s_already + 1;
          end if;
        else
          v_prod_new := sv; v_filled := pg_catalog.array_append(v_filled, 'current_product'::text); s_filled := s_filled + 1;
        end if;
      end if;

      v_video_new := null;
      sv := nullif(pg_catalog.btrim(r ->> 'first_video_link'), '');
      if sv is not null then
        v_synced := c.synced_fields -> 'first_video_link' = 'true'::jsonb;
        if v_synced then
          v_skipped := v_skipped || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('field', 'first_video_link', 'reason', 'TikTok has this'));
          s_tiktok := s_tiktok + 1;
        elsif nullif(pg_catalog.btrim(c.first_video_link), '') is not null then
          if pg_catalog.btrim(c.first_video_link) <> sv then
            v_skipped := v_skipped || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('field', 'first_video_link', 'reason', 'already filled'));
            s_already := s_already + 1;
          end if;
        else
          v_video_new := sv; v_filled := pg_catalog.array_append(v_filled, 'first_video_link'::text); s_filled := s_filled + 1;
        end if;
      end if;

      -- Stage: forward only. A CC Join Date filled now also lifts an Invited
      -- creator to Joined (the same thing the trigger does).
      v_stage_cur := c.stage;
      v_stage_new := c.stage;
      if v_cand is not null then
        if v_cand > c.stage then
          v_stage_new := v_cand;
        else
          s_notlater := s_notlater + 1;
          v_msgs := pg_catalog.array_append(v_msgs, ('Stage not changed: ' || c.stage::text || ' is already ' || v_cand::text || ' or later.'));
        end if;
      end if;
      if v_join_new is not null and v_stage_new < 'Joined'::public.creator_stage then
        v_stage_new := 'Joined'::public.creator_stage;
      end if;
      if v_stage_new > v_stage_cur then
        s_moved := s_moved + 1;
        v_msgs := pg_catalog.array_append(v_msgs, ('Stage: ' || v_stage_cur::text || ' → ' || v_stage_new::text || '.'));
      end if;

      if not p_dry_run then
        update public.creators u
           set name                = coalesce(v_fill ->> 'name', u.name),
               email               = coalesce(v_fill ->> 'email', u.email),
               instagram_handle    = coalesce(v_fill ->> 'instagram_handle', u.instagram_handle),
               mobile              = coalesce(v_fill ->> 'mobile', u.mobile),
               discord_handle      = coalesce(v_fill ->> 'discord_handle', u.discord_handle),
               shipping_address    = coalesce(v_fill ->> 'shipping_address', u.shipping_address),
               language            = coalesce(v_lang_new, u.language),
               cc_join_date        = coalesce(v_join_new, u.cc_join_date),
               next_follow_up_date = coalesce(v_follow_new, u.next_follow_up_date),
               owner_id            = coalesce(v_owner_new, u.owner_id),
               new_from_tiktok     = case when v_owner_new is not null then false else u.new_from_tiktok end,
               current_product     = coalesce(v_prod_new, u.current_product),
               first_video_link    = coalesce(v_video_new, u.first_video_link),
               other_products_received = coalesce(v_opr_new, u.other_products_received),
               -- 017: defensive, a non-array stored value no longer swallows the new notes
               notes               = case when pg_catalog.jsonb_array_length(v_notes_new) > 0
                                          then (case when pg_catalog.jsonb_typeof(u.notes) = 'array' then u.notes else '[]'::jsonb end)
                                               || v_notes_new
                                          else u.notes end,
               stage               = v_stage_new
         where u.id = c.id;

        -- The manual-product trigger stamps current_product_manual_at on any
        -- change. An imported product is a starting value that a TikTok sample
        -- should replace, so clear the stamp (this update doesn't list
        -- current_product, so the trigger doesn't run again).
        if v_prod_new is not null then
          update public.creators u set current_product_manual_at = null where u.id = c.id;
        end if;
      end if;

      if pg_catalog.cardinality(v_filled) = 0 and v_stage_new = v_stage_cur
         and pg_catalog.jsonb_array_length(v_notes_new) = 0 then
        v_msgs := pg_catalog.array_append(v_msgs, 'Nothing to change.'::text);
      end if;

    else
      -- =====================================================================
      -- New creator
      -- =====================================================================
      s_created := s_created + 1;

      foreach k in array array['name', 'email', 'instagram_handle', 'mobile', 'discord_handle', 'shipping_address'] loop
        sv := nullif(pg_catalog.btrim(r ->> k), '');
        continue when sv is null;
        v_fill   := v_fill || pg_catalog.jsonb_build_object(k, sv);
        v_filled := pg_catalog.array_append(v_filled, k);
        s_filled := s_filled + 1;
      end loop;
      v_name := coalesce(v_fill ->> 'name', v_handle);
      if v_fill ->> 'name' is null then
        v_msgs := pg_catalog.array_append(v_msgs, 'No name in the sheet; the handle is used as the name.'::text);
      end if;

      if v_lang is not null     then v_filled := pg_catalog.array_append(v_filled, 'language'::text);            s_filled := s_filled + 1; end if;
      if v_join is not null     then v_filled := pg_catalog.array_append(v_filled, 'cc_join_date'::text);        s_filled := s_filled + 1; end if;
      if v_follow is not null   then v_filled := pg_catalog.array_append(v_filled, 'next_follow_up_date'::text); s_filled := s_filled + 1; end if;
      if v_owner_id is not null then v_filled := pg_catalog.array_append(v_filled, 'owner_id'::text);            s_filled := s_filled + 1; end if;

      v_prod_new := nullif(pg_catalog.btrim(r ->> 'current_product'), '');
      if v_prod_new is not null then v_filled := pg_catalog.array_append(v_filled, 'current_product'::text); s_filled := s_filled + 1; end if;
      v_video_new := nullif(pg_catalog.btrim(r ->> 'first_video_link'), '');
      if v_video_new is not null then v_filled := pg_catalog.array_append(v_filled, 'first_video_link'::text); s_filled := s_filled + 1; end if;

      -- The candidate, else Joined when there is a Join Date, else Invited.
      v_stage_new := coalesce(v_cand,
                              case when v_join is not null then 'Joined'::public.creator_stage
                                   else 'Invited'::public.creator_stage end);
      if v_join is not null and v_stage_new < 'Joined'::public.creator_stage then
        v_stage_new := 'Joined'::public.creator_stage;
      end if;
      v_msgs := pg_catalog.array_append(v_msgs, ('New creator at ' || v_stage_new::text || '.'));

      if not p_dry_run then
        insert into public.creators
          (name, tiktok_handle, instagram_handle, email, mobile, discord_handle, shipping_address,
           language, cc_join_date, next_follow_up_date, owner_id, current_product, first_video_link,
           other_products_received, notes, stage, stage_manual_at, source, status)
        values
          (v_name, v_handle, v_fill ->> 'instagram_handle', v_fill ->> 'email', v_fill ->> 'mobile',
           v_fill ->> 'discord_handle', v_fill ->> 'shipping_address',
           v_lang, v_join, v_follow, v_owner_id, v_prod_new, v_video_new,
           coalesce(v_opr_new, '[]'::jsonb), v_notes_new, v_stage_new, pg_catalog.now(), 'import', 'active');
      end if;
    end if;

    v_rows := v_rows || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
      'row', v_row_id, 'handle', v_handle, 'action', v_action,
      'filled', pg_catalog.to_jsonb(v_filled), 'skipped', v_skipped, 'messages', pg_catalog.to_jsonb(v_msgs)));
  end loop;

  return pg_catalog.jsonb_build_object(
    'dry_run', p_dry_run,
    'summary', pg_catalog.jsonb_build_object(
      'rows_received', s_total,
      'matched', s_matched,
      'created', s_created,
      'skipped', pg_catalog.jsonb_build_object(
        'total', s_nohandle + s_dup + s_removed,
        'no_handle', s_nohandle,
        'duplicate', s_dup,
        'removed_match', s_removed),
      'fields_filled', s_filled,
      'values_skipped_already_filled', s_already,
      'values_skipped_tiktok_owned', s_tiktok,
      'stage_moved_forward', s_moved,
      'stage_not_later', s_notlater,
      'notes_appended', s_notes,
      'notes_skipped_duplicate', s_notes_dup,
      'owner_unmatched', pg_catalog.jsonb_build_object(
        'rows', s_owner_rows,
        'names', (select coalesce(pg_catalog.jsonb_agg(d.n order by d.n), '[]'::jsonb)
                    from (select distinct u.n from pg_catalog.unnest(s_owner_names) as u(n)) d)),
      'invalid_values', s_invalid),
    'rows', v_rows);
end;
$$;

revoke all on function public.import_creators(jsonb, boolean) from public, anon;
grant execute on function public.import_creators(jsonb, boolean) to authenticated, service_role;

commit;
