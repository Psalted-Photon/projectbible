/**
 * Lock state for the journal: is the lock on, is the journal key in memory,
 * and when does it get dropped again.
 *
 * The journal key only ever lives in this module's memory. It is dropped when
 * the app closes (nothing survives a reload), on sign-out, when the app has
 * been away longer than the chosen relock time, and when another device
 * changes the lock underneath this one.
 *
 * Whether the journal needs unlocking is driven by the data as well as the
 * lock row: scrambled text on this device needs the key even if the cloud
 * says the lock is off (another device turned it off while this one still
 * held scrambled copies), so the key slots stay cached until none is left.
 */

import { get, writable, type Readable } from 'svelte/store';
import type { DBJournalKeySlot, DBJournalLock } from '../../adapters/db';
import { IndexedDBJournalStore } from '../../adapters/JournalStore';
import { deriveContentKey, isScrambled, keyIdFor } from './crypto';
import {
  lockFromRow, readLocalLock, readLocalSlots, replaceLocalSlots, writeLocalLock, type LockMode,
} from './slotStore';

export interface JournalWork {
  kind: 'scramble' | 'unscramble';
  done: number;
  total: number;
}

export interface JournalLockView {
  /** The device's own copy has been read, so the UI can decide without flashing. */
  ready: boolean;
  userId: string | null;
  mode: LockMode;
  keyId: string | null;
  slots: DBJournalKeySlot[];
  /** The journal key is in memory. */
  unlocked: boolean;
  /** The journal can't be shown until it's unlocked. */
  needsUnlock: boolean;
  /** A scramble or unscramble pass in progress, for the progress bar. */
  work: JournalWork | null;
}

const initial: JournalLockView = {
  ready: false,
  userId: null,
  mode: 'off',
  keyId: null,
  slots: [],
  unlocked: false,
  needsUnlock: false,
  work: null,
};

const store = writable<JournalLockView>(initial);
export const journalLock: Readable<JournalLockView> = { subscribe: store.subscribe };

// ── The key, in memory only ───────────────────────────────────────────────

let journalKey: Uint8Array<ArrayBuffer> | null = null;
let contentKey: CryptoKey | null = null;
let unlockedKeyId: string | null = null;
/** Scrambled text turned up on this device before the lock row did. */
let scrambledSeen = false;
/**
 * The cloud has answered at least once this session. Until it has, scrambled
 * text on a fresh device is taken to mean a lock is coming; after, with the
 * lock off and no slots, such an entry is just one that can't be opened.
 */
let cloudChecked = false;

function publish(patch: Partial<JournalLockView>): void {
  store.update((s) => {
    const next = { ...s, ...patch, unlocked: contentKey !== null };
    next.needsUnlock = !next.unlocked
      && (next.mode !== 'off' || next.slots.length > 0 || (scrambledSeen && !cloudChecked));
    return next;
  });
}

export function setJournalWork(work: JournalWork | null): void {
  publish({ work });
}

export function getContentKey(): CryptoKey | null {
  return contentKey;
}

/** The raw journal key, for locking a new copy of it into a slot. */
export function getJournalKey(): Uint8Array<ArrayBuffer> | null {
  return journalKey;
}

export function getUnlockedKeyId(): string | null {
  return unlockedKeyId;
}

/** New and edited entries get scrambled only while the lock is fully on. */
export function scramblesWrites(): boolean {
  return get(store).mode === 'on';
}

export function isUnlocked(): boolean {
  return contentKey !== null;
}

export function currentLockView(): JournalLockView {
  return get(store);
}

/** Called by the journal store when it meets scrambled text it can't open. */
export function noteScrambledSeen(): void {
  if (scrambledSeen) return;
  scrambledSeen = true;
  publish({});
}

// ── Hooks ─────────────────────────────────────────────────────────────────

type Hook = () => void | Promise<void>;
const beforeLockHooks = new Set<Hook>();
const unlockedHooks = new Set<Hook>();
const lockChangedHooks = new Set<Hook>();
const settledHooks = new Set<Hook>();

function fire(hooks: Set<Hook>, label: string): void {
  for (const fn of [...hooks]) {
    void Promise.resolve().then(fn).catch((err) => console.error(`[JournalLock] ${label} task failed:`, err));
  }
}

/** Runs before the key is dropped — the journal writer saves unsaved typing here. */
export function onBeforeLock(fn: Hook): () => void {
  beforeLockHooks.add(fn);
  return () => beforeLockHooks.delete(fn);
}

/** Runs after every unlock — the sweep that finishes any half-done scramble. */
export function onUnlocked(fn: Hook): () => void {
  unlockedHooks.add(fn);
  return () => unlockedHooks.delete(fn);
}

/** Runs when another device turns the lock on, off or turning off while this one is unlocked. */
export function onLockChangedWhileUnlocked(fn: Hook): () => void {
  lockChangedHooks.add(fn);
  return () => lockChangedHooks.delete(fn);
}

/** Runs when this device's own lock change has finished — the cloud gets re-read then. */
export function onLocalLockChangeSettled(fn: Hook): () => void {
  settledHooks.add(fn);
  return () => settledHooks.delete(fn);
}

// ── Local changes versus cloud refreshes ──────────────────────────────────
//
// While this device is changing the lock (turning it on or off, adding a
// fingerprint), what the cloud says is mid-change and must not be applied: a
// refresh fetched between two of its writes would flip the lock back. Cloud
// state is ignored while a change runs, and any refresh that started before a
// change began or ended is dropped; a fresh one runs once the change settles.

let localChanges = 0;
let generation = 0;

export function lockGeneration(): number {
  return generation;
}

export async function withLocalLockChange<T>(fn: () => Promise<T>): Promise<T> {
  localChanges++;
  generation++;
  try {
    return await fn();
  } finally {
    localChanges--;
    generation++;
    if (localChanges === 0) fire(settledHooks, 'after-change');
  }
}

async function runBeforeLockHooks(): Promise<void> {
  const hooks = [...beforeLockHooks];
  if (hooks.length === 0) return;
  await Promise.race([
    Promise.allSettled(hooks.map((fn) => fn())),
    new Promise((resolve) => setTimeout(resolve, 4000)),
  ]);
}

// ── Unlock and lock ───────────────────────────────────────────────────────

/** Put a journal key opened from a slot into memory. */
export async function unlockWith(key: Uint8Array<ArrayBuffer>): Promise<void> {
  const id = await keyIdFor(key);
  const view = get(store);
  if (view.keyId && view.keyId !== id) {
    throw new Error('That key belongs to an older journal lock.');
  }
  contentKey = await deriveContentKey(key);
  journalKey = key;
  unlockedKeyId = id;
  publish({});
  fire(unlockedHooks, 'after-unlock');
}

function dropKey(): void {
  journalKey?.fill(0);
  journalKey = null;
  contentKey = null;
  unlockedKeyId = null;
  clearRelockTimer();
  hiddenAt = null;
  publish({});
}

/** Forget the key without saving first — the lock was just turned off. */
export function forgetJournalKey(): void {
  dropKey();
}

/** Lock now, saving any unsaved journal typing first. */
export async function lockJournal(): Promise<void> {
  if (!contentKey) return;
  await runBeforeLockHooks();
  dropKey();
}

// ── Relock time ───────────────────────────────────────────────────────────

export const RELOCK_OPTIONS: { label: string; ms: number }[] = [
  { label: 'Immediately', ms: 0 },
  { label: '1 minute', ms: 60_000 },
  { label: '5 minutes', ms: 5 * 60_000 },
  { label: '15 minutes', ms: 15 * 60_000 },
];

const RELOCK_KEY = 'pb_journal_relock_ms';
const DEFAULT_RELOCK_MS = 60_000;

export function getRelockAfterMs(): number {
  try {
    const raw = localStorage.getItem(RELOCK_KEY);
    const ms = raw === null ? DEFAULT_RELOCK_MS : Number(raw);
    return RELOCK_OPTIONS.some((o) => o.ms === ms) ? ms : DEFAULT_RELOCK_MS;
  } catch {
    return DEFAULT_RELOCK_MS;
  }
}

export function setRelockAfterMs(ms: number): void {
  try {
    localStorage.setItem(RELOCK_KEY, String(ms));
  } catch {
    // Private mode: the default applies.
  }
}

let hiddenAt: number | null = null;
let relockTimer: ReturnType<typeof setTimeout> | null = null;

function clearRelockTimer(): void {
  if (relockTimer) clearTimeout(relockTimer);
  relockTimer = null;
}

/**
 * App.svelte's visibility listener calls this. Leaving the app starts the
 * clock (and saves typing straight away, while there is still time to);
 * coming back after the relock time finds the journal locked.
 */
export function journalLockVisibilityChanged(hidden: boolean): void {
  if (!contentKey) {
    hiddenAt = null;
    return;
  }
  const after = getRelockAfterMs();
  if (hidden) {
    hiddenAt = Date.now();
    if (after === 0) {
      void lockJournal();
      return;
    }
    void runBeforeLockHooks();
    clearRelockTimer();
    relockTimer = setTimeout(() => {
      if (document.hidden) void lockJournal();
    }, after);
  } else {
    clearRelockTimer();
    const away = hiddenAt === null ? 0 : Date.now() - hiddenAt;
    hiddenAt = null;
    // Typing was already saved on the way out, so drop the key at once
    // rather than show the journal for another moment.
    if (away >= after) dropKey();
  }
}

// ── Adopting lock state ───────────────────────────────────────────────────

async function hasScrambledEntries(): Promise<boolean> {
  const entries = await new IndexedDBJournalStore().getEntries();
  return entries.some((e) => isScrambled(e.title) || isScrambled(e.text));
}

/** Setup and turn-off write the new state here after the cloud accepted it. */
export async function adoptLock(lock: DBJournalLock, slots: DBJournalKeySlot[]): Promise<void> {
  await writeLocalLock(lock);
  await replaceLocalSlots(slots);
  cloudChecked = true;
  if (lock.state === 'off' && slots.length === 0) scrambledSeen = false;
  publish({ userId: lock.userId, mode: lock.state, keyId: lock.keyId, slots });
}

/**
 * What the cloud says, for the signed-in account. `slots` is null when they
 * couldn't be fetched, in which case the device's copies are kept.
 * `fetchedAt` is lockGeneration() from before the fetch; a stale answer is
 * dropped (see withLocalLockChange).
 */
export async function applyRemoteLock(
  userId: string,
  row: any | null,
  slots: DBJournalKeySlot[] | null,
  fetchedAt: number,
): Promise<void> {
  if (localChanges > 0 || fetchedAt !== generation) return;
  const lock = lockFromRow(row, userId);
  const before = get(store);
  const local = before.userId === userId ? before.slots : [];

  let nextSlots = local;
  if (lock.state !== 'off') {
    if (slots) nextSlots = slots;
  } else if (slots) {
    // Lock off. Keep the device's copies only while scrambled text remains
    // here that still needs them.
    if (slots.length > 0) nextSlots = slots;
    else if (local.length > 0 && !(await hasScrambledEntries())) nextSlots = [];
  }

  // The journal is about to disappear behind the lock screen: save typing first.
  const willNeedUnlock = !contentKey && (lock.state !== 'off' || nextSlots.length > 0);
  if (willNeedUnlock && !before.needsUnlock) await runBeforeLockHooks();

  await writeLocalLock(lock);
  await replaceLocalSlots(nextSlots);
  cloudChecked = true;
  if (lock.state === 'off' && nextSlots.length === 0) scrambledSeen = false;

  // The lock was turned off and on again elsewhere: the key in memory is stale.
  if (contentKey && lock.state !== 'off' && lock.keyId && unlockedKeyId !== lock.keyId) {
    await runBeforeLockHooks();
    dropKey();
  }

  publish({ userId, mode: lock.state, keyId: lock.keyId, slots: nextSlots });

  // Turned on or off elsewhere while this device holds the key: bring this
  // device's copies in line.
  if (contentKey && before.mode !== lock.state) fire(lockChangedHooks, 'lock-changed');
}

/**
 * With the lock off, the device keeps its key slots only while scrambled
 * text remains here. Called after unscrambled entries arrive from the cloud,
 * and after this device's own unscramble pass.
 */
export async function releaseSlotsIfDone(): Promise<void> {
  const view = get(store);
  if (view.mode !== 'off' || view.slots.length === 0) return;
  if (await hasScrambledEntries()) return;
  await replaceLocalSlots([]);
  scrambledSeen = false;
  publish({ slots: [] });
}

async function loadLocal(): Promise<void> {
  try {
    const [lock, slots] = await Promise.all([readLocalLock(), readLocalSlots()]);
    const mine = lock ? slots.filter((s) => s.userId === lock.userId) : slots;
    publish({
      ready: true,
      userId: lock?.userId ?? null,
      mode: lock?.state ?? 'off',
      keyId: lock?.keyId ?? null,
      slots: mine,
    });
  } catch (err) {
    console.error('[JournalLock] Could not read the lock from this device:', err);
    publish({ ready: true });
  }
}

if (typeof window !== 'undefined') void loadLocal();
