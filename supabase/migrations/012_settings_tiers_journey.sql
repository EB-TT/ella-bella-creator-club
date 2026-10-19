-- Settings, tiers and the one-sequence journey (phase 7; follows 011).
--
-- 1. profiles.is_admin and public.is_admin(). Admins are set by hand in SQL.
-- 2. tiktok_settings.stage_rules (Build Momentum / Consistent Creator
--    thresholds) and the first tier bands: all-time GMV, Bronze $500, Silver
--    $2,500, Gold $10,000, Platinum $25,000. Auto-apply stays off.
-- 3. tiktok_activity reads the rules and returns the two new milestones, so
--    tiktok_recompute and tiktok_autocreate (which sets the stage on insert)
--    both pick them up. Tier Up and Top Performer stay in the enum but nothing
--    produces them any more.
-- 4. tiktok_recompute: copied from 011 and changed only where noted ("012:").
-- 5. App functions for the Settings screen. All security definer; the admin
--    ones raise unless public.is_admin().
--
-- Run BEFORE the frontend that uses it (the frontend degrades quietly without
-- it, but the Settings screen needs these functions). No Edge Function change.
-- Afterwards run `select public.tiktok_derive(null);` (pause cron first) so
-- existing creators pick up the new rules and bands. Manual-only fields are
-- never written. Safe to re-run. One transaction.

begin;

-- ---------------------------------------------------------------------------
-- 1. Admin flag
-- ---------------------------------------------------------------------------

alter table public.profiles
  add column if not exists is_admin boolean not null default false;

comment on column public.profiles.is_admin is
  'Can change the TikTok sync settings. Set by hand in SQL; the app has no write access to profiles.';

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select p.is_admin from public.profiles p where p.id = auth.uid()), false)
$$;

-- ---------------------------------------------------------------------------
-- 2. Settings: stage rules and the first tier bands
-- ---------------------------------------------------------------------------

alter table public.tiktok_settings
  add column if not exists stage_rules jsonb not null default
    '{"build_momentum": {"min_content": 2}, "consistent_creator": {"min_content": 5, "months": 3}}'::jsonb;

comment on column public.tiktok_settings.stage_rules is
  'Thresholds for the later stages. Build Momentum: min_content selling videos/lives. Consistent Creator: min_content, or sales in each of the last `months` calendar months (this month included).';

-- Only while nobody has set bands, so a re-run never undoes an admin's edit.
update public.tiktok_settings
   set tier_bands = '{"basis": "all_time", "bands": [{"tier": "Bronze", "min_gmv": 500}, {"tier": "Silver", "min_gmv": 2500}, {"tier": "Gold", "min_gmv": 10000}, {"tier": "Platinum", "min_gmv": 25000}]}'::jsonb
 where id and tier_bands is null;

-- ---------------------------------------------------------------------------
-- 3. tiktok_activity: adds selling content and the month rule
--
-- Selling content = distinct content_id on sale-counting lines whose
-- content_type is VIDEO or LIVE. The month rule counts the calendar months
-- (UTC) with a sale among the last `months`, this month included.
-- New return columns: selling_content, consistent_by_content, rule_months.
-- The return type changes, so the function is dropped and recreated.
-- ---------------------------------------------------------------------------

drop function if exists public.tiktok_activity(uuid[]);

create function public.tiktok_activity(p_tc_ids uuid[] default null)
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
  rule_months            integer
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
           coalesce(ls.recent_months, 0)       as recent_months
    from base b
    left join ls on ls.id = b.id
    left join ss on ss.id = b.id
    left join co on co.id = b.id
  )
  select x.id, x.has_sale, x.has_video_sale, x.approved_n, x.pending_n, x.cancelled_n,
         x.collab_accepted, x.collab_posted,
         greatest(
           x.sample_stage,
           case when x.collab_accepted then 'Accepted (Target Collab Invite)'::public.creator_stage end,
           case when x.has_video_sale or x.collab_posted then 'Video Posted'::public.creator_stage end,
           case when x.has_sale then 'First Sale Achieved'::public.creator_stage end,
           case when x.selling_content >= cfg.bm_min then 'Build Momentum'::public.creator_stage end,
           case when x.selling_content >= cfg.cc_min or x.recent_months >= cfg.cc_months
                then 'Consistent Creator'::public.creator_stage end
         ),
         (not x.has_sale and x.approved_n = 0 and x.pending_n = 0
            and not x.collab_accepted and x.cancelled_n > 0),
         x.selling_content,
         (x.selling_content >= cfg.cc_min),
         cfg.cc_months
  from x cross join cfg
$$;

-- Same grants as 009.
revoke all on function public.tiktok_activity(uuid[]) from public, anon, authenticated;
grant execute on function public.tiktok_activity(uuid[]) to service_role;

-- ---------------------------------------------------------------------------
-- 4. tiktok_recompute: as in 011, plus the two new stage reasons and the
--    tier reason wording. Changes are marked "012:".
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

  bands as (
    select b.tier, b.min_gmv
    from (
      select e ->> 'tier' as tier,
             case when (e ->> 'min_gmv') ~ '^-?[0-9]+(\.[0-9]+)?$' then (e ->> 'min_gmv')::numeric end as min_gmv
      from jsonb_array_elements(
             case when pg_catalog.jsonb_typeof(v_bands -> 'bands') = 'array' then v_bands -> 'bands' else '[]'::jsonb end
           ) e
    ) b
    where b.tier in ('Bronze', 'Silver', 'Gold', 'Platinum') and b.min_gmv is not null
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
      case when v_has_bands and la.n > 0 then
        (select b.tier from bands b
          where b.min_gmv <= (case v_basis when 'last_30_days' then coalesce(la.g30, 0)
                                           when 'last_90_days' then coalesce(la.g90, 0)
                                           else coalesce(la.gmv, 0) end)
          order by b.min_gmv desc limit 1)
      end as tier_cand
    from t
    left join la  on la.cid  = t.cid
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
            and public.tiktok_tier_rank(x.tier_cand) > public.tiktok_tier_rank(x.cur_tier)) as tier_later
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
                    else 'Sample completed' end
             when 'First Video' then 'Sample content pending'
             when 'Product Sent' then 'Sample shipped'
             when 'First Product' then 'Sample requested or approved'
             when 'Accepted (Target Collab Invite)' then 'Target collab invite accepted'
           end as stage_reason,
           -- 012: "All-time GMV $2,600 reaches Silver"
           case v_basis when 'last_30_days' then 'Last 30 days GMV $'
                        when 'last_90_days' then 'Last 90 days GMV $'
                        else 'All-time GMV $' end
             || pg_catalog.to_char(pg_catalog.round(y.tier_gmv), 'FM999,999,999,990')
             || ' reaches ' || y.tier_cand as tier_reason
    from y
  )
  update public.creators c set
    gmv                         = coalesce(z.gmv, c.gmv),
    first_sale_date             = coalesce((z.first_sale at time zone 'UTC')::date, c.first_sale_date),
    last_sale_at                = coalesce(z.last_sale, c.last_sale_at),
    units_sold_total            = coalesce(z.units, c.units_sold_total),
    first_video_date            = coalesce((z.fv_posted at time zone 'UTC')::date, c.first_video_date),
    first_video_link            = coalesce(
                                    case when z.fv_content_id is not null
                                         then 'https://www.tiktok.com/@' || z.username || '/video/' || z.fv_content_id end,
                                    c.first_video_link),
    other_videos                = coalesce(z.other_videos, c.other_videos),
    current_product             = case when z.tk_current then z.pname else c.current_product end,
    units_sold_current_product  = coalesce(z.cur_units, c.units_sold_current_product),
    other_products_received     = coalesce(z.opr_new, c.other_products_received),
    -- Follow the current TikTok sample, nulls included; manual Current Product leaves both alone.
    product_sent_date           = case when z.tk_current then z.sent_date else c.product_sent_date end,
    product_delivery_date       = case when z.tk_current then z.delivered_date else c.product_delivery_date end,
    tiktok_shop_eligible        = true,
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
        ('tiktok_shop_eligible',       true)
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

-- ---------------------------------------------------------------------------
-- 5. Functions for the Settings screen
--
-- Security definer, so the TikTok tables stay closed to the app. The admin
-- ones raise unless public.is_admin(). The two that re-run the derive
-- (update_tiktok_settings, set_product_short_name) touch every creator and so
-- take as long as a full tiktok_derive(null); the 120s limit below is asked
-- for, but a platform-level statement timeout on API calls may still win.
-- ---------------------------------------------------------------------------

create or replace function public.get_tiktok_settings()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select pg_catalog.jsonb_build_object(
           'tier_bands',       s.tier_bands,
           'stage_rules',      s.stage_rules,
           'auto_apply_stage', s.auto_apply_stage,
           'auto_apply_tier',  s.auto_apply_tier)
    from public.tiktok_settings s
   where s.id
$$;

-- p may carry any of tier_bands, stage_rules, auto_apply_stage, auto_apply_tier;
-- what is present is validated and saved, the rest is left alone. Then every
-- creator is re-derived. Returns the derive counts.
create or replace function public.update_tiktok_settings(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
set statement_timeout = '120s'
as $$
declare
  v_bands   jsonb;
  v_rules   jsonb;
  v_basis   text;
  v_arr     jsonb;
  v_tier    text;
  v_elem    jsonb;
  v_min     numeric;
  v_prev    numeric := 0;
  v_out     jsonb := '[]'::jsonb;
  v_bm      integer;
  v_cc      integer;
  v_months  integer;
  v_a_stage boolean;
  v_a_tier  boolean;
begin
  if not public.is_admin() then
    raise exception 'Only admins can change these settings.' using errcode = '42501';
  end if;
  if p is null or pg_catalog.jsonb_typeof(p) <> 'object' then
    raise exception 'Settings must be an object.';
  end if;

  -- Tier bands ---------------------------------------------------------------
  if p ? 'tier_bands' then
    v_basis := p -> 'tier_bands' ->> 'basis';
    if v_basis is null or v_basis not in ('all_time', 'last_30_days', 'last_90_days') then
      raise exception 'Basis must be all time, last 30 days or last 90 days.';
    end if;
    v_arr := p -> 'tier_bands' -> 'bands';
    if pg_catalog.jsonb_typeof(v_arr) is distinct from 'array' or pg_catalog.jsonb_array_length(v_arr) <> 4 then
      raise exception 'There must be exactly four tiers: Bronze, Silver, Gold and Platinum.';
    end if;
    foreach v_tier in array array['Bronze', 'Silver', 'Gold', 'Platinum'] loop
      select e into v_elem
        from pg_catalog.jsonb_array_elements(v_arr) e
       where e ->> 'tier' = v_tier
       limit 1;
      if v_elem is null then
        raise exception 'The % tier is missing.', v_tier;
      end if;
      if (v_elem ->> 'min_gmv') is null or (v_elem ->> 'min_gmv') !~ '^[0-9]{1,12}(\.[0-9]{1,2})?$' then
        raise exception '% needs a minimum GMV that is a number.', v_tier;
      end if;
      v_min := (v_elem ->> 'min_gmv')::numeric;
      if v_min <= 0 then
        raise exception '% needs a minimum GMV above $0.', v_tier;
      end if;
      if v_min <= v_prev then
        raise exception 'Minimum GMV must go up at each tier: % must be above the tier before it.', v_tier;
      end if;
      v_prev := v_min;
      v_out := v_out || pg_catalog.jsonb_build_array(
                 pg_catalog.jsonb_build_object('tier', v_tier, 'min_gmv', v_min));
    end loop;
    v_bands := pg_catalog.jsonb_build_object('basis', v_basis, 'bands', v_out);
  end if;

  -- Stage rules --------------------------------------------------------------
  if p ? 'stage_rules' then
    if (p #>> '{stage_rules,build_momentum,min_content}') is null
       or (p #>> '{stage_rules,build_momentum,min_content}') !~ '^[0-9]{1,6}$'
       or (p #>> '{stage_rules,consistent_creator,min_content}') is null
       or (p #>> '{stage_rules,consistent_creator,min_content}') !~ '^[0-9]{1,6}$'
       or (p #>> '{stage_rules,consistent_creator,months}') is null
       or (p #>> '{stage_rules,consistent_creator,months}') !~ '^[0-9]{1,2}$' then
      raise exception 'Journey rules must be whole numbers.';
    end if;
    v_bm     := (p #>> '{stage_rules,build_momentum,min_content}')::integer;
    v_cc     := (p #>> '{stage_rules,consistent_creator,min_content}')::integer;
    v_months := (p #>> '{stage_rules,consistent_creator,months}')::integer;
    if v_bm < 1 or v_cc < 1 then
      raise exception 'Content counts must be at least 1.';
    end if;
    if v_cc <= v_bm then
      raise exception 'Consistent Creator needs more content than Build Momentum.';
    end if;
    if v_months < 1 or v_months > 12 then
      raise exception 'Months must be between 1 and 12.';
    end if;
    v_rules := pg_catalog.jsonb_build_object(
      'build_momentum',     pg_catalog.jsonb_build_object('min_content', v_bm),
      'consistent_creator', pg_catalog.jsonb_build_object('min_content', v_cc, 'months', v_months));
  end if;

  -- Auto-apply switches ------------------------------------------------------
  if p ? 'auto_apply_stage' then
    if pg_catalog.jsonb_typeof(p -> 'auto_apply_stage') <> 'boolean' then
      raise exception 'Auto-apply stage must be on or off.';
    end if;
    v_a_stage := (p ->> 'auto_apply_stage')::boolean;
  end if;
  if p ? 'auto_apply_tier' then
    if pg_catalog.jsonb_typeof(p -> 'auto_apply_tier') <> 'boolean' then
      raise exception 'Auto-apply tier must be on or off.';
    end if;
    v_a_tier := (p ->> 'auto_apply_tier')::boolean;
  end if;

  update public.tiktok_settings s set
    tier_bands       = coalesce(v_bands, s.tier_bands),
    stage_rules      = coalesce(v_rules, s.stage_rules),
    auto_apply_stage = coalesce(v_a_stage, s.auto_apply_stage),
    auto_apply_tier  = coalesce(v_a_tier, s.auto_apply_tier)
  where s.id;

  return public.tiktok_derive(null);
end;
$$;

-- Empty p_short_name clears the override (back to the automatic name).
-- Then every creator is re-derived, since product names appear in several fields.
create or replace function public.set_product_short_name(p_product_id text, p_short_name text)
returns jsonb
language plpgsql
security definer
set search_path = ''
set statement_timeout = '120s'
as $$
declare
  v_name text := nullif(pg_catalog.btrim(p_short_name), '');
  v_n    integer;
begin
  if not public.is_admin() then
    raise exception 'Only admins can change product names.' using errcode = '42501';
  end if;
  if v_name is not null and pg_catalog.length(v_name) > 80 then
    raise exception 'A product name can be at most 80 characters.';
  end if;

  update public.tiktok_products p set short_name = v_name where p.product_id = p_product_id;
  get diagnostics v_n = row_count;
  if v_n = 0 then
    raise exception 'Unknown product.';
  end if;

  return public.tiktok_derive(null);
end;
$$;

create or replace function public.list_tiktok_products()
returns table (
  product_id   text,
  title        text,
  short_name   text,
  auto_name    text,
  display_name text
)
language sql
stable
security definer
set search_path = ''
as $$
  select p.product_id, p.title, p.short_name,
         public.tiktok_auto_short_name(p.title),
         public.tiktok_product_name(p.product_id)
    from public.tiktok_products p
   order by pg_catalog.lower(coalesce(public.tiktok_product_name(p.product_id), p.product_id)), p.product_id
$$;

-- Bulk accept. The derive's own switch (app.tiktok_sync) is on while these
-- write, so the creators triggers leave them alone. Forward-only, active
-- creators only. Returns the number accepted.
create or replace function public.accept_all_tier_suggestions()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_prev text := coalesce(pg_catalog.current_setting('app.tiktok_sync', true), '');
  v_n    integer;
begin
  if not public.is_admin() then
    raise exception 'Only admins can accept suggestions in bulk.' using errcode = '42501';
  end if;

  perform pg_catalog.set_config('app.tiktok_sync', 'on', true);

  update public.creators c set
    creator_tier      = c.suggested_tier,
    suggested_tier    = null,
    -- The reason is "<stage reason> · <tier reason>" when both exist: keep the stage part.
    suggestion_reason = case when c.suggested_stage is not null
                             then nullif(pg_catalog.split_part(c.suggestion_reason, ' · ', 1), '')
                        end
  where c.status = 'active'
    and c.suggested_tier is not null
    and public.tiktok_tier_rank(c.suggested_tier) > public.tiktok_tier_rank(c.creator_tier);
  get diagnostics v_n = row_count;

  perform pg_catalog.set_config('app.tiktok_sync', v_prev, true);
  return v_n;
end;
$$;

create or replace function public.accept_all_stage_suggestions()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_prev text := coalesce(pg_catalog.current_setting('app.tiktok_sync', true), '');
  v_n    integer;
begin
  if not public.is_admin() then
    raise exception 'Only admins can accept suggestions in bulk.' using errcode = '42501';
  end if;

  perform pg_catalog.set_config('app.tiktok_sync', 'on', true);

  update public.creators c set
    stage             = c.suggested_stage::public.creator_stage,
    suggested_stage   = null,
    -- Keep the tier part of "<stage reason> · <tier reason>".
    suggestion_reason = case when c.suggested_tier is not null
                             then nullif(pg_catalog.split_part(c.suggestion_reason, ' · ', 2), '')
                        end
  where c.status = 'active'
    and c.suggested_stage is not null
    and c.suggested_stage::public.creator_stage > c.stage;
  get diagnostics v_n = row_count;

  perform pg_catalog.set_config('app.tiktok_sync', v_prev, true);
  return v_n;
end;
$$;

-- Grants as in 009: signed-in users and the service role only. The admin
-- checks are inside the functions.
revoke all on function public.is_admin()                                     from public, anon;
revoke all on function public.get_tiktok_settings()                          from public, anon;
revoke all on function public.update_tiktok_settings(jsonb)                  from public, anon;
revoke all on function public.set_product_short_name(text, text)             from public, anon;
revoke all on function public.list_tiktok_products()                         from public, anon;
revoke all on function public.accept_all_tier_suggestions()                  from public, anon;
revoke all on function public.accept_all_stage_suggestions()                 from public, anon;

grant execute on function public.is_admin()                                  to authenticated, service_role;
grant execute on function public.get_tiktok_settings()                       to authenticated, service_role;
grant execute on function public.update_tiktok_settings(jsonb)               to authenticated, service_role;
grant execute on function public.set_product_short_name(text, text)          to authenticated, service_role;
grant execute on function public.list_tiktok_products()                      to authenticated, service_role;
grant execute on function public.accept_all_tier_suggestions()               to authenticated, service_role;
grant execute on function public.accept_all_stage_suggestions()              to authenticated, service_role;

commit;
