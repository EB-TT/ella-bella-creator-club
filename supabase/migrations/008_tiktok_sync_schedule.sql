-- TikTok Shop sync, phase 2: scheduling support.
--
-- Adds the columns the tiktok-shop-sync Edge Function needs on
-- tiktok_sync_state (overlap lease, hourly/daily pass times, "more to do",
-- warnings), a per-collaboration table so the target-collab stream knows what
-- it has already read, and the pg_cron job that calls the function every
-- 5 minutes. Nothing here touches creators, RLS on existing tables, or
-- creator_valuations.
--
-- Run it AFTER the function is deployed and the Vault secret exists (see the
-- check below): running it starts the 5-minute schedule, and therefore the
-- backfill. Safe to re-run; the job is unscheduled before it is recreated.
--
-- The sync secret is NOT in this file. It is read from Supabase Vault
-- (name: tiktok_sync_secret) each time the job fires.

begin;

-- ---------------------------------------------------------------------------
-- Extensions. If your project won't let SQL enable them, turn them on in
-- Dashboard > Database > Extensions (pg_cron, pg_net) and re-run.
-- ---------------------------------------------------------------------------

do $$
begin
  create extension if not exists pg_cron;
exception when others then
  raise exception 'Could not enable pg_cron (%). Enable it in Dashboard > Database > Extensions, then re-run this migration.', sqlerrm;
end $$;

do $$
begin
  create extension if not exists pg_net;
exception when others then
  raise exception 'Could not enable pg_net (%). Enable it in Dashboard > Database > Extensions, then re-run this migration.', sqlerrm;
end $$;

-- ---------------------------------------------------------------------------
-- tiktok_sync_state: new columns, and the token row
-- ---------------------------------------------------------------------------

alter table public.tiktok_sync_state
  -- A stream claims this (now + 5 min) before working; null or past = free
  add column if not exists lease_until     timestamptz,
  -- When the last complete hourly / daily pass started
  add column if not exists hourly_last_at  timestamptz,
  add column if not exists daily_last_at   timestamptz,
  add column if not exists last_success_at timestamptz,
  -- True when a run stopped early (time budget, rate limit or error)
  add column if not exists more_to_do      boolean not null default false,
  add column if not exists warnings        jsonb;

-- Token health: last_counts holds the raw expiry fields from the last refresh
insert into public.tiktok_sync_state (stream)
values ('token')
on conflict (stream) do nothing;

-- ---------------------------------------------------------------------------
-- tiktok_affiliate_lines: commission amounts, captured now so the backfill
-- doesn't have to be re-run for commission-vs-GMV reporting later. Each is
-- null when TikTok doesn't send it (actual amounts only appear once settled;
-- partner and shop-ads figures only on the lines they apply to).
-- ---------------------------------------------------------------------------

alter table public.tiktok_affiliate_lines
  add column if not exists estimated_paid_commission          numeric,
  add column if not exists actual_paid_commission             numeric,
  add column if not exists estimated_paid_shop_ads_commission numeric,
  add column if not exists actual_paid_shop_ads_commission    numeric,
  add column if not exists estimated_paid_partner_commission  numeric,
  add column if not exists actual_paid_partner_commission     numeric,
  -- Hundredths of a percent, like commission_rate
  add column if not exists shop_ads_commission_rate           integer,
  add column if not exists partner_commission_rate            integer;

-- ---------------------------------------------------------------------------
-- tiktok_target_collabs: one row per VALID target collaboration seen.
-- Lets the daily pass fetch detail only for collaborations whose update_time
-- changed, including ones with no accepted creators (which leave no row in
-- tiktok_target_collab_creators).
-- ---------------------------------------------------------------------------

create table if not exists public.tiktok_target_collabs (
  collab_id          text primary key,
  name               text,
  list_update_time   timestamptz,
  -- Set when the list shows a new update_time; cleared once detail is read
  needs_detail       boolean not null default true,
  -- Detail calls that failed since the last change; at 3 the collab is skipped
  detail_failures    integer not null default 0,
  detail_synced_at   timestamptz,
  -- Start of the pass that last listed it
  last_listed_at     timestamptz,
  first_seen_at      timestamptz not null default now(),
  synced_at          timestamptz not null default now()
);

create index if not exists tiktok_target_collabs_pending_idx
  on public.tiktok_target_collabs (collab_id)
  where needs_detail;

alter table public.tiktok_target_collabs enable row level security;
revoke all on public.tiktok_target_collabs from anon, authenticated;

-- ---------------------------------------------------------------------------
-- The schedule
-- ---------------------------------------------------------------------------

do $$
begin
  if not exists (select 1 from vault.decrypted_secrets where name = 'tiktok_sync_secret') then
    raise exception 'Vault secret "tiktok_sync_secret" is missing. Add it first (see the setup steps), then re-run this migration.';
  end if;
end $$;

-- Unschedule any existing job with this name, so a re-run replaces it
select cron.unschedule(jobid) from cron.job where jobname = 'tiktok-shop-sync';

select cron.schedule(
  'tiktok-shop-sync',
  '*/5 * * * *',
  $job$
  select net.http_post(
    url := 'https://alxzuzxathoqxlrbmbry.supabase.co/functions/v1/tiktok-shop-sync',
    headers := jsonb_build_object(
      'content-type', 'application/json',
      'x-sync-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'tiktok_sync_secret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 5000
  );
  $job$
);

commit;
