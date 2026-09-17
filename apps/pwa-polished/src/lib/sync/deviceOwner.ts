/**
 * Which account the rows in this device's personal stores belong to.
 *
 * The local stores — notes, highlights, bookmarks, the journal, notebooks and
 * their pages, reading progress, plan metadata — were written as "this
 * device's data" while Supabase treats the same rows as "this account's data".
 * Nothing on the device recorded the difference, which is how one account's
 * queued work could be uploaded under another's name (phase 1) and how signing
 * out could leave somebody else's notes on screen (phases 3 to 5).
 *
 * This module is the single answer to "whose rows are these?". It is
 * deliberately synchronous: a row is stamped from inside an IndexedDB
 * transaction callback, where there is no opportunity to await Supabase, and
 * where touching localStorage on every put would be wasteful. So the value is
 * held in memory and localStorage is only the copy that survives a reload.
 *
 * The key is the one phase 1 introduced. There is one account id on the
 * device, and one place that reads and writes it.
 */

/** Which account this device's local rows and pending queue belong to. */
const OWNER_KEY = 'projectbible_queue_owner';

/**
 * The in-memory copy. `undefined` means not yet read from storage this
 * session; `null` means read, and this device has never had an owner.
 */
let cached: string | null | undefined;

/** Set when localStorage could not be read — see `isOwnerReadable`. */
let storageBroken = false;

/**
 * The account this device is keeping rows for, or null if it has never had
 * one. Safe to call from inside an IndexedDB transaction callback.
 */
export function getDeviceOwner(): string | null {
  if (cached !== undefined) return cached;
  try {
    cached = localStorage.getItem(OWNER_KEY);
  } catch {
    // Private mode, or storage blocked. Report "no owner" rather than guess —
    // callers that cannot act safely without one check isOwnerReadable().
    storageBroken = true;
    cached = null;
  }
  return cached;
}

/**
 * Record the account this device is now keeping rows for.
 *
 * Called on sign-in, before anything is written or uploaded, so that rows
 * created during the session carry the right name from the start.
 */
export function setDeviceOwner(userId: string): void {
  cached = userId;
  try {
    localStorage.setItem(OWNER_KEY, userId);
    storageBroken = false;
  } catch {
    // The memory copy still serves this session; the next reload takes the
    // unreadable-storage path and errs towards caution.
    storageBroken = true;
  }
}

/**
 * Whether the stored owner could actually be read.
 *
 * A device whose storage is blocked cannot tell "never had an owner" from
 * "had a different one", so anything destructive or irreversible — dropping a
 * queue, uploading rows — must treat that case as a mismatch rather than as a
 * fresh device.
 */
export function isOwnerReadable(): boolean {
  getDeviceOwner();
  return !storageBroken;
}

/** Forget the owner entirely. Used when the queue is dropped as unattributable. */
export function clearDeviceOwner(): void {
  cached = null;
  try {
    localStorage.removeItem(OWNER_KEY);
  } catch {
    storageBroken = true;
  }
}
