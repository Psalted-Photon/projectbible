-- ============================================================
-- 004: True union-merge for reading progress + harmony support
--
-- Replaces the live upsert_reading_progress function (which previously
-- existed ONLY in the live database — this file brings it into the repo).
--
-- Changes vs the previous live version:
--   • chapters_read is merged by (book, chapter) with the action lists
--     unioned and de-duplicated by (timestamp, type). The old version
--     de-duplicated whole chapter objects, so stale duplicates of the
--     same chapter accumulated side by side as actions grew.
--   • completed / completed_at follow the most recent writer (by
--     updated_at) instead of only ever flipping to true, so unchecking
--     a day on one device propagates to the others.
--   • New harmony_sections column + parameter so Gospel-harmony passage
--     progress syncs at all (it previously never left the device).
--   • Row-owner guard: authenticated callers may only write their own
--     rows (the SQL editor, where auth.uid() is NULL, stays unrestricted
--     for admin work).
-- ============================================================

ALTER TABLE public.reading_progress
  ADD COLUMN IF NOT EXISTS harmony_sections JSONB;

-- Adding a parameter changes the signature, so drop the old function
-- explicitly — CREATE OR REPLACE would otherwise create a second overload
-- and old clients would keep hitting the old body.
DROP FUNCTION IF EXISTS public.upsert_reading_progress(
  text, uuid, text, integer, integer,
  timestamptz, timestamptz, timestamptz, text, text, timestamptz);

CREATE FUNCTION public.upsert_reading_progress(
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
  IF auth.uid() IS NOT NULL AND auth.uid() <> p_user_id THEN
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

GRANT EXECUTE ON FUNCTION public.upsert_reading_progress(
  text, uuid, text, integer, integer,
  timestamptz, timestamptz, timestamptz, text, text, timestamptz, text)
  TO authenticated;

NOTIFY pgrst, 'reload schema';
