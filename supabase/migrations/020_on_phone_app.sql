-- =============================================================================
-- ProjectBible: The phone app rings it, so the server stays quiet
-- Migration 020: on_phone_app on wake_alarms and devotional_reminders
-- =============================================================================
-- Run this in your Supabase SQL Editor (Dashboard > SQL Editor) BEFORE the
-- two sender functions are redeployed and before the new app ships: both read
-- this column. Safe to run more than once. Written without any $ sign, like 015.
--
-- The Android app sets the alarm and reminders on the phone itself, and still
-- saves a copy to the account. The senders sent that copy to every browser on
-- the account, including Chrome on the same phone, whose notification cut the
-- app's ringing off (seen 2026-11-23).
--
-- The rule: saved in the app, the app rings it and the senders skip the row.
-- Saved on the website's alarm or reminder screen, it goes back to false and
-- the senders send it.
-- =============================================================================

ALTER TABLE public.wake_alarms
  ADD COLUMN IF NOT EXISTS on_phone_app BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE public.devotional_reminders
  ADD COLUMN IF NOT EXISTS on_phone_app BOOLEAN NOT NULL DEFAULT false;

-- Should show the new column on both tables.
SELECT table_name, column_name, column_default
  FROM information_schema.columns
 WHERE table_schema = 'public' AND column_name = 'on_phone_app';
