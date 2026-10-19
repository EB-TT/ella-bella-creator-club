-- TikTok Shop sync, phase 5 (follows 010).
--
-- 1. Back-off for failing streams. A stream (or the token step) that ends in
--    error now waits 5, 10, 20, 40, 80, 160 minutes, then 6 hours, before the
--    sync tries it again; "Sync now" ignores the wait. The Edge Function writes
--    these two columns; tiktok_sync_status() now returns them.
-- 2. Stage and tier suggestions are dismissed separately. creators gains
--    suggestion_dismissed_stage / suggestion_dismissed_tier, any existing
--    suggestion_dismissed_value is copied across, and tiktok_recompute compares
--    each suggestion with its own column. suggestion_dismissed_value stays in
--    place, unused.
--
-- Run this BEFORE redeploying the sync function and before the frontend: both
-- read or write the new columns. The old function keeps working against the new
-- schema (it just doesn't back off).
--
-- tiktok_recompute is copied from 010 and changed only where it reads the
-- dismissed value. Manual-only fields are never written. Safe to re-run. One
-- transaction.

begin;

-- ---------------------------------------------------------------------------
-- 1. Back-off
-- ---------------------------------------------------------------------------

alter table public.tiktok_sync_state
  -- Runs in a row that ended in error; reset to 0 by a run that doesn't
  add column if not exists consecutive_failures integer not null default 0,
  -- The stream is not due before this time (unless forced); null = no wait
  add column if not exists next_retry_at        timestamptz;

-- The return type changes, so the function is dropped and recreated.
drop function if exists public.tiktok_sync_status();

-- One row per stream (affiliate, samples, sample_orders, target_collabs,
-- token, derive). access_token_expires_at is filled on the token row only.
-- No token values.
create function public.tiktok_sync_status()
returns table (
  stream                  text,
  last_status             text,
  last_error              text,
  last_success_at         timestamptz,
  last_run_finished_at    timestamptz,
  backfill_done           boolean,
  more_to_do              boolean,
  rate_limited_count      integer,
  access_token_expires_at timestamptz,
  consecutive_failures    integer,
  next_retry_at           timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select s.stream, s.last_status, s.last_error, s.last_success_at, s.last_run_finished_at,
         s.backfill_done, s.more_to_do, s.rate_limited_count,
         case when s.stream = 'token'
              then (select min(k.access_token_expires_at) from public.tiktok_shop_connections k)
         end,
         s.consecutive_failures, s.next_retry_at
    from public.tiktok_sync_state s
   order by s.stream
$$;

-- Same grants as 009.
revoke all on function public.tiktok_sync_status() from public, anon;
grant execute on function public.tiktok_sync_status() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. Separate stage and tier dismissals
-- ---------------------------------------------------------------------------

alter table public.creators
  add column if not exists suggestion_dismissed_stage text,
  add column if not exists suggestion_dismissed_tier  text;

-- Copy the old single value to whichever column it belongs in.
update public.creators
   set suggestion_dismissed_tier = suggestion_dismissed_value
 where suggestion_dismissed_value in ('Bronze', 'Silver', 'Gold', 'Platinum')
   and suggestion_dismissed_tier is null;

update public.creators
   set suggestion_dismissed_stage = suggestion_dismissed_value
 where suggestion_dismissed_value = any (pg_catalog.enum_range(null::public.creator_stage)::text[])
   and suggestion_dismissed_stage is null;

comment on column public.creators.suggestion_dismissed_value is
  'Superseded by suggestion_dismissed_stage / suggestion_dismissed_tier (011). No longer read or written.';

-- ---------------------------------------------------------------------------
-- tiktok_recompute: as in 010, comparing each suggestion with its own
-- dismissed column
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
           'GMV $' || pg_catalog.to_char(pg_catalog.round(y.tier_gmv), 'FM999,999,999,990')
             || case v_basis when 'last_30_days' then ' in the last 30 days'
                             when 'last_90_days' then ' in the last 90 days'
                             else ' all time' end
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

commit;
