-- =============================================================================
-- ProjectBible: Journal lock
-- Migration 011: scrambled journal + fingerprint / recovery-code key slots
-- =============================================================================
-- Run this in your Supabase SQL Editor (Dashboard > SQL Editor), BEFORE the
-- app update that uses it. Safe to run more than once.
--
-- When the journal lock is on, the app scrambles every journal title and entry
-- with a random journal key before it leaves the phone. Supabase only ever
-- holds scrambled text. These two tables hold what a device needs to open that
-- key again — never the key itself:
--
--   journal_lock       one row per user: is the lock on, off, or turning off,
--                      and which journal key is current.
--   journal_key_slots  locked copies of the journal key: one per fingerprint
--                      passkey, plus one for the recovery code. Each copy is
--                      useless without that passkey or that code.
--
-- A guard on journal_entries then refuses readable title or text while the
-- lock is on, so an old app version or a missed code path can't put readable
-- journal text back in the cloud.
-- =============================================================================

-- 1. The lock itself — one row per user
CREATE TABLE IF NOT EXISTS public.journal_lock (
  user_id UUID NOT NULL PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  state TEXT NOT NULL DEFAULT 'off' CHECK (state IN ('off', 'on', 'turning_off')),
  -- A short public fingerprint of the current journal key, so a device can
  -- tell a stale key slot from a current one. Reveals nothing about the key.
  key_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.journal_lock ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'journal_lock' AND policyname = 'Users can CRUD their own journal lock'
  ) THEN
    CREATE POLICY "Users can CRUD their own journal lock"
      ON public.journal_lock
      FOR ALL
      TO authenticated
      USING ((SELECT auth.uid()) = user_id)
      WITH CHECK ((SELECT auth.uid()) = user_id);
  END IF;
END $$;

-- 2. Locked copies of the journal key
CREATE TABLE IF NOT EXISTS public.journal_key_slots (
  id TEXT NOT NULL,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('passkey', 'recovery')),
  key_id TEXT NOT NULL,
  -- Which device made it, e.g. "iPhone · Safari". Empty for the recovery code.
  label TEXT NOT NULL DEFAULT '',
  -- Passkey slots only: which passkey opens it, and the site it belongs to.
  credential_id TEXT,
  rp_id TEXT,
  salt TEXT NOT NULL,
  wrapped_key TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (id, user_id)
);

ALTER TABLE public.journal_key_slots ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'journal_key_slots' AND policyname = 'Users can CRUD their own journal key slots'
  ) THEN
    CREATE POLICY "Users can CRUD their own journal key slots"
      ON public.journal_key_slots
      FOR ALL
      TO authenticated
      USING ((SELECT auth.uid()) = user_id)
      WITH CHECK ((SELECT auth.uid()) = user_id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_journal_key_slots_user_id ON public.journal_key_slots(user_id);

-- 3. Realtime, so a second device locks the moment the lock turns on
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'journal_lock'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.journal_lock;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'journal_key_slots'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.journal_key_slots;
  END IF;
END $$;

-- 4. The guard: no readable journal text in the cloud while the lock is on.
--
-- Scrambled fields start with 'pbj1:'. Empty text and an empty title are
-- allowed (they stay empty). On an UPDATE only the columns actually being
-- changed are checked, so a write never fails because of an older field that
-- the app hasn't scrambled yet — the app re-scrambles those on unlock.
-- While the lock is turning off, readable text is allowed again.
CREATE OR REPLACE FUNCTION public.journal_entries_lock_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.journal_lock WHERE user_id = NEW.user_id AND state = 'on'
  ) THEN
    IF (TG_OP = 'INSERT' OR NEW.title IS DISTINCT FROM OLD.title)
       AND NEW.title IS NOT NULL AND NEW.title <> '' AND left(NEW.title, 5) <> 'pbj1:' THEN
      RAISE EXCEPTION 'The journal lock is on: journal titles must be scrambled'
        USING ERRCODE = 'check_violation';
    END IF;
    IF (TG_OP = 'INSERT' OR NEW.text IS DISTINCT FROM OLD.text)
       AND NEW.text IS NOT NULL AND NEW.text <> '' AND left(NEW.text, 5) <> 'pbj1:' THEN
      RAISE EXCEPTION 'The journal lock is on: journal text must be scrambled'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS journal_entries_lock_guard ON public.journal_entries;
CREATE TRIGGER journal_entries_lock_guard
  BEFORE INSERT OR UPDATE ON public.journal_entries
  FOR EACH ROW
  EXECUTE FUNCTION public.journal_entries_lock_guard();

-- 5. Re-define delete_account so the two new tables are swept too.
-- Same function as migration 010, with 'journal_lock' and 'journal_key_slots' added.
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
    'journal_entries', 'journal_lock', 'journal_key_slots',
    'notebooks', 'notebook_pages',
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

-- 6. Check: every value below should be true, and realtime_tables should be 2.
SELECT
  to_regclass('public.journal_lock') IS NOT NULL      AS lock_table_ready,
  to_regclass('public.journal_key_slots') IS NOT NULL AS key_slots_table_ready,
  EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'journal_entries_lock_guard' AND NOT tgisinternal
  )                                                   AS guard_ready,
  (
    SELECT count(*) FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public'
      AND tablename IN ('journal_lock', 'journal_key_slots')
  )                                                   AS realtime_tables;
