/**
 * SyncedJournalStore - Journal store with cloud sync
 * 
 * Wraps IndexedDB operations with:
 * - Queue sync operations for upload
 * - Apply remote changes from Realtime
 * - Conflict resolution using timestamps
 * - The journal lock: while it's on, titles and text are scrambled before
 *   they're saved on the device or queued for upload, and unscrambled on
 *   read. Remote rows pass through still scrambled, so sync works while locked.
 */

import type { JournalStore, JournalEntry } from '@projectbible/core';
import { IndexedDBJournalStore } from './JournalStore';
import { syncQueue } from '../lib/sync/SyncQueueService';
import { realtimeService } from '../lib/sync/RealtimeService';
import { shouldApplyRemoteChange, nowISO } from '../lib/sync/conflictResolver';
import { reconcileDeletedRows } from '../lib/sync/reconcileDeletes';
import { generateId, openDB, writeTransaction } from './db';
import type { DBJournalEntry } from './db';
import { releaseSlotsIfDone, scramblesWrites } from '../lib/journalLock/lockState';
import {
  entryIsScrambled, JournalLockedError, openEntry, sealFields, type OpenedJournalEntry,
} from '../lib/journalLock/entryCrypto';
import '../lib/journalLock/sync';

/**
 * Lightweight event emitter — fires when a remote journal change is applied.
 * Components call subscribeToJournalRemoteChanges() to react without needing svelte/store here.
 */
const journalChangeListeners = new Set<() => void>();

export function subscribeToJournalRemoteChanges(fn: () => void): () => void {
  journalChangeListeners.add(fn);
  return () => journalChangeListeners.delete(fn);
}

/**
 * Apply remote journal entries to local IndexedDB
 * Called by SyncService on initial pull
 */
export async function applyRemoteJournalEntries(
  rows: any[],
  opts: { fullPull?: boolean } = {},
): Promise<void> {
  await applyRows(rows, opts);
  // The lock was turned off elsewhere and the readable copies just arrived:
  // this device no longer needs its key slots.
  await releaseSlotsIfDone().catch(() => {});
}

async function applyRows(rows: any[], opts: { fullPull?: boolean }): Promise<void> {
  // Full pulls only: remove entries deleted on another device while this one
  // was offline (pending un-uploaded entries are protected inside).
  if (opts.fullPull) {
    await reconcileDeletedRows('journal_entries', rows);
  }
  if (!rows || rows.length === 0) return;
  const db = await openDB();
  for (const row of rows) {
    // Each lookup uses its own readonly transaction to avoid TransactionInactiveError.

    // 1. Look up the local entry that shares this remote row's ID.
    const local = await new Promise<DBJournalEntry | undefined>((resolve) => {
      const tx = db.transaction('journal_entries', 'readonly');
      const req = tx.objectStore('journal_entries').get(row.id);
      req.onsuccess = () => resolve(req.result as DBJournalEntry | undefined);
      req.onerror = () => resolve(undefined);
    });

    // 2. Look up any existing entry that already occupies this date (different ID).
    //    The 'date' index has unique:true, so a collision with a different id would
    //    cause a ConstraintError on put(). We resolve it here instead.
    const dateConflict = await new Promise<DBJournalEntry | undefined>((resolve) => {
      const tx = db.transaction('journal_entries', 'readonly');
      const req = tx.objectStore('journal_entries').index('date').get(row.date);
      req.onsuccess = () => {
        const found = req.result as DBJournalEntry | undefined;
        // Only a conflict if it's a different id (same id is just an update)
        resolve(found && found.id !== row.id ? found : undefined);
      };
      req.onerror = () => resolve(undefined);
    });

    if (dateConflict) {
      // A different local entry already occupies this date. Resolve by timestamp.
      if (shouldApplyRemoteChange(dateConflict.updatedAt, row.updated_at)) {
        // Remote row is newer — delete the conflicting local entry first, then write remote.
        // Also enqueue a DELETE so the losing local entry (which was previously uploaded)
        // gets removed from Supabase.
        console.warn(`[SyncedJournal] Date conflict on ${row.date}: replacing local id ${dateConflict.id} with remote id ${row.id}`);
        await writeTransaction('journal_entries', (store) => store.delete(dateConflict.id));
        await writeTransaction('journal_entries', (store) => store.put({
          id: row.id,
          date: row.date,
          title: row.title,
          text: row.text,
          createdAt: new Date(row.created_at).getTime(),
          updatedAt: new Date(row.updated_at).getTime(),
        }));
        // Clean up the losing entry from Supabase
        syncQueue.enqueue({ type: 'DELETE', table: 'journal_entries', id: dateConflict.id });
      } else {
        // Local entry is newer — skip the remote row and delete the losing remote entry from Supabase.
        console.warn(`[SyncedJournal] Date conflict on ${row.date}: keeping local id ${dateConflict.id}, deleting remote id ${row.id}`);
        syncQueue.enqueue({ type: 'DELETE', table: 'journal_entries', id: row.id });
      }
      continue;
    }

    // No date collision — normal upsert path.
    if (!local || shouldApplyRemoteChange(local.updatedAt, row.updated_at)) {
      await writeTransaction('journal_entries', (store) => store.put({
        id: row.id,
        date: row.date,
        title: row.title,
        text: row.text,
        createdAt: new Date(row.created_at).getTime(),
        updatedAt: new Date(row.updated_at).getTime(),
      }));
    }
  }
}

/**
 * Synced JournalStore implementation
 */
export class SyncedJournalStore implements JournalStore {
  private local = new IndexedDBJournalStore();
  private unsubscribes: (() => void)[] = [];
  private initialized = false;
  
  /**
   * Initialize realtime subscriptions
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;
    this.initialized = true;
    
    // Subscribe to remote changes
    this.unsubscribes.push(
      realtimeService.onTableChange('journal_entries', async (change) => {
        if (change.eventType === 'DELETE' && change.old?.id) {
          await this.local.deleteEntry(change.old.id);
        } else if (change.new) {
          await applyRemoteJournalEntries([change.new]);
        }
        // Notify any subscribed components to re-load
        journalChangeListeners.forEach(fn => fn());
      })
    );
  }
  
  /**
   * Cleanup subscriptions
   */
  dispose(): void {
    this.unsubscribes.forEach(fn => fn());
    this.unsubscribes = [];
    this.initialized = false;
  }
  
  // ========== JournalStore Interface ==========
  
  /**
   * Entries come back unscrambled. While the journal is locked, scrambled
   * ones come back empty and marked `locked`; one the key can't open comes
   * back empty and marked `unreadable`.
   */
  async getEntries(startDate?: string, endDate?: string): Promise<OpenedJournalEntry[]> {
    const entries = await this.local.getEntries(startDate, endDate);
    return Promise.all(entries.map(openEntry));
  }
  
  async getEntryByDate(date: string): Promise<OpenedJournalEntry | null> {
    const entry = await this.local.getEntryByDate(date);
    return entry ? openEntry(entry) : null;
  }
  
  async saveEntry(entry: Omit<JournalEntry, 'id' | 'createdAt' | 'updatedAt'>): Promise<JournalEntry> {
    // The id comes first: a scrambled field is tied to its entry's id.
    const id = generateId();
    const stored = scramblesWrites()
      ? await sealFields(id, entry.date, entry.title, entry.text)
      : { title: entry.title, text: entry.text };

    // 1. Save locally
    const saved = await this.local.saveEntry({ date: entry.date, title: stored.title, text: stored.text }, id);

    // 2. Queue for sync
    await syncQueue.enqueue({
      type: 'INSERT',
      table: 'journal_entries',
      id: saved.id,
      data: {
        id: saved.id,
        date: entry.date,
        title: stored.title || null,
        text: stored.text,
        created_at: saved.createdAt.toISOString(),
        updated_at: saved.updatedAt.toISOString(),
      },
    });
    
    return { ...saved, title: entry.title, text: entry.text };
  }
  
  async updateEntry(
    id: string, 
    updates: { title?: string; text?: string }
  ): Promise<void> {
    // With the lock involved, title and text are rewritten as a pair, so an
    // entry is never left half scrambled and half readable.
    const current = await this.local.getEntryById(id);
    if (current && (scramblesWrites() || entryIsScrambled(current))) {
      const opened = await openEntry(current);
      if (opened.locked) throw new JournalLockedError();
      if (opened.unreadable) throw new Error(`Journal entry ${id} couldn't be opened, so it wasn't saved over`);

      const title = updates.title !== undefined ? updates.title : opened.title;
      const text = updates.text !== undefined ? updates.text : opened.text;
      const stored = scramblesWrites()
        ? await sealFields(id, current.date, title, text)
        : { title: title || undefined, text };
      const updatedAt = Date.now();

      await this.local.replaceFields(id, { title: stored.title, text: stored.text, updatedAt });
      await syncQueue.enqueue({
        type: 'UPDATE',
        table: 'journal_entries',
        id,
        data: { title: stored.title ?? null, text: stored.text, updated_at: new Date(updatedAt).toISOString() },
      });
      return;
    }

    // 1. Update locally
    await this.local.updateEntry(id, updates);
    
    // 2. Queue for sync (only sync title and text)
    const syncData: Record<string, any> = { updated_at: nowISO() };
    if (updates.title !== undefined) syncData.title = updates.title;
    if (updates.text !== undefined) syncData.text = updates.text;
    
    await syncQueue.enqueue({
      type: 'UPDATE',
      table: 'journal_entries',
      id,
      data: syncData,
    });
  }
  
  async deleteEntry(id: string): Promise<void> {
    // 1. Delete locally
    await this.local.deleteEntry(id);
    
    // 2. Queue for sync
    await syncQueue.enqueue({
      type: 'DELETE',
      table: 'journal_entries',
      id,
    });
  }
  
  async getDateRange(): Promise<{ oldest: string | null; newest: string | null }> {
    return this.local.getDateRange();
  }
}

/**
 * Singleton instance — import this instead of creating new SyncedJournalStore().
 * Registers itself with SyncService so initialize()/dispose() are called automatically.
 */
export const syncedJournalStore = new SyncedJournalStore();

// Self-register with SyncService so no circular imports are needed in SyncService.
import { syncService } from '../lib/sync/SyncService';
syncService.registerSyncStore(syncedJournalStore);
syncService.registerApplyFn('journal_entries', (rows) => applyRemoteJournalEntries(rows, { fullPull: true }));
