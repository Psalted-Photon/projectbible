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
 * With one exception, added in phase 7: a whole notebook that stops coming
 * back is kept and marked `removedAt` instead of being deleted, along with its
 * members and its pages. Being removed from a study group should not make the
 * evening you spent writing in it vanish off your phone without a word. The
 * copy left behind is inert — every permission answers no for it — and its
 * owner can throw it away whenever they like.
 *
 * Phase 1 reads. Phase 2 makes one and joins one. Phase 3 writes in one.
 * Phase 4 stamps each save with who wrote which paragraph, and lets a member
 * change the badge they are known by. Phase 7 runs one: the roster, roles,
 * removing somebody, the code, and switching what kind of notebook it is.
 * Phase 8 lets you write in one with no signal: the words go into the local
 * copy and into sharedOutbox, the pull sends them before it fetches anything,
 * and a page somebody else has moved on in the meantime is forked rather than
 * either version being chosen over the other.
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
import {
  clearOutbox,
  dropNotebookWrites,
  dropWrite,
  isOffline,
  markAttempt,
  pendingFor,
  pendingPageIds,
  pendingWrites,
  queueWrite,
  subscribeToOutboxChanges,
} from '../lib/shared/sharedOutbox';
import type { DBSharedOutboxItem } from '../lib/shared/sharedOutbox';
import { showNotice } from '../stores/noticeStore';

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
  /**
   * Set once this account is no longer in the notebook — removed, or the
   * notebook deleted. Null for every notebook you are actually in. A notebook
   * carrying a date here is a read-only keepsake: see sharedPermissions, where
   * it is the first thing every rule asks about.
   */
  removedAt: Date | null;
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
 * first and nothing was written — the caller still holds the text, and the bar
 * in NotesPane is where it becomes a copy. 'deleted' means the page was taken
 * out of the notebook while it was open. 'queued' means there was no signal:
 * the words are in the local copy and in the outbox, and they will go up on
 * their own — the page that comes back with it is the local one, so the reader
 * draws what was just written rather than what the server last had.
 *
 * None of the four is an error, which is why this is a returned value rather
 * than an exception; a refusal — a reader trying to write, or a closed page —
 * is a different thing and does throw.
 */
export interface SharedPageSaveResult {
  status: 'saved' | 'conflict' | 'deleted' | 'queued';
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
    removedAt: row.removedAt ? new Date(row.removedAt) : null,
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

// Something queued, sent or given up on is a change to what the list should be
// drawing — the mark on a row saying it has not gone up yet appears and
// disappears with it. Bridged here so a component only has to subscribe once.
subscribeToOutboxChanges(announce);

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
  private flushing = false;
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

    // Up before down. A pull that ran first would replace the page somebody
    // wrote on a train with the older one the server still has, and the words
    // would be gone before the outbox got its turn.
    await this.flushOutbox();

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

      // A notebook that has stopped coming back is one this account is no
      // longer in. Its rows stay — see the note at the top of this file — and
      // the rows underneath it stay with it, because a notebook kept as
      // something to read needs its pages and the badges that go on them.
      const stillIn = new Set(notebooks.map((n) => n.id));
      const gone = await this.markMissingNotebooksRemoved(stillIn);

      // A page with writing still waiting to go up is left exactly as it is,
      // both ways round: the server's older copy does not replace it, and a
      // page started offline — which the server has never heard of, so it is
      // missing from the pull by definition — is not taken for one that has
      // been removed. Anything still here after the flush is here because the
      // flush could not reach the server, and the words on screen are the
      // newest version of it that exists anywhere.
      const waiting = await pendingPageIds();
      const fresh = waiting.size ? pages.filter((row) => !waiting.has(row.id)) : pages;

      let changed = gone.size > 0;
      changed = (await replaceAll('shared_notebooks', notebooks, () => false)) || changed;
      changed =
        (await replaceAll('shared_notebook_members', members, (row) => !gone.has(row.notebookId))) ||
        changed;
      changed =
        (await replaceAll(
          'shared_notebook_pages',
          fresh,
          (row) => !gone.has(row.notebookId) && !waiting.has(row.id),
        )) || changed;

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

  /**
   * Mark every local notebook the pull did not return, and say which they are.
   *
   * Called with the ids that did come back, so it answers both questions at
   * once: which notebooks have gone, and — through the returned set — which
   * members and pages must be spared by the reconciliation that follows.
   *
   * Stamped once. A notebook already carrying a date keeps the one it has, so
   * the line the person reads goes on saying when it happened rather than
   * quietly becoming "just now" on every pull.
   */
  private async markMissingNotebooksRemoved(stillIn: Set<string>): Promise<Set<string>> {
    const gone = new Set<string>();
    const local = await getAll<DBSharedNotebook>('shared_notebooks');
    for (const row of local) {
      if (stillIn.has(row.id)) continue;
      gone.add(row.id);
      if (row.removedAt) continue;
      await writeTransaction('shared_notebooks', (store) =>
        store.put({ ...row, removedAt: Date.now() }),
      );
    }
    return gone;
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
    this.requireOnline();
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
    this.requireOnline();
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
      // Nothing to be removed from: a signed-out reader was never a member,
      // and this copy is held in memory for as long as they have it open.
      removedAt: null,
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
    // What PostgREST says when an update matched no row. Every update here
    // asks for the row back, so a policy that refuses one reads as "nothing
    // came back" rather than as a refusal — the same sentence either way, and
    // not one to show anybody.
    if (/multiple \(or no\) rows returned/i.test(message)) {
      return new Error('You do not have permission to change that');
    }
    return new Error(message);
  }

  /**
   * The same sentence for every action that simply cannot be done with no
   * signal — joining, changing the code, moving somebody's role.
   *
   * Writing in a page is the exception rather than the rule here: it is the
   * only thing anybody does at length, so it is the only thing worth keeping
   * in an outbox. The rest are single taps that are no trouble to repeat once
   * there is a connection, and each of them needs an answer from the server —
   * a join has nothing to show until the notebook comes back — so pretending
   * they had worked would be a lie with nothing behind it.
   */
  private requireOnline(): void {
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      throw new Error('You are offline — try that again when you have a signal');
    }
  }

  /**
   * Save a page, without writing over anybody else's work.
   *
   * `baseRev` is the revision this device started from. The server compares it
   * with the row's current one and, if somebody has saved in between, changes
   * nothing and says so — which is why this returns a status rather than
   * throwing. The bar in NotesPane then offers to keep your version as a page
   * of its own beside theirs, rather than either being chosen over the other.
   *
   * 'deleted' is the third answer: the page was taken out of the notebook
   * while it was open. Also not an error, and also not something to retry.
   *
   * 'queued' is the fourth, and the whole of phase 8: there was no signal, so
   * the words went into the local copy and into the outbox. The same four
   * answers come back later when the outbox is flushed, and a conflict there
   * forks exactly as one here does — the only difference being that nobody is
   * looking, so the fork is made for them and they are told.
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

    // No signal: into the local copy and into the outbox, before a round trip
    // is even attempted. Checked here rather than left to the fetch failing
    // because a save on a dead connection can hang for half a minute, and the
    // writer would spend it watching a page that had already been dealt with.
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      return { status: 'queued', page: await this.queueSave(args, text) };
    }

    try {
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
        // Keep the local copy in step with the removal rather than leaving a
        // row the list would go on offering.
        await this.markRemoved(args.id);
        return { status, page: null };
      }

      if (!payload.page) throw new Error('The page was not saved');
      return { status, page: await this.storePage(payload.page) };
    } catch (err) {
      // A connection that dropped part way through, or a browser still
      // claiming to be online in a lift. The same answer as having known it
      // beforehand: queue it. Anything the server actually said no to is a
      // refusal and is passed on.
      if (isOffline(err)) {
        return { status: 'queued', page: await this.queueSave(args, text) };
      }
      throw err;
    }
  }

  /**
   * Write an edit into the local copy and leave a note of it for later.
   *
   * The local row is what the reader and the list draw, so it has to carry the
   * new words immediately — an offline save that left the old text on screen
   * would look exactly like one that had failed. Its `rev` is deliberately not
   * moved: the revision belongs to the server, and inventing one here would
   * make the flush measure the edit against a version that never existed.
   */
  private async queueSave(
    args: {
      id: string;
      notebookId: string;
      title: string;
      baseRev: number | null;
      editMode?: 'anyone' | 'author';
      pinned?: boolean;
      createdAt?: Date;
    },
    text: string,
  ): Promise<SharedNotebookPage> {
    const existing = await getOne<DBSharedNotebookPage>('shared_notebook_pages', args.id);
    const now = Date.now();
    const me = await this.saverId();
    const title = args.title.trim() || undefined;

    const row: DBSharedNotebookPage = existing
      ? {
          ...existing,
          title,
          text,
          editMode: args.editMode ?? existing.editMode,
          pinned: args.pinned ?? existing.pinned,
          updatedAt: now,
          updatedBy: me || existing.updatedBy,
        }
      : {
          id: args.id,
          notebookId: args.notebookId,
          authorId: me,
          title,
          text,
          editMode: args.editMode ?? 'author',
          pinned: args.pinned ?? false,
          sortOrder: 0,
          // Nothing the server has ever seen, so there is no revision yet.
          rev: 0,
          baseRev: 0,
          deletedAt: null,
          createdAt: args.createdAt ? args.createdAt.getTime() : now,
          updatedAt: now,
          updatedBy: me,
        };

    await writeTransaction('shared_notebook_pages', (store) => store.put(row));
    await queueWrite({
      pageId: args.id,
      notebookId: args.notebookId,
      kind: 'save',
      title: args.title,
      text,
      baseRev: args.baseRev,
      editMode: args.editMode ?? null,
      pinned: args.pinned ?? null,
      // Only a page the server has never seen needs its creation date sent;
      // queueWrite carries it forward through every later edit of that page.
      createdAt: existing ? null : row.createdAt,
    });
    announce();
    return toPage(row);
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
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      await this.queueRemove(id);
      return;
    }
    try {
      const { error } = await supabase.rpc('remove_shared_page', { p_id: id });
      if (error) throw this.plainError(error.message);
    } catch (err) {
      if (!isOffline(err)) throw err;
      await this.queueRemove(id);
      return;
    }
    await dropWrite(id);
    await this.markRemoved(id);
  }

  /**
   * Take a page out with no signal.
   *
   * A page that was also started with no signal is the easy case: the server
   * has never heard of it, so there is nothing to tell it. The queued write is
   * dropped and that is the end of the page — otherwise the flush would create
   * it a moment before removing it again.
   */
  private async queueRemove(id: string): Promise<void> {
    const page = await getOne<DBSharedNotebookPage>('shared_notebook_pages', id);
    const waiting = await pendingFor(id);

    if (waiting?.kind === 'save' && waiting.createdAt !== null) {
      await dropWrite(id);
      await this.markRemoved(id);
      return;
    }

    await queueWrite({
      pageId: id,
      notebookId: page?.notebookId ?? waiting?.notebookId ?? '',
      kind: 'remove',
      title: '',
      text: '',
      baseRev: null,
      editMode: null,
      pinned: null,
      createdAt: null,
    });
    await this.markRemoved(id);
  }

  private async markRemoved(id: string): Promise<void> {
    await writeTransaction('shared_notebook_pages', (store) => store.delete(id));
    announce();
  }

  // ── The outbox ───────────────────────────────────────────────────────────

  /**
   * Send everything that was written with no signal.
   *
   * Run at the top of every pull, so uploading always comes before
   * downloading — the alternative is a pull that overwrites the local copy
   * with the older server one and then sends it straight back up. Also run on
   * the browser's 'online' event, which is what makes coming out of aeroplane
   * mode enough on its own.
   *
   * The drain stops at the first item that could not be delivered rather than
   * working through the rest: if one write cannot reach the server the next
   * one will not either, and nothing here is so urgent that it is worth a
   * dozen timeouts to find that out again.
   */
  async flushOutbox(): Promise<number> {
    if (this.flushing) return 0;
    if (typeof navigator !== 'undefined' && !navigator.onLine) return 0;

    const items = await pendingWrites();
    if (items.length === 0) return 0;

    this.flushing = true;
    let sent = 0;
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      // Signed out with writing still waiting: leave it where it is. Signing
      // back in on the same device should still send it.
      if (!user) return 0;

      for (const item of items) {
        const outcome = await this.flushOne(item);
        if (outcome === 'offline') break;
        if (outcome === 'sent') sent++;
      }
    } catch (err) {
      console.error('[SharedNotebooks] flush threw:', err);
    } finally {
      this.flushing = false;
    }

    if (sent > 0) announce();
    return sent;
  }

  /**
   * One queued write, and what became of it.
   *
   * Three endings, and which one it is decides whether the item is kept:
   * delivered, so it goes; refused by the server, so it also goes — retrying a
   * refusal only produces the same refusal, and the words are still in the
   * local copy for whoever wrote them; or it never arrived, so it stays.
   */
  private async flushOne(item: DBSharedOutboxItem): Promise<'sent' | 'dropped' | 'offline'> {
    try {
      if (item.kind === 'remove') {
        const { error } = await supabase.rpc('remove_shared_page', { p_id: item.pageId });
        if (error) throw this.plainError(error.message);
        await dropWrite(item.pageId);
        return 'sent';
      }

      const { data, error } = await supabase.rpc('save_shared_page', {
        p_id: item.pageId,
        p_notebook_id: item.notebookId,
        p_title: item.title.trim() || null,
        // Sanitised and stamped when it was queued, so it goes as it is. Doing
        // either again would be measuring it against a stored page that has
        // moved on since, which is the one thing that must not happen to it.
        p_text: item.text,
        p_base_rev: item.baseRev,
        p_edit_mode: item.editMode,
        p_pinned: item.pinned,
        p_created_at: item.createdAt ? new Date(item.createdAt).toISOString() : null,
      });
      if (error) throw this.plainError(error.message);

      const payload = (data ?? {}) as { status?: string; page?: any };
      if (payload.status === 'conflict' || payload.status === 'deleted') {
        await this.forkQueued(item, payload.status);
        return 'sent';
      }

      if (payload.page) await this.storePage(payload.page);
      await dropWrite(item.pageId);
      return 'sent';
    } catch (err) {
      if (isOffline(err)) {
        await markAttempt(item);
        return 'offline';
      }
      // The server thought about it and said no — the notebook has been left
      // since, or the page closed, or a role changed. The item goes, and the
      // sentence the database wrote is the one shown, because it is already
      // the reason.
      await dropWrite(item.pageId);
      showNotice(
        `${this.queuedPageLabel(item)} could not be sent: ${
          (err as Error)?.message || 'the notebook would not take it'
        }. Your copy on this device still has it.`,
        'error',
      );
      return 'dropped';
    }
  }

  /**
   * Somebody else wrote in the page first. Keep both.
   *
   * The plain answer to the one problem an outbox creates, and the same one
   * the bar offers when a conflict happens with somebody watching: the version
   * written offline becomes a page of its own in the same notebook, called
   * "… (your version)", and the notebook's own copy is left exactly as the
   * others left it. Nothing is merged, nothing is chosen, nothing is lost.
   *
   * The text goes across already stamped, and is passed as its own previous
   * version so that every paragraph anchors — the fork keeps the record of who
   * wrote which line instead of crediting all of it to whoever was offline.
   */
  private async forkQueued(item: DBSharedOutboxItem, reason: 'conflict' | 'deleted'): Promise<void> {
    const name = this.queuedPageLabel(item);
    await this.save({
      id: sharedId(),
      notebookId: item.notebookId,
      title: `${name} (your version)`,
      text: item.text,
      previousText: item.text,
      baseRev: null,
      // Closed, like any new page: it is one person's account of something,
      // sitting beside the notebook's, and it is theirs to open if they want.
      editMode: 'author',
      createdAt: new Date(),
    });

    await dropWrite(item.pageId);
    // The local copy still holds what was written offline. It is not the
    // notebook's copy any more, and the pull that follows will put the real
    // one back; the words themselves are safe in the page just made.
    showNotice(
      reason === 'conflict'
        ? `Somebody else wrote in “${name}” while you were offline, so what you wrote has been kept beside it as “${name} (your version)”.`
        : `“${name}” was taken out of the notebook while you were offline, so what you wrote has been kept as “${name} (your version)”.`,
    );
  }

  /** What to call a queued page in a message. Its title, or something plain. */
  private queuedPageLabel(item: DBSharedOutboxItem): string {
    const title = item.title.trim();
    if (title) return title;
    const text = item.text.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
    return text ? `${text.slice(0, 40)}${text.length > 40 ? '…' : ''}` : 'A page';
  }

  /** The pages with writing still waiting to go up. Drawn as a mark on the row. */
  async pendingPages(): Promise<Set<string>> {
    return pendingPageIds();
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
    this.requireOnline();
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

  // ── Running one ──────────────────────────────────────────────────────────

  /**
   * Change how the notebook itself works: its name, its kind, who may see it,
   * and whether the code still lets anybody in.
   *
   * A plain UPDATE, because the policy on shared_notebooks already says the
   * owner and only the owner may write to the row. Anything here that matters
   * to somebody else is enforced again where it counts —
   * `can_write_shared_notebook()` reads `kind`, `join_shared_notebook()` reads
   * `join_open`, `read_public_shared_notebook()` reads `visibility` — so this
   * changes one row and the rules follow from it rather than being reapplied
   * in half a dozen places.
   */
  async updateNotebook(
    notebookId: string,
    changes: {
      name?: string;
      kind?: 'group' | 'broadcast';
      visibility?: 'private' | 'public';
      joinOpen?: boolean;
    },
  ): Promise<SharedNotebook> {
    this.requireOnline();
    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (changes.name !== undefined) patch.name = changes.name.trim();
    if (changes.kind !== undefined) patch.kind = changes.kind;
    if (changes.visibility !== undefined) patch.visibility = changes.visibility;
    if (changes.joinOpen !== undefined) patch.join_open = changes.joinOpen;

    const { data, error } = await supabase
      .from('shared_notebooks')
      .update(patch)
      .eq('id', notebookId)
      .select()
      .single();
    if (error) throw this.plainError(error.message);
    if (!data) throw new Error('Only the owner can change this notebook');

    return toNotebook(await this.storeNotebook(data));
  }

  /**
   * Issue a new join code, and throw the old one away.
   *
   * The way out of a link that has gone further than it was meant to: every
   * old link, QR code and written-down code stops working the moment this
   * returns. Nobody already in is affected — they are members, and membership
   * has nothing to do with the code they arrived by.
   */
  async resetJoinCode(notebookId: string): Promise<string> {
    this.requireOnline();
    const { data, error } = await supabase.rpc('reset_shared_notebook_code', {
      p_notebook_id: notebookId,
    });
    if (error) throw this.plainError(error.message);
    const code = (data ?? '').toString();
    if (!code) throw new Error('The code was not changed');

    const row = await getOne<DBSharedNotebook>('shared_notebooks', notebookId);
    if (row) {
      await writeTransaction('shared_notebooks', (store) =>
        store.put({ ...row, joinCode: code, updatedAt: Date.now() }),
      );
      announce();
    }
    return code;
  }

  /**
   * Change what somebody may do here.
   *
   * The owner's to decide — the policy on the members table lets you write
   * your own row and lets the owner write anybody's — and the commonest use is
   * quietening one person rather than removing them: a reader keeps everything
   * they have written and goes on reading, and simply stops being offered a
   * pencil.
   */
  async setMemberRole(
    memberId: string,
    role: 'admin' | 'writer' | 'reader',
  ): Promise<SharedNotebookMember> {
    this.requireOnline();
    const { data, error } = await supabase
      .from('shared_notebook_members')
      .update({ role, updated_at: new Date().toISOString() })
      .eq('id', memberId)
      .select()
      .single();
    if (error) throw this.plainError(error.message);
    if (!data) throw new Error('Only the owner can change what people may do');

    const row = rowToDBMember(data);
    await writeTransaction('shared_notebook_members', (store) => store.put(row));
    announce();
    return toMember(row);
  }

  /**
   * Take somebody out of the notebook, and decide what happens to their pages.
   *
   * The two are asked separately on purpose. Removing a person and deleting
   * what they wrote are different acts — a group usually wants to keep the
   * notes and lose the access — so `alsoRemovePages` is a choice made at the
   * time rather than a consequence of the first one.
   *
   * Their pages go first. The order matters: `remove_shared_page` lets the
   * notebook's owner take out anybody's page, but the roster is what the
   * server reads to know who the owner is, and a page removed after the person
   * has gone would be fine while a member row removed first is not recoverable
   * if the page removal then fails.
   */
  async removeMember(
    member: SharedNotebookMember,
    opts: { alsoRemovePages?: boolean } = {},
  ): Promise<void> {
    this.requireOnline();
    if (opts.alsoRemovePages) {
      const pages = await this.getPages(member.notebookId);
      for (const page of pages) {
        if (page.authorId === member.userId) await this.removePage(page.id);
      }
    }

    const { error } = await supabase
      .from('shared_notebook_members')
      .delete()
      .eq('id', member.id);
    if (error) throw this.plainError(error.message);

    await writeTransaction('shared_notebook_members', (store) => store.delete(member.id));
    announce();
  }

  /**
   * Leave a notebook somebody else runs.
   *
   * The same DELETE the owner uses, under the half of the policy that says you
   * may always remove yourself. What you wrote stays — it belongs to the
   * notebook now — and the local copy goes altogether rather than becoming a
   * read-only keepsake, because leaving is a decision and does not need to be
   * softened the way being removed does.
   */
  async leaveNotebook(notebookId: string, userId: string): Promise<void> {
    this.requireOnline();
    const mine = await this.getMyMembership(notebookId, userId);
    if (mine) {
      const { error } = await supabase
        .from('shared_notebook_members')
        .delete()
        .eq('id', mine.id);
      if (error) throw this.plainError(error.message);
    }
    await this.forgetNotebook(notebookId);
  }

  /**
   * Take a notebook off this device, without touching the server.
   *
   * What clears away a read-only copy of a notebook this account is no longer
   * in. It is purely local: a notebook you are still a member of would simply
   * come back on the next pull, which is the honest behaviour — this is not a
   * way to leave.
   */
  async forgetNotebook(notebookId: string): Promise<void> {
    const members = await getByIndex<DBSharedNotebookMember>(
      'shared_notebook_members',
      'notebookId',
      notebookId,
    );
    for (const row of members) {
      await writeTransaction('shared_notebook_members', (store) => store.delete(row.id));
    }

    const pages = await getByIndex<DBSharedNotebookPage>(
      'shared_notebook_pages',
      'notebookId',
      notebookId,
    );
    for (const row of pages) {
      await writeTransaction('shared_notebook_pages', (store) => store.delete(row.id));
    }

    await writeTransaction('shared_notebooks', (store) => store.delete(notebookId));
    // Anything still queued for it has nowhere to go: the pages it belonged to
    // are not on this device any more, and a write that went up now would put
    // a page back into a notebook this account has just walked out of.
    await dropNotebookWrites(notebookId);
    announce();
  }

  /** Put a notebook row from the server into IndexedDB, and say so. */
  private async storeNotebook(row: any): Promise<DBSharedNotebook> {
    const mapped = rowToDBNotebook(row);
    await writeTransaction('shared_notebooks', (store) => store.put(mapped));
    announce();
    return mapped;
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
    // The queue goes with them. It is keyed on pages that are no longer here,
    // and the account that wrote them is signing out.
    await clearOutbox();
    this.lastPullAt = 0;
    announce();
  }
}

/** Singleton — import this rather than constructing the class. */
export const sharedNotebookStore = new SharedNotebookStoreImpl();

/**
 * Coming back into signal is enough on its own.
 *
 * Nobody should have to open the Notes pane for what they wrote in a tunnel to
 * arrive, so the browser's own event does it. A force pull follows the flush
 * rather than the throttled one, because the last pull may well have been ten
 * seconds before the signal went and the app could otherwise sit on stale
 * pages for as long as anybody left it alone.
 */
if (typeof window !== 'undefined') {
  window.addEventListener('online', () => {
    void sharedNotebookStore.pull({ force: true });
  });
}
