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
 * Phase 1 reads. Writing arrives in phase 3.
 */

import { supabase } from '../lib/supabase/client';
import { openDB, writeTransaction } from './db';
import type {
  DBSharedNotebook,
  DBSharedNotebookMember,
  DBSharedNotebookPage,
} from './db';
import { sanitizeNoteHtml } from '../lib/shared/sanitizeNoteHtml';

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
