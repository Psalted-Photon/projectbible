/**
 * SyncedJournalStore - Journal store with cloud sync
 * 
 * Wraps IndexedDB operations with:
 * - Queue sync operations for upload
 * - Apply remote changes from Realtime
 * - Conflict resolution using timestamps
 */

import type { JournalStore, JournalEntry } from '@projectbible/core';
import { IndexedDBJournalStore } from './JournalStore';
import { syncQueue } from '../lib/sync/SyncQueueService';
import { realtimeService } from '../lib/sync/RealtimeService';
import { shouldApplyRemoteChange, nowISO } from '../lib/sync/conflictResolver';
import { openDB, writeTransaction } from './db';
import type { DBJournalEntry } from './db';

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
export async function applyRemoteJournalEntries(rows: any[]): Promise<void> {
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
        console.warn(`[SyncedJournal] Date conflict on ${row.date}: replacing local id ${dateConflict.id} with remote id ${row.id}`);
        await writeTransaction('journal_entries', (store) => store.delete(dateConflict.id));
        await writeTransaction('journal_entries', (store) => store.put({
          id: row.id,
          date: row.date,
          title: row.title,
          text: row.text,
          textLinkified: dateConflict.textLinkified,
          createdAt: new Date(row.created_at).getTime(),
          updatedAt: new Date(row.updated_at).getTime(),
        }));
      } else {
        // Local entry is newer — skip the remote row.
        console.warn(`[SyncedJournal] Date conflict on ${row.date}: keeping local id ${dateConflict.id}, skipping remote id ${row.id}`);
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
        // textLinkified is display-only, derived locally — preserve if we have it
        textLinkified: local?.textLinkified,
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
  
  async getEntries(startDate?: string, endDate?: string): Promise<JournalEntry[]> {
    return this.local.getEntries(startDate, endDate);
  }
  
  async getEntryByDate(date: string): Promise<JournalEntry | null> {
    return this.local.getEntryByDate(date);
  }
  
  async saveEntry(entry: Omit<JournalEntry, 'id' | 'createdAt' | 'updatedAt'>): Promise<JournalEntry> {
    // 1. Save locally
    const saved = await this.local.saveEntry(entry);
    
    // 2. Queue for sync (don't send textLinkified - it's display-only)
    await syncQueue.enqueue({
      type: 'INSERT',
      table: 'journal_entries',
      id: saved.id,
      data: {
        id: saved.id,
        date: entry.date,
        title: entry.title || null,
        text: entry.text,
        created_at: saved.createdAt.toISOString(),
        updated_at: saved.updatedAt.toISOString(),
      },
    });
    
    return saved;
  }
  
  async updateEntry(
    id: string, 
    updates: { title?: string; text?: string; textLinkified?: string }
  ): Promise<void> {
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
syncService.registerApplyFn('journal_entries', applyRemoteJournalEntries);
