-- =============================================================================
-- ProjectBible: Security fixes
-- Migration 013: close four holes found in the 2026-09-26 health check
-- =============================================================================
-- Run this in your Supabase SQL Editor (Dashboard > SQL Editor). Safe to run
-- more than once. No app update is needed before or after it: nothing the app
-- legitimately does is refused by these rules.
--
--   1. upsert_reading_progress skipped its owner check for a caller who was
--      not signed in, and ran with full rights — so anyone could write anyone's
--      reading-plan progress. Now the caller must be signed in and must be the
--      row's owner, and the anon role loses the right to call it at all.
--      (Admin fixes to reading_progress are done with a plain UPDATE instead.)
--   2. A shared-notebook member could edit their own member row without limit:
--      make themselves admin, or move the row into a notebook they were never
--      invited to. Now only the owner changes a role, and nobody moves a row.
--   3. An editor on a page left open to anyone could make themselves its
--      author, shut the real author out, move it to another notebook, or undo
--      the owner's removal of it. Now author, notebook and removal are fixed,
--      only the author opens or closes a page, and updated_by is always the
--      person actually saving.
--   4. read_public_shared_notebook handed every member's account id to anyone
--      holding the code. It now hands out a stand-in id per notebook instead,
--      which still lets the app match pages to pills but is no use elsewhere.
-- =============================================================================

-- =============================================================================
-- 1. Reading progress: signed in, and your own rows only
--
-- Same body as migration 004; only the guard at the top has changed.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.upsert_reading_progress(
  p_id                  text,
  p_user_id             uuid,
  p_plan_id             text,
  p_day_number          integer,
  p_completed           integer,
  p_created_at          timestamptz,
  p_completed_at        timestamptz,
  p_started_reading_at  timestamptz,
  p_chapters_read       text,
  p_catch_up_adjustment text,
  p_updated_at          timestamptz,
  p_harmony_sections    text DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_existing      reading_progress%ROWTYPE;
  v_existing_ch   jsonb := '[]'::jsonb;
  v_incoming_ch   jsonb := '[]'::jsonb;
  v_merged_ch     jsonb;
  v_incoming_hs   jsonb;
  v_catch_up      jsonb;
  v_take_incoming boolean;
BEGIN
  IF auth.uid() IS NULL OR auth.uid() <> p_user_id THEN
    RAISE EXCEPTION 'permission denied for reading_progress row';
  END IF;

  BEGIN
    IF p_chapters_read IS NOT NULL AND trim(p_chapters_read) <> ''
       AND jsonb_typeof(p_chapters_read::jsonb) = 'array' THEN
      v_incoming_ch := p_chapters_read::jsonb;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    v_incoming_ch := '[]'::jsonb;
  END;

  BEGIN
    IF p_harmony_sections IS NOT NULL AND trim(p_harmony_sections) <> '' THEN
      v_incoming_hs := p_harmony_sections::jsonb;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    v_incoming_hs := NULL;
  END;

  BEGIN
    IF p_catch_up_adjustment IS NOT NULL AND trim(p_catch_up_adjustment) <> '' THEN
      v_catch_up := p_catch_up_adjustment::jsonb;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    v_catch_up := NULL;
  END;

  SELECT * INTO v_existing
  FROM reading_progress
  WHERE id = p_id AND user_id = p_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    INSERT INTO reading_progress (
      id, user_id, plan_id, day_number, completed,
      created_at, completed_at, started_reading_at,
      chapters_read, catch_up_adjustment, harmony_sections, updated_at
    ) VALUES (
      p_id, p_user_id, p_plan_id, p_day_number, (COALESCE(p_completed, 0) <> 0),
      COALESCE(p_created_at, now()), p_completed_at, p_started_reading_at,
      v_incoming_ch, v_catch_up, v_incoming_hs, now()
    );
    RETURN;
  END IF;

  IF jsonb_typeof(v_existing.chapters_read) = 'array' THEN
    v_existing_ch := v_existing.chapters_read;
  END IF;

  -- Union-merge: group by (book, chapter); union + dedupe the action lists
  -- by (timestamp, type); keep chronological order. Chapters that exist only
  -- as placeholders (no actions yet) are preserved with empty action lists.
  WITH all_chapters AS (
    SELECT el->>'book' AS book,
           (el->>'chapter')::int AS chapter,
           el->'actions' AS actions
    FROM jsonb_array_elements(v_existing_ch || v_incoming_ch) el
    WHERE el ? 'book' AND el ? 'chapter'
      AND el->>'chapter' ~ '^[0-9]+$'
  ),
  all_actions AS (
    SELECT c.book, c.chapter,
           (act->>'timestamp')::numeric AS ts,
           act->>'type' AS act_type
    FROM all_chapters c
    CROSS JOIN LATERAL jsonb_array_elements(
      CASE WHEN jsonb_typeof(c.actions) = 'array' THEN c.actions ELSE '[]'::jsonb END
    ) act
    WHERE act ? 'timestamp' AND act ? 'type'
  ),
  merged AS (
    SELECT book, chapter,
           jsonb_agg(jsonb_build_object('type', act_type, 'timestamp', ts)
                     ORDER BY ts) AS actions
    FROM (SELECT DISTINCT book, chapter, ts, act_type FROM all_actions) d
    GROUP BY book, chapter
  )
  SELECT COALESCE(jsonb_agg(
           jsonb_build_object(
             'book', c.book,
             'chapter', c.chapter,
             'actions', COALESCE(m.actions, '[]'::jsonb))), '[]'::jsonb)
  INTO v_merged_ch
  FROM (SELECT DISTINCT book, chapter FROM all_chapters) c
  LEFT JOIN merged m ON m.book = c.book AND m.chapter = c.chapter;

  v_take_incoming :=
    COALESCE(p_updated_at, now()) >= COALESCE(v_existing.updated_at, '-infinity'::timestamptz);

  UPDATE reading_progress SET
    chapters_read       = v_merged_ch,
    completed           = CASE WHEN v_take_incoming
                               THEN (COALESCE(p_completed, 0) <> 0)
                               ELSE completed END,
    completed_at        = CASE WHEN v_take_incoming THEN p_completed_at ELSE completed_at END,
    started_reading_at  = LEAST(started_reading_at, p_started_reading_at),
    created_at          = LEAST(created_at, COALESCE(p_created_at, created_at)),
    catch_up_adjustment = COALESCE(v_catch_up, catch_up_adjustment),
    harmony_sections    = CASE WHEN v_take_incoming
                               THEN COALESCE(v_incoming_hs, harmony_sections)
                               ELSE COALESCE(harmony_sections, v_incoming_hs) END,
    updated_at          = now()
  WHERE id = p_id AND user_id = p_user_id;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.upsert_reading_progress(
  text, uuid, text, integer, integer,
  timestamptz, timestamptz, timestamptz, text, text, timestamptz, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.upsert_reading_progress(
  text, uuid, text, integer, integer,
  timestamptz, timestamptz, timestamptz, text, text, timestamptz, text)
  TO authenticated;

-- =============================================================================
-- 2. Member rows: your own pill yes, your own role no
--
-- The UPDATE policy in 012 says who may touch a row; this says which columns.
-- A caller with no account (the SQL editor, the service key) is admin work and
-- passes. The anon role has no UPDATE policy on this table to begin with.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.shared_member_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.notebook_id IS DISTINCT FROM OLD.notebook_id
     OR NEW.user_id IS DISTINCT FROM OLD.user_id
     OR NEW.joined_at IS DISTINCT FROM OLD.joined_at
  THEN
    RAISE EXCEPTION 'A membership cannot be moved to another notebook or person'
      USING ERRCODE = 'check_violation';
  END IF;

  IF NEW.role IS DISTINCT FROM OLD.role
     AND NOT public.owns_shared_notebook(OLD.notebook_id) THEN
    RAISE EXCEPTION 'Only the person who owns this notebook can change what people may do'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS shared_member_guard ON public.shared_notebook_members;
CREATE TRIGGER shared_member_guard
  BEFORE UPDATE ON public.shared_notebook_members
  FOR EACH ROW
  EXECUTE FUNCTION public.shared_member_guard();

-- =============================================================================
-- 3. Pages: an open page lends its words, not its ownership
--
-- Runs alongside shared_page_guard (012), which already handles pinning and
-- the size and markup ceilings. Also fires inside save_shared_page and
-- remove_shared_page, where auth.uid() is still the person calling.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.shared_page_fields_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_uid UUID := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.notebook_id IS DISTINCT FROM OLD.notebook_id
     OR NEW.author_id IS DISTINCT FROM OLD.author_id
     OR NEW.created_at IS DISTINCT FROM OLD.created_at
  THEN
    RAISE EXCEPTION 'A page cannot change its author or move to another notebook'
      USING ERRCODE = 'check_violation';
  END IF;

  -- Opening or closing a page is the author's switch. From anyone else it is
  -- quietly kept as it was rather than refused, because a device that edited
  -- offline sends back the mode it last saw, and that edit should still land.
  IF NEW.edit_mode IS DISTINCT FROM OLD.edit_mode AND v_uid <> OLD.author_id THEN
    NEW.edit_mode := OLD.edit_mode;
  END IF;

  -- A removed page stays removed.
  IF OLD.deleted_at IS NOT NULL AND NEW.deleted_at IS DISTINCT FROM OLD.deleted_at THEN
    RAISE EXCEPTION 'This page has been removed'
      USING ERRCODE = 'check_violation';
  END IF;

  -- Removing is for the author or the notebook's owner, as in remove_shared_page.
  IF OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL
     AND v_uid <> OLD.author_id
     AND NOT public.owns_shared_notebook(OLD.notebook_id) THEN
    RAISE EXCEPTION 'Only the person who wrote this page, or whoever owns the notebook, can remove it'
      USING ERRCODE = 'check_violation';
  END IF;

  NEW.updated_by := v_uid;
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS shared_page_fields_guard ON public.shared_notebook_pages;
CREATE TRIGGER shared_page_fields_guard
  BEFORE UPDATE ON public.shared_notebook_pages
  FOR EACH ROW
  EXECUTE FUNCTION public.shared_page_fields_guard();

-- =============================================================================
-- 4. Public notebooks: stand-in ids instead of account ids
--
-- Same as 012 except for the ids. Each account id is swapped for an md5 of the
-- notebook id and the account id, shaped as a uuid. It is the same everywhere
-- that person appears in that notebook, so pages still line up with the right
-- pill, but it differs from notebook to notebook and cannot be turned back
-- into the account id.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.read_public_shared_notebook(p_code TEXT)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_row public.shared_notebooks;
BEGIN
  SELECT * INTO v_row FROM public.shared_notebooks
  WHERE join_code = upper(trim(coalesce(p_code, ''))) AND visibility = 'public';

  IF v_row.id IS NULL THEN
    RAISE EXCEPTION 'No notebook is being shared with that code';
  END IF;

  RETURN jsonb_build_object(
    'notebook', jsonb_build_object(
      'id', v_row.id, 'name', v_row.name, 'kind', v_row.kind,
      'visibility', v_row.visibility, 'rev', v_row.rev,
      'created_at', v_row.created_at, 'updated_at', v_row.updated_at
    ),
    'members', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'id', m.id,
        'user_id', md5(v_row.id || ':' || m.user_id::text)::uuid,
        'role', m.role,
        'display_name', m.display_name, 'initials', m.initials, 'color', m.color
      ) ORDER BY m.joined_at)
      FROM public.shared_notebook_members m WHERE m.notebook_id = v_row.id
    ), '[]'::jsonb),
    'pages', coalesce((
      SELECT jsonb_agg(
        to_jsonb(p) || jsonb_build_object(
          'author_id', md5(v_row.id || ':' || p.author_id::text)::uuid,
          'updated_by', CASE WHEN p.updated_by IS NULL THEN NULL
                             ELSE md5(v_row.id || ':' || p.updated_by::text)::uuid END
        )
        ORDER BY p.pinned DESC, p.updated_at DESC)
      FROM public.shared_notebook_pages p
      WHERE p.notebook_id = v_row.id AND p.deleted_at IS NULL
    ), '[]'::jsonb)
  );
END;
$fn$;

GRANT EXECUTE ON FUNCTION public.read_public_shared_notebook(TEXT) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';

-- =============================================================================
-- 5. Check. anon_can_write_progress should be false, the other two true.
-- =============================================================================
SELECT
  has_function_privilege('anon',
    'public.upsert_reading_progress(text, uuid, text, integer, integer, timestamptz, timestamptz, timestamptz, text, text, timestamptz, text)',
    'EXECUTE')                                                            AS anon_can_write_progress,
  EXISTS (SELECT 1 FROM pg_trigger WHERE NOT tgisinternal
          AND tgname = 'shared_member_guard')                             AS member_guard_ready,
  EXISTS (SELECT 1 FROM pg_trigger WHERE NOT tgisinternal
          AND tgname = 'shared_page_fields_guard')                        AS page_guard_ready;
