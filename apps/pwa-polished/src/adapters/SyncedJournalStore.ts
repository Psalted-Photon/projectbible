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
import { openDB } from './db';
import type { DBJournalEntry } from './db';
import { writable } from 'svelte/store';

/**
 * Svelte store that increments whenever a remote journal change is applied.
 * Components subscribe to re-load entries from IndexedDB when this fires.
 */
export const journalRemoteChanges = writable(0);

/**
 * Apply remote journal entries to local IndexedDB
 * Called by SyncService on initial pull
 */
export async function applyRemoteJournalEntries(rows: any[]): Promise<void> {
  const db = await openDB();
  const tx = db.transaction('journal_entries', 'readwrite');
  const store = tx.objectStore('journal_entries');
  
  for (const row of rows) {
    const localReq = store.get(row.id);
    await new Promise<void>((resolve) => {
      localReq.onsuccess = () => {
        const local = localReq.result as DBJournalEntry | undefined;
        if (!local || shouldApplyRemoteChange(local.updatedAt, row.updated_at)) {
          store.put({
            id: row.id,
            date: row.date,
            title: row.title,
            text: row.text,
            // Note: textLinkified is display-only, derived locally
            textLinkified: local?.textLinkified,
            createdAt: new Date(row.created_at).getTime(),
            updatedAt: new Date(row.updated_at).getTime(),
          });
        }
        resolve();
      };
      localReq.onerror = () => resolve();
    });
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
        // Signal Svelte components to re-load
        journalRemoteChanges.update(n => n + 1);
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
 * Call initialize() from SyncService on sign-in; dispose() on sign-out.
 */
export const syncedJournalStore = new SyncedJournalStore();
