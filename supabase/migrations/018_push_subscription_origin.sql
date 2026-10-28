-- =============================================================================
-- ProjectBible: Which address a device signed up for notifications on
-- Migration 018: push_subscriptions.origin
-- =============================================================================
-- Run this in your Supabase SQL Editor (Dashboard > SQL Editor) BEFORE the
-- deploy that writes it. Safe to run more than once.
--
-- Chrome keeps a separate sign-up for each web address, so one phone that
-- used the app on hexapla.app and then on irisbible.com has two rows, and
-- both get every reminder. Nothing in a row said which address it came from
-- (the user agent is the same for both). The app now fills this in, e.g.
-- 'https://irisbible.com', whenever it saves or refreshes its sign-up.
--
-- Rows from before this have no origin. Once a device has opened irisBible,
-- its row is filled in, so a live row still without one is a leftover from
-- an old address.
-- =============================================================================

ALTER TABLE public.push_subscriptions
  ADD COLUMN IF NOT EXISTS origin TEXT;
