-- 016: tiers use Ella Bella VIDEO views only; stale TikTok values are cleared.
--
-- 1. LIVE views are the views of the whole LIVE session, even when Ella Bella was
--    shown briefly, so they distorted tiers (creators suggested Platinum on LIVE
--    views alone with no sales). Tier qualification by views now uses video_views.
--    live_views and ella_bella_views are still computed, stored and shown. Live
--    SALES still count through GMV. Reasons read "Ella Bella video views N reach <Tier>".
-- 2. When TikTok stops returning data for a field it filled before (e.g. a sales line
--    reattributed to a new username after a handle change), the derive used to keep the
--    old value. Now, for these fields, a value whose key is in the creator's previous
--    synced_fields is cleared when TikTok has no data for it:
--      gmv, units_sold_total      -> 0
--      first_sale_date, last_sale_at, first_video_date, first_video_link -> null
--      other_videos               -> null
--    synced_fields is rebuilt on every recompute from what TikTok filled that run, so a
--    field cleared here drops out of it. Not covered (unchanged): current_product,
--    product dates (already follow the current sample), units_sold_current_product,
--    other_products_received (mixes manual entries), and the view totals (an analytics
--    stream that failed would otherwise blank them).
--    A value the team typed by hand is never in synced_fields (synced fields are
--    read-only in the app), so it is never touched.
-- Everything else is as in 014.

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
  vv as (
    select t.cid, sum(w.views)::bigint as v
    from t
    join public.tiktok_videos tv on tv.username_normalised = t.u
    join public.tiktok_video_window_views w on w.video_id = tv.video_id
    group by t.cid
  ),
  lv as (
    select t.cid, sum(l.views)::bigint as v
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


-- Same grants as 009.
revoke all on function public.tiktok_recompute(uuid[]) from public, anon, authenticated;
grant execute on function public.tiktok_recompute(uuid[]) to service_role;
