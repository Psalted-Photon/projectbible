-- =============================================================================
-- ProjectBible: User Data Tables for PowerSync Integration
-- Migration 001: Create all user data tables with RLS
-- =============================================================================
-- Run this in your Supabase SQL Editor (Dashboard > SQL Editor)
-- =============================================================================

-- 1. User Notes
-- Stores per-verse notes created by users
CREATE TABLE IF NOT EXISTS public.user_notes (
  id TEXT NOT NULL,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  book TEXT NOT NULL,
  chapter INTEGER NOT NULL,
  verse INTEGER NOT NULL,
  text TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (id, user_id)
);

ALTER TABLE public.user_notes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can CRUD their own notes"
  ON public.user_notes
  FOR ALL
  TO authenticated
  USING ((SELECT auth.uid()) = user_id)
  WITH CHECK ((SELECT auth.uid()) = user_id);

CREATE INDEX idx_user_notes_user_id ON public.user_notes(user_id);
CREATE INDEX idx_user_notes_verse ON public.user_notes(user_id, book, chapter, verse);

-- 2. User Highlights
-- Stores per-verse color highlights
CREATE TABLE IF NOT EXISTS public.user_highlights (
  id TEXT NOT NULL,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  book TEXT NOT NULL,
  chapter INTEGER NOT NULL,
  verse INTEGER NOT NULL,
  color TEXT NOT NULL DEFAULT '#ffeb3b',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (id, user_id)
);

ALTER TABLE public.user_highlights ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can CRUD their own highlights"
  ON public.user_highlights
  FOR ALL
  TO authenticated
  USING ((SELECT auth.uid()) = user_id)
  WITH CHECK ((SELECT auth.uid()) = user_id);

CREATE INDEX idx_user_highlights_user_id ON public.user_highlights(user_id);
CREATE INDEX idx_user_highlights_verse ON public.user_highlights(user_id, book, chapter, verse);

-- 3. User Bookmarks (Saved Verses)
-- Stores bookmarked/saved verses with optional labels
CREATE TABLE IF NOT EXISTS public.user_bookmarks (
  id TEXT NOT NULL,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  book TEXT NOT NULL,
  chapter INTEGER NOT NULL,
  verse INTEGER NOT NULL,
  label TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (id, user_id)
);

ALTER TABLE public.user_bookmarks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can CRUD their own bookmarks"
  ON public.user_bookmarks
  FOR ALL
  TO authenticated
  USING ((SELECT auth.uid()) = user_id)
  WITH CHECK ((SELECT auth.uid()) = user_id);

CREATE INDEX idx_user_bookmarks_user_id ON public.user_bookmarks(user_id);

-- 4. Journal Entries
-- Rich-text journal entries by date
CREATE TABLE IF NOT EXISTS public.journal_entries (
  id TEXT NOT NULL,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  date TEXT NOT NULL, -- YYYY-MM-DD format
  title TEXT,
  text TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (id, user_id)
);

ALTER TABLE public.journal_entries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can CRUD their own journal entries"
  ON public.journal_entries
  FOR ALL
  TO authenticated
  USING ((SELECT auth.uid()) = user_id)
  WITH CHECK ((SELECT auth.uid()) = user_id);

CREATE INDEX idx_journal_entries_user_id ON public.journal_entries(user_id);
CREATE INDEX idx_journal_entries_date ON public.journal_entries(user_id, date);

-- 5. Reading Plans
-- Stores the plan configuration and status
CREATE TABLE IF NOT EXISTS public.reading_plans (
  id TEXT NOT NULL,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL DEFAULT '',
  config TEXT NOT NULL DEFAULT '{}', -- JSON string of ReadingPlanConfig
  started_at BIGINT, -- Unix timestamp
  completed_at BIGINT, -- Unix timestamp
  current_day_number INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'active',
  plan_definition_hash TEXT,
  plan_version INTEGER DEFAULT 1,
  activated_at BIGINT,
  archived_at BIGINT,
  catch_up_adjustment TEXT, -- JSON string
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (id, user_id)
);

ALTER TABLE public.reading_plans ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can CRUD their own reading plans"
  ON public.reading_plans
  FOR ALL
  TO authenticated
  USING ((SELECT auth.uid()) = user_id)
  WITH CHECK ((SELECT auth.uid()) = user_id);

CREATE INDEX idx_reading_plans_user_id ON public.reading_plans(user_id);
CREATE INDEX idx_reading_plans_status ON public.reading_plans(user_id, status);

-- 6. Reading Progress
-- Per-day progress entries for reading plans
CREATE TABLE IF NOT EXISTS public.reading_progress (
  id TEXT NOT NULL,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  plan_id TEXT NOT NULL,
  day_number INTEGER NOT NULL,
  completed INTEGER NOT NULL DEFAULT 0, -- 0 or 1
  created_at BIGINT NOT NULL DEFAULT 0,
  completed_at BIGINT,
  started_reading_at BIGINT,
  chapters_read TEXT NOT NULL DEFAULT '[]', -- JSON string
  catch_up_adjustment TEXT, -- JSON string
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (id, user_id)
);

ALTER TABLE public.reading_progress ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can CRUD their own reading progress"
  ON public.reading_progress
  FOR ALL
  TO authenticated
  USING ((SELECT auth.uid()) = user_id)
  WITH CHECK ((SELECT auth.uid()) = user_id);

CREATE INDEX idx_reading_progress_user_id ON public.reading_progress(user_id);
CREATE INDEX idx_reading_progress_plan ON public.reading_progress(user_id, plan_id);

-- 7. Reading History
-- Append-only log of chapters read
CREATE TABLE IF NOT EXISTS public.reading_history (
  id TEXT NOT NULL,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  book TEXT NOT NULL,
  chapter INTEGER NOT NULL,
  read_at BIGINT NOT NULL, -- Unix timestamp
  plan_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (id, user_id)
);

ALTER TABLE public.reading_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can CRUD their own reading history"
  ON public.reading_history
  FOR ALL
  TO authenticated
  USING ((SELECT auth.uid()) = user_id)
  WITH CHECK ((SELECT auth.uid()) = user_id);

CREATE INDEX idx_reading_history_user_id ON public.reading_history(user_id);
CREATE INDEX idx_reading_history_book ON public.reading_history(user_id, book, chapter);

-- 8. User Settings (keep existing table, add if missing)
-- Already exists in Supabase - this is a safety net
CREATE TABLE IF NOT EXISTS public.user_settings (
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE PRIMARY KEY,
  settings JSONB NOT NULL DEFAULT '{}',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.user_settings ENABLE ROW LEVEL SECURITY;

-- Only create policy if it doesn't exist (idempotent)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'user_settings' AND policyname = 'Users can CRUD their own settings'
  ) THEN
    CREATE POLICY "Users can CRUD their own settings"
      ON public.user_settings
      FOR ALL
      TO authenticated
      USING ((SELECT auth.uid()) = user_id)
      WITH CHECK ((SELECT auth.uid()) = user_id);
  END IF;
END $$;
