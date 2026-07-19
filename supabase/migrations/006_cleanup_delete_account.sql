-- ============================================================
-- 006: Cleanup + working delete_account
--
-- • Drops the PowerSync publication — PowerSync was removed from the app
--   long ago; this broadcast list fed nothing. (The app's live updates use
--   the supabase_realtime publication, which is untouched.)
-- • Creates delete_account: the app's Delete Account button calls this RPC
--   but no such function existed in the live DB, so the button errored.
--   It deletes ONLY the calling user (auth.uid()), sweeping their rows from
--   every user table (including legacy tables if present) and finally the
--   auth user itself. The app requires two explicit confirmations before
--   calling it.
-- ============================================================

DROP PUBLICATION IF EXISTS powersync;

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

  -- Explicit sweep of user rows. FK cascades would usually handle this, but
  -- legacy tables may lack CASCADE — the sweep works either way and skips
  -- tables that don't exist.
  FOREACH t IN ARRAY ARRAY[
    'user_notes', 'user_highlights', 'user_word_highlights', 'user_bookmarks',
    'journal_entries', 'reading_plans', 'reading_progress', 'reading_history',
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
