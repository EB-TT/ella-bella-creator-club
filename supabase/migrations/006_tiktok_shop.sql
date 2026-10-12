-- TikTok Shop connection: the app's credentials (entered once on the public
-- setup page) and one row per authorised shop with its tokens.
--
-- Both tables hold secrets, so they're service-role only: RLS on with no
-- policies, every grant revoked from the client roles, and not in Realtime.
-- Safe to re-run.

create table if not exists public.tiktok_app_credentials (
  id          boolean primary key default true check (id),
  app_key     text not null,
  app_secret  text not null,
  service_id  text not null,
  region      text not null check (region in ('us', 'global')),
  saved_at    timestamptz not null default now()
);

create table if not exists public.tiktok_shop_connections (
  shop_id                   text primary key,
  shop_cipher               text not null,
  shop_name                 text,
  shop_code                 text,
  region                    text,
  seller_type               text,
  seller_name               text,
  open_id                   text,
  access_token              text not null,
  access_token_expires_at   timestamptz not null,
  refresh_token             text not null,
  refresh_token_expires_at  timestamptz not null,
  granted_scopes            text[],
  connected_at              timestamptz not null default now(),
  updated_at                timestamptz not null default now()
);

-- public.set_updated_at() comes from 001.
drop trigger if exists tiktok_shop_connections_set_updated_at on public.tiktok_shop_connections;
create trigger tiktok_shop_connections_set_updated_at
  before update on public.tiktok_shop_connections
  for each row execute function public.set_updated_at();

alter table public.tiktok_app_credentials enable row level security;
alter table public.tiktok_shop_connections enable row level security;

revoke all on public.tiktok_app_credentials from anon, authenticated;
revoke all on public.tiktok_shop_connections from anon, authenticated;
