-- ella bella creator club — initial schema
-- Run this in the Supabase SQL editor.

-- Journey stages and record status as enums so bad values can't be written.
create type creator_stage as enum (
  'Accepted (Target Collab Invitation)',
  'Received Product',
  'First Video',
  'First Sale',
  'Build Momentum',
  'Consistent Creator',
  'Tier Up'
);

create type creator_status as enum ('active', 'removed');

create table public.creators (
  id uuid primary key default gen_random_uuid(),

  -- Identity
  name                  text not null,
  tiktok_handle         text,
  instagram_handle      text,
  email                 text,
  tiktok_shop_eligible  boolean not null default false,

  -- Journey
  stage                 creator_stage not null default 'Accepted (Target Collab Invitation)',
  next_action           text,
  next_follow_up_date   date,
  owner                 text,
  last_contact          date,

  -- Product & content
  product_sent_date     date,
  product_delivery_date date,
  first_video_date      date,
  first_video_link      text,

  -- Performance
  first_sale_date       date,
  units_sold            integer,
  gmv                   numeric(12, 2),
  creator_tier          text,

  -- Timestamped, authored note entries: [{ author, timestamp, text }, ...]
  notes                 jsonb not null default '[]'::jsonb,

  -- Soft delete
  status                creator_status not null default 'active',
  removed_by            text,
  removed_at            timestamptz,

  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

-- The two views the app reads most: active list sorted by follow-up, and the removed tab.
create index creators_status_idx on public.creators (status);
create index creators_follow_up_idx on public.creators (next_follow_up_date) where status = 'active';

-- Keep updated_at honest without the client having to set it.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger creators_set_updated_at
  before update on public.creators
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Row Level Security
-- MVP policy: any authenticated team member has full read/write access.
-- No per-owner restriction yet. Anonymous users get nothing.
-- ---------------------------------------------------------------------------

alter table public.creators enable row level security;

create policy "authenticated users can read creators"
  on public.creators for select
  to authenticated
  using (true);

create policy "authenticated users can insert creators"
  on public.creators for insert
  to authenticated
  with check (true);

create policy "authenticated users can update creators"
  on public.creators for update
  to authenticated
  using (true)
  with check (true);

-- Deliberately no DELETE policy: the app soft-deletes via status, and without a
-- policy PostgREST will refuse hard deletes even if one is attempted.
