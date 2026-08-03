/**
 * SyncedNotebookStore - Notebook store with cloud sync
 *
 * Wraps IndexedDB operations with:
 * - Queue sync operations for upload
 * - Apply remote changes from Realtime
 * - Conflict resolution using timestamps
 *
 * Same shape as SyncedJournalStore, minus the date-uniqueness resolver — a
 * notebook has no unique column, so remote rows are a plain timestamp upsert.
 */

import { IndexedDBNotebookStore } from './NotebookStore';
import type { Notebook, NotebookPage } from './NotebookStore';
import { syncQueue } from '../lib/sync/SyncQueueService';
import { realtimeService } from '../lib/sync/RealtimeService';
import { shouldApplyRemoteChange, nowISO } from '../lib/sync/conflictResolver';
import { reconcileDeletedRows } from '../lib/sync/reconcileDeletes';
import { openDB, writeTransaction } from './db';
import type { DBNotebook, DBNotebookPage } from './db';

/**
 * Lightweight event emitter — fires when a remote notebook change is applied.
 * Components call subscribeToNotebookRemoteChanges() to react.
 */
const notebookChangeListeners = new Set<() => void>();

export function subscribeToNotebookRemoteChanges(fn: () => void): () => void {
  notebookChangeListeners.add(fn);
  return () => notebookChangeListeners.delete(fn);
}

function getLocalRow<T>(storeName: string, id: string, db: IDBDatabase): Promise<T | undefined> {
  return new Promise((resolve) => {
    const tx = db.transaction(storeName, 'readonly');
    const req = tx.objectStore(storeName).get(id);
    req.onsuccess = () => resolve(req.result as T | undefined);
    req.onerror = () => resolve(undefined);
  });
}

/**
 * Apply remote notebooks to local IndexedDB.
 * Called by SyncService on initial pull and by the Realtime handler.
 */
export async function applyRemoteNotebooks(
  rows: any[],
  opts: { fullPull?: boolean } = {},
): Promise<void> {
  if (opts.fullPull) {
    await reconcileDeletedRows('notebooks', rows);
  }
  if (!rows || rows.length === 0) return;

  const db = await openDB();
  for (const row of rows) {
    const local = await getLocalRow<DBNotebook>('notebooks', row.id, db);
    if (!local || shouldApplyRemoteChange(local.updatedAt, row.updated_at)) {
      await writeTransaction('notebooks', (store) =>
        store.put({
          id: row.id,
          name: row.name ?? '',
          createdAt: new Date(row.created_at).getTime(),
          updatedAt: new Date(row.updated_at).getTime(),
        } satisfies DBNotebook),
      );
    }
  }
}

/**
 * Apply remote notebook pages to local IndexedDB.
 */
export async function applyRemoteNotebookPages(
  rows: any[],
  opts: { fullPull?: boolean } = {},
): Promise<void> {
  if (opts.fullPull) {
    await reconcileDeletedRows('notebook_pages', rows);
  }
  if (!rows || rows.length === 0) return;

  const db = await openDB();
  for (const row of rows) {
    const local = await getLocalRow<DBNotebookPage>('notebook_pages', row.id, db);
    if (!local || shouldApplyRemoteChange(local.updatedAt, row.updated_at)) {
      await writeTransaction('notebook_pages', (store) =>
        store.put({
          id: row.id,
          notebookId: row.notebook_id,
          title: row.title ?? undefined,
          text: row.text ?? '',
          sortOrder: row.sort_order ?? 0,
          createdAt: new Date(row.created_at).getTime(),
          updatedAt: new Date(row.updated_at).getTime(),
        } satisfies DBNotebookPage),
      );
    }
  }
}

/**
 * Synced notebook store implementation
 */
export class SyncedNotebookStore {
  private local = new IndexedDBNotebookStore();
  private unsubscribes: (() => void)[] = [];
  private initialized = false;

  async initialize(): Promise<void> {
    if (this.initialized) return;
    this.initialized = true;

    this.unsubscribes.push(
      realtimeService.onTableChange('notebooks', async (change) => {
        if (change.eventType === 'DELETE' && change.old?.id) {
          await this.local.deleteNotebook(change.old.id);
        } else if (change.new) {
          await applyRemoteNotebooks([change.new]);
        }
        notebookChangeListeners.forEach((fn) => fn());
      }),
    );

    this.unsubscribes.push(
      realtimeService.onTableChange('notebook_pages', async (change) => {
        if (change.eventType === 'DELETE' && change.old?.id) {
          await this.local.deletePage(change.old.id);
        } else if (change.new) {
          await applyRemoteNotebookPages([change.new]);
        }
        notebookChangeListeners.forEach((fn) => fn());
      }),
    );
  }

  dispose(): void {
    this.unsubscribes.forEach((fn) => fn());
    this.unsubscribes = [];
    this.initialized = false;
  }

  // ========== NOTEBOOKS ==========

  async getNotebooks(): Promise<Notebook[]> {
    return this.local.getNotebooks();
  }

  async getNotebook(id: string): Promise<Notebook | null> {
    return this.local.getNotebook(id);
  }

  async createNotebook(name: string): Promise<Notebook> {
    const saved = await this.local.createNotebook(name);

    await syncQueue.enqueue({
      type: 'INSERT',
      table: 'notebooks',
      id: saved.id,
      data: {
        id: saved.id,
        name: saved.name,
        created_at: saved.createdAt.toISOString(),
        updated_at: saved.updatedAt.toISOString(),
      },
    });

    return saved;
  }

  async renameNotebook(id: string, name: string): Promise<void> {
    await this.local.renameNotebook(id, name);

    await syncQueue.enqueue({
      type: 'UPDATE',
      table: 'notebooks',
      id,
      data: { name, updated_at: nowISO() },
    });
  }

  /** Deletes the notebook and every page inside it, locally and remotely. */
  async deleteNotebook(id: string): Promise<void> {
    const pages = await this.local.getPages(id);
    for (const page of pages) {
      await this.deletePage(page.id);
    }

    await this.local.deleteNotebook(id);
    await syncQueue.enqueue({ type: 'DELETE', table: 'notebooks', id });
  }

  // ========== PAGES ==========

  async getPages(notebookId: string): Promise<NotebookPage[]> {
    return this.local.getPages(notebookId);
  }

  async getAllPages(): Promise<NotebookPage[]> {
    return this.local.getAllPages();
  }

  async getPage(id: string): Promise<NotebookPage | null> {
    return this.local.getPage(id);
  }

  async createPage(page: {
    notebookId: string;
    title?: string;
    text?: string;
    sortOrder?: number;
  }): Promise<NotebookPage> {
    const saved = await this.local.createPage(page);

    await syncQueue.enqueue({
      type: 'INSERT',
      table: 'notebook_pages',
      id: saved.id,
      data: {
        id: saved.id,
        notebook_id: saved.notebookId,
        title: saved.title ?? null,
        text: saved.text,
        sort_order: saved.sortOrder,
        created_at: saved.createdAt.toISOString(),
        updated_at: saved.updatedAt.toISOString(),
      },
    });

    return saved;
  }

  async updatePage(
    id: string,
    updates: { title?: string; text?: string; notebookId?: string; sortOrder?: number },
  ): Promise<void> {
    await this.local.updatePage(id, updates);

    const syncData: Record<string, any> = { updated_at: nowISO() };
    if (updates.title !== undefined) syncData.title = updates.title || null;
    if (updates.text !== undefined) syncData.text = updates.text;
    if (updates.notebookId !== undefined) syncData.notebook_id = updates.notebookId;
    if (updates.sortOrder !== undefined) syncData.sort_order = updates.sortOrder;

    await syncQueue.enqueue({
      type: 'UPDATE',
      table: 'notebook_pages',
      id,
      data: syncData,
    });
  }

  async deletePage(id: string): Promise<void> {
    await this.local.deletePage(id);
    await syncQueue.enqueue({ type: 'DELETE', table: 'notebook_pages', id });
  }
}

/**
 * Singleton instance — import this instead of creating new SyncedNotebookStore().
 * Registers itself with SyncService so initialize()/dispose() are called automatically.
 */
export const syncedNotebookStore = new SyncedNotebookStore();

// Self-register with SyncService so no circular imports are needed in SyncService.
import { syncService } from '../lib/sync/SyncService';
syncService.registerSyncStore(syncedNotebookStore);
syncService.registerApplyFn('notebooks', (rows) => applyRemoteNotebooks(rows, { fullPull: true }));
syncService.registerApplyFn('notebook_pages', (rows) =>
  applyRemoteNotebookPages(rows, { fullPull: true }),
);
