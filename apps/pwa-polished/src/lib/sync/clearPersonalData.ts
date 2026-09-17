/**
 * Take one account's work off this device.
 *
 * Signing out used to leave everything where it was: the next person to sign
 * in on the same device saw the previous one's notes, highlights, journal and
 * notebooks, because the local stores were written as "this device's rows"
 * and nothing recorded whose they actually were. Phase 2 gave every personal
 * row an ownerId; this is the phase that acts on it.
 *
 * Three groups go:
 *
 *   The personal stores — the same nine `prepareBackup` copies, because that
 *   list has already been proven to be exactly one person's own work.
 *
 *   The journal lock and its key slots — slotStore keeps one account's lock
 *   only, so leaving account A's behind means account B is asked to unlock a
 *   journal with a passkey it has never seen and cannot produce.
 *
 *   The shared notebooks, their members, their pages and the outbox — those
 *   are other people's notebooks, reached through account A's membership.
 *   B is not in them.
 *
 * What stays: packs, the atlas, lexicons, audio, art, and every other
 * reference store, which are the same for everybody and are expensive to
 * download again. Settings stay too — they describe this device more than
 * they describe the account, and a sign-out that reset somebody's font size
 * would read as a bug.
 *
 * Nothing here is recoverable from the device afterwards. The caller checks
 * `pendingWork()` first and asks, because rows that reached the server come
 * back on the next sign-in and rows that did not are simply gone.
 *
 * What brings them back is onSignIn: the applyFn pipeline for the personal
 * tables, refreshLockFromCloud for the lock and its key slots, and a forced
 * sharedNotebookStore.pull for the four shared stores. Reading history is the
 * exception — see HISTORY_STORES below.
 */

import { openDB } from '../../adapters/db';
import { syncQueue } from './SyncQueueService';
import { clearDeviceOwner } from './deviceOwner';
import { clearOutbox, pendingWrites } from '../shared/sharedOutbox';
import {
  ACTIVE_PLANS_KEY,
  CATCHUP_PREFIX,
  PLAN_HISTORY_KEY,
} from '../backup/backupFile';

/**
 * The nine stores holding this account's own work. Mirrors PERSONAL_STORES in
 * db.ts and the list `prepareBackup` walks.
 */
const PERSONAL_STORES = [
  'user_notes',
  'user_highlights',
  'user_word_highlights',
  'user_bookmarks',
  'journal_entries',
  'notebooks',
  'notebook_pages',
  'reading_progress',
  'plan_metadata',
];

/**
 * Where this account has been reading. Personal, and not in the backup file —
 * it is a trail rather than something written on purpose — but it would still
 * be the previous account's trail if it stayed.
 *
 * Unlike everything else here, this one does not come back. There is no
 * reading_history table on the server, so nothing was ever uploaded and the
 * sign-in restore has nothing to fetch. Clearing it is still right — the
 * alternative is showing account B where account A has been — but it is the
 * one store where signing out is genuinely a loss rather than a round trip.
 */
const HISTORY_STORES = ['reading_history'];

/**
 * The journal lock. Keyed by userId, but only ever one account's: a lock left
 * behind asks the next account for a passkey that does not exist.
 */
const LOCK_STORES = ['journal_lock', 'journal_key_slots'];

/**
 * Shared notebooks are other people's, reached through this account's
 * membership in them. The outbox is included here rather than left for the
 * flush, so that a wipe the user has confirmed actually finishes.
 */
const SHARED_STORES = [
  'shared_notebooks',
  'shared_notebook_members',
  'shared_notebook_pages',
  'shared_outbox',
];

const ALL_STORES = [
  ...PERSONAL_STORES,
  ...HISTORY_STORES,
  ...LOCK_STORES,
  ...SHARED_STORES,
];

/**
 * localStorage that belongs to the account rather than the device. The three
 * named keys are the ones `prepareBackup` reads; the catch-up days are one
 * key per plan, so they are found by prefix.
 *
 * The repeats list is deliberately not here: it is a reading aid attached to
 * verses rather than a record of anything the account did, and it is the kind
 * of thing somebody would be annoyed to lose on a sign-out.
 */
const ACCOUNT_KEYS = [
  ACTIVE_PLANS_KEY,
  PLAN_HISTORY_KEY,
  /** The journal's re-lock timer. Means nothing without the lock above. */
  'pb_journal_relock_ms',
  /** Set once the pre-ownership rows were adopted; the next account adopts its own. */
  'projectbible_ownership_adopted',
];

/** What has not reached the server yet, and so would be lost by clearing. */
export interface PendingWork {
  /** Queued writes to the personal tables. */
  queued: number;
  /** Shared-notebook edits waiting to go up. */
  outbox: number;
  /** The two added together, for the one number worth putting in a sentence. */
  total: number;
}

/**
 * How much unsent work this device is holding.
 *
 * Asked before signing out, so the answer can be put in front of the user
 * rather than discovered afterwards. Both counts are guarded: a store that
 * cannot be read reports nothing pending rather than blocking a sign-out
 * forever, since the alternative is somebody stuck signed in on a device
 * whose storage is broken.
 */
export async function pendingWork(): Promise<PendingWork> {
  let queued = 0;
  let outbox = 0;

  try {
    queued = await syncQueue.getPendingCount();
  } catch (err) {
    console.warn('[ClearData] Could not count queued writes:', err);
  }

  try {
    outbox = (await pendingWrites()).length;
  } catch (err) {
    console.warn('[ClearData] Could not count outbox writes:', err);
  }

  return { queued, outbox, total: queued + outbox };
}

/** Empty one store. A store this database has never created is not an error. */
function clearStore(db: IDBDatabase, storeName: string): Promise<void> {
  if (!db.objectStoreNames.contains(storeName)) return Promise.resolve();

  return new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(storeName, 'readwrite');
      tx.objectStore(storeName).clear();
      tx.oncomplete = () => resolve();
      // One store refusing to empty should not leave the other twelve full.
      // The failure is logged and the sweep goes on; what is left behind is
      // reported by the count the caller gets back.
      tx.onerror = () => {
        console.warn(`[ClearData] Could not clear ${storeName}:`, tx.error);
        resolve();
      };
      tx.onabort = () => resolve();
    } catch (err) {
      console.warn(`[ClearData] Could not open ${storeName}:`, err);
      resolve();
    }
  });
}

/** Remove the account-scoped localStorage keys, including the catch-up days. */
function clearAccountKeys(): void {
  try {
    for (const key of ACCOUNT_KEYS) localStorage.removeItem(key);

    // Collected before removing: mutating localStorage while walking its
    // indices skips entries.
    const catchUp: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key?.startsWith(CATCHUP_PREFIX)) catchUp.push(key);
    }
    for (const key of catchUp) localStorage.removeItem(key);
  } catch (err) {
    console.warn('[ClearData] Could not clear account keys:', err);
  }
}

/**
 * Why the device is being emptied. Only the log line differs — the sweep is
 * the same either way, because what has to come off the device does not
 * depend on whether the previous account left on purpose.
 */
export type ClearReason = 'sign-out' | 'account-switch';

/**
 * Take this account's work off the device.
 *
 * Returns how many stores were emptied, which is what the sign-out path logs.
 * The sync queue goes with them: its rows are writes to the stores being
 * emptied, so keeping it would mean uploading rows that no longer exist here,
 * and phase 1's owner check would refuse them on the next sign-in anyway.
 * The device owner is forgotten last, so that anything writing during the
 * sweep is stamped for the account that is on its way out rather than left
 * unowned for the next one to adopt.
 *
 * Called from two places. A sign-out, where the user has already been asked
 * about anything unsent; and an account switch (phase 5), where they have
 * not, because by then Supabase has changed who is signed in and there is
 * nobody left to ask — see the note on `switchAccounts` in SyncService.
 */
export async function clearPersonalData(reason: ClearReason = 'sign-out'): Promise<number> {
  let cleared = 0;

  try {
    const db = await openDB();
    for (const storeName of ALL_STORES) {
      await clearStore(db, storeName);
      cleared++;
    }
  } catch (err) {
    console.warn('[ClearData] Could not open the database to clear it:', err);
  }

  // Belt and braces: the store sweep above already empties shared_outbox, but
  // this goes through the module that owns it, so its subscribers are told.
  try {
    await clearOutbox();
  } catch (err) {
    console.warn('[ClearData] Could not clear the outbox:', err);
  }

  try {
    await syncQueue.clear();
  } catch (err) {
    console.warn('[ClearData] Could not clear the sync queue:', err);
  }

  clearAccountKeys();
  clearDeviceOwner();

  // Tell the screen. Everything above writes to IndexedDB directly, which the
  // open components have no way of noticing: they load on mount and then wait
  // to be told. Until this was here, signing out emptied the database and left
  // the previous account's work on display — the note icons went only because
  // something else happened to re-render them, and the highlights stayed put
  // until a manual reload, because they are painted spans rather than reactive
  // state and clearing the rows does not remove paint already on the page.
  //
  // Imported here rather than at the top of the file: the adapters import
  // SyncService, which imports this module, and they self-register at the
  // bottom of their own files specifically to keep that cycle from forming.
  // Guarded, because a sign-out should not fail over a repaint.
  try {
    const [{ notifyHighlightChange }, { notifyUserDataChange }] = await Promise.all([
      import('../../adapters/SyncedHighlightAdapter'),
      import('../../adapters/SyncedUserDataStore'),
    ]);
    notifyHighlightChange();
    notifyUserDataChange();
  } catch (err) {
    console.warn('[ClearData] Could not tell the UI the data is gone:', err);
  }

  console.log(
    reason === 'account-switch'
      ? `[ClearData] Cleared ${cleared} store(s) — a different account signed in`
      : `[ClearData] Cleared ${cleared} store(s) on sign-out`,
  );
  return cleared;
}
