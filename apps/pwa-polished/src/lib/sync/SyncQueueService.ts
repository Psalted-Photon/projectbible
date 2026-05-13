/**
 * SyncQueueService - Manages offline write queue
 * 
 * Writes are queued to IndexedDB when made, then processed
 * when online. Failed operations are retried with exponential backoff.
 */

import { openDB, writeTransaction } from '../../adapters/db';
import type { DBSyncQueueItem } from '../../adapters/db';
import { supabase } from '../supabase/client';
import type { SyncOperation } from './types';

const MAX_RETRIES = 5;

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
   * Process all pending operations
   */
  async processQueue(): Promise<{ success: number; failed: number }> {
    if (this.processing || !navigator.onLine) {
      return { success: 0, failed: 0 };
    }
    
    this.processing = true;
    let success = 0;
    let failed = 0;
    
    try {
      // Drain loop: keep processing until no pending items remain.
      // Items enqueued while a previous batch is in-flight are handled here
      // instead of being silently dropped until the next external trigger.
      let batch = await this.getPendingItems();
      console.log(`[SyncQueue] processQueue start: ${batch.length} pending items`);
      while (batch.length > 0) {
        for (const item of batch) {
          const ok = await this.processItem(item);
          if (ok) success++;
          else failed++;
        }
        batch = await this.getPendingItems();
      }
      console.log(`[SyncQueue] processQueue done: ${success} succeeded, ${failed} failed`);
      
      this.notifyListeners();
    } finally {
      this.processing = false;
    }
    
    return { success, failed };
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
  
  private async getPendingItems(): Promise<DBSyncQueueItem[]> {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('sync_queue', 'readonly');
      const store = tx.objectStore('sync_queue');
      const index = store.index('status');
      const request = index.getAll('pending');
      request.onsuccess = () => resolve(request.result || []);
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
        // No explicit onConflict — PostgREST resolves conflicts via the table's primary key.
        // Using onConflict: 'id,user_id' requires a named unique index separate from the PK
        // which not all tables have, causing "no unique constraint" errors.
        const { error } = await supabase
          .from(op.table)
          .upsert({ ...op.data, user_id: userId });
        if (error) throw error;
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
