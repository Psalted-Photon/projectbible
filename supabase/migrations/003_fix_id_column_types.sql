-- Migration: Fix reading_plans and reading_progress id columns to TEXT
--
-- The original migration declared id as TEXT NOT NULL, but the live database
-- has id as UUID. Our app uses non-UUID id values like "plan_1774225160586"
-- and "plan_1774225160586-1", so we need TEXT to accept them.
--
-- UUID casts to TEXT without data loss, so this is safe on any existing rows.
--
-- Run this in the Supabase SQL editor (Dashboard → SQL Editor → New query).

-- ── reading_plans ────────────────────────────────────────────────────────────

ALTER TABLE public.reading_plans
  DROP CONSTRAINT reading_plans_pkey;

ALTER TABLE public.reading_plans
  ALTER COLUMN id TYPE TEXT USING id::TEXT;

ALTER TABLE public.reading_plans
  ADD PRIMARY KEY (id, user_id);

-- ── reading_progress ─────────────────────────────────────────────────────────

ALTER TABLE public.reading_progress
  DROP CONSTRAINT reading_progress_pkey;

ALTER TABLE public.reading_progress
  ALTER COLUMN id TYPE TEXT USING id::TEXT;

ALTER TABLE public.reading_progress
  ADD PRIMARY KEY (id, user_id);
