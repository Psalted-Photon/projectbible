/**
 * What the lock screen and Settings can do: unlock, turn the lock on, manage
 * its fingerprints and recovery code, and turn it off.
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
import type { DBJournalLock } from '../../adapters/db';
import {
  adoptLock, currentLockView, forgetJournalKey, getJournalKey, unlockWith, withLocalLockChange,
} from './lockState';
import { createPasskeySlot, currentRpId, forgetPasskey, openWithPasskey } from './passkey';
import { createRecoverySlot, generateRecoveryCode, openRecoverySlot } from './recoveryCode';
import {
  deleteAllRemoteSlots, deleteRemoteSlots, fetchRemoteLock, setRemoteLock, uploadSlots,
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
export function finishTurnOn(draft: LockDraft): Promise<void> {
  return withLocalLockChange(() => saveTurnOn(draft));
}

async function saveTurnOn(draft: LockDraft): Promise<void> {
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

// ── Managing it (unlocked only) ───────────────────────────────────────────

function requireUnlocked(): { journalKey: Uint8Array<ArrayBuffer>; keyId: string; lock: DBJournalLock } {
  const view = currentLockView();
  const journalKey = getJournalKey();
  if (!journalKey || !view.keyId || !view.userId || view.mode === 'off') {
    throw new JournalLockError('Unlock the journal first.');
  }
  return {
    journalKey,
    keyId: view.keyId,
    lock: { userId: view.userId, state: view.mode, keyId: view.keyId, updatedAt: Date.now() },
  };
}

/** Add a passkey on this device, so it can unlock with a fingerprint. */
export async function addThisDeviceFingerprint(): Promise<void> {
  const account = await requireAccount();
  const { journalKey, keyId, lock } = requireUnlocked();
  const view = currentLockView();
  const existing = view.slots
    .filter((s) => s.kind === 'passkey' && s.rpId === currentRpId() && s.credentialId)
    .map((s) => s.credentialId!);

  const slot = await createPasskeySlot(journalKey, keyId, account.userId, account.email, existing);
  await withLocalLockChange(async () => {
    try {
      await uploadSlots([slot]);
    } catch (err) {
      if (slot.rpId && slot.credentialId) forgetPasskey(slot.rpId, slot.credentialId);
      throw new JournalLockError(cloudProblem(err));
    }
    await adoptLock(lock, [...currentLockView().slots, slot]);
  });
}

/** Take a fingerprint device off the list. Its passkey no longer opens the journal. */
export async function removeFingerprint(slotId: string): Promise<void> {
  const account = await requireAccount();
  const { lock } = requireUnlocked();
  const view = currentLockView();
  const slot = view.slots.find((s) => s.id === slotId && s.kind === 'passkey');
  if (!slot) return;
  await withLocalLockChange(async () => {
    try {
      await deleteRemoteSlots(account.userId, [slot.id]);
    } catch (err) {
      throw new JournalLockError(cloudProblem(err));
    }
    await adoptLock(lock, currentLockView().slots.filter((s) => s.id !== slot.id));
  });
  if (slot.rpId === currentRpId() && slot.credentialId) forgetPasskey(slot.rpId, slot.credentialId);
}

/**
 * Swap in a new recovery code. The new one is saved before the old one is
 * removed, so there's never a moment with no recovery code at all.
 */
export async function replaceRecoveryCode(code: string): Promise<void> {
  const account = await requireAccount();
  const { journalKey, keyId, lock } = requireUnlocked();
  const slot = await createRecoverySlot(journalKey, keyId, account.userId, code);
  await withLocalLockChange(async () => {
    try {
      await uploadSlots([slot]);
    } catch (err) {
      throw new JournalLockError(cloudProblem(err));
    }
    const old = currentLockView().slots.filter((s) => s.kind === 'recovery');
    let retired = true;
    try {
      await deleteRemoteSlots(account.userId, old.map((s) => s.id));
    } catch (err) {
      retired = false;
      console.warn('[JournalLock] Old recovery code not removed:', err);
    }
    const others = currentLockView().slots.filter((s) => s.kind !== 'recovery');
    await adoptLock(lock, retired ? [...others, slot] : [...others, ...old, slot]);
    if (!retired) {
      // The new code works. Say plainly that the old one does too, for now.
      throw new JournalLockError('The new code is saved, but the old one still works too. Make a new code again when you’re back online to retire it.');
    }
  });
}

// ── Turning it off ────────────────────────────────────────────────────────

/** Some entries couldn't be unscrambled; turning off would leave them scrambled for good. */
export class UnreadableEntriesError extends JournalLockError {
  constructor(readonly count: number) {
    super(`${count} journal ${count === 1 ? 'entry' : 'entries'} couldn’t be opened.`);
    this.name = 'UnreadableEntriesError';
  }
}

async function scrambledInCloud(userId: string): Promise<number> {
  let total = 0;
  for (const column of ['title', 'text']) {
    const { count, error } = await supabase
      .from('journal_entries')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .like(column, 'pbj1:%');
    if (error) throw error;
    total += count ?? 0;
  }
  return total;
}

/**
 * Turn the lock off everywhere. Nothing is deleted until the readable copies
 * are safely in the cloud:
 *   1. mark the lock as turning off,
 *   2. unscramble every entry and queue it for upload,
 *   3. wait for the uploads, and check the cloud has no scrambled text left,
 *   4. only then delete the key slots and mark the lock off.
 * Interrupted at any point, running it again carries on from where it is.
 */
export function turnOffJournalLock(opts: { leaveUnreadable?: boolean } = {}): Promise<void> {
  return withLocalLockChange(() => runTurnOff(opts));
}

async function runTurnOff(opts: { leaveUnreadable?: boolean }): Promise<void> {
  const account = await requireAccount();
  const { keyId } = requireUnlocked();
  const slots = currentLockView().slots;

  // 1.
  try {
    const lock = await setRemoteLock(account.userId, 'turning_off', keyId);
    await adoptLock(lock, slots);
  } catch (err) {
    throw new JournalLockError(cloudProblem(err));
  }

  // 2. Pull first, so entries another device wrote are here to unscramble.
  await syncService.forceSync();
  const result = await sweepJournal();
  if (result.failed > 0 && !opts.leaveUnreadable) throw new UnreadableEntriesError(result.failed);

  // 3.
  await emptyJournalUploads();
  if (!opts.leaveUnreadable) {
    let left: number;
    try {
      left = await scrambledInCloud(account.userId);
    } catch (err) {
      throw new JournalLockError(cloudProblem(err));
    }
    if (left > 0) {
      throw new JournalLockError('Some scrambled entries are still in the cloud. Wait a moment, then try again.');
    }
  }

  // 4.
  try {
    await deleteAllRemoteSlots(account.userId);
    const lock = await setRemoteLock(account.userId, 'off', null);
    await adoptLock(lock, []);
  } catch (err) {
    throw new JournalLockError(cloudProblem(err));
  }
  // The passkeys stay in the password manager on purpose: a device that was
  // offline through all this may still hold scrambled copies to open.
  forgetJournalKey();
}
