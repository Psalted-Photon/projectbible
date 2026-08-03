-- =============================================================================
-- ProjectBible: Notebooks + Notebook Pages
-- Migration 010: general note-taking for the Notes panel
-- =============================================================================
-- Run this in your Supabase SQL Editor (Dashboard > SQL Editor)
--
-- Verse notes already live in user_notes (migration 001). These two tables are
-- the other half of the Notes panel: free-form notes the user writes without a
-- verse anchor, filed into notebooks they name themselves. A notebook is just a
-- named folder; a page is one note. Shapes and policies mirror journal_entries.
-- =============================================================================

-- 1. Notebooks — the named folders
CREATE TABLE IF NOT EXISTS public.notebooks (
  id TEXT NOT NULL,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (id, user_id)
);

ALTER TABLE public.notebooks ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'notebooks' AND policyname = 'Users can CRUD their own notebooks'
  ) THEN
    CREATE POLICY "Users can CRUD their own notebooks"
      ON public.notebooks
      FOR ALL
      TO authenticated
      USING ((SELECT auth.uid()) = user_id)
      WITH CHECK ((SELECT auth.uid()) = user_id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_notebooks_user_id ON public.notebooks(user_id);

-- 2. Notebook pages — one note each
--
-- notebook_id is a plain TEXT column, not a foreign key: notebooks' primary key
-- is the composite (id, user_id), and pages are already scoped to the user by
-- RLS. Deleting a notebook cascades its pages in app code (SyncedNotebookStore).
CREATE TABLE IF NOT EXISTS public.notebook_pages (
  id TEXT NOT NULL,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  notebook_id TEXT NOT NULL,
  title TEXT,
  text TEXT NOT NULL DEFAULT '',
  -- Manual ordering within a notebook. Unused in v1 (pages sort by updated_at)
  -- but present so drag-to-reorder does not need another migration later.
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (id, user_id)
);

ALTER TABLE public.notebook_pages ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'notebook_pages' AND policyname = 'Users can CRUD their own notebook pages'
  ) THEN
    CREATE POLICY "Users can CRUD their own notebook pages"
      ON public.notebook_pages
      FOR ALL
      TO authenticated
      USING ((SELECT auth.uid()) = user_id)
      WITH CHECK ((SELECT auth.uid()) = user_id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_notebook_pages_user_id ON public.notebook_pages(user_id);
CREATE INDEX IF NOT EXISTS idx_notebook_pages_notebook ON public.notebook_pages(user_id, notebook_id);

-- 3. Realtime
-- Without this the app's RealtimeService subscribes to a table that never
-- broadcasts, and edits made on one device never reach the others live.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'notebooks'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.notebooks;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'notebook_pages'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.notebook_pages;
  END IF;
END $$;

-- 4. Re-define delete_account so the two new tables are swept too.
-- Same function as migration 006, with 'notebooks' and 'notebook_pages' added.
CREATE OR REPLACE FUNCTION public.delete_account()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid;
  t text;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'delete_account requires an authenticated user';
  END IF;

  FOREACH t IN ARRAY ARRAY[
    'user_notes', 'user_highlights', 'user_word_highlights', 'user_bookmarks',
    'journal_entries', 'notebooks', 'notebook_pages',
    'reading_plans', 'reading_progress', 'reading_history',
    'user_settings', 'plan_metadata', 'sync_operations'
  ] LOOP
    IF to_regclass('public.' || t) IS NOT NULL THEN
      EXECUTE format('DELETE FROM public.%I WHERE user_id = $1', t) USING v_uid;
    END IF;
  END LOOP;

  DELETE FROM auth.users WHERE id = v_uid;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.delete_account() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.delete_account() TO authenticated;

NOTIFY pgrst, 'reload schema';
