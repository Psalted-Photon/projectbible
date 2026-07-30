-- =============================================================================
-- ProjectBible: Web Push subscriptions
-- Migration 008: push_subscriptions table with RLS
-- =============================================================================
-- Run this in your Supabase SQL Editor (Dashboard > SQL Editor)
--
-- One row per browser/device that agreed to receive notifications. The endpoint
-- is a URL at the browser vendor's push service (FCM for Chrome/Android, Apple's
-- for Safari/iOS); posting an encrypted payload to it is what actually wakes the
-- phone. `p256dh` and `auth` are the keys that payload is encrypted with.
--
-- A user can have several rows (phone, tablet, desktop). The alarm sends to all
-- of them; whichever device you pick up is the one you read on.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.push_subscriptions (
  -- The endpoint uniquely identifies a browser install, so it is the natural key.
  endpoint TEXT NOT NULL PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  -- Encryption material handed to us by the browser's PushManager.
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,

  -- Free-text hint so a stale row is identifiable in the dashboard.
  user_agent TEXT,

  -- Set when the push service reports the subscription is gone (HTTP 404/410).
  -- Kept rather than deleted so a dead phone is visible instead of silently absent.
  expired_at TIMESTAMPTZ,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can CRUD their own push subscriptions"
  ON public.push_subscriptions
  FOR ALL
  TO authenticated
  USING ((SELECT auth.uid()) = user_id)
  WITH CHECK ((SELECT auth.uid()) = user_id);

-- The sender looks up live subscriptions by user.
CREATE INDEX IF NOT EXISTS idx_push_subscriptions_user
  ON public.push_subscriptions(user_id)
  WHERE expired_at IS NULL;
