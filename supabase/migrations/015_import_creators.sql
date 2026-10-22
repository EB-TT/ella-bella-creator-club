-- Phase 8c: import the team's sheet. Matches rows to creators by TikTok handle,
-- fills only what is empty, never moves anyone backwards, never writes over
-- TikTok data. Run after 013 and 014.
--
--   public.import_creators(p_rows jsonb, p_dry_run boolean default true) -> jsonb
--     SECURITY INVOKER: RLS applies as the signed-in user. One transaction per
--     call. p_dry_run = true writes nothing and returns exactly what a real run
--     would do. Returns { dry_run, summary, rows }.
--
--   Three small helpers it uses (import_parse_date, import_language,
--   import_stage), kept separate so they can be tested on their own.
--
-- Row keys read from p_rows (the app parses the sheet and sends one object per row):
--   row                  the sheet's row number, echoed back in the report
--   tiktok_handle        the match key: a handle, @handle or a tiktok.com/@ URL
--   name, email, instagram_handle, mobile, discord_handle, shipping_address
--                        text, fill-only (creators.name, .email, .instagram_handle,
--                        .mobile, .discord_handle, .shipping_address)
--   language             Spa / Spanish / Español / ES / En / English / blank
--                        (creators.language, 'English' | 'Spanish')
--   cc_join_date         YYYY-MM-DD, DD/MM/YYYY or D-Mon-YYYY (creators.cc_join_date)
--   next_follow_up_date  same formats (creators.next_follow_up_date)
--   owner_name           matched to profiles.name, ignoring case and spacing
--                        (creators.owner_id)
--   stage_candidate      the furthest of Next Action / TT Shop Enabled? / Status,
--                        already worked out by the app (creators.stage)
--   current_product      TikTok-owned: written only if empty and not synced
--                        (creators.current_product, synced_fields)
--   first_video_link     TikTok-owned: same rule (creators.first_video_link)
--   other_products       array of names or { product, date_received }, appended
--                        as manual entries (creators.other_products_received)
--   notes                array of { date, text }; date is YYYY-MM-DD or null
--   extra_note           one text, appended as a note ("Imported video links: …")
--
-- Rules (see docs/phase8-decisions.md and the build plan, phase 8c):
--   * Match among ACTIVE creators by public.normalise_tiktok_handle. A row with
--     no handle, a repeat of an earlier row's handle, or a handle that only
--     matches a removed creator is skipped and reported.
--   * Team fields fill only when the creator's value is empty. (A name that is
--     just the creator's own handle, as TikTok auto-created rows have, counts
--     as empty.) TikTok-owned fields are never written when synced_fields says
--     TikTok fills them, and only when empty otherwise.
--   * Stage is forward-only. The CC Join Date -> Joined trigger and the
--     stage_manual_at stamp both fire on the update; new creators get
--     stage_manual_at set on insert (the stamp trigger only runs on update).
--   * New creators get source = 'import'; the existing triggers link them to TikTok.
--   * Notes are appended (never replaced), dated from the sheet, and an entry
--     whose text already exists on the creator is skipped, so re-importing is safe.
--
-- Safe to re-run. No data is changed by this migration itself.

begin;

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

-- A sheet date: YYYY-MM-DD (a time after it is ignored), DD/MM/YYYY or
-- D-Mon-YYYY (month name or its first three letters; two-digit years are 20xx).
-- Null for blank or anything that isn't a real date (31-Feb, "soon").
create or replace function public.import_parse_date(p_text text)
returns date
language plpgsql
immutable
set search_path = ''
as $$
declare
  s   text := nullif(pg_catalog.btrim(p_text), '');
  m   text[];
  p   integer;
  y   integer;
begin
  if s is null then
    return null;
  end if;

  begin
    m := pg_catalog.regexp_match(s, '^(\d{4})-(\d{1,2})-(\d{1,2})');
    if m is not null then
      return pg_catalog.make_date(m[1]::integer, m[2]::integer, m[3]::integer);
    end if;

    m := pg_catalog.regexp_match(s, '^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$');
    if m is not null then
      return pg_catalog.make_date(m[3]::integer, m[2]::integer, m[1]::integer);
    end if;

    m := pg_catalog.regexp_match(s, '^(\d{1,2})[ /.-]+([A-Za-z]{3,9})\.?[ /.,-]+(\d{2}|\d{4})$');
    if m is not null then
      p := pg_catalog.strpos('janfebmaraprmayjunjulaugsepoctnovdec', pg_catalog.lower(pg_catalog.left(m[2], 3)));
      if p = 0 or (p - 1) % 3 <> 0 then
        return null;
      end if;
      y := m[3]::integer;
      if y < 100 then
        y := 2000 + y;
      end if;
      return pg_catalog.make_date(y, (p - 1) / 3 + 1, m[1]::integer);
    end if;
  exception when others then
    return null;
  end;

  return null;
end;
$$;

-- 'English' or 'Spanish' for a sheet value; null for blank; '?' when it isn't recognised.
create or replace function public.import_language(p_text text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  s text := pg_catalog.btrim(pg_catalog.regexp_replace(pg_catalog.lower(coalesce(p_text, '')), '[\s.]+', ' ', 'g'));
begin
  if s = '' then
    return null;
  elsif s in ('spa', 'spanish', 'español', 'espanol', 'es', 'esp', 'sp') then
    return 'Spanish';
  elsif s in ('en', 'eng', 'english') then
    return 'English';
  end if;
  return '?';
end;
$$;

-- A stage name from a sheet or the app, as a creator_stage label.
--   label null, ok true   : blank, or a retired stage to ignore (Tier Up, Top Performer)
--   label null, ok false  : not recognised
-- Strips a leading "7. " and ignores case. The old name "Accepted (Target Collab
-- Invite)" and plain "Accepted" mean TT Shop Enabled; "First Sale" means Video Posted.
create or replace function public.import_stage(p_text text, out label text, out ok boolean)
returns record
language plpgsql
stable
set search_path = ''
as $$
declare
  s text := pg_catalog.btrim(pg_catalog.regexp_replace(
              pg_catalog.regexp_replace(pg_catalog.lower(coalesce(p_text, '')), '^\s*\d+\s*[.)]\s*', ''),
              '\s+', ' ', 'g'));
begin
  label := null;
  ok := true;
  if s = '' or s in ('tier up', 'top performer') then
    return;
  elsif s in ('accepted', 'accepted (target collab invite)', 'accepted (target collab invitation)') then
    label := 'TT Shop Enabled';
  elsif s = 'first sale' then
    label := 'Video Posted';
  else
    select e into label
      from pg_catalog.unnest(pg_catalog.enum_range(null::public.creator_stage)::text[]) as e
     where pg_catalog.lower(e) = s
     limit 1;
    ok := label is not null;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- import_creators
-- ---------------------------------------------------------------------------

create or replace function public.import_creators(p_rows jsonb, p_dry_run boolean default true)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  c            public.creators%rowtype;
  r            jsonb;
  n            jsonb;
  el           jsonb;
  v_ord        integer;
  k            text;
  sv           text;
  ev           text;
  v_importer   text;
  v_author     text;
  v_now_iso    text;

  -- per row
  v_row_id     jsonb;
  v_handle     text;
  v_norm       text;
  v_action     text;
  v_found      boolean;
  v_filled     text[];
  v_skipped    jsonb;
  v_msgs       text[];
  v_fill       jsonb;
  v_lang       text;
  v_lang_new   text;
  v_join       date;
  v_join_new   date;
  v_follow     date;
  v_follow_new date;
  v_owner_raw  text;
  v_owner_cnt  integer;
  v_owner_id   uuid;
  v_owner_new  uuid;
  v_cand       public.creator_stage;
  v_stage_new  public.creator_stage;
  v_stage_cur  public.creator_stage;
  v_label      text;
  v_ok         boolean;
  v_prod_new   text;
  v_video_new  text;
  v_opr        jsonb;
  v_opr_names  text[];
  v_opr_new    jsonb;
  v_name       text;
  v_exist      text[];
  v_notes_new  jsonb;
  v_text       text;
  v_date       date;
  v_has_date   boolean;
  v_synced     boolean;
  v_extra      text;

  -- totals
  s_total      integer := 0;
  s_matched    integer := 0;
  s_created    integer := 0;
  s_nohandle   integer := 0;
  s_dup        integer := 0;
  s_removed    integer := 0;
  s_filled     integer := 0;
  s_already    integer := 0;
  s_tiktok     integer := 0;
  s_moved      integer := 0;
  s_notlater   integer := 0;
  s_notes      integer := 0;
  s_notes_dup  integer := 0;
  s_invalid    integer := 0;
  s_owner_rows integer := 0;
  s_owner_names text[] := '{}';
  v_seen       jsonb := '{}'::jsonb;
  v_rows       jsonb := '[]'::jsonb;
begin
  if p_rows is null or pg_catalog.jsonb_typeof(p_rows) <> 'array' then
    raise exception 'p_rows must be a JSON array of rows.';
  end if;
  if pg_catalog.jsonb_array_length(p_rows) > 5000 then
    raise exception 'Too many rows in one call (limit 5000).';
  end if;

  select p.name into v_importer from public.profiles p where p.id = auth.uid();
  v_author  := 'Import · ' || coalesce(nullif(pg_catalog.btrim(v_importer), ''), 'unknown');
  v_now_iso := pg_catalog.to_char(pg_catalog.now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');

  for r, v_ord in
    select e.value, e.ordinality::integer
      from pg_catalog.jsonb_array_elements(p_rows) with ordinality as e(value, ordinality)
  loop
    s_total   := s_total + 1;
    v_row_id  := coalesce(r -> 'row', pg_catalog.to_jsonb(v_ord));
    v_filled  := '{}';
    v_skipped := '[]'::jsonb;
    v_msgs    := '{}';
    v_fill    := '{}'::jsonb;
    v_action  := null;
    v_found   := false;

    if pg_catalog.jsonb_typeof(r) <> 'object' then
      r := '{}'::jsonb;
    end if;

    -- ---- The handle, and which kind of row this is ------------------------
    v_handle := nullif(pg_catalog.btrim(r ->> 'tiktok_handle'), '');
    if v_handle is not null then
      v_handle := coalesce((pg_catalog.regexp_match(v_handle, 'tiktok\.com/@+([^/?#\s]+)', 'i'))[1], v_handle);
      v_handle := nullif(pg_catalog.regexp_replace(pg_catalog.regexp_replace(v_handle, '[?#/].*$', ''), '^@+', ''), '');
    end if;
    v_norm := public.normalise_tiktok_handle(v_handle);

    if v_norm is null then
      v_action := 'skip';
      v_msgs := v_msgs || 'No TikTok handle.';
      s_nohandle := s_nohandle + 1;
    elsif v_seen ? v_norm then
      v_action := 'skip';
      v_msgs := v_msgs || ('Same handle as row ' || (v_seen ->> v_norm) || '; the first one is used.');
      s_dup := s_dup + 1;
    else
      v_seen := v_seen || pg_catalog.jsonb_build_object(v_norm, v_row_id);
      select * into c
        from public.creators x
       where x.handle_normalised = v_norm and x.status = 'active';
      v_found := found;
      if v_found then
        v_action := 'update';
      elsif exists (select 1 from public.creators x where x.handle_normalised = v_norm and x.status = 'removed') then
        v_action := 'skip';
        v_msgs := v_msgs || 'This handle belongs to a removed creator. Restore them first.';
        s_removed := s_removed + 1;
      else
        v_action := 'create';
      end if;
    end if;

    if v_action = 'skip' then
      v_rows := v_rows || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
        'row', v_row_id, 'handle', v_handle, 'action', 'skip',
        'filled', '[]'::jsonb, 'skipped', '[]'::jsonb, 'messages', pg_catalog.to_jsonb(v_msgs)));
      continue;
    end if;

    -- ---- Read and check the values ---------------------------------------
    v_lang := public.import_language(r ->> 'language');
    if v_lang = '?' then
      v_msgs := v_msgs || ('Language "' || pg_catalog.btrim(r ->> 'language') || '" not recognised.');
      s_invalid := s_invalid + 1;
      v_lang := null;
    end if;

    v_join := public.import_parse_date(r ->> 'cc_join_date');
    if v_join is null and nullif(pg_catalog.btrim(r ->> 'cc_join_date'), '') is not null then
      v_msgs := v_msgs || ('CC Join Date "' || pg_catalog.btrim(r ->> 'cc_join_date') || '" is not a date.');
      s_invalid := s_invalid + 1;
    end if;

    v_follow := public.import_parse_date(r ->> 'next_follow_up_date');
    if v_follow is null and nullif(pg_catalog.btrim(r ->> 'next_follow_up_date'), '') is not null then
      v_msgs := v_msgs || ('Follow-up date "' || pg_catalog.btrim(r ->> 'next_follow_up_date') || '" is not a date.');
      s_invalid := s_invalid + 1;
    end if;

    select s.label, s.ok into v_label, v_ok from public.import_stage(r ->> 'stage_candidate') s;
    v_cand := null;
    if not v_ok then
      v_msgs := v_msgs || ('Stage "' || pg_catalog.btrim(r ->> 'stage_candidate') || '" not recognised.');
      s_invalid := s_invalid + 1;
    elsif v_label is not null then
      v_cand := v_label::public.creator_stage;
    end if;

    v_owner_raw := nullif(pg_catalog.btrim(r ->> 'owner_name'), '');
    v_owner_id  := null;
    if v_owner_raw is not null then
      select pg_catalog.count(*)::integer, (pg_catalog.min(p.id::text))::uuid
        into v_owner_cnt, v_owner_id
        from public.profiles p
       where pg_catalog.lower(pg_catalog.btrim(pg_catalog.regexp_replace(p.name, '\s+', ' ', 'g')))
           = pg_catalog.lower(pg_catalog.btrim(pg_catalog.regexp_replace(v_owner_raw, '\s+', ' ', 'g')));
      if v_owner_cnt <> 1 then
        v_owner_id := null;
        s_owner_rows := s_owner_rows + 1;
        s_owner_names := s_owner_names || v_owner_raw;
        v_msgs := v_msgs || (case when v_owner_cnt = 0
                                  then 'No team member named "' || v_owner_raw || '" yet; owner left blank.'
                                  else 'More than one team member is named "' || v_owner_raw || '"; owner left blank.' end);
      end if;
    end if;

    -- ---- Notes (same for update and create) ------------------------------
    v_notes_new := '[]'::jsonb;
    if v_action = 'update' then
      select coalesce(pg_catalog.array_agg(pg_catalog.lower(pg_catalog.btrim(e ->> 'text'))), '{}')
        into v_exist
        from pg_catalog.jsonb_array_elements(
               case when pg_catalog.jsonb_typeof(c.notes) = 'array' then c.notes else '[]'::jsonb end) e;
    else
      v_exist := '{}';
    end if;

    v_extra := nullif(pg_catalog.btrim(r ->> 'extra_note'), '');
    for n in
      select x from pg_catalog.jsonb_array_elements(
                      case when pg_catalog.jsonb_typeof(r -> 'notes') = 'array' then r -> 'notes' else '[]'::jsonb end) x
      union all
      select pg_catalog.jsonb_build_object('date', null::text, 'text', v_extra) where v_extra is not null
    loop
      v_text := nullif(pg_catalog.btrim(n ->> 'text'), '');
      continue when v_text is null;
      if pg_catalog.lower(v_text) = any (v_exist) then
        s_notes_dup := s_notes_dup + 1;
        continue;
      end if;
      v_exist    := v_exist || pg_catalog.lower(v_text);
      v_has_date := nullif(pg_catalog.btrim(n ->> 'date'), '') is not null;
      v_date     := public.import_parse_date(n ->> 'date');
      if v_has_date and v_date is null then
        v_msgs := v_msgs || ('Note date "' || pg_catalog.btrim(n ->> 'date') || '" is not a date; dated now.');
        s_invalid := s_invalid + 1;
      end if;
      v_notes_new := v_notes_new || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
        'author', v_author,
        'timestamp', case when v_date is not null
                          then pg_catalog.to_char(v_date, 'YYYY-MM-DD') || 'T12:00:00.000Z'
                          else v_now_iso end,
        'text', v_text));
      s_notes := s_notes + 1;
    end loop;

    -- ---- Other products (manual entries, no TikTok source) ---------------
    v_opr_new := null;
    if pg_catalog.jsonb_typeof(r -> 'other_products') = 'array'
       and pg_catalog.jsonb_array_length(r -> 'other_products') > 0 then
      v_opr := case when v_action = 'update' and pg_catalog.jsonb_typeof(c.other_products_received) = 'array'
                    then c.other_products_received else '[]'::jsonb end;
      select coalesce(pg_catalog.array_agg(pg_catalog.lower(pg_catalog.btrim(e ->> 'product'))), '{}')
        into v_opr_names
        from pg_catalog.jsonb_array_elements(v_opr) e;
      v_opr_new := v_opr;
      for el in select x from pg_catalog.jsonb_array_elements(r -> 'other_products') x loop
        v_text := nullif(pg_catalog.btrim(
                    case when pg_catalog.jsonb_typeof(el) = 'object' then el ->> 'product' else el #>> '{}' end), '');
        continue when v_text is null;
        if pg_catalog.lower(v_text) = any (v_opr_names) then
          s_already := s_already + 1;
          v_skipped := v_skipped || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
            'field', 'other_products_received', 'reason', 'already listed: ' || v_text));
          continue;
        end if;
        v_opr_names := v_opr_names || pg_catalog.lower(v_text);
        v_opr_new := v_opr_new || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
          'product', v_text,
          'date_received', case when pg_catalog.jsonb_typeof(el) = 'object'
                                then public.import_parse_date(el ->> 'date_received') end));
      end loop;
      if pg_catalog.jsonb_array_length(v_opr_new) = pg_catalog.jsonb_array_length(v_opr) then
        v_opr_new := null;
      else
        v_filled := v_filled || 'other_products_received';
        s_filled := s_filled + 1;
      end if;
    end if;

    if v_action = 'update' then
      -- =====================================================================
      -- Matched creator: fill what is empty, never overwrite
      -- =====================================================================
      s_matched := s_matched + 1;

      foreach k in array array['name', 'email', 'instagram_handle', 'mobile', 'discord_handle', 'shipping_address'] loop
        sv := nullif(pg_catalog.btrim(r ->> k), '');
        continue when sv is null;
        ev := nullif(pg_catalog.btrim(pg_catalog.to_jsonb(c) ->> k), '');
        -- An auto-created creator's name is their handle; that counts as empty.
        if k = 'name' and ev is not null and public.normalise_tiktok_handle(ev) = c.handle_normalised then
          ev := null;
        end if;
        if ev is null then
          v_fill   := v_fill || pg_catalog.jsonb_build_object(k, sv);
          v_filled := v_filled || k;
          s_filled := s_filled + 1;
        elsif ev <> sv then
          v_skipped := v_skipped || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('field', k, 'reason', 'already filled'));
          s_already := s_already + 1;
        end if;
      end loop;

      v_lang_new := null;
      if v_lang is not null then
        if c.language is null then
          v_lang_new := v_lang; v_filled := v_filled || 'language'; s_filled := s_filled + 1;
        elsif c.language <> v_lang then
          v_skipped := v_skipped || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('field', 'language', 'reason', 'already filled'));
          s_already := s_already + 1;
        end if;
      end if;

      v_join_new := null;
      if v_join is not null then
        if c.cc_join_date is null then
          v_join_new := v_join; v_filled := v_filled || 'cc_join_date'; s_filled := s_filled + 1;
        elsif c.cc_join_date <> v_join then
          v_skipped := v_skipped || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('field', 'cc_join_date', 'reason', 'already filled'));
          s_already := s_already + 1;
        end if;
      end if;

      v_follow_new := null;
      if v_follow is not null then
        if c.next_follow_up_date is null then
          v_follow_new := v_follow; v_filled := v_filled || 'next_follow_up_date'; s_filled := s_filled + 1;
        elsif c.next_follow_up_date <> v_follow then
          v_skipped := v_skipped || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('field', 'next_follow_up_date', 'reason', 'already filled'));
          s_already := s_already + 1;
        end if;
      end if;

      v_owner_new := null;
      if v_owner_id is not null then
        if c.owner_id is null then
          v_owner_new := v_owner_id; v_filled := v_filled || 'owner_id'; s_filled := s_filled + 1;
          if c.new_from_tiktok then
            v_msgs := v_msgs || 'Owner assigned, so New from TikTok is cleared.';
          end if;
        elsif c.owner_id <> v_owner_id then
          v_skipped := v_skipped || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('field', 'owner_id', 'reason', 'already filled'));
          s_already := s_already + 1;
        end if;
      end if;

      -- TikTok-owned: never when TikTok fills it, only into an empty value otherwise.
      v_prod_new := null;
      sv := nullif(pg_catalog.btrim(r ->> 'current_product'), '');
      if sv is not null then
        v_synced := c.synced_fields -> 'current_product' = 'true'::jsonb;
        if v_synced then
          v_skipped := v_skipped || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('field', 'current_product', 'reason', 'TikTok has this'));
          s_tiktok := s_tiktok + 1;
        elsif nullif(pg_catalog.btrim(c.current_product), '') is not null then
          if pg_catalog.btrim(c.current_product) <> sv then
            v_skipped := v_skipped || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('field', 'current_product', 'reason', 'already filled'));
            s_already := s_already + 1;
          end if;
        else
          v_prod_new := sv; v_filled := v_filled || 'current_product'; s_filled := s_filled + 1;
        end if;
      end if;

      v_video_new := null;
      sv := nullif(pg_catalog.btrim(r ->> 'first_video_link'), '');
      if sv is not null then
        v_synced := c.synced_fields -> 'first_video_link' = 'true'::jsonb;
        if v_synced then
          v_skipped := v_skipped || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('field', 'first_video_link', 'reason', 'TikTok has this'));
          s_tiktok := s_tiktok + 1;
        elsif nullif(pg_catalog.btrim(c.first_video_link), '') is not null then
          if pg_catalog.btrim(c.first_video_link) <> sv then
            v_skipped := v_skipped || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('field', 'first_video_link', 'reason', 'already filled'));
            s_already := s_already + 1;
          end if;
        else
          v_video_new := sv; v_filled := v_filled || 'first_video_link'; s_filled := s_filled + 1;
        end if;
      end if;

      -- Stage: forward only. A CC Join Date filled now also lifts an Invited
      -- creator to Joined (the same thing the trigger does).
      v_stage_cur := c.stage;
      v_stage_new := c.stage;
      if v_cand is not null then
        if v_cand > c.stage then
          v_stage_new := v_cand;
        else
          s_notlater := s_notlater + 1;
          v_msgs := v_msgs || ('Stage not changed: ' || c.stage::text || ' is already ' || v_cand::text || ' or later.');
        end if;
      end if;
      if v_join_new is not null and v_stage_new < 'Joined'::public.creator_stage then
        v_stage_new := 'Joined'::public.creator_stage;
      end if;
      if v_stage_new > v_stage_cur then
        s_moved := s_moved + 1;
        v_msgs := v_msgs || ('Stage: ' || v_stage_cur::text || ' → ' || v_stage_new::text || '.');
      end if;

      if not p_dry_run then
        update public.creators u
           set name                = coalesce(v_fill ->> 'name', u.name),
               email               = coalesce(v_fill ->> 'email', u.email),
               instagram_handle    = coalesce(v_fill ->> 'instagram_handle', u.instagram_handle),
               mobile              = coalesce(v_fill ->> 'mobile', u.mobile),
               discord_handle      = coalesce(v_fill ->> 'discord_handle', u.discord_handle),
               shipping_address    = coalesce(v_fill ->> 'shipping_address', u.shipping_address),
               language            = coalesce(v_lang_new, u.language),
               cc_join_date        = coalesce(v_join_new, u.cc_join_date),
               next_follow_up_date = coalesce(v_follow_new, u.next_follow_up_date),
               owner_id            = coalesce(v_owner_new, u.owner_id),
               new_from_tiktok     = case when v_owner_new is not null then false else u.new_from_tiktok end,
               current_product     = coalesce(v_prod_new, u.current_product),
               first_video_link    = coalesce(v_video_new, u.first_video_link),
               other_products_received = coalesce(v_opr_new, u.other_products_received),
               notes               = case when pg_catalog.jsonb_array_length(v_notes_new) > 0
                                          then u.notes || v_notes_new else u.notes end,
               stage               = v_stage_new
         where u.id = c.id;

        -- The manual-product trigger stamps current_product_manual_at on any
        -- change. An imported product is a starting value that a TikTok sample
        -- should replace, so clear the stamp (this update doesn't list
        -- current_product, so the trigger doesn't run again).
        if v_prod_new is not null then
          update public.creators u set current_product_manual_at = null where u.id = c.id;
        end if;
      end if;

      if pg_catalog.cardinality(v_filled) = 0 and v_stage_new = v_stage_cur
         and pg_catalog.jsonb_array_length(v_notes_new) = 0 then
        v_msgs := v_msgs || 'Nothing to change.';
      end if;

    else
      -- =====================================================================
      -- New creator
      -- =====================================================================
      s_created := s_created + 1;

      foreach k in array array['name', 'email', 'instagram_handle', 'mobile', 'discord_handle', 'shipping_address'] loop
        sv := nullif(pg_catalog.btrim(r ->> k), '');
        continue when sv is null;
        v_fill   := v_fill || pg_catalog.jsonb_build_object(k, sv);
        v_filled := v_filled || k;
        s_filled := s_filled + 1;
      end loop;
      v_name := coalesce(v_fill ->> 'name', v_handle);
      if v_fill ->> 'name' is null then
        v_msgs := v_msgs || 'No name in the sheet; the handle is used as the name.';
      end if;

      if v_lang is not null     then v_filled := v_filled || 'language';            s_filled := s_filled + 1; end if;
      if v_join is not null     then v_filled := v_filled || 'cc_join_date';        s_filled := s_filled + 1; end if;
      if v_follow is not null   then v_filled := v_filled || 'next_follow_up_date'; s_filled := s_filled + 1; end if;
      if v_owner_id is not null then v_filled := v_filled || 'owner_id';            s_filled := s_filled + 1; end if;

      v_prod_new := nullif(pg_catalog.btrim(r ->> 'current_product'), '');
      if v_prod_new is not null then v_filled := v_filled || 'current_product'; s_filled := s_filled + 1; end if;
      v_video_new := nullif(pg_catalog.btrim(r ->> 'first_video_link'), '');
      if v_video_new is not null then v_filled := v_filled || 'first_video_link'; s_filled := s_filled + 1; end if;

      -- The candidate, else Joined when there is a Join Date, else Invited.
      v_stage_new := coalesce(v_cand,
                              case when v_join is not null then 'Joined'::public.creator_stage
                                   else 'Invited'::public.creator_stage end);
      if v_join is not null and v_stage_new < 'Joined'::public.creator_stage then
        v_stage_new := 'Joined'::public.creator_stage;
      end if;
      v_msgs := v_msgs || ('New creator at ' || v_stage_new::text || '.');

      if not p_dry_run then
        insert into public.creators
          (name, tiktok_handle, instagram_handle, email, mobile, discord_handle, shipping_address,
           language, cc_join_date, next_follow_up_date, owner_id, current_product, first_video_link,
           other_products_received, notes, stage, stage_manual_at, source, status)
        values
          (v_name, v_handle, v_fill ->> 'instagram_handle', v_fill ->> 'email', v_fill ->> 'mobile',
           v_fill ->> 'discord_handle', v_fill ->> 'shipping_address',
           v_lang, v_join, v_follow, v_owner_id, v_prod_new, v_video_new,
           coalesce(v_opr_new, '[]'::jsonb), v_notes_new, v_stage_new, pg_catalog.now(), 'import', 'active');
      end if;
    end if;

    v_rows := v_rows || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
      'row', v_row_id, 'handle', v_handle, 'action', v_action,
      'filled', pg_catalog.to_jsonb(v_filled), 'skipped', v_skipped, 'messages', pg_catalog.to_jsonb(v_msgs)));
  end loop;

  return pg_catalog.jsonb_build_object(
    'dry_run', p_dry_run,
    'summary', pg_catalog.jsonb_build_object(
      'rows_received', s_total,
      'matched', s_matched,
      'created', s_created,
      'skipped', pg_catalog.jsonb_build_object(
        'total', s_nohandle + s_dup + s_removed,
        'no_handle', s_nohandle,
        'duplicate', s_dup,
        'removed_match', s_removed),
      'fields_filled', s_filled,
      'values_skipped_already_filled', s_already,
      'values_skipped_tiktok_owned', s_tiktok,
      'stage_moved_forward', s_moved,
      'stage_not_later', s_notlater,
      'notes_appended', s_notes,
      'notes_skipped_duplicate', s_notes_dup,
      'owner_unmatched', pg_catalog.jsonb_build_object(
        'rows', s_owner_rows,
        'names', (select coalesce(pg_catalog.jsonb_agg(d.n order by d.n), '[]'::jsonb)
                    from (select distinct u.n from pg_catalog.unnest(s_owner_names) as u(n)) d)),
      'invalid_values', s_invalid),
    'rows', v_rows);
end;
$$;

-- ---------------------------------------------------------------------------
-- Grants: signed-in users only
-- ---------------------------------------------------------------------------

revoke all on function public.import_parse_date(text)               from public, anon;
revoke all on function public.import_language(text)                 from public, anon;
revoke all on function public.import_stage(text)                    from public, anon;
revoke all on function public.import_creators(jsonb, boolean)       from public, anon;

grant execute on function public.import_parse_date(text)            to authenticated, service_role;
grant execute on function public.import_language(text)              to authenticated, service_role;
grant execute on function public.import_stage(text)                 to authenticated, service_role;
grant execute on function public.import_creators(jsonb, boolean)    to authenticated, service_role;

comment on function public.import_creators(jsonb, boolean) is
  'Phase 8c. Imports parsed sheet rows: match by TikTok handle, fill empty team fields only, forward-only stage, append notes. p_dry_run (default true) writes nothing.';

commit;
