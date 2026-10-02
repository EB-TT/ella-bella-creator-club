alter table public.creator_valuations
  add column removed_at timestamptz,
  add column removed_by uuid references auth.users(id),
  add column removed_by_name text;

create or replace function public.creator_valuations_track_removal()
returns trigger
language plpgsql
as $$
begin
  if new.removed_at is distinct from old.removed_at then
    if new.removed_at is null then
      new.removed_by := null;
      new.removed_by_name := null;
    else
      new.removed_at := now();
      new.removed_by := auth.uid();
    end if;
  else
    new.removed_by := old.removed_by;
    new.removed_by_name := old.removed_by_name;
  end if;
  return new;
end;
$$;

create trigger creator_valuations_track_removal
  before update on public.creator_valuations
  for each row execute function public.creator_valuations_track_removal();

grant update (removed_at, removed_by_name) on public.creator_valuations to authenticated;
