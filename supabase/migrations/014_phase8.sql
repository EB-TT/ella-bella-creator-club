-- Phase 8a, part 2 of 2: journey, view-based tiers, analytics sync tables,
-- new creator fields and engagement (follows 013, which must have run first).
--
--  1. New creators columns (language, mobile, cc_join_date, discord_handle,
--     last_engaged_at, the three view totals, stage_manual_at).
--  2. Triggers: stage_manual_at, and CC Join Date -> Joined.
--  3. Analytics tables: tiktok_videos, tiktok_video_window_views, tiktok_lives
--     (service role only), and the video_views / live_views sync-state rows.
--  4. creator_engagements, its triggers and policies, and creator_videos().
--  5. Settings: tier bands gain min_views; update_tiktok_settings validates both.
--  6. Derive: tiktok_sample_stage, tiktok_activity, tiktok_recompute,
--     tiktok_autocreate and tiktok_derive re-created for the new journey rules.
--     Every function that named the old 'Accepted (Target Collab Invite)'
--     literal is re-created here (tiktok_activity, tiktok_recompute); the older
--     copies in 009-011 were already superseded by 012.
--  7. tiktok_replace_untouched(): the one-off re-placement. NOT called here.
--
-- Run order (see the hand-back): pause cron, run 013, run this, redeploy the
-- sync function, `select public.tiktok_replace_untouched();`,
-- `select public.tiktok_derive(null);`, resume cron.
--
-- Nothing here touches creator_valuations. The manual-only fields (owner, next
-- action, follow-up date, last contact, Instagram, email, notes, shipping
-- address, language, mobile, CC Join Date, Discord) are never written by a
-- database function; the only automatic writes to `stage` are the derive
-- (forward-only, or suggestions), the CC Join Date trigger, and the one-off
-- re-placement. Safe to re-run. One transaction.

begin;

-- ---------------------------------------------------------------------------
-- 1. creators columns
-- ---------------------------------------------------------------------------

alter table public.creators
  add column if not exists language         text,
  add column if not exists mobile           text,
  add column if not exists cc_join_date     date,
  add column if not exists discord_handle   text,
  add column if not exists last_engaged_at  timestamptz,
  add column if not exists ella_bella_views bigint,
  add column if not exists video_views      bigint,
  add column if not exists live_views       bigint,
  add column if not exists stage_manual_at  timestamptz;

alter table public.creators drop constraint if exists creators_language_check;
alter table public.creators
  add constraint creators_language_check check (language in ('English', 'Spanish'));

comment on column public.creators.language is 'English or Spanish. Null is shown as English. Manual only.';
comment on column public.creators.mobile is 'Mobile number. Manual only.';
comment on column public.creators.cc_join_date is
  'When the creator joined the Creator Club. Setting it (null -> a date) moves an earlier stage to Joined. Manual only.';
comment on column public.creators.discord_handle is 'Discord handle. Manual only.';
comment on column public.creators.last_engaged_at is
  'Latest like or comment on the creator''s videos; kept by a trigger on creator_engagements.';
comment on column public.creators.video_views is 'TikTok: total views of the creator''s videos (sum over non-overlapping windows).';
comment on column public.creators.live_views is 'TikTok: total views of the creator''s LIVE sessions (whole session).';
comment on column public.creators.ella_bella_views is 'TikTok: video_views + live_views.';
comment on column public.creators.stage_manual_at is
  'When the stage was last changed outside the TikTok derive. Null = the team never moved this creator by hand.';

-- ---------------------------------------------------------------------------
-- 2. Triggers on creators
-- ---------------------------------------------------------------------------

-- CC Join Date goes from null to a date: an earlier stage (Invited) becomes
-- Joined. The only automatic rule for Joined; 'Invited' stays manual.
create or replace function public.creators_cc_join_to_joined()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.cc_join_date is not null
     and (tg_op = 'INSERT' or old.cc_join_date is null)
     and new.stage < 'Joined'::public.creator_stage then
    new.stage := 'Joined'::public.creator_stage;
  end if;
  return new;
end;
$$;

drop trigger if exists creators_cc_join_to_joined on public.creators;
create trigger creators_cc_join_to_joined
  before insert or update of cc_join_date on public.creators
  for each row execute function public.creators_cc_join_to_joined();

-- Stamps stage_manual_at when the stage changes outside the derive. The
-- trigger name sorts after creators_cc_join_to_joined, so a stage that trigger
-- sets (a team member entering CC Join Date) is stamped too.
create or replace function public.creators_stamp_stage_manual()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if coalesce(pg_catalog.current_setting('app.tiktok_sync', true), '') <> 'on'
     and new.stage is distinct from old.stage then
    new.stage_manual_at := pg_catalog.now();
  end if;
  return new;
end;
$$;

drop trigger if exists creators_stamp_stage_manual on public.creators;
create trigger creators_stamp_stage_manual
  before update on public.creators
  for each row execute function public.creators_stamp_stage_manual();

-- ---------------------------------------------------------------------------
-- 3. Analytics tables (service role only: RLS on, no policies, no grants,
--    not in Realtime)
-- ---------------------------------------------------------------------------

create table if not exists public.tiktok_videos (
  video_id             text primary key,
  username_normalised  text not null,
  username             text not null,
  post_time            timestamptz,
  title                text,
  duration             integer,
  -- [{ id, name }]
  products             jsonb not null default '[]'::jsonb,
  first_seen_at        timestamptz not null default now(),
  last_seen_at         timestamptz not null default now()
);

create index if not exists tiktok_videos_username_idx on public.tiktok_videos (username_normalised);
create index if not exists tiktok_videos_last_seen_idx on public.tiktok_videos (last_seen_at);

-- One row per video per fetched window. The sync tiles non-overlapping windows,
-- so a video's total views = sum(views) over its rows.
create table if not exists public.tiktok_video_window_views (
  video_id      text not null references public.tiktok_videos (video_id) on delete cascade,
  window_start  date not null,
  -- exclusive
  window_end    date not null,
  views         bigint not null default 0,
  likes         bigint,
  comments      bigint,
  shares        bigint,
  gmv           numeric,
  items_sold    integer,
  fetched_at    timestamptz not null default now(),
  primary key (video_id, window_start),
  check (window_end > window_start)
);

-- Overlapping windows for one video would double-count views, so the database
-- refuses them where it can (needs btree_gist). If the extension can't be
-- enabled the migration carries on and the verification query still checks.
do $$
begin
  create extension if not exists btree_gist with schema extensions;
  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conrelid = 'public.tiktok_video_window_views'::regclass
      and conname = 'tiktok_video_window_views_no_overlap'
  ) then
    alter table public.tiktok_video_window_views
      add constraint tiktok_video_window_views_no_overlap
      exclude using gist (video_id with =, pg_catalog.daterange(window_start, window_end) with &&);
  end if;
exception when others then
  raise notice 'No-overlap constraint on tiktok_video_window_views not created (%). The verification query still checks for overlaps.', sqlerrm;
end $$;

create table if not exists public.tiktok_lives (
  live_id               text primary key,
  username_normalised   text not null,
  username              text not null,
  start_time            timestamptz,
  end_time              timestamptz,
  views                 bigint not null default 0,
  viewers               bigint,
  live_attributed_gmv   numeric,
  fetched_at            timestamptz not null default now()
);

create index if not exists tiktok_lives_username_idx on public.tiktok_lives (username_normalised);
create index if not exists tiktok_lives_fetched_idx on public.tiktok_lives (fetched_at);

alter table public.tiktok_videos             enable row level security;
alter table public.tiktok_video_window_views enable row level security;
alter table public.tiktok_lives              enable row level security;

revoke all on public.tiktok_videos             from anon, authenticated;
revoke all on public.tiktok_video_window_views from anon, authenticated;
revoke all on public.tiktok_lives              from anon, authenticated;

-- Sync state. `progress` holds what must outlive a finished pass (the sync
-- clears backfill_cursor when a pass completes): lookback_floor,
-- backfill_windows_done, covered_until, latest_available_date. The in-progress
-- window and page token stay in backfill_cursor.
alter table public.tiktok_sync_state add column if not exists progress jsonb;

insert into public.tiktok_sync_state (stream)
values ('video_views'), ('live_views')
on conflict (stream) do nothing;

-- ---------------------------------------------------------------------------
-- 4. Engagement
-- ---------------------------------------------------------------------------

create table if not exists public.creator_engagements (
  id                    uuid primary key default gen_random_uuid(),
  creator_id            uuid not null references public.creators (id) on delete cascade,
  -- Null for a pasted link
  video_id              text,
  video_url             text,
  liked_at              timestamptz,
  liked_by              uuid references public.profiles (id) on delete set null,
  commented_at          timestamptz,
  commented_by          uuid references public.profiles (id) on delete set null,
  featured_ella_bella   boolean not null default true,
  created_at            timestamptz not null default now(),
  check (video_id is not null or video_url is not null)
);

create unique index if not exists creator_engagements_creator_video_uniq
  on public.creator_engagements (creator_id, video_id)
  where video_id is not null;
create index if not exists creator_engagements_creator_idx on public.creator_engagements (creator_id);

alter table public.creator_engagements enable row level security;

-- Signed-in users can read, add and edit. No delete: clearing a tick sets its
-- timestamp to null.
drop policy if exists "authenticated users can read engagements" on public.creator_engagements;
create policy "authenticated users can read engagements"
  on public.creator_engagements for select to authenticated using (true);

drop policy if exists "authenticated users can insert engagements" on public.creator_engagements;
create policy "authenticated users can insert engagements"
  on public.creator_engagements for insert to authenticated with check (true);

drop policy if exists "authenticated users can update engagements" on public.creator_engagements;
create policy "authenticated users can update engagements"
  on public.creator_engagements for update to authenticated using (true) with check (true);

revoke all on public.creator_engagements from anon;
revoke delete, truncate on public.creator_engagements from authenticated;
grant select, insert, update on public.creator_engagements to authenticated;

-- liked_by / commented_by follow their timestamps.
create or replace function public.creator_engagements_stamp_by()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.liked_at is null then
    new.liked_by := null;
  elsif new.liked_by is null then
    new.liked_by := auth.uid();
  end if;
  if new.commented_at is null then
    new.commented_by := null;
  elsif new.commented_by is null then
    new.commented_by := auth.uid();
  end if;
  return new;
end;
$$;

drop trigger if exists creator_engagements_stamp_by on public.creator_engagements;
create trigger creator_engagements_stamp_by
  before insert or update on public.creator_engagements
  for each row execute function public.creator_engagements_stamp_by();

-- creators.last_engaged_at = the latest like or comment for that creator.
create or replace function public.creator_engagements_sync_last()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old uuid;
  v_new uuid;
begin
  if tg_op in ('UPDATE', 'DELETE') then
    v_old := old.creator_id;
  end if;
  if tg_op in ('INSERT', 'UPDATE') then
    v_new := new.creator_id;
  end if;

  update public.creators c
     set last_engaged_at = (
       select max(greatest(e.liked_at, e.commented_at))
         from public.creator_engagements e
        where e.creator_id = c.id)
   where c.id in (v_old, v_new);
  return null;
end;
$$;

drop trigger if exists creator_engagements_sync_last on public.creator_engagements;
create trigger creator_engagements_sync_last
  after insert or update or delete on public.creator_engagements
  for each row execute function public.creator_engagements_sync_last();

-- A creator's Ella Bella videos for the app, newest first:
--   videos: analytics videos (total views = sum over windows), then selling
--           videos from affiliate lines that analytics doesn't list, then
--           pasted-link engagements (video_id null). Each carries its
--           engagement state.
--   lives:  the creator's LIVE sessions, newest first.
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
   where v_user is not null and l.username_normalised = v_user;

  return pg_catalog.jsonb_build_object('videos', v_videos, 'lives', v_lives);
end;
$$;

revoke all on function public.creator_videos(uuid) from public, anon;
grant execute on function public.creator_videos(uuid) to authenticated, service_role;

revoke all on function public.creator_engagements_sync_last() from public, anon, authenticated;
revoke all on function public.creator_engagements_stamp_by()  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. Settings: tier bands gain min_views
--    Only while the stored bands have no min_views, so a re-run never undoes an
--    admin's edit. Basis stays as it is (all_time by default).
-- ---------------------------------------------------------------------------

update public.tiktok_settings s
   set tier_bands = pg_catalog.jsonb_build_object(
         'basis', coalesce(s.tier_bands ->> 'basis', 'all_time'),
         'bands', pg_catalog.jsonb_build_array(
           pg_catalog.jsonb_build_object('tier', 'Bronze',   'min_gmv', 100,   'min_views', 5000),
           pg_catalog.jsonb_build_object('tier', 'Silver',   'min_gmv', 500,   'min_views', 20000),
           pg_catalog.jsonb_build_object('tier', 'Gold',     'min_gmv', 2500,  'min_views', 100000),
           pg_catalog.jsonb_build_object('tier', 'Platinum', 'min_gmv', 10000, 'min_views', 500000)))
 where s.id
   and (s.tier_bands is null or (s.tier_bands #>> '{bands,0,min_views}') is null);

-- ---------------------------------------------------------------------------
-- 6. Derive
--
-- 6a. tiktok_sample_stage: what a sample status points to under the new rules.
--     Any sample application proves TT Shop Enabled (PENDING, and requests
--     that were withdrawn, rejected or overdue). First Product needs an
--     approval: AWAITING_SHIPMENT, or a cancellation after approval
--     (UNFULFILL_CANCELLED, UNFULFILLABLE_CANCELLED, SELLER_NOT_SHIP_CANCELLED,
--     and the OPS_* approved statuses as before). Others as in 009.
--     tiktok_sample_is_approved is NOT changed, so Current Product and
--     Other Products Received behave exactly as before.
-- ---------------------------------------------------------------------------

create or replace function public.tiktok_sample_stage(p_status text)
returns public.creator_stage
language sql
immutable
parallel safe
set search_path = ''
as $$
  select case
    when p_status = 'PENDING'                                         then 'TT Shop Enabled'::public.creator_stage
    when p_status in ('AWAITING_SHIPMENT', 'SELLER_NOT_SHIP_CANCELLED') then 'First Product'::public.creator_stage
    when p_status = 'SHIPPED'                                         then 'Product Sent'::public.creator_stage
    when p_status = 'CONTENT_PENDING'                                 then 'First Video'::public.creator_stage
    when p_status = 'COMPLETED'                                       then 'Video Posted'::public.creator_stage
    when public.tiktok_sample_is_approved(p_status)                   then 'First Product'::public.creator_stage
    when p_status is not null                                         then 'TT Shop Enabled'::public.creator_stage
  end
$$;

-- ---------------------------------------------------------------------------
-- 6b. tiktok_activity: as in 012, changed only where marked "014:".
--     New return columns: ella_bella_content, consistent_met.
--     The return type changes, so the function is dropped and recreated.
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
  eb as (
    select b.id
    from base b
    where exists (select 1 from public.tiktok_videos v where v.username_normalised = b.u)
       or exists (select 1 from public.tiktok_lives l where l.username_normalised = b.u)
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
-- 6c. tiktok_recompute: as in 012, changed only where marked "014:"
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
      -- 014: highest tier reached by GMV or by Ella Bella views. Bronze also needs
      -- the Consistent Creator criteria; Silver and above do not depend on stage.
      case when v_has_bands then
        (select b.tier from bands b
          where ((b.min_gmv is not null
                  and b.min_gmv <= (case v_basis when 'last_30_days' then coalesce(la.g30, 0)
                                                 when 'last_90_days' then coalesce(la.g90, 0)
                                                 else coalesce(la.gmv, 0) end))
              or (b.min_views is not null
                  and b.min_views <= coalesce(vv.v, 0) + coalesce(lv.v, 0)))
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
           -- 014: names the measure that reached the tier:
           -- "All-time GMV $612 reaches Silver" or "Ella Bella views 23,410 reach Silver"
           case when y.tier_by_gmv then
             case v_basis when 'last_30_days' then 'Last 30 days GMV $'
                          when 'last_90_days' then 'Last 90 days GMV $'
                          else 'All-time GMV $' end
               || pg_catalog.to_char(pg_catalog.round(y.tier_gmv), 'FM999,999,999,990')
               || ' reaches ' || y.tier_cand
           else
             'Ella Bella views ' || pg_catalog.to_char(coalesce(y.eb_views, 0), 'FM999,999,999,990')
               || ' reach ' || y.tier_cand
           end as tier_reason
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

-- ---------------------------------------------------------------------------
-- 6d. tiktok_autocreate: as in 009, plus "has an Ella Bella video or LIVE".
--     The stage fallback is now explicit (the first enum value is 'Invited',
--     which the derive never sets); the activity milestone is never null.
-- ---------------------------------------------------------------------------

create or replace function public.tiktok_autocreate()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_prev    text := coalesce(pg_catalog.current_setting('app.tiktok_sync', true), '');
  v_created integer := 0;
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
    -- 014: or an Ella Bella video / LIVE
    where (a.has_sale or a.approved_n > 0 or a.pending_n > 0 or a.collab_accepted or a.ella_bella_content)
      and public.normalise_tiktok_handle(tc.username) is not null
  )
  insert into public.creators
    (name, tiktok_handle, tiktok_shop_eligible, stage, source, new_from_tiktok, status, tiktok_creator_id)
  select coalesce(nullif(pg_catalog.btrim(cand.nickname), ''), cand.username),
         '@' || cand.username,
         true,
         coalesce(cand.milestone, 'TT Shop Enabled'::public.creator_stage),
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
-- 6e. tiktok_derive: as in 009, and a creator with analytics rows fetched
--     since p_since is recomputed too.
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
                  where k.username_normalised = tc.username_normalised and k.synced_at > p_since)
      -- 014: analytics
      or exists (select 1 from public.tiktok_videos v
                  where v.username_normalised = tc.username_normalised and v.last_seen_at > p_since)
      or exists (select 1 from public.tiktok_lives lv
                  where lv.username_normalised = tc.username_normalised and lv.fetched_at > p_since);

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

revoke all on function public.tiktok_autocreate()        from public, anon, authenticated;
revoke all on function public.tiktok_derive(timestamptz) from public, anon, authenticated;
grant execute on function public.tiktok_autocreate()        to service_role;
grant execute on function public.tiktok_derive(timestamptz) to service_role;

-- ---------------------------------------------------------------------------
-- 6f. update_tiktok_settings: as in 012; tier bands now need min_views too.
--     (get_tiktok_settings already returns the stored tier_bands as they are.)
-- ---------------------------------------------------------------------------

-- 014: each tier needs min_gmv AND min_views, both ascending and above zero.
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
  v_min_v   numeric;
  v_prev_v  numeric := 0;
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

      if (v_elem ->> 'min_views') is null or (v_elem ->> 'min_views') !~ '^[0-9]{1,12}$' then
        raise exception '% needs a minimum number of views that is a whole number.', v_tier;
      end if;
      v_min_v := (v_elem ->> 'min_views')::numeric;
      if v_min_v <= 0 then
        raise exception '% needs a minimum number of views above 0.', v_tier;
      end if;
      if v_min_v <= v_prev_v then
        raise exception 'Minimum views must go up at each tier: % must be above the tier before it.', v_tier;
      end if;
      v_prev_v := v_min_v;

      v_out := v_out || pg_catalog.jsonb_build_array(
                 pg_catalog.jsonb_build_object('tier', v_tier, 'min_gmv', v_min, 'min_views', v_min_v));
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

revoke all on function public.update_tiktok_settings(jsonb) from public, anon;
grant execute on function public.update_tiktok_settings(jsonb) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 7. One-off re-placement. NOT called by this migration.
--
-- For active, TikTok-sourced creators the team has never touched (no manual
-- stage change, no owner), sets `stage` to the highest milestone under the NEW
-- rules. This can move a creator BACKWARDS (e.g. a pending sample request used
-- to read First Product and is now TT Shop Enabled). Tiers are left to the
-- suggestions; the stage suggestion is cleared (the next derive rebuilds it).
-- Manual-only fields are not written, and stage_manual_at is NOT stamped (the
-- derive switch is on while it runs).
--
-- Run once, after 013 and 014 are in:
--   select public.tiktok_replace_untouched();
-- then `select public.tiktok_derive(null);`.
--
-- Returns { moved, in_scope, changes: [{ from, to, n }, ...] }.
-- Callable by the service role / SQL editor, or by a signed-in admin.
-- ---------------------------------------------------------------------------

create or replace function public.tiktok_replace_untouched()
returns jsonb
language plpgsql
security definer
set search_path = ''
set statement_timeout = '300s'
as $$
declare
  v_prev     text := coalesce(pg_catalog.current_setting('app.tiktok_sync', true), '');
  v_scope    integer;
  v_changes  jsonb;
  v_moved    integer;
begin
  if auth.uid() is not null and not public.is_admin() then
    raise exception 'Only admins can run the re-placement.' using errcode = '42501';
  end if;

  perform pg_catalog.set_config('app.tiktok_sync', 'on', true);

  with
  sc as (
    select c.id as cid, c.tiktok_creator_id as tcid, c.stage as old_stage,
           c.suggested_stage, c.suggested_tier
    from public.creators c
    where c.status = 'active'
      and c.source = 'tiktok'
      and c.tiktok_creator_id is not null
      and c.stage_manual_at is null
      and c.owner_id is null
  ),
  act as (
    select a.tiktok_creator_id, a.milestone
    from public.tiktok_activity(coalesce((select pg_catalog.array_agg(sc.tcid) from sc), '{}'::uuid[])) a
  ),
  s as (
    select sc.*, act.milestone as new_stage
    from sc join act on act.tiktok_creator_id = sc.tcid
  ),
  upd as (
    update public.creators c set
      stage             = s.new_stage,
      suggested_stage   = null,
      -- Keep the tier part of "<stage reason> · <tier reason>".
      suggestion_reason = case when s.suggested_tier is not null
                               then nullif(pg_catalog.split_part(c.suggestion_reason, ' · ', 2), '')
                          end
    from s
    where c.id = s.cid
      and (c.stage is distinct from s.new_stage or s.suggested_stage is not null)
    returning s.old_stage, s.new_stage
  ),
  g as (
    select u.old_stage, u.new_stage, count(*) as n
    from upd u
    where u.old_stage is distinct from u.new_stage
    group by u.old_stage, u.new_stage
  )
  select (select count(*) from s)::integer,
         coalesce((select sum(g.n) from g), 0)::integer,
         coalesce((select pg_catalog.jsonb_agg(
                     pg_catalog.jsonb_build_object('from', g.old_stage, 'to', g.new_stage, 'n', g.n)
                     order by g.old_stage, g.new_stage)
                   from g), '[]'::jsonb)
    into v_scope, v_moved, v_changes;

  perform pg_catalog.set_config('app.tiktok_sync', v_prev, true);
  return pg_catalog.jsonb_build_object('in_scope', v_scope, 'moved', v_moved, 'changes', v_changes);
end;
$$;

revoke all on function public.tiktok_replace_untouched() from public, anon;
grant execute on function public.tiktok_replace_untouched() to authenticated, service_role;

commit;
