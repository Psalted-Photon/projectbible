/**
 * SharedNotebookStore — notebooks more than one person reads and writes.
 *
 * Deliberately separate plumbing from SyncedNotebookStore, and it has to stay
 * that way. The single-user engine injects user_id into every write, scopes
 * every pull to the signed-in account, and then deletes any local row that
 * pull did not return. Every one of those is right for a table holding one
 * person's rows and wrong for a table holding everybody's: aimed here, the
 * last one would wipe other people's pages off this device the first time it
 * ran. So shared rows get their own pull, their own reconciliation and (from
 * phase 8) their own outbox, and the shared tables stay out of the SyncTable
 * union and out of RealtimeService's list.
 *
 * What makes reconciliation safe here is that the pull is scoped by
 * *membership*, not by authorship. What comes back is exactly the set of rows
 * this account is allowed to see, so a row that is missing from it really is
 * gone — the notebook was deleted, or this account was removed from it, or the
 * page was taken out — and deleting the local copy is the correct answer
 * rather than a data loss.
 *
 * Phase 1 reads. Phase 2 makes one and joins one. Phase 3 writes in one.
 * Phase 4 stamps each save with who wrote which paragraph, and lets a member
 * change the badge they are known by.
 */

import { supabase } from '../lib/supabase/client';
import { openDB, writeTransaction } from './db';
import type {
  DBSharedNotebook,
  DBSharedNotebookMember,
  DBSharedNotebookPage,
} from './db';
import { sanitizeNoteHtml, MAX_PAGE_CHARS } from '../lib/shared/sanitizeNoteHtml';
import { sharedId } from '../lib/shared/ids';
import { normalizeJoinCode } from '../lib/shared/joinCode';
import { defaultMemberIdentity } from '../lib/shared/memberIdentity';
import { stampParagraphs } from '../lib/shared/paragraphStamp';

// ─── Shapes the app works in ─────────────────────────────────────────────────

export interface SharedNotebook {
  id: string;
  ownerId: string;
  name: string;
  kind: 'group' | 'broadcast';
  visibility: 'private' | 'public';
  joinCode: string;
  joinOpen: boolean;
  rev: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface SharedNotebookMember {
  id: string;
  notebookId: string;
  userId: string;
  role: 'admin' | 'writer' | 'reader';
  displayName: string;
  initials: string;
  color: string;
  joinedAt: Date;
  updatedAt: Date;
}

export interface SharedNotebookPage {
  id: string;
  notebookId: string;
  authorId: string;
  title?: string;
  /** Always sanitised — on the way in from the server and again before display. */
  text: string;
  editMode: 'anyone' | 'author';
  pinned: boolean;
  sortOrder: number;
  rev: number;
  baseRev: number;
  createdAt: Date;
  updatedAt: Date;
  updatedBy: string | null;
}

/**
 * What came of a save.
 *
 * 'saved' is the ordinary answer. 'conflict' means somebody else got there
 * first and nothing was written — the caller still holds the text, and phase 8
 * is where it becomes a copy. 'deleted' means the page was taken out of the
 * notebook while it was open. None of the three is an error, which is why this
 * is a returned value rather than an exception; a refusal — a reader trying to
 * write, or a closed page — is a different thing and does throw.
 */
export interface SharedPageSaveResult {
  status: 'saved' | 'conflict' | 'deleted';
  page: SharedNotebookPage | null;
}

/**
 * What a signed-out reader gets back: the notebook, who is in it, and the
 * pages — and nothing that could be written to.
 *
 * Kept apart from the types above because it never reaches IndexedDB. There is
 * no account here to scope a pull to, nothing to reconcile it against, and
 * nothing to sync; it is read once from one function call and held in memory
 * for as long as the reader has it open.
 */
export interface PublicSharedNotebook {
  notebook: SharedNotebook;
  members: SharedNotebookMember[];
  pages: SharedNotebookPage[];
}

// ─── Row mapping ─────────────────────────────────────────────────────────────

function toNotebook(row: DBSharedNotebook): SharedNotebook {
  return {
    id: row.id,
    ownerId: row.ownerId,
    name: row.name,
    kind: row.kind,
    visibility: row.visibility,
    joinCode: row.joinCode,
    joinOpen: row.joinOpen,
    rev: row.rev,
    createdAt: new Date(row.createdAt),
    updatedAt: new Date(row.updatedAt),
  };
}

function toMember(row: DBSharedNotebookMember): SharedNotebookMember {
  return {
    id: row.id,
    notebookId: row.notebookId,
    userId: row.userId,
    role: row.role,
    displayName: row.displayName,
    initials: row.initials,
    color: row.color,
    joinedAt: new Date(row.joinedAt),
    updatedAt: new Date(row.updatedAt),
  };
}

function toPage(row: DBSharedNotebookPage): SharedNotebookPage {
  return {
    id: row.id,
    notebookId: row.notebookId,
    authorId: row.authorId,
    title: row.title,
    text: row.text,
    editMode: row.editMode,
    pinned: row.pinned,
    sortOrder: row.sortOrder ?? 0,
    rev: row.rev ?? 1,
    baseRev: row.baseRev ?? row.rev ?? 1,
    createdAt: new Date(row.createdAt),
    updatedAt: new Date(row.updatedAt),
    updatedBy: row.updatedBy,
  };
}

/** Epoch milliseconds from a Postgres timestamp, or now if it is missing. */
function ms(value: string | null | undefined, fallback = Date.now()): number {
  if (!value) return fallback;
  const t = new Date(value).getTime();
  return Number.isFinite(t) ? t : fallback;
}

function rowToDBNotebook(row: any): DBSharedNotebook {
  return {
    id: row.id,
    ownerId: row.owner_id,
    name: row.name ?? '',
    kind: row.kind === 'broadcast' ? 'broadcast' : 'group',
    visibility: row.visibility === 'public' ? 'public' : 'private',
    joinCode: row.join_code ?? '',
    joinOpen: row.join_open !== false,
    rev: Number(row.rev ?? 1),
    createdAt: ms(row.created_at),
    updatedAt: ms(row.updated_at),
  };
}

function rowToDBMember(row: any): DBSharedNotebookMember {
  const role = row.role === 'admin' || row.role === 'reader' ? row.role : 'writer';
  return {
    id: row.id,
    notebookId: row.notebook_id,
    userId: row.user_id,
    role,
    displayName: row.display_name ?? '',
    initials: row.initials ?? '',
    color: row.color ?? '#888888',
    joinedAt: ms(row.joined_at),
    updatedAt: ms(row.updated_at),
  };
}

function rowToDBPage(row: any): DBSharedNotebookPage {
  const rev = Number(row.rev ?? 1);
  return {
    id: row.id,
    notebookId: row.notebook_id,
    authorId: row.author_id,
    title: row.title ?? undefined,
    // Sanitised here, at the door, so nothing downstream ever holds a page of
    // somebody else's markup in its raw form — not the list preview, not the
    // reader, not a copy saved back into a personal notebook.
    text: sanitizeNoteHtml(row.text),
    editMode: row.edit_mode === 'anyone' ? 'anyone' : 'author',
    pinned: row.pinned === true,
    sortOrder: Number(row.sort_order ?? 0),
    rev,
    // What the server says right now is, by definition, what this device last
    // saw. An edit made later uploads with this attached.
    baseRev: rev,
    deletedAt: row.deleted_at ? ms(row.deleted_at) : null,
    createdAt: ms(row.created_at),
    updatedAt: ms(row.updated_at),
    updatedBy: row.updated_by ?? null,
  };
}

// ─── Change notifications ────────────────────────────────────────────────────

const changeListeners = new Set<() => void>();

/** Fires whenever a pull changes anything. Components redraw from this. */
export function subscribeToSharedNotebookChanges(fn: () => void): () => void {
  changeListeners.add(fn);
  return () => changeListeners.delete(fn);
}

function announce(): void {
  changeListeners.forEach((fn) => {
    try {
      fn();
    } catch (err) {
      console.error('[SharedNotebooks] listener error:', err);
    }
  });
}

// ─── Local reads ─────────────────────────────────────────────────────────────

function getAll<T>(storeName: string): Promise<T[]> {
  return openDB().then(
    (db) =>
      new Promise<T[]>((resolve) => {
        const tx = db.transaction(storeName, 'readonly');
        const req = tx.objectStore(storeName).getAll();
        req.onsuccess = () => resolve((req.result ?? []) as T[]);
        req.onerror = () => resolve([]);
      }),
  );
}

function getByIndex<T>(storeName: string, index: string, value: any): Promise<T[]> {
  return openDB().then(
    (db) =>
      new Promise<T[]>((resolve) => {
        const tx = db.transaction(storeName, 'readonly');
        const req = tx.objectStore(storeName).index(index).getAll(IDBKeyRange.only(value));
        req.onsuccess = () => resolve((req.result ?? []) as T[]);
        req.onerror = () => resolve([]);
      }),
  );
}

function getOne<T>(storeName: string, id: string): Promise<T | null> {
  return openDB().then(
    (db) =>
      new Promise<T | null>((resolve) => {
        const tx = db.transaction(storeName, 'readonly');
        const req = tx.objectStore(storeName).get(id);
        req.onsuccess = () => resolve((req.result as T) ?? null);
        req.onerror = () => resolve(null);
      }),
  );
}

/**
 * Replace a whole store's contents for the rows the pull covers.
 *
 * `keep` is the set of ids the server returned. Anything else in the store is
 * a row this account can no longer see, so it goes. See the note at the top of
 * this file for why that is safe here and would not be on the single-user
 * tables.
 */
async function replaceAll(
  storeName: string,
  rows: { id: string }[],
  shouldDrop: (existing: any) => boolean,
): Promise<boolean> {
  const keep = new Set(rows.map((r) => r.id));
  let changed = false;

  const existing = await getAll<{ id: string }>(storeName);
  for (const row of existing) {
    if (!keep.has(row.id) && shouldDrop(row)) {
      await writeTransaction(storeName, (store) => store.delete(row.id));
      changed = true;
    }
  }

  for (const row of rows) {
    await writeTransaction(storeName, (store) => store.put(row));
    changed = true;
  }

  return changed;
}

export class SharedNotebookStoreImpl {
  private pulling = false;
  private lastPullAt = 0;

  // ── Reads ────────────────────────────────────────────────────────────────

  /** Every shared notebook this account is in, oldest first. */
  async getNotebooks(): Promise<SharedNotebook[]> {
    const rows = await getAll<DBSharedNotebook>('shared_notebooks');
    return rows.map(toNotebook).sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  }

  async getNotebook(id: string): Promise<SharedNotebook | null> {
    const row = await getOne<DBSharedNotebook>('shared_notebooks', id);
    return row ? toNotebook(row) : null;
  }

  /** The roster, in the order people joined — the owner first, by definition. */
  async getMembers(notebookId: string): Promise<SharedNotebookMember[]> {
    const rows = await getByIndex<DBSharedNotebookMember>(
      'shared_notebook_members',
      'notebookId',
      notebookId,
    );
    return rows.map(toMember).sort((a, b) => a.joinedAt.getTime() - b.joinedAt.getTime());
  }

  /** Every member row this device holds, for looking up a pill by author id. */
  async getAllMembers(): Promise<SharedNotebookMember[]> {
    const rows = await getAll<DBSharedNotebookMember>('shared_notebook_members');
    return rows.map(toMember);
  }

  /**
   * This account's own place in a notebook. Null means not a member, which is
   * what every "may I?" question in the pane resolves to.
   */
  async getMyMembership(notebookId: string, userId: string): Promise<SharedNotebookMember | null> {
    const members = await this.getMembers(notebookId);
    return members.find((m) => m.userId === userId) ?? null;
  }

  /** Pages in one notebook: pinned first, then most recently written. */
  async getPages(notebookId: string): Promise<SharedNotebookPage[]> {
    const rows = await getByIndex<DBSharedNotebookPage>(
      'shared_notebook_pages',
      'notebookId',
      notebookId,
    );
    return rows
      .filter((row) => !row.deletedAt)
      .map(toPage)
      .sort((a, b) => {
        if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
        return b.updatedAt.getTime() - a.updatedAt.getTime();
      });
  }

  /** Every page across every shared notebook — used to count without N queries. */
  async getAllPages(): Promise<SharedNotebookPage[]> {
    const rows = await getAll<DBSharedNotebookPage>('shared_notebook_pages');
    return rows.filter((row) => !row.deletedAt).map(toPage);
  }

  async getPage(id: string): Promise<SharedNotebookPage | null> {
    const row = await getOne<DBSharedNotebookPage>('shared_notebook_pages', id);
    if (!row || row.deletedAt) return null;
    return toPage(row);
  }

  // ── Pull ─────────────────────────────────────────────────────────────────

  /**
   * Fetch everything this account can see and reconcile it into IndexedDB.
   *
   * No `.eq('user_id', …)` anywhere: the policies in migration 012 decide what
   * comes back, which is the whole point — a plain select returns exactly the
   * notebooks this account is a member of, and nothing else exists as far as
   * the server is concerned.
   *
   * Returns false when there was nothing to do (signed out, offline, or called
   * again within the throttle window).
   */
  async pull(opts: { force?: boolean } = {}): Promise<boolean> {
    if (this.pulling) return false;
    if (typeof navigator !== 'undefined' && !navigator.onLine) return false;
    // Opening and closing the Shared tab should not mean a round trip each time.
    if (!opts.force && Date.now() - this.lastPullAt < 10_000) return false;

    this.pulling = true;
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return false;

      const [notebooksRes, membersRes, pagesRes] = await Promise.all([
        supabase.from('shared_notebooks').select('*'),
        supabase.from('shared_notebook_members').select('*'),
        supabase.from('shared_notebook_pages').select('*').is('deleted_at', null),
      ]);

      // One table failing is not a reason to reconcile against a half-answer:
      // a members list that didn't arrive would look like a notebook full of
      // strangers, and an empty pages result would look like every page gone.
      const failure = notebooksRes.error ?? membersRes.error ?? pagesRes.error;
      if (failure) {
        console.error('[SharedNotebooks] pull failed:', failure.message);
        return false;
      }

      const notebooks = (notebooksRes.data ?? []).map(rowToDBNotebook);
      const members = (membersRes.data ?? []).map(rowToDBMember);
      const pages = (pagesRes.data ?? []).map(rowToDBPage);

      let changed = await replaceAll('shared_notebooks', notebooks, () => true);
      changed = (await replaceAll('shared_notebook_members', members, () => true)) || changed;
      changed = (await replaceAll('shared_notebook_pages', pages, () => true)) || changed;

      this.lastPullAt = Date.now();
      if (changed) announce();
      return true;
    } catch (err) {
      console.error('[SharedNotebooks] pull threw:', err);
      return false;
    } finally {
      this.pulling = false;
    }
  }

  // ── Making one, and joining one ──────────────────────────────────────────

  /**
   * The signed-in account, from the session this device already holds.
   *
   * Deliberately getSession() rather than getUser(): this is only ever used to
   * write a pill onto a paragraph, and the server decides author_id and
   * updated_by for itself whatever this says. Paying a round trip on every
   * autosave to re-validate a token, so a badge can be drawn, would be the
   * wrong trade — and an answer of null simply means the paragraph goes
   * unstamped rather than anything breaking.
   */
  private async saverId(): Promise<string> {
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      return session?.user?.id ?? '';
    } catch {
      return '';
    }
  }

  /**
   * The name and badge to put on a new member row.
   *
   * Taken from the account rather than asked for, because a join should be one
   * tap. What it produces is a default — phase 4's picker is where anyone who
   * wants different letters or a different colour changes them.
   */
  private async identity(): Promise<{
    userId: string;
    displayName: string;
    initials: string;
    color: string;
  }> {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) throw new Error('You have to be signed in for that');

    // The name people chose, or the part of their address before the @ — which
    // is at least theirs, and is better than a notebook full of "Someone".
    const named = (user.user_metadata?.name ?? '').toString().trim();
    const fromEmail = (user.email ?? '').split('@')[0] ?? '';
    return { userId: user.id, ...defaultMemberIdentity(named || fromEmail, user.id) };
  }

  /**
   * Make a shared notebook. You become its owner and its first member.
   *
   * Both rows are made by the same SECURITY DEFINER function, in one
   * transaction, because they have to be: there is no INSERT policy on either
   * table, and an owner without a member row could not read back the notebook
   * they had just made.
   *
   * The ids are made here rather than by the database so that this device
   * knows them without a round trip, and they are UUIDs — see ids.ts for why a
   * timestamp is not good enough once two accounts write to one table.
   */
  async createNotebook(opts: {
    name: string;
    kind: 'group' | 'broadcast';
    visibility: 'private' | 'public';
  }): Promise<SharedNotebook> {
    const me = await this.identity();

    const { data, error } = await supabase.rpc('create_shared_notebook', {
      p_id: sharedId(),
      p_member_id: sharedId(),
      p_name: opts.name.trim(),
      p_kind: opts.kind,
      p_visibility: opts.visibility,
      p_display_name: me.displayName,
      p_initials: me.initials,
      p_color: me.color,
    });
    if (error) throw new Error(error.message);
    if (!data) throw new Error('The notebook was not created');

    // Force past the throttle: the whole point of the next screen is that the
    // notebook is on it.
    await this.pull({ force: true });
    return toNotebook(rowToDBNotebook(data));
  }

  /**
   * Join by code.
   *
   * Joining one you are already in is not an error — it hands back the same
   * notebook — so a re-tapped link, a second scan, or a code typed twice all
   * do the right thing rather than complaining.
   *
   * The code is never looked up from here. There is no read access that would
   * let it be: this is a function call that either adds you or refuses, and a
   * stranger guessing codes learns nothing from the difference.
   */
  async joinByCode(code: string): Promise<SharedNotebook> {
    const clean = normalizeJoinCode(code);
    if (!clean) throw new Error('Enter the code you were given');

    const me = await this.identity();

    const { data, error } = await supabase.rpc('join_shared_notebook', {
      p_code: clean,
      p_member_id: sharedId(),
      p_display_name: me.displayName,
      p_initials: me.initials,
      p_color: me.color,
    });
    if (error) throw new Error(error.message);
    if (!data) throw new Error('No shared notebook has that code');

    await this.pull({ force: true });
    return toNotebook(rowToDBNotebook(data));
  }

  /**
   * Read a public notebook with no account at all.
   *
   * The one way in for a signed-out reader, and deliberately a dead end: the
   * function returns a notebook and its pages and accepts nothing back, it
   * only answers for a notebook whose owner marked it public, and it cannot be
   * used to list anything — you have to already hold the code.
   *
   * Nothing here is written to IndexedDB. There is no account to scope it to
   * and no sync to feed, so it is held in memory by whoever asked for it and
   * forgotten when they close it.
   */
  async readPublic(code: string): Promise<PublicSharedNotebook> {
    const clean = normalizeJoinCode(code);
    if (!clean) throw new Error('Enter the code you were given');

    const { data, error } = await supabase.rpc('read_public_shared_notebook', {
      p_code: clean,
    });
    if (error) throw new Error(error.message);
    if (!data) throw new Error('No notebook is being shared with that code');

    const payload = data as {
      notebook: any;
      members: any[];
      pages: any[];
    };

    const row = payload.notebook ?? {};
    const notebook: SharedNotebook = {
      id: row.id,
      // The function returns neither of these, on purpose. A reader with no
      // account has no business knowing who owns a notebook, and the code they
      // already hold is the only code there is to show them.
      ownerId: '',
      name: row.name ?? '',
      kind: row.kind === 'broadcast' ? 'broadcast' : 'group',
      visibility: 'public',
      joinCode: clean,
      joinOpen: false,
      rev: Number(row.rev ?? 1),
      createdAt: new Date(ms(row.created_at)),
      updatedAt: new Date(ms(row.updated_at)),
    };

    return {
      notebook,
      members: (payload.members ?? []).map((m) =>
        toMember(rowToDBMember({ ...m, notebook_id: notebook.id })),
      ),
      // Sanitised on arrival like every other page — this is the one path where
      // the markup has not been near the allowlist before, so it matters most.
      pages: (payload.pages ?? []).map((pg) => toPage(rowToDBPage(pg))),
    };
  }

  /**
   * Has anything changed in a public notebook?
   *
   * A signed-out reader is not a member and holds no realtime connection, so
   * this single number is how they find out — a few hundred bytes, and the
   * pages are only fetched again when it has moved.
   */
  async publicRev(code: string): Promise<number | null> {
    const { data, error } = await supabase.rpc('public_shared_notebook_rev', {
      p_code: normalizeJoinCode(code),
    });
    if (error) {
      console.error('[SharedNotebooks] rev check failed:', error.message);
      return null;
    }
    return data == null ? null : Number(data);
  }

  // ── Writing ──────────────────────────────────────────────────────────────

  /**
   * Put one row the server just handed back into IndexedDB.
   *
   * Every write below ends here rather than calling pull(): the row that comes
   * back from save_shared_page is the authoritative one, complete with the
   * revision the trigger gave it, so a round trip to fetch what we are already
   * holding would only add a wait. The pull still runs on its own schedule and
   * will agree with this.
   */
  private async storePage(row: any): Promise<SharedNotebookPage> {
    const dbRow = rowToDBPage(row);
    await writeTransaction('shared_notebook_pages', (store) => store.put(dbRow));
    announce();
    return toPage(dbRow);
  }

  /**
   * Turn a database refusal into something worth reading.
   *
   * The functions in migration 012 raise plain sentences and those are passed
   * through untouched. What needs translating is the one refusal Postgres
   * words itself: a policy turning down an INSERT, which is what a reader
   * adding a page hits, and which otherwise reaches the screen as "new row
   * violates row-level security policy for table …".
   */
  private plainError(message: string): Error {
    if (/row-level security/i.test(message)) {
      return new Error('You do not have permission to write in this notebook');
    }
    return new Error(message);
  }

  /**
   * Save a page, without writing over anybody else's work.
   *
   * `baseRev` is the revision this device started from. The server compares it
   * with the row's current one and, if somebody has saved in between, changes
   * nothing and says so — which is why this returns a status rather than
   * throwing. Phase 8 turns a conflict into a copy of your version; until then
   * the caller's job is simply to say so rather than lose either side.
   *
   * 'deleted' is the third answer: the page was taken out of the notebook
   * while it was open. Also not an error, and also not something to retry.
   */
  private async save(args: {
    id: string;
    notebookId: string;
    title: string;
    text: string;
    /** The stored version, which carries the paragraph ids. '' for a new page. */
    previousText: string;
    baseRev: number | null;
    editMode?: 'anyone' | 'author';
    pinned?: boolean;
    createdAt?: Date;
  }): Promise<SharedPageSaveResult> {
    // Sanitised before it leaves this device as well as when it arrives. The
    // page is about to be somebody else's to read, and nothing the editor can
    // legitimately produce is lost by passing it through the allowlist twice.
    const clean = sanitizeNoteHtml(args.text);

    // Then stamped, so each paragraph carries its id and the people who have
    // written in it. After the allowlist rather than before, because the
    // stamping reads the stored version's ids and writes the new version's,
    // and it should be looking at the same markup everybody else will see.
    // The attributes it adds are two the allowlist already permits, so the
    // sanitiser at the other end leaves them alone.
    const text = stampParagraphs(args.previousText, clean, await this.saverId());
    if (text.length > MAX_PAGE_CHARS) {
      throw new Error('That page is too long to save');
    }

    const { data, error } = await supabase.rpc('save_shared_page', {
      p_id: args.id,
      p_notebook_id: args.notebookId,
      p_title: args.title.trim() || null,
      p_text: text,
      p_base_rev: args.baseRev,
      p_edit_mode: args.editMode ?? null,
      p_pinned: args.pinned ?? null,
      p_created_at: args.createdAt ? args.createdAt.toISOString() : null,
    });
    if (error) throw this.plainError(error.message);

    const payload = (data ?? {}) as { status?: string; page?: any };
    const status = payload.status === 'conflict' || payload.status === 'deleted'
      ? payload.status
      : 'saved';

    if (status === 'deleted') {
      // Keep the local copy in step with the removal rather than leaving a row
      // the list would go on offering.
      await this.markRemoved(args.id);
      return { status, page: null };
    }

    if (!payload.page) throw new Error('The page was not saved');
    return { status, page: await this.storePage(payload.page) };
  }

  /**
   * Add a page to a shared notebook.
   *
   * There is no separate insert: save_shared_page creates a page it has not
   * seen before, so a new page and the hundredth edit of an old one take the
   * same path and cannot drift apart. The id is a UUID made here — see ids.ts
   * for why a timestamp is not enough once two accounts write to one table.
   */
  async createPage(opts: {
    notebookId: string;
    title?: string;
    text?: string;
    /** Closed by default: a new page belongs to whoever started it. */
    editMode?: 'anyone' | 'author';
  }): Promise<SharedNotebookPage> {
    const result = await this.save({
      id: sharedId(),
      notebookId: opts.notebookId,
      title: opts.title ?? '',
      text: opts.text ?? '',
      // Nothing came before it, so every paragraph in it is this person's.
      previousText: '',
      baseRev: null,
      editMode: opts.editMode ?? 'author',
      createdAt: new Date(),
    });
    if (!result.page) throw new Error('The page was not created');
    return result.page;
  }

  /**
   * Rewrite a page that is already there.
   *
   * Everything not named is left as it is — the function coalesces each of
   * edit_mode and pinned against the stored value — so saving prose cannot
   * quietly reopen a page its author closed, and closing a page cannot revert
   * the paragraph somebody was midway through.
   */
  async savePage(
    page: SharedNotebookPage,
    changes: {
      title?: string;
      text?: string;
      editMode?: 'anyone' | 'author';
      pinned?: boolean;
    },
  ): Promise<SharedPageSaveResult> {
    return this.save({
      id: page.id,
      notebookId: page.notebookId,
      title: changes.title ?? page.title ?? '',
      text: changes.text ?? page.text,
      // The copy this edit was measured against, which is where the paragraph
      // ids come from. Saving a flag without touching the prose passes the
      // same text on both sides, so every paragraph anchors and nobody is
      // credited with an edit they did not make.
      previousText: page.text,
      baseRev: page.baseRev,
      editMode: changes.editMode,
      pinned: changes.pinned,
    });
  }

  /**
   * Take a page out of the notebook.
   *
   * A soft delete on the server, so a device that was offline when it happened
   * finds out on its next pull instead of quietly uploading the page again.
   * Locally the row goes altogether: every read here already skips a row with
   * deletedAt set, and the next pull — which asks only for undeleted rows —
   * would drop it anyway.
   */
  async removePage(id: string): Promise<void> {
    const { error } = await supabase.rpc('remove_shared_page', { p_id: id });
    if (error) throw this.plainError(error.message);
    await this.markRemoved(id);
  }

  private async markRemoved(id: string): Promise<void> {
    await writeTransaction('shared_notebook_pages', (store) => store.delete(id));
    announce();
  }

  // ── Your badge ───────────────────────────────────────────────────────────

  /**
   * Change the two letters and the colour you are known by in one notebook.
   *
   * A plain UPDATE rather than another function: the policy on the members
   * table already says a member may change their own row and nobody else's,
   * so there is nothing here a SECURITY DEFINER would add except a place for
   * the rule to be written down twice and drift.
   *
   * Per notebook on purpose. The colour is meant to tell people apart inside
   * one group, so it has to be able to move when the group you are in already
   * has somebody wearing it — one badge across every notebook would make that
   * impossible to resolve.
   */
  async updateMyBadge(
    notebookId: string,
    changes: { displayName?: string; initials?: string; color?: string },
  ): Promise<SharedNotebookMember> {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) throw new Error('You have to be signed in for that');

    const patch: Record<string, string> = { updated_at: new Date().toISOString() };
    if (changes.displayName !== undefined) patch.display_name = changes.displayName.trim();
    // Two characters, because the badge is 20px wide and a third would not fit
    // inside it — it would sit over the edge of the disc.
    if (changes.initials !== undefined) patch.initials = changes.initials.trim().slice(0, 2);
    if (changes.color !== undefined) patch.color = changes.color;

    const { data, error } = await supabase
      .from('shared_notebook_members')
      .update(patch)
      .eq('notebook_id', notebookId)
      .eq('user_id', user.id)
      .select()
      .single();
    if (error) throw this.plainError(error.message);
    if (!data) throw new Error('You are not in that notebook');

    const row = rowToDBMember(data);
    await writeTransaction('shared_notebook_members', (store) => store.put(row));
    announce();
    return toMember(row);
  }

  /** Throw away every shared row. Called on sign-out — none of it is ours. */
  async clear(): Promise<void> {
    for (const storeName of [
      'shared_notebooks',
      'shared_notebook_members',
      'shared_notebook_pages',
    ]) {
      await writeTransaction(storeName, (store) => store.clear());
    }
    this.lastPullAt = 0;
    announce();
  }
}

/** Singleton — import this rather than constructing the class. */
export const sharedNotebookStore = new SharedNotebookStoreImpl();
