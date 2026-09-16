-- =============================================================================
-- ProjectBible: Shared notebooks
-- Migration 012: notebooks more than one person can read and write
-- =============================================================================
-- Run this in your Supabase SQL Editor (Dashboard > SQL Editor), BEFORE the
-- app update that uses it. Safe to run more than once.
--
-- A personal notebook (migration 010) belongs to one account and never leaves
-- it: every row is keyed on (id, user_id) and every policy is "your rows only".
-- A shared notebook is the opposite — one notebook, many people — so it gets
-- three tables of its own and leaves the single-user ones exactly as they are.
--
--   shared_notebooks          the notebook: who owns it, whether everyone
--                             writes (Group) or only the owner does
--                             (Broadcast), whether a stranger may read it,
--                             its join code, and a revision number.
--   shared_notebook_members   who is in it, what they may do, and the two
--                             letters and colour their pill shows.
--   shared_notebook_pages     the pages. Each has an author, and the author
--                             decides whether anyone else may edit it.
--
-- Who may see what is decided by membership, not by user_id. Membership is
-- read through SECURITY DEFINER helpers, because a policy on the members table
-- that read the members table through RLS would call itself forever.
-- =============================================================================

-- =============================================================================
-- 1. The tables
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.shared_notebooks (
  -- crypto.randomUUID() from the app. The single-user tables use a timestamp
  -- plus a random tail, which is fine inside one account but not once two
  -- accounts insert into the same table.
  id TEXT NOT NULL PRIMARY KEY,
  owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL DEFAULT '',
  -- group: everyone writes and everyone is live.
  -- broadcast: a handful write, any number read.
  kind TEXT NOT NULL DEFAULT 'group' CHECK (kind IN ('group', 'broadcast')),
  -- private: you must be signed in and a member to see anything at all.
  -- public: anyone with the link may read. Writing always needs an account.
  visibility TEXT NOT NULL DEFAULT 'private' CHECK (visibility IN ('private', 'public')),
  -- Eight characters, and the only thing a joiner types.
  join_code TEXT NOT NULL UNIQUE,
  -- Off means the code stops working. People already in stay in.
  join_open BOOLEAN NOT NULL DEFAULT true,
  -- Bumped by any page change. A signed-out reader polls this one number
  -- instead of holding a realtime connection open.
  rev BIGINT NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.shared_notebooks ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_shared_notebooks_owner ON public.shared_notebooks(owner_id);

CREATE TABLE IF NOT EXISTS public.shared_notebook_members (
  -- An id of its own, so the app's outbox can address a member row the same
  -- way it addresses every other row.
  id TEXT NOT NULL PRIMARY KEY,
  notebook_id TEXT NOT NULL REFERENCES public.shared_notebooks(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'writer' CHECK (role IN ('admin', 'writer', 'reader')),
  -- The pill: a name to show, two letters, and a colour, all picked by the
  -- member. Colour is identity rather than appearance, so unlike the reader's
  -- own theme it looks the same to everybody.
  display_name TEXT NOT NULL DEFAULT '',
  initials TEXT NOT NULL DEFAULT '',
  color TEXT NOT NULL DEFAULT '#888888',
  joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (notebook_id, user_id)
);

ALTER TABLE public.shared_notebook_members ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_shared_members_notebook ON public.shared_notebook_members(notebook_id);
CREATE INDEX IF NOT EXISTS idx_shared_members_user ON public.shared_notebook_members(user_id);

CREATE TABLE IF NOT EXISTS public.shared_notebook_pages (
  id TEXT NOT NULL PRIMARY KEY,
  notebook_id TEXT NOT NULL REFERENCES public.shared_notebooks(id) ON DELETE CASCADE,
  -- Who made the page. Never changes, and decides who may edit it.
  author_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title TEXT,
  text TEXT NOT NULL DEFAULT '',
  -- The author's own switch. 'author' means closed, and closed is closed: the
  -- notebook's owner can remove the page but can never rewrite it.
  edit_mode TEXT NOT NULL DEFAULT 'author' CHECK (edit_mode IN ('anyone', 'author')),
  -- Pinned pages sort above everything else. Only over your own pages.
  pinned BOOLEAN NOT NULL DEFAULT false,
  sort_order INTEGER NOT NULL DEFAULT 0,
  -- Bumped on every save. A device that edited offline sends the revision it
  -- started from; if the page has moved on since, its edit is kept as a copy
  -- rather than written over the top.
  rev BIGINT NOT NULL DEFAULT 1,
  -- Soft delete, so a device that was offline when a page was removed finds
  -- out about it on the next pull instead of quietly putting it back.
  deleted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Who saved last, so a pill can sit on the page without another lookup.
  updated_by UUID REFERENCES auth.users(id) ON DELETE SET NULL
);

ALTER TABLE public.shared_notebook_pages ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_shared_pages_notebook ON public.shared_notebook_pages(notebook_id);
CREATE INDEX IF NOT EXISTS idx_shared_pages_author ON public.shared_notebook_pages(notebook_id, author_id, created_at);

-- =============================================================================
-- 2. Membership helpers
--
-- SECURITY DEFINER on purpose: these are called from the policies below, and a
-- policy on shared_notebook_members that read shared_notebook_members through
-- RLS would call itself. Each answers only about the caller, so none of them
-- can be used to look at anybody else's membership.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.is_shared_notebook_member(p_notebook_id TEXT)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
  SELECT EXISTS (
    SELECT 1 FROM public.shared_notebook_members
    WHERE notebook_id = p_notebook_id AND user_id = auth.uid()
  );
$fn$;

CREATE OR REPLACE FUNCTION public.shared_notebook_role(p_notebook_id TEXT)
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
  SELECT role FROM public.shared_notebook_members
  WHERE notebook_id = p_notebook_id AND user_id = auth.uid();
$fn$;

-- May the caller write a page here right now? An admin always may. A writer
-- may, unless the notebook has been switched to Broadcast. A reader never may.
CREATE OR REPLACE FUNCTION public.can_write_shared_notebook(p_notebook_id TEXT)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
  SELECT EXISTS (
    SELECT 1
    FROM public.shared_notebook_members m
    JOIN public.shared_notebooks n ON n.id = m.notebook_id
    WHERE m.notebook_id = p_notebook_id
      AND m.user_id = auth.uid()
      AND (m.role = 'admin' OR (m.role = 'writer' AND n.kind = 'group'))
  );
$fn$;

CREATE OR REPLACE FUNCTION public.owns_shared_notebook(p_notebook_id TEXT)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
  SELECT EXISTS (
    SELECT 1 FROM public.shared_notebooks
    WHERE id = p_notebook_id AND owner_id = auth.uid()
  );
$fn$;

GRANT EXECUTE ON FUNCTION public.is_shared_notebook_member(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.shared_notebook_role(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_write_shared_notebook(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.owns_shared_notebook(TEXT) TO authenticated;

-- =============================================================================
-- 3. Policies
--
-- Note there is no INSERT policy on shared_notebooks or on the members table.
-- Making a notebook and joining one both go through the SECURITY DEFINER
-- functions further down, which are the only things that can create an owner's
-- own member row alongside the notebook, or check a join code nobody is
-- allowed to look up.
-- =============================================================================

DROP POLICY IF EXISTS "Members can read a shared notebook" ON public.shared_notebooks;
CREATE POLICY "Members can read a shared notebook"
  ON public.shared_notebooks FOR SELECT TO authenticated
  USING (public.is_shared_notebook_member(id));

DROP POLICY IF EXISTS "Owners can change a shared notebook" ON public.shared_notebooks;
CREATE POLICY "Owners can change a shared notebook"
  ON public.shared_notebooks FOR UPDATE TO authenticated
  USING ((SELECT auth.uid()) = owner_id)
  WITH CHECK ((SELECT auth.uid()) = owner_id);

DROP POLICY IF EXISTS "Owners can delete a shared notebook" ON public.shared_notebooks;
CREATE POLICY "Owners can delete a shared notebook"
  ON public.shared_notebooks FOR DELETE TO authenticated
  USING ((SELECT auth.uid()) = owner_id);

DROP POLICY IF EXISTS "Members can read the roster" ON public.shared_notebook_members;
CREATE POLICY "Members can read the roster"
  ON public.shared_notebook_members FOR SELECT TO authenticated
  USING (public.is_shared_notebook_member(notebook_id));

-- You change your own pill; the owner changes anybody's role.
DROP POLICY IF EXISTS "Members change their own row, owners change any" ON public.shared_notebook_members;
CREATE POLICY "Members change their own row, owners change any"
  ON public.shared_notebook_members FOR UPDATE TO authenticated
  USING (user_id = (SELECT auth.uid()) OR public.owns_shared_notebook(notebook_id))
  WITH CHECK (user_id = (SELECT auth.uid()) OR public.owns_shared_notebook(notebook_id));

-- You can leave; the owner can remove.
DROP POLICY IF EXISTS "Members can leave and owners can remove" ON public.shared_notebook_members;
CREATE POLICY "Members can leave and owners can remove"
  ON public.shared_notebook_members FOR DELETE TO authenticated
  USING (user_id = (SELECT auth.uid()) OR public.owns_shared_notebook(notebook_id));

DROP POLICY IF EXISTS "Members can read shared pages" ON public.shared_notebook_pages;
CREATE POLICY "Members can read shared pages"
  ON public.shared_notebook_pages FOR SELECT TO authenticated
  USING (public.is_shared_notebook_member(notebook_id));

DROP POLICY IF EXISTS "Writers can add shared pages" ON public.shared_notebook_pages;
CREATE POLICY "Writers can add shared pages"
  ON public.shared_notebook_pages FOR INSERT TO authenticated
  WITH CHECK (
    author_id = (SELECT auth.uid())
    AND public.can_write_shared_notebook(notebook_id)
  );

-- The author always may. Anyone else only where the author left it open, and
-- only if the notebook lets them write at all.
DROP POLICY IF EXISTS "Authors, and open pages, can be edited" ON public.shared_notebook_pages;
CREATE POLICY "Authors, and open pages, can be edited"
  ON public.shared_notebook_pages FOR UPDATE TO authenticated
  USING (
    author_id = (SELECT auth.uid())
    OR (edit_mode = 'anyone' AND public.can_write_shared_notebook(notebook_id))
  )
  WITH CHECK (
    author_id = (SELECT auth.uid())
    OR (edit_mode = 'anyone' AND public.can_write_shared_notebook(notebook_id))
  );

-- Removing a page is moderation, so the owner may do it to anyone's page.
-- Rewriting one is not, which is why the UPDATE policy above is narrower.
DROP POLICY IF EXISTS "Authors and the owner can delete shared pages" ON public.shared_notebook_pages;
CREATE POLICY "Authors and the owner can delete shared pages"
  ON public.shared_notebook_pages FOR DELETE TO authenticated
  USING (author_id = (SELECT auth.uid()) OR public.owns_shared_notebook(notebook_id));

-- =============================================================================
-- 4. Ceilings, so one person cannot fill a shared notebook
--
-- The client sanitiser is the real defence against dangerous markup; this is
-- the cheap second line, refusing the handful of things the editor can never
-- legitimately produce. A `<` typed as prose arrives escaped, so a raw tag in
-- stored text is never something a person typed.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.shared_page_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  -- A generous ceiling for one page of prose: roughly 100 printed pages.
  max_chars CONSTANT INT := 200000;
  max_pages CONSTANT INT := 1000;
  max_new_per_minute CONSTANT INT := 30;
  live_pages INT;
  recent INT;
BEGIN
  IF length(coalesce(NEW.text, '')) > max_chars THEN
    RAISE EXCEPTION 'That page is too long to save (limit % characters)', max_chars
      USING ERRCODE = 'check_violation';
  END IF;

  IF coalesce(NEW.text, '') ~* '<[a-z][^>]*\s(on[a-z]+|href|src|srcset|formaction|xlink:href)\s*='
     OR coalesce(NEW.text, '') ~* '<\s*/?\s*(script|iframe|object|embed|form|link|meta|base|style|svg)\b'
  THEN
    RAISE EXCEPTION 'That page contains markup a note cannot hold'
      USING ERRCODE = 'check_violation';
  END IF;

  -- Pinning is the notebook owner's, and only over pages they wrote themselves.
  -- The UPDATE policy already stops anyone moving somebody else's page; this
  -- stops a member pinning their own page to the top of a notebook they do not
  -- run. On the way in it is quietly ignored rather than refused, because an
  -- older app version could send it without meaning anything by it.
  IF TG_OP = 'INSERT' THEN
    IF NEW.pinned AND NOT public.owns_shared_notebook(NEW.notebook_id) THEN
      NEW.pinned := false;
    END IF;
  ELSIF NEW.pinned IS DISTINCT FROM OLD.pinned
        AND NOT public.owns_shared_notebook(NEW.notebook_id) THEN
    RAISE EXCEPTION 'Only the person who owns this notebook can pin a page'
      USING ERRCODE = 'check_violation';
  END IF;

  IF TG_OP = 'INSERT' THEN
    SELECT count(*) INTO live_pages
    FROM public.shared_notebook_pages
    WHERE notebook_id = NEW.notebook_id AND deleted_at IS NULL;

    IF live_pages >= max_pages THEN
      RAISE EXCEPTION 'This notebook is full (limit % pages)', max_pages
        USING ERRCODE = 'check_violation';
    END IF;

    SELECT count(*) INTO recent
    FROM public.shared_notebook_pages
    WHERE notebook_id = NEW.notebook_id
      AND author_id = NEW.author_id
      AND created_at > now() - interval '1 minute';

    IF recent >= max_new_per_minute THEN
      RAISE EXCEPTION 'Too many new pages at once — wait a moment and try again'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS shared_page_guard ON public.shared_notebook_pages;
CREATE TRIGGER shared_page_guard
  BEFORE INSERT OR UPDATE ON public.shared_notebook_pages
  FOR EACH ROW
  EXECUTE FUNCTION public.shared_page_guard();

-- Every page change moves the page's own revision and the notebook's, so a
-- signed-out reader can poll one number and a returning device can tell
-- whether the page it edited has moved on.
CREATE OR REPLACE FUNCTION public.shared_page_bump_rev()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_notebook TEXT;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    NEW.rev := OLD.rev + 1;
    NEW.updated_at := now();
  END IF;

  v_notebook := CASE WHEN TG_OP = 'DELETE' THEN OLD.notebook_id ELSE NEW.notebook_id END;
  UPDATE public.shared_notebooks
  SET rev = rev + 1, updated_at = now()
  WHERE id = v_notebook;

  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$fn$;

DROP TRIGGER IF EXISTS shared_page_bump_rev ON public.shared_notebook_pages;
CREATE TRIGGER shared_page_bump_rev
  BEFORE INSERT OR UPDATE ON public.shared_notebook_pages
  FOR EACH ROW
  EXECUTE FUNCTION public.shared_page_bump_rev();

DROP TRIGGER IF EXISTS shared_page_bump_rev_delete ON public.shared_notebook_pages;
CREATE TRIGGER shared_page_bump_rev_delete
  AFTER DELETE ON public.shared_notebook_pages
  FOR EACH ROW
  EXECUTE FUNCTION public.shared_page_bump_rev();

-- =============================================================================
-- 5. Join codes
-- =============================================================================

-- Eight characters with no 0, O, 1, I, L or U, so a code survives being read
-- aloud across a room. Re-rolled until it is one nobody else holds.
CREATE OR REPLACE FUNCTION public.new_shared_notebook_code()
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  alphabet TEXT := 'ABCDEFGHJKMNPQRSTVWXYZ23456789';
  candidate TEXT;
  i INT;
BEGIN
  LOOP
    candidate := '';
    FOR i IN 1..8 LOOP
      candidate := candidate || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1);
    END LOOP;
    EXIT WHEN NOT EXISTS (SELECT 1 FROM public.shared_notebooks WHERE join_code = candidate);
  END LOOP;
  RETURN candidate;
END;
$fn$;

-- =============================================================================
-- 6. Make one, join one, run one
-- =============================================================================

-- Make a shared notebook. The caller becomes its owner, and their own member
-- row is created in the same breath — without it, the owner could not read
-- back what they had just made.
CREATE OR REPLACE FUNCTION public.create_shared_notebook(
  p_id TEXT,
  p_member_id TEXT,
  p_name TEXT DEFAULT '',
  p_kind TEXT DEFAULT 'group',
  p_visibility TEXT DEFAULT 'private',
  p_display_name TEXT DEFAULT '',
  p_initials TEXT DEFAULT '',
  p_color TEXT DEFAULT '#888888'
)
RETURNS public.shared_notebooks
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_uid UUID := auth.uid();
  v_row public.shared_notebooks;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'You have to be signed in to make a shared notebook';
  END IF;

  INSERT INTO public.shared_notebooks (id, owner_id, name, kind, visibility, join_code)
  VALUES (
    p_id, v_uid, coalesce(p_name, ''),
    coalesce(p_kind, 'group'), coalesce(p_visibility, 'private'),
    public.new_shared_notebook_code()
  )
  RETURNING * INTO v_row;

  INSERT INTO public.shared_notebook_members
    (id, notebook_id, user_id, role, display_name, initials, color)
  VALUES
    (p_member_id, v_row.id, v_uid, 'admin', coalesce(p_display_name, ''),
     coalesce(p_initials, ''), coalesce(p_color, '#888888'));

  RETURN v_row;
END;
$fn$;

-- Join by code. Joining again is not an error — it hands back the notebook you
-- are already in, so a re-tapped link or a second scan is harmless.
--
-- A new member is a writer in a Group notebook and a reader in a Broadcast one.
CREATE OR REPLACE FUNCTION public.join_shared_notebook(
  p_code TEXT,
  p_member_id TEXT,
  p_display_name TEXT DEFAULT '',
  p_initials TEXT DEFAULT '',
  p_color TEXT DEFAULT '#888888'
)
RETURNS public.shared_notebooks
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_uid UUID := auth.uid();
  v_row public.shared_notebooks;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'You have to be signed in to join a shared notebook';
  END IF;

  SELECT * INTO v_row FROM public.shared_notebooks
  WHERE join_code = upper(trim(coalesce(p_code, '')));

  IF v_row.id IS NULL THEN
    RAISE EXCEPTION 'No shared notebook has that code';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.shared_notebook_members
    WHERE notebook_id = v_row.id AND user_id = v_uid
  ) THEN
    RETURN v_row;
  END IF;

  IF NOT v_row.join_open THEN
    RAISE EXCEPTION 'This notebook is not taking new people';
  END IF;

  INSERT INTO public.shared_notebook_members
    (id, notebook_id, user_id, role, display_name, initials, color)
  VALUES
    (p_member_id, v_row.id, v_uid,
     CASE WHEN v_row.kind = 'broadcast' THEN 'reader' ELSE 'writer' END,
     coalesce(p_display_name, ''), coalesce(p_initials, ''), coalesce(p_color, '#888888'));

  RETURN v_row;
END;
$fn$;

-- Owner only: throw the current code away and issue a new one. Every old link
-- and QR code stops working the moment this returns.
CREATE OR REPLACE FUNCTION public.reset_shared_notebook_code(p_notebook_id TEXT)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_code TEXT;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.shared_notebooks
    WHERE id = p_notebook_id AND owner_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'Only the owner can change the code';
  END IF;

  v_code := public.new_shared_notebook_code();
  UPDATE public.shared_notebooks
  SET join_code = v_code, updated_at = now()
  WHERE id = p_notebook_id;

  RETURN v_code;
END;
$fn$;

-- Save a page without writing over somebody else's work.
--
-- p_base_rev is the revision the writer started from. If the page has moved on
-- since — someone saved while this device had no signal — nothing is written
-- and the current row comes back marked 'conflict', for the app to keep as a
-- separate copy. A page that isn't there yet is created.
--
-- SECURITY INVOKER (the default) on purpose: every write still goes through
-- the policies above, so this cannot put text anywhere you may not write.
CREATE OR REPLACE FUNCTION public.save_shared_page(
  p_id TEXT,
  p_notebook_id TEXT,
  p_title TEXT,
  p_text TEXT,
  p_base_rev BIGINT DEFAULT NULL,
  p_edit_mode TEXT DEFAULT NULL,
  p_pinned BOOLEAN DEFAULT NULL,
  p_created_at TIMESTAMPTZ DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SET search_path = public
AS $fn$
DECLARE
  v_uid UUID := auth.uid();
  v_existing public.shared_notebook_pages;
  v_row public.shared_notebook_pages;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'You have to be signed in to write in a shared notebook';
  END IF;

  SELECT * INTO v_existing FROM public.shared_notebook_pages WHERE id = p_id;

  IF v_existing.id IS NULL THEN
    INSERT INTO public.shared_notebook_pages
      (id, notebook_id, author_id, title, text, edit_mode, pinned, created_at, updated_at, updated_by)
    VALUES
      (p_id, p_notebook_id, v_uid, p_title, coalesce(p_text, ''),
       coalesce(p_edit_mode, 'author'), coalesce(p_pinned, false),
       coalesce(p_created_at, now()), now(), v_uid)
    RETURNING * INTO v_row;
    RETURN jsonb_build_object('status', 'saved', 'page', to_jsonb(v_row));
  END IF;

  IF v_existing.deleted_at IS NOT NULL THEN
    RETURN jsonb_build_object('status', 'deleted', 'page', to_jsonb(v_existing));
  END IF;

  IF p_base_rev IS NOT NULL AND v_existing.rev > p_base_rev THEN
    RETURN jsonb_build_object('status', 'conflict', 'page', to_jsonb(v_existing));
  END IF;

  UPDATE public.shared_notebook_pages
  SET title      = p_title,
      text       = coalesce(p_text, ''),
      edit_mode  = coalesce(p_edit_mode, edit_mode),
      pinned     = coalesce(p_pinned, pinned),
      updated_by = v_uid
  WHERE id = p_id
  RETURNING * INTO v_row;

  IF v_row.id IS NULL THEN
    RAISE EXCEPTION 'That page is closed to everyone but the person who wrote it';
  END IF;

  RETURN jsonb_build_object('status', 'saved', 'page', to_jsonb(v_row));
END;
$fn$;

-- Take a page out of the notebook.
--
-- Removing is moderation, so the notebook's owner may do it to anybody's page
-- — but rewriting one is not, which is why this is a function of its own
-- rather than an UPDATE. It only ever sets deleted_at, so there is no path
-- here by which the owner can put words into somebody else's page.
--
-- Soft, not a real delete, so a device that was offline when the page went
-- finds out on its next pull instead of quietly uploading it again.
CREATE OR REPLACE FUNCTION public.remove_shared_page(p_id TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_uid UUID := auth.uid();
  v_page public.shared_notebook_pages;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'You have to be signed in to remove a page';
  END IF;

  SELECT * INTO v_page FROM public.shared_notebook_pages WHERE id = p_id;
  IF v_page.id IS NULL THEN
    RETURN false;
  END IF;

  IF v_page.author_id <> v_uid AND NOT EXISTS (
    SELECT 1 FROM public.shared_notebooks
    WHERE id = v_page.notebook_id AND owner_id = v_uid
  ) THEN
    RAISE EXCEPTION 'Only the person who wrote this page, or whoever owns the notebook, can remove it';
  END IF;

  UPDATE public.shared_notebook_pages
  SET deleted_at = now(), updated_by = v_uid
  WHERE id = p_id AND deleted_at IS NULL;

  RETURN true;
END;
$fn$;

-- =============================================================================
-- 7. Reading a public notebook with no account
--
-- A signed-out reader is not a member and holds no realtime connection. These
-- two functions are their only way in: one returns the notebook and its pages,
-- the other returns the single revision number they poll to find out whether
-- anything has changed. Neither accepts a write, and neither can be used to
-- list notebooks — you have to already hold the code.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.read_public_shared_notebook(p_code TEXT)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_row public.shared_notebooks;
BEGIN
  SELECT * INTO v_row FROM public.shared_notebooks
  WHERE join_code = upper(trim(coalesce(p_code, ''))) AND visibility = 'public';

  IF v_row.id IS NULL THEN
    RAISE EXCEPTION 'No notebook is being shared with that code';
  END IF;

  RETURN jsonb_build_object(
    'notebook', jsonb_build_object(
      'id', v_row.id, 'name', v_row.name, 'kind', v_row.kind,
      'visibility', v_row.visibility, 'rev', v_row.rev,
      'created_at', v_row.created_at, 'updated_at', v_row.updated_at
    ),
    'members', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'id', m.id, 'user_id', m.user_id, 'role', m.role,
        'display_name', m.display_name, 'initials', m.initials, 'color', m.color
      ) ORDER BY m.joined_at)
      FROM public.shared_notebook_members m WHERE m.notebook_id = v_row.id
    ), '[]'::jsonb),
    'pages', coalesce((
      SELECT jsonb_agg(to_jsonb(p) ORDER BY p.pinned DESC, p.updated_at DESC)
      FROM public.shared_notebook_pages p
      WHERE p.notebook_id = v_row.id AND p.deleted_at IS NULL
    ), '[]'::jsonb)
  );
END;
$fn$;

CREATE OR REPLACE FUNCTION public.public_shared_notebook_rev(p_code TEXT)
RETURNS BIGINT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
  SELECT rev FROM public.shared_notebooks
  WHERE join_code = upper(trim(coalesce(p_code, ''))) AND visibility = 'public';
$fn$;

GRANT EXECUTE ON FUNCTION public.new_shared_notebook_code() TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_shared_notebook(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.join_shared_notebook(TEXT, TEXT, TEXT, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reset_shared_notebook_code(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.save_shared_page(TEXT, TEXT, TEXT, TEXT, BIGINT, TEXT, BOOLEAN, TIMESTAMPTZ) TO authenticated;
GRANT EXECUTE ON FUNCTION public.remove_shared_page(TEXT) TO authenticated;

-- The two public-reader functions are the only ones the anon role ever gets.
GRANT EXECUTE ON FUNCTION public.read_public_shared_notebook(TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.public_shared_notebook_rev(TEXT) TO anon, authenticated;

-- =============================================================================
-- 8. Realtime, so a page somebody else writes appears without a refresh
-- =============================================================================
DO $$
DECLARE
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['shared_notebooks', 'shared_notebook_members', 'shared_notebook_pages'] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = t
    ) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', t);
    END IF;
  END LOOP;
END $$;

-- =============================================================================
-- 9. Re-define delete_account so the new tables are swept too.
--
-- Same function as migration 011, with the shared-notebook tables added. A
-- notebook the leaver owned goes with them and its members and pages cascade;
-- their membership of other people's notebooks, and the pages they wrote
-- there, go too — so nothing of theirs is left behind anywhere.
-- =============================================================================
CREATE OR REPLACE FUNCTION public.delete_account()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_uid uuid;
  t text;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'delete_account requires an authenticated user';
  END IF;

  IF to_regclass('public.shared_notebook_pages') IS NOT NULL THEN
    DELETE FROM public.shared_notebook_pages WHERE author_id = v_uid;
  END IF;
  IF to_regclass('public.shared_notebook_members') IS NOT NULL THEN
    DELETE FROM public.shared_notebook_members WHERE user_id = v_uid;
  END IF;
  IF to_regclass('public.shared_notebooks') IS NOT NULL THEN
    DELETE FROM public.shared_notebooks WHERE owner_id = v_uid;
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
$fn$;

REVOKE EXECUTE ON FUNCTION public.delete_account() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.delete_account() TO authenticated;

NOTIFY pgrst, 'reload schema';

-- =============================================================================
-- 10. Check. The three table columns should be true, functions_ready 12,
--     policies_ready 10, triggers_ready 3 and realtime_tables 3.
-- =============================================================================
SELECT
  to_regclass('public.shared_notebooks') IS NOT NULL        AS notebooks_table_ready,
  to_regclass('public.shared_notebook_members') IS NOT NULL AS members_table_ready,
  to_regclass('public.shared_notebook_pages') IS NOT NULL   AS pages_table_ready,
  (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.proname IN ('is_shared_notebook_member', 'shared_notebook_role',
                       'can_write_shared_notebook', 'owns_shared_notebook',
                       'new_shared_notebook_code', 'create_shared_notebook',
                       'join_shared_notebook', 'reset_shared_notebook_code',
                       'save_shared_page', 'remove_shared_page',
                       'read_public_shared_notebook',
                       'public_shared_notebook_rev'))                       AS functions_ready,
  (SELECT count(*) FROM pg_policies WHERE schemaname = 'public'
     AND tablename IN ('shared_notebooks', 'shared_notebook_members',
                       'shared_notebook_pages'))                           AS policies_ready,
  (SELECT count(*) FROM pg_trigger
   WHERE NOT tgisinternal
     AND tgname IN ('shared_page_guard', 'shared_page_bump_rev',
                    'shared_page_bump_rev_delete'))                        AS triggers_ready,
  (SELECT count(*) FROM pg_publication_tables
   WHERE pubname = 'supabase_realtime' AND schemaname = 'public'
     AND tablename IN ('shared_notebooks', 'shared_notebook_members',
                       'shared_notebook_pages'))                           AS realtime_tables;
