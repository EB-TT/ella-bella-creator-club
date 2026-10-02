create table public.creator_valuations (
  id uuid primary key default gen_random_uuid(),
  platform text not null check (platform in ('tiktok', 'instagram')),
  handle text not null check (handle = lower(handle) and handle !~ '^@' and length(handle) between 1 and 100),
  quoted_rate numeric(12,2) check (quoted_rate is null or quoted_rate >= 0),
  status text not null default 'pending' check (status in ('pending', 'running', 'complete', 'failed')),
  error text,
  results jsonb,
  credits_used integer,
  requested_by uuid not null default auth.uid() references auth.users(id),
  requested_by_name text,
  requested_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz
);

create index creator_valuations_lookup_idx on public.creator_valuations (platform, handle, requested_at desc);

alter table public.creator_valuations enable row level security;

create policy "authenticated can read valuations"
  on public.creator_valuations for select to authenticated using (true);

create policy "authenticated can request valuations"
  on public.creator_valuations for insert to authenticated
  with check (requested_by = auth.uid() and status = 'pending');

create policy "authenticated can edit quoted rate"
  on public.creator_valuations for update to authenticated
  using (true) with check (true);

revoke all on public.creator_valuations from anon;
revoke insert, update, delete on public.creator_valuations from authenticated;
grant insert (platform, handle, quoted_rate, requested_by_name) on public.creator_valuations to authenticated;
grant update (quoted_rate) on public.creator_valuations to authenticated;

alter publication supabase_realtime add table public.creator_valuations;
