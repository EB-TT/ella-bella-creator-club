-- TikTok Shop sync, phase 3: derive creator fields from the stored TikTok data.
--
-- Adds handle normalisation, the GMV / sale rules, linking of creators to
-- tiktok_creators, auto-creation of creators TikTok shows activity for, the
-- per-creator recompute (synced fields plus stage/tier suggestions), and the
-- read-only functions the app will use in phase 4.
--
-- Nothing here touches creator_valuations. The manual-only fields (owner,
-- next action, next follow-up date, last contact, Instagram handle, email,
-- notes, shipping address) are never written by any function below.
--
-- The derive functions mark their own writes with
--   set_config('app.tiktok_sync', 'on', true)
-- so the creators triggers can tell them apart from edits made in the app.
--
-- Safe to re-run. One transaction.

begin;

-- ---------------------------------------------------------------------------
-- 1. Handle normalisation
--
-- Lowercase and trim; take the name out of a tiktok.com/@name URL; strip every
-- leading "@"; drop any query string, fragment or trailing slash; empty ->
-- null. For a plain username this gives exactly what the sync's normUsername()
-- gives (trim, strip leading @s, trim, lowercase).
-- ---------------------------------------------------------------------------

create or replace function public.normalise_tiktok_handle(p_handle text)
returns text
language plpgsql
immutable
parallel safe
set search_path = ''
as $$
declare
  s text;
begin
  if p_handle is null then
    return null;
  end if;

  s := pg_catalog.lower(pg_catalog.regexp_replace(p_handle, '^\s+|\s+$', '', 'g'));
  if s ~ 'tiktok\.com/@' then
    s := (pg_catalog.regexp_match(s, 'tiktok\.com/@+([^/?#\s]+)'))[1];
  end if;
  s := pg_catalog.regexp_replace(s, '[?#].*$', '');
  s := pg_catalog.regexp_replace(s, '/+$', '');
  s := pg_catalog.regexp_replace(s, '^@+', '');
  s := pg_catalog.regexp_replace(s, '^\s+|\s+$', '', 'g');
  return nullif(s, '');
end;
$$;

-- Rebuild the generated column on the new function. Skipped when it already
-- uses it, so a re-run doesn't rewrite the table.
do $$
begin
  if not exists (
    select 1
    from pg_catalog.pg_attribute a
    join pg_catalog.pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
    where a.attrelid = 'public.creators'::regclass
      and a.attname = 'handle_normalised'
      and not a.attisdropped
      and pg_catalog.pg_get_expr(d.adbin, d.adrelid) like '%normalise_tiktok_handle%'
  ) then
    drop index if exists public.creators_handle_normalised_active_uniq;
    alter table public.creators drop column if exists handle_normalised;
    alter table public.creators
      add column handle_normalised text
        generated always as (public.normalise_tiktok_handle(tiktok_handle)) stored;
  end if;
end $$;

-- The stricter rules can make two handles collide that didn't before
-- ("@@foo" and "@foo"). Say so plainly rather than fail on the index.
do $$
declare
  dupes text;
begin
  select string_agg(h, ', ')
    into dupes
    from (
      select handle_normalised as h
      from public.creators
      where status = 'active' and handle_normalised is not null
      group by handle_normalised
      having count(*) > 1
    ) d;

  if dupes is not null then
    raise exception 'Duplicate active TikTok handles block creators_handle_normalised_active_uniq: %', dupes;
  end if;
end $$;

create unique index if not exists creators_handle_normalised_active_uniq
  on public.creators (handle_normalised)
  where status = 'active' and handle_normalised is not null;

-- ---------------------------------------------------------------------------
-- 2. GMV per line, and what counts as a sale
-- ---------------------------------------------------------------------------

create or replace function public.tiktok_line_gmv(
  p_settlement_status text,
  p_actual            numeric,
  p_estimated         numeric,
  p_fully_return      boolean
)
returns numeric
language sql
immutable
parallel safe
set search_path = ''
as $$
  select case
    when p_settlement_status = 'INELIGIBLE' then 0::numeric
    when p_actual is not null              then p_actual
    when coalesce(p_fully_return, false)   then 0::numeric
    else coalesce(p_estimated, 0::numeric)
  end
$$;

comment on function public.tiktok_line_gmv(text, numeric, numeric, boolean) is
  'GMV of one affiliate order line: 0 if INELIGIBLE; else actual_commission_base if present; else 0 if fully returned; else estimated_commission_base.';

-- A line counts as a sale (for units, First Sale and Last sale) when it is not
-- INELIGIBLE and not fully returned. The build plan said only "not fully
-- returned"; this also excludes INELIGIBLE (cancellations), which TikTok
-- itself zeroes.
create or replace function public.tiktok_line_is_sale(p_settlement_status text, p_fully_return boolean)
returns boolean
language sql
immutable
parallel safe
set search_path = ''
as $$
  select p_settlement_status is distinct from 'INELIGIBLE' and not coalesce(p_fully_return, false)
$$;

comment on function public.tiktok_line_is_sale(text, boolean) is
  'True when an affiliate line counts as a sale: not INELIGIBLE and not fully returned.';

-- ---------------------------------------------------------------------------
-- Sample status helpers
-- ---------------------------------------------------------------------------

-- Got past approval.
create or replace function public.tiktok_sample_is_approved(p_status text)
returns boolean
language sql
immutable
parallel safe
set search_path = ''
as $$
  select p_status in (
    'AWAITING_SHIPMENT', 'SHIPPED', 'CONTENT_PENDING', 'COMPLETED',
    'UNFULFILL_CANCELLED', 'UNFULFILLABLE_CANCELLED',
    'OPS_COMPLETED', 'OPS_FAILED', 'OPS_CANCELLED'
  )
$$;

-- Cancelled before anything shipped.
create or replace function public.tiktok_sample_is_unshipped_cancel(p_status text)
returns boolean
language sql
immutable
parallel safe
set search_path = ''
as $$
  select p_status in (
    'OVERDUE_CANCELLED', 'WITHDRAW_CANCELLED', 'REJECT_CANCELLED',
    'SELLER_NOT_SHIP_CANCELLED', 'DEL_OPEN_COLLAB'
  )
$$;

-- The stage a sample status points to. Approved statuses the plan doesn't name
-- (post-approval cancellations, OPS_*) only prove the request was approved, so
-- they map to First Product.
create or replace function public.tiktok_sample_stage(p_status text)
returns public.creator_stage
language sql
immutable
parallel safe
set search_path = ''
as $$
  select case
    when p_status in ('PENDING', 'AWAITING_SHIPMENT') then 'First Product'::public.creator_stage
    when p_status = 'SHIPPED'                          then 'Product Sent'::public.creator_stage
    when p_status = 'CONTENT_PENDING'                  then 'First Video'::public.creator_stage
    when p_status = 'COMPLETED'                        then 'Video Posted'::public.creator_stage
    when public.tiktok_sample_is_approved(p_status)    then 'First Product'::public.creator_stage
  end
$$;

create or replace function public.tiktok_tier_rank(p_tier text)
returns integer
language sql
immutable
parallel safe
set search_path = ''
as $$
  select case p_tier when 'Bronze' then 1 when 'Silver' then 2 when 'Gold' then 3 when 'Platinum' then 4 else 0 end
$$;

-- Display name for a product: short_name, else the listing title, else the
-- sample's own title, else any stored sample title for it, else the ID.
create or replace function public.tiktok_product_name(p_product_id text, p_fallback text default null)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    nullif(pg_catalog.btrim(p.short_name), ''),
    nullif(pg_catalog.btrim(p.title), ''),
    nullif(pg_catalog.btrim(p_fallback), ''),
    (select nullif(pg_catalog.btrim(s.product_title), '')
       from public.tiktok_samples s
      where s.product_id = p_product_id and s.product_title is not null
      limit 1),
    p_product_id
  )
  from (select 1) one
  left join public.tiktok_products p on p.product_id = p_product_id
$$;

-- ---------------------------------------------------------------------------
-- 3. New creators columns, and the manual Current Product timestamp
-- ---------------------------------------------------------------------------

alter table public.creators
  add column if not exists current_product_manual_at timestamptz,
  add column if not exists tiktok_request_cancelled_only boolean not null default false;

comment on column public.creators.current_product_manual_at is
  'When Current Product was last changed from the app. A TikTok sample dated before this does not replace the manual value.';
comment on column public.creators.tiktok_request_cancelled_only is
  'True when the creator''s only TikTok activity is sample requests cancelled before shipping.';

create index if not exists tiktok_samples_open_id_idx
  on public.tiktok_samples (creator_open_id);
create index if not exists tiktok_affiliate_lines_synced_at_idx
  on public.tiktok_affiliate_lines (synced_at);
create index if not exists tiktok_samples_synced_at_idx
  on public.tiktok_samples (synced_at);
create index if not exists tiktok_target_collab_creators_synced_at_idx
  on public.tiktok_target_collab_creators (synced_at);

-- Stamps current_product_manual_at when Current Product is changed by anything
-- other than the derive functions. A new creator typed in by hand with a
-- product counts as a manual entry too; imports don't (their values are
-- starting values that TikTok replaces).
create or replace function public.creators_track_manual_product()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if coalesce(pg_catalog.current_setting('app.tiktok_sync', true), '') = 'on' then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if new.current_product is not null and new.source <> 'import' and new.current_product_manual_at is null then
      new.current_product_manual_at := pg_catalog.now();
    end if;
  elsif new.current_product is distinct from old.current_product then
    new.current_product_manual_at := pg_catalog.now();
  end if;
  return new;
end;
$$;

drop trigger if exists creators_track_manual_product on public.creators;
create trigger creators_track_manual_product
  before insert or update of current_product on public.creators
  for each row execute function public.creators_track_manual_product();

-- ---------------------------------------------------------------------------
-- tiktok_activity: per TikTok creator, what TikTok shows and the highest stage
-- milestone it implies. Shared by the recompute and the auto-create.
-- p_tc_ids null = every tiktok_creators row; an empty array = none.
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
  request_cancelled_only boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  with base as (
    select tc.id, tc.username_normalised as u, tc.open_id
    from public.tiktok_creators tc
    where p_tc_ids is null or tc.id = any (p_tc_ids)
  ),
  ls as (
    select b.id,
           bool_or(public.tiktok_line_is_sale(l.settlement_status, l.fully_return)) as has_sale,
           bool_or(public.tiktok_line_is_sale(l.settlement_status, l.fully_return)
                   and l.content_type = 'VIDEO') as has_video_sale
    from base b
    join public.tiktok_affiliate_lines l on l.username_normalised = b.u
    group by b.id
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
           ss.sample_stage
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
           case when x.has_sale then 'First Sale Achieved'::public.creator_stage end
         ),
         (not x.has_sale and x.approved_n = 0 and x.pending_n = 0
            and not x.collab_accepted and x.cancelled_n > 0)
  from x
$$;

-- ---------------------------------------------------------------------------
-- 4. Recompute
--
-- tiktok_recompute(uuid[]) is the set-based worker: one statement updates every
-- creator in the array. recompute_creator_tiktok(uuid) is the single-creator
-- wrapper.
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
           c.suggestion_dismissed_value as dismissed,
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
  ov as (
    select distinct on (v.cid, v.product_id) v.cid, v.product_id, v.content_id, v.posted
    from vid v
    join fv f on f.cid = v.cid
    where v.product_id is not null and v.product_id is distinct from f.product_id
    order by v.cid, v.product_id, v.posted, v.content_id
  ),
  ova as (
    select ov.cid,
           jsonb_agg(
             jsonb_build_object(
               'product_id', ov.product_id,
               'product',    public.tiktok_product_name(ov.product_id),
               'date',       pg_catalog.to_char(ov.posted at time zone 'UTC', 'YYYY-MM-DD'),
               'url',        'https://www.tiktok.com/@' || t.username || '/video/' || ov.content_id
             )
             order by ov.posted desc, ov.content_id desc
           ) as list
    from ov join t on t.cid = ov.cid
    group by ov.cid
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
      t.cid, t.cur_stage, t.cur_tier, t.dismissed,
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
           (y.stage_later and not v_auto_stage and y.milestone::text is distinct from y.dismissed) as stage_sugg,
           (y.tier_later and not v_auto_tier and y.tier_cand is distinct from y.dismissed) as tier_sugg,
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
    product_sent_date           = coalesce(z.sent_date, c.product_sent_date),
    product_delivery_date       = coalesce(z.delivered_date, c.product_delivery_date),
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
        ('product_sent_date',          z.sent_date is not null),
        ('product_delivery_date',      z.delivered_date is not null),
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

create or replace function public.recompute_creator_tiktok(p_creator_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.tiktok_recompute(array[p_creator_id]);
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. Linking and auto-create
-- ---------------------------------------------------------------------------

-- Returns {linked, handles_updated}.
create or replace function public.tiktok_link_creators()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_prev    text := coalesce(pg_catalog.current_setting('app.tiktok_sync', true), '');
  v_linked  integer := 0;
  v_handles integer := 0;
begin
  perform pg_catalog.set_config('app.tiktok_sync', 'on', true);

  -- Any status. If several creators share a handle (a removed one and an active
  -- one), the active one is linked, then the oldest.
  with m as (
    select distinct on (tc.id) c.id as cid, tc.id as tcid
    from public.creators c
    join public.tiktok_creators tc on tc.username_normalised = c.handle_normalised
    where c.tiktok_creator_id is null
      and c.handle_normalised is not null
      and not exists (select 1 from public.creators o where o.tiktok_creator_id = tc.id)
    order by tc.id, (c.status = 'active') desc, c.created_at, c.id
  )
  update public.creators c
     set tiktok_creator_id = m.tcid
    from m
   where c.id = m.cid;
  get diagnostics v_linked = row_count;

  -- The sync changed a linked creator's username (same open ID, new handle).
  -- Skipped where another active creator already holds the new handle.
  update public.creators c
     set tiktok_handle = '@' || tc.username
    from public.tiktok_creators tc
   where tc.id = c.tiktok_creator_id
     and c.handle_normalised is distinct from tc.username_normalised
     and public.normalise_tiktok_handle(tc.username) is not null
     and not (
       c.status = 'active' and exists (
         select 1 from public.creators o
          where o.status = 'active' and o.id <> c.id
            and o.handle_normalised = public.normalise_tiktok_handle(tc.username)
       )
     );
  get diagnostics v_handles = row_count;

  perform pg_catalog.set_config('app.tiktok_sync', v_prev, true);
  return jsonb_build_object('linked', v_linked, 'handles_updated', v_handles);
end;
$$;

-- Creates a creator for every TikTok creator that is linked to none (removed
-- ones included) and shows a sale, an approved sample, a pending request or an
-- accepted collab invite. Returns the number created.
create or replace function public.tiktok_autocreate()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_prev    text := coalesce(pg_catalog.current_setting('app.tiktok_sync', true), '');
  v_created integer := 0;
  v_first   public.creator_stage := (pg_catalog.enum_range(null::public.creator_stage))[1];
begin
  perform pg_catalog.set_config('app.tiktok_sync', 'on', true);

  with unlinked as (
    select tc.id
    from public.tiktok_creators tc
    where not exists (select 1 from public.creators c where c.tiktok_creator_id = tc.id)
  ),
  cand as (
    select tc.id, tc.username, tc.nickname, a.milestone
    from public.tiktok_activity(coalesce((select pg_catalog.array_agg(id) from unlinked), '{}'::uuid[])) a
    join public.tiktok_creators tc on tc.id = a.tiktok_creator_id
    where (a.has_sale or a.approved_n > 0 or a.pending_n > 0 or a.collab_accepted)
      and public.normalise_tiktok_handle(tc.username) is not null
  )
  insert into public.creators
    (name, tiktok_handle, tiktok_shop_eligible, stage, source, new_from_tiktok, status, tiktok_creator_id)
  select coalesce(nullif(pg_catalog.btrim(cand.nickname), ''), cand.username),
         '@' || cand.username,
         true,
         coalesce(cand.milestone, v_first),
         'tiktok',
         true,
         'active',
         cand.id
  from cand
  on conflict (handle_normalised) where status = 'active' and handle_normalised is not null
  do nothing;
  get diagnostics v_created = row_count;

  -- A handle that already belonged to an active creator was skipped above;
  -- link those instead.
  perform public.tiktok_link_creators();

  perform pg_catalog.set_config('app.tiktok_sync', v_prev, true);
  return v_created;
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. Triggers on creators
--
-- BEFORE: link (or re-link) by handle, so the row is written with its link.
--   Editing the handle of a linked creator to a different account detaches the
--   old link, and attaches the new account if one exists and is free.
-- AFTER:  recompute the synced fields.
-- Both do nothing for the derive functions' own writes (app.tiktok_sync).
-- ---------------------------------------------------------------------------

create or replace function public.creators_tiktok_link()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_norm text;
begin
  if coalesce(pg_catalog.current_setting('app.tiktok_sync', true), '') = 'on' then
    return new;
  end if;

  -- handle_normalised isn't computed yet in a BEFORE trigger, so use the function.
  v_norm := public.normalise_tiktok_handle(new.tiktok_handle);

  if tg_op = 'UPDATE' and new.tiktok_creator_id is not null then
    if v_norm is distinct from (select tc.username_normalised from public.tiktok_creators tc where tc.id = new.tiktok_creator_id) then
      new.tiktok_creator_id := null;
    end if;
  end if;

  if new.tiktok_creator_id is null and v_norm is not null then
    select tc.id
      into new.tiktok_creator_id
      from public.tiktok_creators tc
     where tc.username_normalised = v_norm
       and not exists (select 1 from public.creators o where o.tiktok_creator_id = tc.id and o.id <> new.id);
  end if;
  return new;
end;
$$;

create or replace function public.creators_tiktok_recompute()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce(pg_catalog.current_setting('app.tiktok_sync', true), '') = 'on' then
    return null;
  end if;
  if new.tiktok_creator_id is not null then
    perform public.tiktok_recompute(array[new.id]);
  end if;
  return null;
end;
$$;

drop trigger if exists creators_tiktok_link_ins on public.creators;
create trigger creators_tiktok_link_ins
  before insert on public.creators
  for each row execute function public.creators_tiktok_link();

drop trigger if exists creators_tiktok_link_upd on public.creators;
create trigger creators_tiktok_link_upd
  before update of tiktok_handle on public.creators
  for each row
  when (old.tiktok_handle is distinct from new.tiktok_handle)
  execute function public.creators_tiktok_link();

drop trigger if exists creators_tiktok_recompute_ins on public.creators;
create trigger creators_tiktok_recompute_ins
  after insert on public.creators
  for each row execute function public.creators_tiktok_recompute();

drop trigger if exists creators_tiktok_recompute_upd on public.creators;
create trigger creators_tiktok_recompute_upd
  after update of tiktok_handle on public.creators
  for each row
  when (old.tiktok_handle is distinct from new.tiktok_handle)
  execute function public.creators_tiktok_recompute();

-- ---------------------------------------------------------------------------
-- 7. Orchestration
--
-- Set-based throughout: link and auto-create are single statements, and the
-- recompute is one statement over the whole id list rather than a row-by-row
-- loop. p_since null = recompute every linked creator.
-- Returns {linked, handles_updated, created, recomputed}.
-- ---------------------------------------------------------------------------

create or replace function public.tiktok_derive(p_since timestamptz default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_prev       text := coalesce(pg_catalog.current_setting('app.tiktok_sync', true), '');
  v_link       jsonb;
  v_created    integer;
  v_ids        uuid[];
  v_recomputed integer;
begin
  perform pg_catalog.set_config('app.tiktok_sync', 'on', true);

  v_link    := public.tiktok_link_creators();
  v_created := public.tiktok_autocreate();

  select coalesce(pg_catalog.array_agg(c.id), '{}'::uuid[])
    into v_ids
    from public.creators c
    join public.tiktok_creators tc on tc.id = c.tiktok_creator_id
   where p_since is null
      or c.tiktok_synced_at is null
      or exists (select 1 from public.tiktok_affiliate_lines l
                  where l.username_normalised = tc.username_normalised and l.synced_at > p_since)
      or exists (select 1 from public.tiktok_samples s
                  where (s.username_normalised = tc.username_normalised
                         or (tc.open_id is not null and s.creator_open_id = tc.open_id))
                    and s.synced_at > p_since)
      or exists (select 1 from public.tiktok_target_collab_creators k
                  where k.username_normalised = tc.username_normalised and k.synced_at > p_since);

  v_recomputed := public.tiktok_recompute(v_ids);

  perform pg_catalog.set_config('app.tiktok_sync', v_prev, true);
  return jsonb_build_object(
    'linked',          (v_link ->> 'linked')::integer,
    'handles_updated', (v_link ->> 'handles_updated')::integer,
    'created',         v_created,
    'recomputed',      v_recomputed
  );
end;
$$;

-- A row to report derive runs in, like the 'token' row.
insert into public.tiktok_sync_state (stream)
values ('derive')
on conflict (stream) do nothing;

-- ---------------------------------------------------------------------------
-- 8. Functions for the app (phase 4). Security definer, no buyer PII.
-- ---------------------------------------------------------------------------

-- GMV and units per linked creator for lines created in [p_from, p_to).
-- p_from null = from the beginning; p_to null = no upper bound. Creators with
-- no lines in the range have no row (treat as 0).
create or replace function public.creator_tiktok_period(p_from timestamptz, p_to timestamptz default null)
returns table (creator_id uuid, gmv numeric, units bigint)
language sql
stable
security definer
set search_path = ''
as $$
  select c.id,
         coalesce(sum(public.tiktok_line_gmv(l.settlement_status, l.actual_commission_base,
                                              l.estimated_commission_base, l.fully_return)), 0),
         coalesce(sum(l.quantity) filter (where public.tiktok_line_is_sale(l.settlement_status, l.fully_return)), 0)::bigint
  from public.creators c
  join public.tiktok_creators tc on tc.id = c.tiktok_creator_id
  join public.tiktok_affiliate_lines l on l.username_normalised = tc.username_normalised
  where (p_from is null or l.create_time >= p_from)
    and (p_to   is null or l.create_time <  p_to)
  group by c.id
$$;

create or replace function public.creator_tiktok_info(p_creator_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_user   text;
  v_open   text;
  v_synced timestamptz;
  v_stats  jsonb;
begin
  select tc.username_normalised, tc.open_id, c.tiktok_synced_at,
         jsonb_build_object(
           'followers',          tc.follower_count,
           'gmv_30d',            tc.gmv_30d,
           'gmv_30d_currency',   tc.gmv_30d_currency,
           'fulfilment_rate',    tc.fulfillment_percentage,
           'median_video_views', tc.ec_video_view,
           'stats_at',           tc.stats_at
         )
    into v_user, v_open, v_synced, v_stats
    from public.creators c
    join public.tiktok_creators tc on tc.id = c.tiktok_creator_id
   where c.id = p_creator_id;

  if not found then
    return jsonb_build_object('linked', false);
  end if;

  return jsonb_build_object(
    'linked',           true,
    'open_id',          v_open,
    'tiktok_synced_at', v_synced,
    'stats',            v_stats,
    'pending_samples', coalesce((
      select jsonb_agg(
               jsonb_build_object(
                 'product',      public.tiktok_product_name(s.product_id, s.product_title),
                 'requested_at', coalesce(s.requested_at, s.first_seen_at),
                 'status',       s.status)
               order by coalesce(s.requested_at, s.first_seen_at) desc)
        from public.tiktok_samples s
       where (s.username_normalised = v_user or s.creator_open_id = v_open)
         and s.status in ('PENDING', 'AWAITING_SHIPMENT')
    ), '[]'::jsonb),
    'samples', coalesce((
      select jsonb_agg(r.j order by r.sd desc)
        from (
          select coalesce(s.requested_at, s.first_seen_at) as sd,
                 jsonb_build_object(
                   'product',      public.tiktok_product_name(s.product_id, s.product_title),
                   'status',       s.status,
                   'requested_at', coalesce(s.requested_at, s.first_seen_at),
                   'shipped_at',   coalesce(s.shipped_at, s.collected_at),
                   'delivered_at', s.delivered_at) as j
            from public.tiktok_samples s
           where s.username_normalised = v_user or s.creator_open_id = v_open
           order by coalesce(s.requested_at, s.first_seen_at) desc
           limit 5
        ) r
    ), '[]'::jsonb),
    'collabs', coalesce((
      select jsonb_agg(r.j order by r.sd desc)
        from (
          select coalesce(k.accepted_at, k.first_seen_at) as sd,
                 jsonb_build_object(
                   'name',                   k.collab_name,
                   'accepted_at',            k.accepted_at,
                   'showcase_product_count', k.showcase_product_count,
                   'content_product_count',  k.content_product_count) as j
            from public.tiktok_target_collab_creators k
           where k.username_normalised = v_user
           order by coalesce(k.accepted_at, k.first_seen_at) desc
           limit 10
        ) r
    ), '[]'::jsonb)
  );
end;
$$;

-- One row per stream (affiliate, samples, sample_orders, target_collabs,
-- token, derive). access_token_expires_at is filled on the token row only.
-- No token values.
create or replace function public.tiktok_sync_status()
returns table (
  stream                  text,
  last_status             text,
  last_error              text,
  last_success_at         timestamptz,
  last_run_finished_at    timestamptz,
  backfill_done           boolean,
  more_to_do              boolean,
  rate_limited_count      integer,
  access_token_expires_at timestamptz
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
         end
    from public.tiktok_sync_state s
   order by s.stream
$$;

-- ---------------------------------------------------------------------------
-- Grants. Everything above is closed to the client roles except the three app
-- functions, which signed-in users may call. The sync calls tiktok_derive
-- with the service role.
-- ---------------------------------------------------------------------------

revoke all on function public.tiktok_product_name(text, text)       from public, anon, authenticated;
revoke all on function public.tiktok_activity(uuid[])               from public, anon, authenticated;
revoke all on function public.tiktok_recompute(uuid[])              from public, anon, authenticated;
revoke all on function public.recompute_creator_tiktok(uuid)        from public, anon, authenticated;
revoke all on function public.tiktok_link_creators()                from public, anon, authenticated;
revoke all on function public.tiktok_autocreate()                   from public, anon, authenticated;
revoke all on function public.tiktok_derive(timestamptz)            from public, anon, authenticated;
revoke all on function public.creators_tiktok_link()                from public, anon, authenticated;
revoke all on function public.creators_tiktok_recompute()           from public, anon, authenticated;
revoke all on function public.creators_track_manual_product()       from public, anon, authenticated;

grant execute on function public.tiktok_product_name(text, text)   to service_role;
grant execute on function public.tiktok_activity(uuid[])           to service_role;
grant execute on function public.tiktok_recompute(uuid[])          to service_role;
grant execute on function public.recompute_creator_tiktok(uuid)    to service_role;
grant execute on function public.tiktok_link_creators()            to service_role;
grant execute on function public.tiktok_autocreate()               to service_role;
grant execute on function public.tiktok_derive(timestamptz)        to service_role;

revoke all on function public.creator_tiktok_period(timestamptz, timestamptz) from public, anon;
revoke all on function public.creator_tiktok_info(uuid)                       from public, anon;
revoke all on function public.tiktok_sync_status()                            from public, anon;

grant execute on function public.creator_tiktok_period(timestamptz, timestamptz) to authenticated, service_role;
grant execute on function public.creator_tiktok_info(uuid)                       to authenticated, service_role;
grant execute on function public.tiktok_sync_status()                            to authenticated, service_role;

commit;
