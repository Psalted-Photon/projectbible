-- =============================================================================
-- ProjectBible: By Heart
-- Migration 019: the verses someone is memorizing
-- =============================================================================
-- Run this in your Supabase SQL Editor (Dashboard > SQL Editor) BEFORE the
-- deploy that uses it. Safe to run more than once.
--
-- One row per saved verse: its exact words and translation, the card it was
-- designed on, and how the memorizing is going. Shapes and policies mirror
-- notebooks (migration 010).
--
-- `card` holds the look, the styled words and which painting is behind them.
-- A personal photo is never here: it stays on the device it was picked on, and
-- another device draws the card on its background color instead.
--
-- `progress` holds what the games keep between sessions, so a new game needs
-- no new column. A game under way is not here at all: it is saved on the device
-- after every word, and only a finished round reaches this table. No audio is
-- ever stored here.
-- =============================================================================

-- 1. The table
CREATE TABLE IF NOT EXISTS public.by_heart_verses (
  id TEXT NOT NULL,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  book TEXT NOT NULL,
  chapter INTEGER NOT NULL,
  start_verse INTEGER NOT NULL,
  end_verse INTEGER NOT NULL,
  -- Every verse the passage touches, when that is not simply start to end.
  verses JSONB,
  translation TEXT NOT NULL,
  passage TEXT NOT NULL,
  -- A long passage is saved in parts, as one saved item holds about 150 words.
  part INTEGER NOT NULL DEFAULT 1,
  parts INTEGER NOT NULL DEFAULT 1,
  card JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- The latest score, 0-100, and the next date it is due (YYYY-MM-DD, as the
  -- journal's dates are). Both stay empty until the verse has been recited.
  score INTEGER,
  next_date TEXT,
  progress JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (id, user_id)
);

ALTER TABLE public.by_heart_verses ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'by_heart_verses' AND policyname = 'Users can CRUD their own by heart verses'
  ) THEN
    CREATE POLICY "Users can CRUD their own by heart verses"
      ON public.by_heart_verses
      FOR ALL
      TO authenticated
      USING ((SELECT auth.uid()) = user_id)
      WITH CHECK ((SELECT auth.uid()) = user_id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_by_heart_verses_user_id ON public.by_heart_verses(user_id);

-- 2. Realtime
-- Without this, a verse saved on one device never reaches the others live.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'by_heart_verses'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.by_heart_verses;
  END IF;
END $$;

-- 3. Re-define delete_account so the new table is swept too.
-- Same function as migration 012, with 'by_heart_verses' added.
CREATE OR REPLACE FUNCTION public.delete_account()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_uid uuid;
  t text;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'delete_account requires an authenticated user';
  END IF;

  IF to_regclass('public.shared_notebook_pages') IS NOT NULL THEN
    DELETE FROM public.shared_notebook_pages WHERE author_id = v_uid;
  END IF;
  IF to_regclass('public.shared_notebook_members') IS NOT NULL THEN
    DELETE FROM public.shared_notebook_members WHERE user_id = v_uid;
  END IF;
  IF to_regclass('public.shared_notebooks') IS NOT NULL THEN
    DELETE FROM public.shared_notebooks WHERE owner_id = v_uid;
  END IF;

  FOREACH t IN ARRAY ARRAY[
    'user_notes', 'user_highlights', 'user_word_highlights', 'user_bookmarks',
    'journal_entries', 'journal_lock', 'journal_key_slots',
    'notebooks', 'notebook_pages', 'by_heart_verses',
    'reading_plans', 'reading_progress', 'reading_history',
    'user_settings', 'plan_metadata', 'sync_operations'
  ] LOOP
    IF to_regclass('public.' || t) IS NOT NULL THEN
      EXECUTE format('DELETE FROM public.%I WHERE user_id = $1', t) USING v_uid;
    END IF;
  END LOOP;

  DELETE FROM auth.users WHERE id = v_uid;
END;
$fn$;

REVOKE EXECUTE ON FUNCTION public.delete_account() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.delete_account() TO authenticated;

NOTIFY pgrst, 'reload schema';

-- 4. Check. All four columns should be true.
SELECT
  to_regclass('public.by_heart_verses') IS NOT NULL AS table_ready,
  EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'by_heart_verses' AND policyname = 'Users can CRUD their own by heart verses'
  ) AS policy_ready,
  EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'by_heart_verses'
  ) AS realtime_ready,
  position('by_heart_verses' IN pg_get_functiondef('public.delete_account()'::regprocedure)) > 0 AS delete_account_ready;
