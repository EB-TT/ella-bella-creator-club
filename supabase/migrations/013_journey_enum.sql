-- Phase 8a, part 1 of 2: the journey enum. Run this ON ITS OWN, before 014.
--
-- A new enum value can't be used in the transaction that adds it, so the enum
-- changes live in their own file and commit first. 014 then uses both values.
--
--   'Invited'                          new, before 'Joined' (set by hand only)
--   'Accepted (Target Collab Invite)'  renamed to 'TT Shop Enabled'
--
-- 'First Sale', 'Tier Up' and 'Top Performer' stay in the enum, unused.
-- Existing rows keep their stage; the rename carries them across.
--
-- Safe to re-run: each step checks before it acts. No begin/commit on purpose
-- (ALTER TYPE ... ADD VALUE is happiest as its own statement).

alter type public.creator_stage add value if not exists 'Invited' before 'Joined';

do $$
begin
  if exists (
    select 1
    from pg_catalog.pg_enum e
    where e.enumtypid = 'public.creator_stage'::regtype
      and e.enumlabel = 'Accepted (Target Collab Invite)'
  ) then
    alter type public.creator_stage rename value 'Accepted (Target Collab Invite)' to 'TT Shop Enabled';
  end if;
end $$;
