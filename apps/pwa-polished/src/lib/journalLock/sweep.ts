/**
 * The sweep: brings every journal entry on this device in line with the lock.
 *
 * While the lock is on it scrambles anything still readable — entries left
 * over from a setup that was interrupted, or written by an old app version or
 * before this device heard the lock had turned on. While it's off or turning
 * off it unscrambles instead. Each changed entry is saved on the device and
 * queued for upload as a whole row.
 *
 * Runs after every unlock, and on demand from setup and turn-off (which wait
 * for it). Only one pass runs at a time; a request made during a pass gets
 * one more pass straight after.
 */

import type { DBSyncQueueItem } from '../../adapters/db';
import { openDB, writeTransaction } from '../../adapters/db';
import { IndexedDBJournalStore } from '../../adapters/JournalStore';
import type { JournalEntry } from '@projectbible/core';
import { syncQueue } from '../sync/SyncQueueService';
import type { SyncOperation } from '../sync/types';
import { isScrambled } from './crypto';
import { entryIsScrambled, openEntry, sealFields } from './entryCrypto';
import {
  currentLockView, getContentKey, onLockChangedWhileUnlocked, onUnlocked, releaseSlotsIfDone, setJournalWork,
} from './lockState';

export interface SweepResult {
  target: 'scrambled' | 'readable';
  changed: number;
  /** Entries the key couldn't open; left exactly as they were. */
  failed: number;
}

const local = new IndexedDBJournalStore();

function hasReadableText(entry: { title?: string | null; text?: string | null }): boolean {
  return (!!entry.title && !isScrambled(entry.title)) || (!!entry.text && !isScrambled(entry.text));
}

function targetFor(mode: string): SweepResult['target'] {
  return mode === 'on' ? 'scrambled' : 'readable';
}

function uploadRow(entry: JournalEntry, title: string | undefined, text: string, updatedAt: number): SyncOperation {
  return {
    type: 'INSERT',
    table: 'journal_entries',
    id: entry.id,
    data: {
      id: entry.id,
      date: entry.date,
      title: title ?? null,
      text,
      created_at: entry.createdAt.toISOString(),
      updated_at: new Date(updatedAt).toISOString(),
    },
  };
}

/**
 * Readable journal text still waiting in the upload queue — written offline,
 * or before this device heard the lock turned on — would be refused by the
 * cloud and sits on the device in the clear. Replace each such upload with
 * the entry's scrambled row.
 */
async function scrubReadableUploads(): Promise<void> {
  const db = await openDB();
  const items = await new Promise<DBSyncQueueItem[]>((resolve) => {
    const req = db.transaction('sync_queue', 'readonly').objectStore('sync_queue').getAll();
    req.onsuccess = () => resolve((req.result as DBSyncQueueItem[]) ?? []);
    req.onerror = () => resolve([]);
  });

  const leaky = items.filter((item) => {
    const op = item.payload as SyncOperation;
    return op?.table === 'journal_entries' && op.type !== 'DELETE' && !!op.data && hasReadableText(op.data);
  });
  if (leaky.length === 0) return;

  const ids = new Set(leaky.map((item) => (item.payload as SyncOperation).id));
  for (const item of leaky) {
    await writeTransaction('sync_queue', (store) => store.delete(item.id));
  }
  for (const id of ids) {
    const entry = await local.getEntryById(id);
    if (!entry || !entryIsScrambled(entry)) continue;
    await syncQueue.enqueue(uploadRow(entry, entry.title, entry.text, entry.updatedAt.getTime()));
  }
  console.log(`[JournalLock] Replaced ${leaky.length} readable journal upload(s) with scrambled ones`);
}

async function runSweep(): Promise<SweepResult> {
  const target = targetFor(currentLockView().mode);
  const result: SweepResult = { target, changed: 0, failed: 0 };
  if (!getContentKey()) return result;

  const entries = await local.getEntries();
  const todo = entries.filter((e) => (target === 'scrambled' ? hasReadableText(e) : entryIsScrambled(e)));

  if (todo.length > 0) {
    setJournalWork({ kind: target === 'scrambled' ? 'scramble' : 'unscramble', done: 0, total: todo.length });
  }
  try {
    for (const entry of todo) {
      // Locked, or the lock changed direction elsewhere: stop cleanly. The
      // next unlock picks up where this left off.
      if (!getContentKey() || targetFor(currentLockView().mode) !== target) break;

      const opened = await openEntry(entry);
      if (opened.locked || opened.unreadable) {
        result.failed++;
      } else {
        const stored = target === 'scrambled'
          ? await sealFields(entry.id, entry.date, opened.title, opened.text)
          : { title: opened.title || undefined, text: opened.text };
        const updatedAt = Date.now();
        await local.replaceFields(entry.id, { title: stored.title, text: stored.text, updatedAt });
        await syncQueue.enqueue(uploadRow(entry, stored.title, stored.text, updatedAt));
        result.changed++;
      }
      setJournalWork({
        kind: target === 'scrambled' ? 'scramble' : 'unscramble',
        done: result.changed + result.failed,
        total: todo.length,
      });
    }

    if (target === 'scrambled' && getContentKey()) await scrubReadableUploads();
  } finally {
    setJournalWork(null);
  }

  if (result.changed > 0) {
    console.log(`[JournalLock] ${target === 'scrambled' ? 'Scrambled' : 'Unscrambled'} ${result.changed} journal entr${result.changed === 1 ? 'y' : 'ies'}`);
    void syncQueue.processQueue();
  }

  // Lock fully off and nothing scrambled left here: the device's copies of
  // the key slots have done their job.
  if (result.failed === 0) await releaseSlotsIfDone();

  return result;
}

let running: Promise<SweepResult> | null = null;
let queued: Promise<SweepResult> | null = null;

export function sweepJournal(): Promise<SweepResult> {
  if (!running) {
    running = runSweep().finally(() => {
      running = null;
    });
    return running;
  }
  if (!queued) {
    queued = running
      .catch(() => undefined)
      .then(() => {
        queued = null;
        return sweepJournal();
      });
  }
  return queued;
}

function sweepInBackground(): void {
  sweepJournal().catch((err) => console.error('[JournalLock] Sweep failed:', err));
}

onUnlocked(sweepInBackground);
onLockChangedWhileUnlocked(sweepInBackground);
