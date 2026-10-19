-- TikTok Shop sync, phase 1: schema only.
--
-- Adds the tiktok_* tables the sync will fill, and the TikTok-derived columns
-- on creators. No existing policies, grants or rows are changed; the new
-- creators columns only take their defaults. Nothing here touches
-- creator_valuations.
--
-- The tiktok_* tables are service-role only: RLS on with no policies, every
-- grant revoked from the client roles, and not in Realtime. Views and
-- functions for the app come in later phases.
--
-- One transaction. Safe to re-run.

begin;

-- ---------------------------------------------------------------------------
-- tiktok_creators: one row per TikTok creator seen
-- ---------------------------------------------------------------------------

create table if not exists public.tiktok_creators (
  id                      uuid primary key default gen_random_uuid(),
  username                text not null,
  -- lowercase, trimmed, no leading "@"
  username_normalised     text not null unique,
  open_id                 text unique,
  nickname                text,

  -- Stats from sample applications
  follower_count          integer,
  gmv_30d                 numeric,
  gmv_30d_currency        text,
  fulfillment_percentage  numeric,
  ec_video_view           integer,
  stats_at                timestamptz,

  first_seen_at           timestamptz not null default now(),
  last_seen_at            timestamptz,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- tiktok_products: affiliate order lines only carry product_id, so titles
-- come from sample applications and target collaboration detail
-- ---------------------------------------------------------------------------

create table if not exists public.tiktok_products (
  product_id  text primary key,
  title       text,
  -- For the team to set later
  short_name  text,
  updated_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- tiktok_affiliate_lines: one row per affiliate order SKU line
-- ---------------------------------------------------------------------------

create table if not exists public.tiktok_affiliate_lines (
  order_id                   text not null,
  sku_id                     text not null,
  -- The line's own id, if TikTok sends one
  line_id                    text,
  -- Empty for partner campaign orders
  creator_username           text,
  username_normalised        text,

  product_id                 text,
  quantity                   integer,
  price_amount               numeric,
  currency                   text,
  -- Only present once settled
  actual_commission_base     numeric,
  estimated_commission_base  numeric,
  fully_return               boolean,
  settlement_status          text,

  content_type               text,
  content_id                 text,
  open_collaboration_id      text,
  target_collaboration_id    text,
  campaign_id                text,
  -- Hundredths of a percent
  commission_rate            integer,

  create_time                timestamptz not null,
  delivery_time              timestamptz,
  first_synced_at            timestamptz not null default now(),
  synced_at                  timestamptz not null default now(),

  primary key (order_id, sku_id)
);

create index if not exists tiktok_affiliate_lines_username_idx
  on public.tiktok_affiliate_lines (username_normalised);
create index if not exists tiktok_affiliate_lines_create_time_idx
  on public.tiktok_affiliate_lines (create_time);
create index if not exists tiktok_affiliate_lines_product_idx
  on public.tiktok_affiliate_lines (product_id);
create index if not exists tiktok_affiliate_lines_username_time_idx
  on public.tiktok_affiliate_lines (username_normalised, create_time);

-- ---------------------------------------------------------------------------
-- tiktok_samples: one row per sample application
-- ---------------------------------------------------------------------------

create table if not exists public.tiktok_samples (
  -- Application ID
  id                   text primary key,
  creator_open_id      text,
  username             text,
  username_normalised  text,

  product_id           text,
  product_title        text,
  sku_id               text,
  sku_name             text,

  status               text not null,
  fulfillment_status   text,
  commission_rate      numeric,
  -- Null when TikTok sends "0"
  order_id             text,

  -- Sample order create time once known, else first seen
  requested_at         timestamptz,
  order_created_at     timestamptz,
  -- rts_time
  shipped_at           timestamptz,
  -- collection_time
  collected_at         timestamptz,
  delivered_at         timestamptz,

  first_seen_at        timestamptz not null default now(),
  status_changed_at    timestamptz,
  synced_at            timestamptz not null default now()
);

create index if not exists tiktok_samples_username_idx
  on public.tiktok_samples (username_normalised);
create index if not exists tiktok_samples_status_idx
  on public.tiktok_samples (status);
create index if not exists tiktok_samples_order_idx
  on public.tiktok_samples (order_id);
create index if not exists tiktok_samples_product_idx
  on public.tiktok_samples (product_id);

-- ---------------------------------------------------------------------------
-- tiktok_target_collab_creators: accepted/posted creators per target collab
-- ---------------------------------------------------------------------------

create table if not exists public.tiktok_target_collab_creators (
  collab_id               text not null,
  username_normalised     text not null,
  open_id                 text,
  username                text,
  collab_name             text,
  showcase_product_count  integer,
  content_product_count   integer,
  creator_collab_status   text,
  -- First time showcase > 0 was seen
  accepted_at             timestamptz,
  collab_update_time      timestamptz,
  first_seen_at           timestamptz not null default now(),
  synced_at               timestamptz not null default now(),

  primary key (collab_id, username_normalised)
);

create index if not exists tiktok_target_collab_creators_username_idx
  on public.tiktok_target_collab_creators (username_normalised);

-- ---------------------------------------------------------------------------
-- tiktok_sync_state: one row per stream
-- ---------------------------------------------------------------------------

create table if not exists public.tiktok_sync_state (
  stream                text primary key,
  backfill_cursor       jsonb,
  backfill_done         boolean not null default false,
  last_run_started_at   timestamptz,
  last_run_finished_at  timestamptz,
  last_status           text,
  last_error            text,
  last_counts           jsonb,
  rate_limited_count    integer not null default 0,
  updated_at            timestamptz not null default now()
);

insert into public.tiktok_sync_state (stream)
values ('affiliate'), ('samples'), ('sample_orders'), ('target_collabs')
on conflict (stream) do nothing;

-- ---------------------------------------------------------------------------
-- tiktok_settings: a single row
-- ---------------------------------------------------------------------------

create table if not exists public.tiktok_settings (
  id                  boolean primary key default true check (id),
  auto_apply_stage    boolean not null default false,
  auto_apply_tier     boolean not null default false,
  -- Null until the team decides
  tier_bands          jsonb,
  updated_at          timestamptz not null default now()
);

insert into public.tiktok_settings (id)
values (true)
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- updated_at triggers (public.set_updated_at() comes from 001)
-- ---------------------------------------------------------------------------

drop trigger if exists tiktok_creators_set_updated_at on public.tiktok_creators;
create trigger tiktok_creators_set_updated_at
  before update on public.tiktok_creators
  for each row execute function public.set_updated_at();

drop trigger if exists tiktok_products_set_updated_at on public.tiktok_products;
create trigger tiktok_products_set_updated_at
  before update on public.tiktok_products
  for each row execute function public.set_updated_at();

drop trigger if exists tiktok_sync_state_set_updated_at on public.tiktok_sync_state;
create trigger tiktok_sync_state_set_updated_at
  before update on public.tiktok_sync_state
  for each row execute function public.set_updated_at();

drop trigger if exists tiktok_settings_set_updated_at on public.tiktok_settings;
create trigger tiktok_settings_set_updated_at
  before update on public.tiktok_settings
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- New columns on creators
-- ---------------------------------------------------------------------------

alter table public.creators
  add column if not exists tiktok_creator_id uuid unique
    references public.tiktok_creators (id) on delete set null,
  -- tiktok_handle lowercased, trimmed, leading "@" removed; empty becomes null
  add column if not exists handle_normalised text
    generated always as (nullif(lower(btrim(regexp_replace(btrim(tiktok_handle), '^@', ''))), '')) stored,
  add column if not exists source text not null default 'manual'
    check (source in ('manual', 'import', 'tiktok')),
  add column if not exists new_from_tiktok boolean not null default false,
  add column if not exists synced_fields jsonb not null default '{}'::jsonb,
  add column if not exists suggested_stage text,
  add column if not exists suggested_tier text,
  add column if not exists suggestion_reason text,
  -- A dismissed suggestion isn't shown again until the suggestion changes
  add column if not exists suggestion_dismissed_value text,
  add column if not exists last_sale_at timestamptz,
  -- [{ product_id, product, date, url }]
  add column if not exists other_videos jsonb not null default '[]'::jsonb,
  add column if not exists tiktok_synced_at timestamptz;

-- Stop with a clear error, rather than touching data, if two active creators
-- already share a normalised handle.
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
-- Lock the new tables to the service role
-- ---------------------------------------------------------------------------

alter table public.tiktok_creators              enable row level security;
alter table public.tiktok_products              enable row level security;
alter table public.tiktok_affiliate_lines       enable row level security;
alter table public.tiktok_samples               enable row level security;
alter table public.tiktok_target_collab_creators enable row level security;
alter table public.tiktok_sync_state            enable row level security;
alter table public.tiktok_settings              enable row level security;

revoke all on public.tiktok_creators               from anon, authenticated;
revoke all on public.tiktok_products               from anon, authenticated;
revoke all on public.tiktok_affiliate_lines        from anon, authenticated;
revoke all on public.tiktok_samples                from anon, authenticated;
revoke all on public.tiktok_target_collab_creators from anon, authenticated;
revoke all on public.tiktok_sync_state             from anon, authenticated;
revoke all on public.tiktok_settings               from anon, authenticated;

commit;
