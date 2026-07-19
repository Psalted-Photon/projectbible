-- =============================================================================
-- ProjectBible: PowerSync Publication Setup
-- Migration 002: Create publication for PowerSync replication
-- =============================================================================
-- Run this in your Supabase SQL Editor AFTER migration 001
-- =============================================================================

-- PowerSync reads changes via Postgres logical replication.
-- We need a publication that includes all user data tables.

-- Drop if exists for idempotency
DROP PUBLICATION IF EXISTS powersync;

CREATE PUBLICATION powersync FOR TABLE
  public.user_notes,
  public.user_highlights,
  public.user_bookmarks,
  public.journal_entries,
  public.reading_plans,
  public.reading_progress,
  public.reading_history;

-- Note: user_settings is intentionally EXCLUDED from PowerSync publication.
-- It uses a simple JSONB column that is better handled via direct Supabase calls
-- (already working via userSettings.ts).
