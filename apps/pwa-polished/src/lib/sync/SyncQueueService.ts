/**
 * SyncQueueService - Manages offline write queue
 *
 * Writes are queued to IndexedDB when made, then processed when online.
 * The drain runs oldest-first, coalesces every queued op for the same row
 * into one equivalent upload, and retries failures with exponential backoff
 * (5s doubling per attempt, capped at 15 minutes).
 */

import { openDB, writeTransaction } from '../../adapters/db';
import type { DBSyncQueueItem } from '../../adapters/db';
import { supabase } from '../supabase/client';
import type { SyncOperation } from './types';

const MAX_RETRIES = 5;
const RETRY_BASE_MS = 5_000;
const RETRY_MAX_MS = 15 * 60_000;

type QueueListener = (pendingCount: number) => void;

class SyncQueueService {
  private processing = false;
  private listeners: Set<QueueListener> = new Set();
  
  /**
   * Add an operation to the sync queue
   */
  async enqueue(operation: SyncOperation): Promise<void> {
    const item: DBSyncQueueItem = {
      id: crypto.randomUUID(),
      type: operation.type,
      payload: operation,
      operationId: crypto.randomUUID(),
      priority: 1,
      createdAt: Date.now(),
      attempts: 0,
      lastAttemptAt: null,
      status: 'pending',
    };
    
    await writeTransaction('sync_queue', (store) => store.add(item));
    this.notifyListeners();
    
    // Try to process immediately if online
    if (navigator.onLine) {
      this.processQueue();
    }
  }
  
  /**
   * Process all pending operations: oldest-first, one coalesced upload per
   * row, backoff-respecting. Each row is attempted at most once per call so
   * an item that can't be delivered (no auth, transient abort) can never
   * spin the drain loop; items enqueued mid-drain are still picked up.
   */
  async processQueue(): Promise<{ success: number; failed: number }> {
    if (this.processing || !navigator.onLine) {
      return { success: 0, failed: 0 };
    }

    this.processing = true;
    let success = 0;
    let failed = 0;

    try {
      const attemptedKeys = new Set<string>();
      for (;;) {
        const pending = await this.getPendingItems();

        // Group every pending op by row, oldest first within each group
        const groups = new Map<string, DBSyncQueueItem[]>();
        for (const item of pending) {
          const op = item.payload as SyncOperation;
          const key = `${op.table}::${op.id}`;
          if (!groups.has(key)) groups.set(key, []);
          groups.get(key)!.push(item);
        }

        const todo = Array.from(groups.entries()).filter(([key, ops]) =>
          !attemptedKeys.has(key) && ops.some((o) => this.isReadyForRetry(o)));
        if (todo.length === 0) break;

        for (const [key, ops] of todo) {
          attemptedKeys.add(key);
          ops.sort((a, b) => a.createdAt - b.createdAt);

          const carrier = await this.coalesce(key, ops);
          const ok = await this.processItem(carrier);
          if (ok) success++;
          else failed++;
        }
      }
      if (success + failed > 0) {
        console.log(`[SyncQueue] processQueue done: ${success} succeeded, ${failed} failed`);
      }

      this.notifyListeners();
    } finally {
      this.processing = false;
    }

    return { success, failed };
  }

  /** Has this item's backoff window elapsed? Fresh items are always ready. */
  private isReadyForRetry(item: DBSyncQueueItem): boolean {
    if (!item.lastAttemptAt || item.attempts === 0) return true;
    const delay = Math.min(2 ** item.attempts * RETRY_BASE_MS, RETRY_MAX_MS);
    return Date.now() - item.lastAttemptAt >= delay;
  }

  /**
   * Collapse all queued ops for one row into a single equivalent op carried
   * by the newest queue item; superseded items are removed from the store.
   *
   * INSERTs are full-row upserts, so a later INSERT replaces an earlier one.
   * UPDATEs carry partial columns, so they merge over what came before —
   * folding an UPDATE into a pending INSERT keeps the full row intact (an
   * UPDATE alone would silently no-op if the row never reached the server).
   * A DELETE supersedes everything before it; an INSERT after a DELETE
   * recreates the row, so the upsert alone expresses the final state.
   */
  private async coalesce(key: string, ops: DBSyncQueueItem[]): Promise<DBSyncQueueItem> {
    const carrier = ops[ops.length - 1];
    if (ops.length === 1) return carrier;

    let type: SyncOperation['type'] | null = null;
    let data: Record<string, any> | null = null;
    for (const item of ops) {
      const op = item.payload as SyncOperation;
      if (op.type === 'DELETE') {
        type = 'DELETE';
        data = null;
      } else if (op.type === 'INSERT') {
        type = 'INSERT';
        data = { ...op.data };
      } else { // UPDATE
        if (type === 'DELETE') continue; // row is gone — nothing to update
        if (data) {
          data = { ...data, ...op.data };
        } else {
          type = 'UPDATE';
          data = { ...op.data };
        }
      }
    }

    const lastOp = carrier.payload as SyncOperation;
    const merged: SyncOperation = { type: type!, table: lastOp.table, id: lastOp.id, data: data ?? undefined } as SyncOperation;

    for (const superseded of ops.slice(0, -1)) {
      await writeTransaction('sync_queue', (store) => store.delete(superseded.id));
    }
    carrier.payload = merged;
    carrier.type = merged.type;
    await writeTransaction('sync_queue', (store) => store.put(carrier));
    console.log(`[SyncQueue] Coalesced ${ops.length} ops → 1 ${merged.type} for ${key}`);
    return carrier;
  }
  
  /**
   * Get count of pending items
   */
  async getPendingCount(): Promise<number> {
    const items = await this.getPendingItems();
    return items.length;
  }
  
  /**
   * Subscribe to queue changes
   */
  subscribe(listener: QueueListener): () => void {
    this.listeners.add(listener);
    // Notify immediately with current count
    this.getPendingCount().then(count => listener(count));
    return () => this.listeners.delete(listener);
  }
  
  /**
   * Reset all permanently-failed items back to 'pending' so they are retried.
   * Called on sign-in to recover items that failed due to transient errors
   * (e.g. wrong column type in a previous app version).
   */
  async resetFailed(): Promise<void> {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('sync_queue', 'readwrite');
      const store = tx.objectStore('sync_queue');
      const index = store.index('status');
      const req = index.openCursor('failed');
      req.onsuccess = () => {
        const cursor = req.result;
        if (cursor) {
          const item = cursor.value;
          item.status = 'pending';
          item.attempts = 0;
          item.lastError = undefined;
          // Fix legacy reading_progress items that stored raw epoch-ms numbers
          // in TIMESTAMPTZ columns — convert them to ISO strings so Postgres
          // accepts them instead of throwing "date/time field value out of range".
          if (item.payload?.table === 'reading_progress' && item.payload?.data) {
            const d = item.payload.data;
            const msToIso = (v: any): string | null =>
              v != null && typeof v === 'number' && v > 0
                ? new Date(v).toISOString()
                : (typeof v === 'string' && v.length > 0 ? v : null);
            if (typeof d.created_at === 'number') d.created_at = msToIso(d.created_at) ?? new Date().toISOString();
            if (typeof d.completed_at === 'number') d.completed_at = msToIso(d.completed_at);
            if (typeof d.started_reading_at === 'number') d.started_reading_at = msToIso(d.started_reading_at);
            item.payload.data = d;
          }
          cursor.update(item);
          cursor.continue();
        } else {
          this.notifyListeners();
          resolve();
        }
      };
      req.onerror = () => reject(req.error);
    });
  }

  /**
   * Clear all pending operations (on sign out)
   */
  async clear(): Promise<void> {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('sync_queue', 'readwrite');
      const store = tx.objectStore('sync_queue');
      const request = store.clear();
      request.onsuccess = () => {
        this.notifyListeners();
        resolve();
      };
      request.onerror = () => reject(request.error);
    });
  }
  
  /**
   * IDs of rows in `table` that still have un-uploaded INSERT/UPDATE ops.
   * Pull-side reconciliation uses this so a locally-created item that hasn't
   * reached Supabase yet is never mistaken for one deleted remotely.
   */
  async getPendingIdsFor(table: string): Promise<Set<string>> {
    const items = await this.getPendingItems();
    const ids = new Set<string>();
    for (const item of items) {
      const op = item.payload as SyncOperation;
      if (op?.table === table && op.type !== 'DELETE') ids.add(op.id);
    }
    return ids;
  }

  private async getPendingItems(): Promise<DBSyncQueueItem[]> {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('sync_queue', 'readonly');
      const store = tx.objectStore('sync_queue');
      const index = store.index('status');
      const request = index.getAll('pending');
      // Oldest-first: the store key is a random UUID, so getAll order is
      // effectively arbitrary — creation order is what uploads must follow.
      request.onsuccess = () =>
        resolve((request.result || []).sort((a: DBSyncQueueItem, b: DBSyncQueueItem) => a.createdAt - b.createdAt));
      request.onerror = () => reject(request.error);
    });
  }
  
  private async processItem(item: DBSyncQueueItem): Promise<boolean> {
    let user: any;
    try {
      const { data } = await supabase.auth.getUser();
      user = data.user;
    } catch (err: any) {
      // Supabase aborts auth requests when the tab visibility changes.
      // Treat as transient — leave item 'pending' for the next retry.
      if (err?.name === 'AbortError') return false;
      throw err;
    }
    if (!user) {
      console.warn('[SyncQueue] No authenticated user, skipping');
      return false;
    }
    
    const op = item.payload as SyncOperation;
    
    try {
      await this.executeOperation(op, user.id);
      
      // Success - delete from queue
      await writeTransaction('sync_queue', (store) => store.delete(item.id));
      const dataPreview = op.table === 'reading_progress'
        ? ` day=${op.data?.day_number} completed=${op.data?.completed}`
        : '';
      console.log(`[SyncQueue] ✓ ${op.type} ${op.table} ${op.id}${dataPreview}`);
      return true;
      
    } catch (error: any) {
      console.error(`[SyncQueue] ✗ ${op.type} ${op.table} ${op.id}:`, error.message);
      
      // Update item with failure info
      item.attempts++;
      item.lastAttemptAt = Date.now();
      item.lastError = error.message;
      
      if (item.attempts >= MAX_RETRIES) {
        item.status = 'failed';
        console.error(`[SyncQueue] Max retries reached for ${op.id}`);
      }
      
      await writeTransaction('sync_queue', (store) => store.put(item));
      return false;
    }
  }
  
  private async executeOperation(op: SyncOperation, userId: string): Promise<void> {
    switch (op.type) {
      case 'INSERT': {
        if (op.table === 'reading_progress') {
          // Use server-side merge RPC so chapters_read is union-merged rather
          // than overwritten. No progress is ever lost when two devices sync
          // at different times — the Postgres function handles the merge atomically.
          const { error } = await supabase.rpc('upsert_reading_progress', {
            p_id:                  op.data.id,
            p_user_id:             userId,
            p_plan_id:             op.data.plan_id,
            p_day_number:          op.data.day_number,
            p_completed:           op.data.completed,
            p_created_at:          op.data.created_at,
            p_completed_at:        op.data.completed_at ?? null,
            p_started_reading_at:  op.data.started_reading_at ?? null,
            p_chapters_read:       op.data.chapters_read,
            p_catch_up_adjustment: op.data.catch_up_adjustment ?? null,
            p_updated_at:          op.data.updated_at,
            p_harmony_sections:    op.data.harmony_sections ?? null,
          });
          if (error) throw error;
        } else {
          // No explicit onConflict — PostgREST resolves conflicts via the table's primary key.
          // Using onConflict: 'id,user_id' requires a named unique index separate from the PK
          // which not all tables have, causing "no unique constraint" errors.
          const { error } = await supabase
            .from(op.table)
            .upsert({ ...op.data, user_id: userId });
          if (error) throw error;
        }
        break;
      }
      
      case 'UPDATE': {
        const { error } = await supabase
          .from(op.table)
          .update(op.data)
          .eq('id', op.id)
          .eq('user_id', userId);
        if (error) throw error;
        break;
      }
      
      case 'DELETE': {
        const { error } = await supabase
          .from(op.table)
          .delete()
          .eq('id', op.id)
          .eq('user_id', userId);
        if (error) throw error;
        break;
      }
    }
  }
  
  private async notifyListeners(): Promise<void> {
    const count = await this.getPendingCount();
    for (const listener of this.listeners) {
      listener(count);
    }
  }
}

export const syncQueue = new SyncQueueService();
