-- ella bella creator club — profiles, Owner as a user reference, fixed Creator Tier list
-- Run this in the Supabase SQL editor after 004. Safe to re-run.
--
-- The old free-text creators.owner column is left in place (unused by the app)
-- so nothing is lost; drop it once every creator has been reassigned.

begin;

-- ---------------------------------------------------------------------------
-- Profiles: one row per auth user, readable by the team
-- ---------------------------------------------------------------------------

create table if not exists public.profiles (
  id         uuid primary key references auth.users (id) on delete cascade,
  name       text not null,
  email      text,
  created_at timestamptz not null default now()
);

-- Users are invited by hand and named afterwards, so the profile is written on
-- insert and kept in step whenever the name metadata or email changes.
create or replace function public.sync_profile_from_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, name, email)
  values (
    new.id,
    coalesce(nullif(trim(new.raw_user_meta_data ->> 'name'), ''), new.email, 'Unknown user'),
    new.email
  )
  on conflict (id) do update
    set name  = excluded.name,
        email = excluded.email;
  return new;
end;
$$;

-- Trigger-only function: nobody needs to call it through the API.
revoke execute on function public.sync_profile_from_auth_user() from public, anon, authenticated;

drop trigger if exists on_auth_user_created_profile on auth.users;
create trigger on_auth_user_created_profile
  after insert on auth.users
  for each row execute function public.sync_profile_from_auth_user();

drop trigger if exists on_auth_user_updated_profile on auth.users;
create trigger on_auth_user_updated_profile
  after update of raw_user_meta_data, email on auth.users
  for each row
  when (
    old.raw_user_meta_data is distinct from new.raw_user_meta_data
    or old.email is distinct from new.email
  )
  execute function public.sync_profile_from_auth_user();

-- Backfill everyone who already exists.
insert into public.profiles (id, name, email)
select
  u.id,
  coalesce(nullif(trim(u.raw_user_meta_data ->> 'name'), ''), u.email, 'Unknown user'),
  u.email
from auth.users u
on conflict (id) do update
  set name  = excluded.name,
      email = excluded.email;

-- Read-only from the client. Writes only ever come from the trigger above.
alter table public.profiles enable row level security;

drop policy if exists "authenticated users can read profiles" on public.profiles;
create policy "authenticated users can read profiles"
  on public.profiles for select
  to authenticated
  using (true);

revoke all on public.profiles from anon, authenticated;
grant select on public.profiles to authenticated;

-- ---------------------------------------------------------------------------
-- creators.owner_id
-- ---------------------------------------------------------------------------

alter table public.creators
  add column if not exists owner_id uuid references public.profiles (id) on delete set null;

create index if not exists creators_owner_id_idx on public.creators (owner_id);

-- Match the old free-text owner to a profile name, ignoring case and outer
-- whitespace. Names shared by two profiles are skipped rather than guessed.
update public.creators c
set owner_id = p.id
from public.profiles p
where c.owner_id is null
  and nullif(trim(c.owner), '') is not null
  and lower(trim(c.owner)) = lower(trim(p.name))
  and (
    select count(*) from public.profiles p2
    where lower(trim(p2.name)) = lower(trim(p.name))
  ) = 1;

-- ---------------------------------------------------------------------------
-- Creator Tier: Bronze, Silver, Gold, Platinum or null
-- ---------------------------------------------------------------------------

-- Normalise case and any whitespace; anything unrecognised becomes null.
update public.creators
set creator_tier = case regexp_replace(lower(creator_tier), '\s', '', 'g')
  when 'bronze'   then 'Bronze'
  when 'silver'   then 'Silver'
  when 'gold'     then 'Gold'
  when 'platinum' then 'Platinum'
  else null
end
where creator_tier is not null
  and creator_tier not in ('Bronze', 'Silver', 'Gold', 'Platinum');

-- A check constraint rather than an enum: the column stays text, so nothing
-- else changes, and the list can be edited later by swapping the constraint
-- (enum values can't be removed or reordered without rebuilding the type).
alter table public.creators drop constraint if exists creators_creator_tier_check;
alter table public.creators
  add constraint creators_creator_tier_check
  check (creator_tier in ('Bronze', 'Silver', 'Gold', 'Platinum'));

commit;
