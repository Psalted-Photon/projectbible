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

/**
 * Which account the pending queue was built for. Read before every upload pass
 * to stop one account's un-uploaded work being written to another's rows.
 */
const QUEUE_OWNER_KEY = 'projectbible_queue_owner';

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
      // Nothing goes up until the queue is known to belong to the account that
      // is signed in now. Every upload path reaches Supabase through here.
      if (!(await this.guardOwnership())) {
        return { success: 0, failed: 0 };
      }

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

  /**
   * Refuse to upload one account's work to another account.
   *
   * Nothing in the local stores records who wrote a row, and the queue is kept
   * across sign-out on purpose so work in flight is not lost. But executeOperation
   * stamps `user_id` from whoever is signed in at the moment it runs, not from
   * whoever made the change — so a queue left behind by account A would be
   * written to the server as account B's data, and there is no getting it back.
   *
   * So the device remembers which account it was last queueing for. On a match,
   * or on a device that has never queued anything, the pass goes ahead. On a
   * mismatch the queue is dropped: those operations belong to an account that is
   * not here, and the rows they describe are still in the local stores, so
   * signing back into A re-uploads them from there. Dropping is recoverable;
   * uploading to the wrong account is not.
   *
   * Only the queue is touched. Clearing the stores themselves is phase 3.
   *
   * @returns whether this pass may upload.
   */
  private async guardOwnership(): Promise<boolean> {
    let user: any;
    try {
      const { data } = await supabase.auth.getUser();
      user = data.user;
    } catch (err: any) {
      // Supabase aborts auth requests on tab-visibility changes. Transient —
      // leave the queue alone and let the next pass decide.
      if (err?.name === 'AbortError') return false;
      throw err;
    }
    // Signed out. processItem would skip every item anyway; stopping here keeps
    // the queue intact for the next sign-in.
    if (!user) return false;

    if (typeof localStorage === 'undefined') return true;

    let previous: string | null = null;
    try {
      previous = localStorage.getItem(QUEUE_OWNER_KEY);
    } catch {
      // Private mode, or storage blocked. Without a reliable record of the
      // previous account there is no safe way to tell whose queue this is, so
      // drop it rather than risk uploading it to the wrong one.
      await this.clear();
      return false;
    }

    if (previous === user.id) return true;

    if (previous !== null) {
      const dropped = await this.getPendingCount();
      await this.clear();
      console.warn(
        `[SyncQueue] Queue belonged to a different account — dropped ${dropped} pending operation(s) rather than uploading them to ${user.id.slice(0, 8)}...`,
      );
    }
    try {
      localStorage.setItem(QUEUE_OWNER_KEY, user.id);
    } catch {
      // Nothing to do — the next pass takes the unreadable-storage path above.
    }
    // Either the queue was just dropped, or this device has never queued for
    // anyone and there was nothing to protect. Both are safe to continue from.
    return true;
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
          const earlier: Record<string, any> = data;
          data = { ...earlier, ...op.data };
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
          const row = op.data!; // an INSERT always carries its row
          const { error } = await supabase.rpc('upsert_reading_progress', {
            p_id:                  row.id,
            p_user_id:             userId,
            p_plan_id:             row.plan_id,
            p_day_number:          row.day_number,
            p_completed:           row.completed,
            p_created_at:          row.created_at,
            p_completed_at:        row.completed_at ?? null,
            p_started_reading_at:  row.started_reading_at ?? null,
            p_chapters_read:       row.chapters_read,
            p_catch_up_adjustment: row.catch_up_adjustment ?? null,
            p_updated_at:          row.updated_at,
            p_harmony_sections:    row.harmony_sections ?? null,
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
