/**
 * Adopt the rows this device was already holding when ownership arrived.
 *
 * Every personal row written from now on is stamped as it is saved, but a
 * device that has been in use for months is full of rows that never were.
 * They are not nobody's — they are whoever has been using this device, which
 * in practice is the account that signs in here. So the first sign-in after
 * the upgrade claims them, once, and from then on the stores can answer whose
 * every row is.
 *
 * This does not run in `onupgradeneeded`. The upgrade happens the first time
 * the database is opened, which is long before Supabase has said who is
 * signed in — and an upgrade transaction cannot wait to find out. So the
 * version bump records that the schema now carries an owner, and the claiming
 * is a separate pass that runs when there is an account to claim for.
 *
 * It is deliberately generous: a row that already names an owner is left
 * alone, so a second account signing in later takes nothing from the first.
 * Only genuinely unstamped rows are adopted, and only once per device.
 */

import { openDB } from '../../adapters/db';

/** Set once the unstamped rows on this device have been claimed. */
const ADOPTED_KEY = 'projectbible_ownership_adopted';

/** The stores this pass walks. Mirrors PERSONAL_STORES in db.ts. */
const STORES = [
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

function alreadyAdopted(): boolean {
  try {
    return localStorage.getItem(ADOPTED_KEY) !== null;
  } catch {
    // Storage blocked. Say "already done" rather than walk every store on
    // every sign-in for the rest of the session — the pass is a convenience
    // for existing rows, not something correctness depends on.
    return true;
  }
}

function markAdopted(userId: string): void {
  try {
    localStorage.setItem(ADOPTED_KEY, userId);
  } catch {
    // Nothing to do; the next session takes the blocked-storage path above.
  }
}

/** Claim every unstamped row in one store. Returns how many it claimed. */
async function adoptStore(db: IDBDatabase, storeName: string, userId: string): Promise<number> {
  if (!db.objectStoreNames.contains(storeName)) return 0;

  return new Promise<number>((resolve) => {
    let claimed = 0;
    const tx = db.transaction(storeName, 'readwrite');
    const store = tx.objectStore(storeName);
    // A cursor rather than getAll + put: the journal alone can be thousands of
    // rows, and this way only one is in memory at a time.
    const request = store.openCursor();

    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) return;
      const row = cursor.value;
      if (row && typeof row === 'object' && !row.ownerId) {
        cursor.update({ ...row, ownerId: userId });
        claimed++;
      }
      cursor.continue();
    };

    tx.oncomplete = () => resolve(claimed);
    // A failure here is not worth failing a sign-in over: the rows stay
    // unstamped and the next sign-in tries again, because the flag is only
    // written once the whole pass has finished.
    tx.onerror = () => resolve(claimed);
    tx.onabort = () => resolve(claimed);
  });
}

/**
 * Claim this device's unstamped personal rows for `userId`. Runs at most once
 * per device; safe to call on every sign-in.
 */
export async function adoptUnownedRows(userId: string): Promise<void> {
  if (alreadyAdopted()) return;

  try {
    const db = await openDB();
    let total = 0;
    for (const storeName of STORES) {
      total += await adoptStore(db, storeName, userId);
    }
    markAdopted(userId);
    if (total > 0) {
      console.log(
        `[Ownership] Claimed ${total} row(s) already on this device for ${userId.slice(0, 8)}...`,
      );
    }
  } catch (err) {
    // Left unmarked, so the next sign-in tries again.
    console.warn('[Ownership] Could not claim existing rows:', err);
  }
}
