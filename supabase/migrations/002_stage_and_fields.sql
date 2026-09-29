-- ella bella creator club — 12-stage journey, product tracking fields
-- Run this in the Supabase SQL editor after 001_creators.sql.
--
-- Only test data exists, so the stage enum and units_sold are replaced outright
-- rather than migrated. Any existing rows fall back to stage 'Joined'.

begin;

-- ---------------------------------------------------------------------------
-- Stage: replace the 7-value enum with the 12-stage journey
-- ---------------------------------------------------------------------------

alter table public.creators drop column stage;
drop type creator_stage;

create type creator_stage as enum (
  'Joined',
  'Accepted (Target Collab Invite)',
  'First Product',
  'Product Sent',
  'First Video',
  'Video Posted',
  'First Sale',
  'First Sale Achieved',
  'Build Momentum',
  'Consistent Creator',
  'Tier Up',
  'Top Performer'
);

alter table public.creators
  add column stage creator_stage not null default 'Joined';

-- ---------------------------------------------------------------------------
-- Units sold: split into current product and lifetime total
-- ---------------------------------------------------------------------------

alter table public.creators drop column units_sold;

alter table public.creators
  add column units_sold_current_product integer,
  add column units_sold_total           integer;

comment on column public.creators.units_sold_current_product is
  'Units sold of the current product.';
comment on column public.creators.units_sold_total is
  'Units sold across all products, lifetime.';

-- ---------------------------------------------------------------------------
-- New fields
-- ---------------------------------------------------------------------------

alter table public.creators
  add column shipping_address        text,
  add column current_product         text,
  -- Products received before the current one: [{ product, date_received }, ...]
  add column other_products_received jsonb not null default '[]'::jsonb;

comment on column public.creators.shipping_address is
  'Only needed for creators who are not TikTok Shop Affiliates.';
comment on column public.creators.current_product is
  'Most recent product sent to / being followed up on with this creator. Manual entry for now; intended to sync from TikTok Shop approved sample data once the Shop API is connected.';
comment on column public.creators.other_products_received is
  'Products received before the current one, as [{ "product": text, "date_received": "YYYY-MM-DD" }]. Manual entry for now; intended to sync from TikTok Shop approved sample history once the Shop API is connected.';

commit;
