-- =============================================================================
-- ProjectBible: Highlight Style Extension
-- Migration 002: Add style column to user_highlights; add user_word_highlights
-- =============================================================================
-- Run this in your Supabase SQL Editor (Dashboard > SQL Editor)
-- or via: supabase db push
-- =============================================================================

-- 1. Extend user_highlights with style JSONB column
--    Stores a HighlightStyle object: { type, color, underlineStyle? }
--    The legacy `color` column is kept for backward compatibility.
ALTER TABLE public.user_highlights
  ADD COLUMN IF NOT EXISTS style JSONB;

-- 2. User Word Highlights
-- Stores word-level highlights tied to a specific translation.
-- On other translations the highlight degrades to verse-level display.
CREATE TABLE IF NOT EXISTS public.user_word_highlights (
  id TEXT NOT NULL,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  book TEXT NOT NULL,
  chapter INTEGER NOT NULL,
  verse INTEGER NOT NULL,
  translation TEXT NOT NULL,
  word_start INTEGER NOT NULL,   -- 0-based character offset within verse text
  word_length INTEGER NOT NULL,  -- character length of the highlighted span
  style JSONB NOT NULL,          -- HighlightStyle: { type, color, underlineStyle? }
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (id, user_id)
);

ALTER TABLE public.user_word_highlights ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can CRUD their own word highlights"
  ON public.user_word_highlights
  FOR ALL
  TO authenticated
  USING ((SELECT auth.uid()) = user_id)
  WITH CHECK ((SELECT auth.uid()) = user_id);

CREATE INDEX IF NOT EXISTS idx_user_word_highlights_user_id
  ON public.user_word_highlights(user_id);

CREATE INDEX IF NOT EXISTS idx_user_word_highlights_verse
  ON public.user_word_highlights(user_id, book, chapter, verse);

CREATE INDEX IF NOT EXISTS idx_user_word_highlights_translation
  ON public.user_word_highlights(user_id, translation);
