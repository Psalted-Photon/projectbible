/**
 * What the lock screen and Settings can do: unlock, and turn the lock on.
 *
 * Unlocking needs no connection — the passkey is on the device and so are
 * the locked key copies. Turning the lock on does, so that every entry is
 * safely swapped in the cloud before anything depends on it.
 */

import type { DBJournalKeySlot } from '../../adapters/db';
import { openDB } from '../../adapters/db';
import type { DBSyncQueueItem } from '../../adapters/db';
import { supabase } from '../supabase/client';
import { syncService } from '../sync/SyncService';
import { syncQueue } from '../sync/SyncQueueService';
import type { SyncOperation } from '../sync/types';
import { generateJournalKey, keyIdFor } from './crypto';
import {
  adoptLock, currentLockView, forgetJournalKey, unlockWith,
} from './lockState';
import { createPasskeySlot, forgetPasskey, openWithPasskey } from './passkey';
import { createRecoverySlot, generateRecoveryCode, openRecoverySlot } from './recoveryCode';
import {
  deleteAllRemoteSlots, fetchRemoteLock, setRemoteLock, uploadSlots,
} from './slotStore';
import { refreshLockFromCloud } from './sync';
import { sweepJournal } from './sweep';

/** A problem worth showing the person as it is. */
export class JournalLockError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'JournalLockError';
  }
}

// ── Unlock ────────────────────────────────────────────────────────────────

/** Fingerprint or face. Must be called straight from a tap. */
export async function unlockWithFingerprint(): Promise<void> {
  const view = currentLockView();
  const { journalKey } = await openWithPasskey(view.slots, view.keyId);
  await unlockWith(journalKey);
}

/** Resolves false when the code doesn't open any recovery slot. */
export async function unlockWithRecoveryCode(code: string): Promise<boolean> {
  const view = currentLockView();
  const slots = view.slots.filter((s) => s.kind === 'recovery' && (!view.keyId || s.keyId === view.keyId));
  for (const slot of slots) {
    const key = await openRecoverySlot(slot, code);
    if (key) {
      await unlockWith(key);
      return true;
    }
  }
  return false;
}

// ── Shared checks ─────────────────────────────────────────────────────────

export interface Account {
  userId: string;
  email: string;
}

export async function requireAccount(): Promise<Account> {
  const { data } = await supabase.auth.getSession();
  const user = data.session?.user;
  if (!user) throw new JournalLockError('Sign in first. The lock is kept with your account.');
  if (!navigator.onLine) throw new JournalLockError('You’re offline. Connect to the internet and try again.');
  return { userId: user.id, email: user.email ?? '' };
}

/** Turn a Supabase error into something a person can act on. */
export function cloudProblem(err: unknown): string {
  const e = err as { code?: string; message?: string };
  if (e?.code === '42P01' || e?.code === 'PGRST205' || /does not exist|schema cache/i.test(e?.message ?? '')) {
    return 'The journal lock isn’t set up in the cloud yet.';
  }
  return 'Couldn’t reach the cloud. Check your connection and try again.';
}

async function journalUploadsWaiting(): Promise<number> {
  const db = await openDB();
  const items = await new Promise<DBSyncQueueItem[]>((resolve) => {
    const req = db.transaction('sync_queue', 'readonly').objectStore('sync_queue').getAll();
    req.onsuccess = () => resolve((req.result as DBSyncQueueItem[]) ?? []);
    req.onerror = () => resolve([]);
  });
  return items.filter((item) =>
    (item.payload as SyncOperation)?.table === 'journal_entries'
    && (item.status === 'pending' || item.status === 'failed')).length;
}

/** Upload everything waiting, and wait until no journal change is left. */
export async function emptyJournalUploads(): Promise<void> {
  await syncQueue.resetFailed();
  for (let attempt = 0; attempt < 6; attempt++) {
    await syncQueue.processQueue();
    const waiting = await journalUploadsWaiting();
    if (waiting === 0) return;
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }
  const waiting = await journalUploadsWaiting();
  if (waiting > 0) {
    throw new JournalLockError(
      `${waiting} journal change${waiting === 1 ? ' hasn’t' : 's haven’t'} reached the cloud yet. Check your connection and try again.`,
    );
  }
}

// ── Turning it on ─────────────────────────────────────────────────────────

/**
 * Everything setup builds before anything is saved. Dropped without a trace
 * if setup is cancelled.
 */
export interface LockDraft {
  account: Account;
  journalKey: Uint8Array<ArrayBuffer>;
  keyId: string;
  recoveryCode: string;
  passkeySlot: DBJournalKeySlot | null;
  /** Made once, so a retried last step doesn't leave a second copy behind. */
  recoverySlot: DBJournalKeySlot | null;
}

/** Step 1: check the account and the cloud, and finish syncing. */
export async function startTurnOn(): Promise<LockDraft> {
  const account = await requireAccount();

  let row: any | null;
  try {
    row = await fetchRemoteLock(account.userId);
  } catch (err) {
    throw new JournalLockError(cloudProblem(err));
  }
  if (row && row.state !== 'off') {
    await refreshLockFromCloud().catch(() => {});
    throw new JournalLockError('The journal lock is already on for your account, probably from another device.');
  }

  await syncService.forceSync();
  await emptyJournalUploads();

  // Copies left in the cloud by a setup that never finished.
  try {
    await deleteAllRemoteSlots(account.userId);
  } catch (err) {
    throw new JournalLockError(cloudProblem(err));
  }

  const journalKey = generateJournalKey();
  return {
    account,
    journalKey,
    keyId: await keyIdFor(journalKey),
    recoveryCode: generateRecoveryCode(),
    passkeySlot: null,
    recoverySlot: null,
  };
}

/** Step 2: the fingerprint. May prompt twice. */
export async function addFingerprintToDraft(draft: LockDraft): Promise<void> {
  if (draft.passkeySlot) return;
  draft.passkeySlot = await createPasskeySlot(
    draft.journalKey, draft.keyId, draft.account.userId, draft.account.email, [],
  );
}

/** Setup was cancelled: forget the key, and the passkey it made. */
export function discardDraft(draft: LockDraft): void {
  if (draft.passkeySlot?.rpId && draft.passkeySlot.credentialId) {
    forgetPasskey(draft.passkeySlot.rpId, draft.passkeySlot.credentialId);
  }
  draft.passkeySlot = null;
  draft.recoverySlot = null;
  draft.recoveryCode = '';
  draft.journalKey.fill(0);
}

/**
 * Steps 4 and 5, once the recovery code has been typed back: save the key
 * slots, turn the lock on, and scramble every entry. If this is interrupted
 * partway through scrambling, the next unlock finishes the job.
 */
export async function finishTurnOn(draft: LockDraft): Promise<void> {
  const { account } = draft;
  draft.recoverySlot ??= await createRecoverySlot(draft.journalKey, draft.keyId, account.userId, draft.recoveryCode);
  const recoverySlot = draft.recoverySlot;
  const slots = draft.passkeySlot ? [draft.passkeySlot, recoverySlot] : [recoverySlot];

  if (!navigator.onLine) throw new JournalLockError('You’re offline. Connect to the internet and try again.');
  try {
    await uploadSlots(slots);
  } catch (err) {
    throw new JournalLockError(cloudProblem(err));
  }

  // From here the lock is real. Unlock this device first so the journal
  // never blinks to the lock screen, then turn it on everywhere.
  await unlockWith(draft.journalKey.slice());
  let lock;
  try {
    lock = await setRemoteLock(account.userId, 'on', draft.keyId);
  } catch (err) {
    forgetJournalKey();
    throw new JournalLockError(cloudProblem(err));
  }
  await adoptLock(lock, slots);

  draft.recoveryCode = '';
  draft.passkeySlot = null;
  draft.recoverySlot = null;
  draft.journalKey.fill(0);

  // The lock is on whatever happens next. A scramble that stops partway
  // finishes on the next unlock, so it's not a setup failure.
  try {
    await sweepJournal();
  } catch (err) {
    console.error('[JournalLock] Scrambling stopped partway; the next unlock finishes it:', err);
  }
  void syncQueue.processQueue();
}
