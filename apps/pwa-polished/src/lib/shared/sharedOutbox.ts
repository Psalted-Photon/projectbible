/**
 * sharedOutbox — what you wrote in a shared notebook while there was no signal.
 *
 * A page you write on a train has to go somewhere. It cannot go to the server,
 * and it must not be thrown away, and it must not quietly be treated as though
 * it had arrived — so it is written into the local copy of the page (which is
 * what the reader draws) and a note of it is put here. When the signal comes
 * back, SharedNotebookStore.flushOutbox() sends each one through exactly the
 * same save_shared_page every online edit goes through, so an edit made in a
 * tunnel and an edit made on wifi are the same edit as far as the notebook is
 * concerned, including the revision check that protects everybody else's work.
 *
 * Three decisions worth keeping:
 *
 * - **One row per page.** Somebody writing offline for twenty minutes means
 *   "send what I end up with", not "replay every autosave in order". A later
 *   edit replaces the earlier one, and `baseRev` stays at what the *first* of
 *   them was measured against, because that is still the newest version of
 *   everybody else's work this device has seen.
 *
 * - **Stamped when queued, not when sent.** The paragraph pills are worked out
 *   against the stored page, and while offline the stored page is the only one
 *   there is. Stamping at the door means the gutter is right on the device
 *   straight away, and the text that eventually goes up is the text that was
 *   on screen. flushOutbox therefore sends it as-is rather than stamping twice.
 *
 * - **It holds no permission of its own.** What may be written is decided by
 *   sharedPermissions before anything reaches here, and by the policies in
 *   migration 012 when it leaves. An item that turns out to be refused on
 *   arrival is dropped with the refusal shown, not retried.
 */

import { openDB, writeTransaction } from '../../adapters/db';
import type { DBSharedOutboxItem } from '../../adapters/db';

export type { DBSharedOutboxItem };

const STORE = 'shared_outbox';

/** Fires whenever something is queued, sent or given up on. */
const listeners = new Set<() => void>();

export function subscribeToOutboxChanges(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function announce(): void {
  listeners.forEach((fn) => {
    try {
      fn();
    } catch (err) {
      console.error('[SharedOutbox] listener error:', err);
    }
  });
}

/** Everything still waiting, oldest first — the order it will be sent in. */
export async function pendingWrites(): Promise<DBSharedOutboxItem[]> {
  const db = await openDB();
  const rows = await new Promise<DBSharedOutboxItem[]>((resolve) => {
    const tx = db.transaction(STORE, 'readonly');
    const req = tx.objectStore(STORE).getAll();
    req.onsuccess = () => resolve((req.result ?? []) as DBSharedOutboxItem[]);
    req.onerror = () => resolve([]);
  });
  return rows.sort((a, b) => a.queuedAt - b.queuedAt);
}

/** The one waiting for this page, if there is one. */
export async function pendingFor(pageId: string): Promise<DBSharedOutboxItem | null> {
  const db = await openDB();
  return new Promise<DBSharedOutboxItem | null>((resolve) => {
    const tx = db.transaction(STORE, 'readonly');
    const req = tx.objectStore(STORE).get(pageId);
    req.onsuccess = () => resolve((req.result as DBSharedOutboxItem) ?? null);
    req.onerror = () => resolve(null);
  });
}

/**
 * The pages with something still to send.
 *
 * Read by the list and by the pull: the list marks those rows "waiting to
 * send", and the pull leaves them alone rather than replacing the words on
 * screen with the older ones the server still has.
 */
export async function pendingPageIds(): Promise<Set<string>> {
  const rows = await pendingWrites();
  return new Set(rows.map((row) => row.pageId));
}

/**
 * Put a write in the queue, folding it into whatever was already waiting.
 *
 * The fold is what keeps a long offline session honest: the newest text wins,
 * but the oldest `baseRev` and the original `createdAt` are carried forward,
 * so a page begun offline is still created rather than updated, and an edit
 * begun before somebody else's save is still measured against the version it
 * was actually written on top of.
 */
export async function queueWrite(
  item: Omit<DBSharedOutboxItem, 'queuedAt' | 'attempts' | 'lastAttemptAt'>,
): Promise<void> {
  const existing = await pendingFor(item.pageId);

  const merged: DBSharedOutboxItem = {
    ...item,
    // Taking a page out supersedes anything queued for it; there is nothing
    // left to send the words to.
    baseRev: item.kind === 'remove' ? item.baseRev : (existing?.baseRev ?? item.baseRev),
    createdAt: existing?.createdAt ?? item.createdAt,
    // A flag left unset by this write keeps whatever an earlier one asked for,
    // so pinning a page and then writing in it does not un-pin it on arrival.
    editMode: item.editMode ?? existing?.editMode ?? null,
    pinned: item.pinned ?? existing?.pinned ?? null,
    queuedAt: existing?.queuedAt ?? Date.now(),
    attempts: 0,
    lastAttemptAt: null,
  };

  await writeTransaction(STORE, (store) => store.put(merged));
  announce();
}

/** Done with, one way or another. */
export async function dropWrite(pageId: string): Promise<void> {
  await writeTransaction(STORE, (store) => store.delete(pageId));
  announce();
}

/** Couldn't be delivered — no signal, or the server was not answering. */
export async function markAttempt(item: DBSharedOutboxItem): Promise<void> {
  await writeTransaction(STORE, (store) =>
    store.put({ ...item, attempts: item.attempts + 1, lastAttemptAt: Date.now() }),
  );
  announce();
}

/**
 * Forget everything queued for a notebook.
 *
 * For the two moments a notebook stops being somewhere this account can write:
 * leaving it, and throwing away the read-only copy left behind after being
 * removed. Neither should leave a write behind that goes on trying.
 */
export async function dropNotebookWrites(notebookId: string): Promise<void> {
  const rows = await pendingWrites();
  for (const row of rows) {
    if (row.notebookId === notebookId) {
      await writeTransaction(STORE, (store) => store.delete(row.pageId));
    }
  }
  announce();
}

/** Everything, for signing out. */
export async function clearOutbox(): Promise<void> {
  await writeTransaction(STORE, (store) => store.clear());
  announce();
}

/**
 * Does this error mean "the message never left the building"?
 *
 * A fetch that never reached the server throws a TypeError with one of a
 * handful of browser-specific sentences; supabase-js passes them through. It
 * matters because the two answers are opposite: something that never arrived
 * should be kept and tried again, and something the server thought about and
 * refused should not be.
 */
export function isOffline(err: unknown): boolean {
  if (typeof navigator !== 'undefined' && !navigator.onLine) return true;
  const message = (err instanceof Error ? err.message : String(err ?? '')).toLowerCase();
  return (
    message.includes('failed to fetch') ||
    message.includes('networkerror') ||
    message.includes('network request failed') ||
    message.includes('load failed') ||
    message.includes('fetch failed') ||
    message.includes('err_internet_disconnected')
  );
}
