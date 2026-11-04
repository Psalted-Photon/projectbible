/**
 * SyncedByHeartStore - By Heart's saved verses with cloud sync
 *
 * Same shape as SyncedNotebookStore: saved on the device first, queued for
 * upload, and remote rows are a plain timestamp upsert. A save always uploads
 * the whole row, since a row is small and most saves touch most of it.
 *
 * The photo behind a card lives beside the row in by_heart_photos and is never
 * queued. A game under way isn't here either: it is kept on the device after
 * every word (lib/byHeart/game.ts), and only a finished round writes a row.
 */

import { syncQueue } from '../lib/sync/SyncQueueService';
import { realtimeService } from '../lib/sync/RealtimeService';
import { shouldApplyRemoteChange } from '../lib/sync/conflictResolver';
import { reconcileDeletedRows } from '../lib/sync/reconcileDeletes';
import type { SyncOperation } from '../lib/sync/types';
import { generateId, openDB, writeTransaction } from './db';
import type { DBByHeartPhoto, DBByHeartRecital, DBByHeartVerse } from './db';

const STORE = 'by_heart_verses';
const PHOTOS = 'by_heart_photos';
const RECITALS = 'by_heart_voice';

const changeListeners = new Set<() => void>();

/** Called whenever the saved verses change, from here or from another device. */
export function subscribeToByHeartChanges(fn: () => void): () => void {
  changeListeners.add(fn);
  return () => changeListeners.delete(fn);
}

/** Say the verses changed, for what writes to the store without coming through here. */
export function notifyByHeartChange(): void {
  changeListeners.forEach((fn) => fn());
}

/** The row as the server keeps it. Also what a backup restore queues. */
export function byHeartUploadOp(row: DBByHeartVerse): SyncOperation {
  return {
    type: 'INSERT',
    table: STORE,
    id: row.id,
    data: {
      id: row.id,
      book: row.book,
      chapter: row.chapter,
      start_verse: row.startVerse,
      end_verse: row.endVerse,
      verses: row.verses ?? null,
      translation: row.translation,
      passage: row.passage,
      part: row.part,
      parts: row.parts,
      card: row.card,
      score: row.score,
      next_date: row.nextDate,
      progress: row.progress,
      created_at: new Date(row.createdAt).toISOString(),
      updated_at: new Date(row.updatedAt).toISOString(),
    },
  };
}

function fromRemote(row: any): DBByHeartVerse {
  return {
    id: row.id,
    book: row.book,
    chapter: row.chapter,
    startVerse: row.start_verse,
    endVerse: row.end_verse,
    verses: Array.isArray(row.verses) ? row.verses : undefined,
    translation: row.translation,
    passage: row.passage ?? '',
    part: row.part ?? 1,
    parts: row.parts ?? 1,
    card: row.card ?? {},
    score: row.score ?? null,
    nextDate: row.next_date ?? null,
    progress: row.progress ?? {},
    createdAt: new Date(row.created_at).getTime(),
    updatedAt: new Date(row.updated_at).getTime(),
  };
}

function allOf<T>(db: IDBDatabase, storeName: string): Promise<T[]> {
  return new Promise((resolve) => {
    const req = db.transaction(storeName, 'readonly').objectStore(storeName).getAll();
    req.onsuccess = () => resolve((req.result as T[]) ?? []);
    req.onerror = () => resolve([]);
  });
}

function oneOf<T>(db: IDBDatabase, storeName: string, id: string): Promise<T | undefined> {
  return new Promise((resolve) => {
    const req = db.transaction(storeName, 'readonly').objectStore(storeName).get(id);
    req.onsuccess = () => resolve(req.result as T | undefined);
    req.onerror = () => resolve(undefined);
  });
}

/** Photos whose verse is gone, removed elsewhere while this device was away. */
async function dropOrphanPhotos(db: IDBDatabase): Promise<void> {
  const [verses, photos] = await Promise.all([
    allOf<DBByHeartVerse>(db, STORE),
    allOf<DBByHeartPhoto>(db, PHOTOS),
  ]);
  const ids = new Set(verses.map((v) => v.id));
  for (const photo of photos) {
    if (!ids.has(photo.id)) await writeTransaction(PHOTOS, (store) => store.delete(photo.id));
  }
}

export async function applyRemoteByHeartVerses(rows: any[], opts: { fullPull?: boolean } = {}): Promise<void> {
  const db = await openDB();
  if (opts.fullPull) {
    await reconcileDeletedRows(STORE, rows);
    await dropOrphanPhotos(db);
  }
  for (const row of rows ?? []) {
    const local = await oneOf<DBByHeartVerse>(db, STORE, row.id);
    if (!local || shouldApplyRemoteChange(local.updatedAt, row.updated_at)) {
      await writeTransaction(STORE, (store) => store.put(fromRemote(row)));
    }
  }
  notifyByHeartChange();
}

export type NewByHeartVerse = Omit<DBByHeartVerse, 'id' | 'createdAt' | 'updatedAt' | 'ownerId'>;

export class SyncedByHeartStore {
  private unsubscribe: (() => void) | null = null;

  async initialize(): Promise<void> {
    if (this.unsubscribe) return;
    this.unsubscribe = realtimeService.onTableChange(STORE, async (change) => {
      if (change.eventType === 'DELETE' && change.old?.id) {
        await this.removeHere(change.old.id);
        notifyByHeartChange();
      } else if (change.new) {
        await applyRemoteByHeartVerses([change.new]);
      }
    });
  }

  dispose(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
  }

  /** Every saved verse, the newest first. */
  async list(): Promise<DBByHeartVerse[]> {
    const rows = await allOf<DBByHeartVerse>(await openDB(), STORE);
    return rows.sort((a, b) => b.createdAt - a.createdAt || a.part - b.part);
  }

  async get(id: string): Promise<DBByHeartVerse | null> {
    return (await oneOf<DBByHeartVerse>(await openDB(), STORE, id)) ?? null;
  }

  async add(fields: NewByHeartVerse): Promise<DBByHeartVerse> {
    const now = Date.now();
    const row: DBByHeartVerse = { ...fields, id: generateId(), createdAt: now, updatedAt: now };
    await writeTransaction(STORE, (store) => store.put(row));
    await syncQueue.enqueue(byHeartUploadOp(row));
    notifyByHeartChange();
    return row;
  }

  async update(id: string, patch: Partial<NewByHeartVerse>): Promise<void> {
    const current = await this.get(id);
    if (!current) return;
    const row: DBByHeartVerse = { ...current, ...patch, updatedAt: Date.now() };
    await writeTransaction(STORE, (store) => store.put(row));
    await syncQueue.enqueue(byHeartUploadOp(row));
    notifyByHeartChange();
  }

  async remove(id: string): Promise<void> {
    await this.removeHere(id);
    await syncQueue.enqueue({ type: 'DELETE', table: STORE, id });
    notifyByHeartChange();
  }

  private async removeHere(id: string): Promise<void> {
    await writeTransaction(STORE, (store) => store.delete(id));
    await writeTransaction(PHOTOS, (store) => store.delete(id));
    await writeTransaction(RECITALS, (store) => store.delete(id));
  }

  // ── The photo behind a card, on this device only ──────────────────────────

  async getPhoto(id: string): Promise<DBByHeartPhoto | null> {
    return (await oneOf<DBByHeartPhoto>(await openDB(), PHOTOS, id)) ?? null;
  }

  async setPhoto(photo: DBByHeartPhoto): Promise<void> {
    await writeTransaction(PHOTOS, (store) => store.put(photo));
  }

  async clearPhoto(id: string): Promise<void> {
    await writeTransaction(PHOTOS, (store) => store.delete(id));
  }

  // ── Your Own Voice, on this device only ───────────────────────────────────

  async recitals(): Promise<DBByHeartRecital[]> {
    return allOf<DBByHeartRecital>(await openDB(), RECITALS);
  }

  async getRecital(id: string): Promise<DBByHeartRecital | null> {
    return (await oneOf<DBByHeartRecital>(await openDB(), RECITALS, id)) ?? null;
  }

  /** Keeps this one if it is the verse's best so far, or level with it. */
  async keepRecital(recital: DBByHeartRecital): Promise<void> {
    const best = await this.getRecital(recital.id);
    if (best && best.score > recital.score) return;
    await writeTransaction(RECITALS, (store) => store.put(recital));
    notifyByHeartChange();
  }

  async removeRecital(id: string): Promise<void> {
    await writeTransaction(RECITALS, (store) => store.delete(id));
    notifyByHeartChange();
  }

  async clearRecitals(): Promise<void> {
    await writeTransaction(RECITALS, (store) => store.clear());
    notifyByHeartChange();
  }
}

/**
 * Singleton instance. Registers itself with SyncService, which is why App
 * imports this file: a verse saved on another device has to come down whether
 * or not a By Heart window has been opened.
 */
export const syncedByHeartStore = new SyncedByHeartStore();

import { syncService } from '../lib/sync/SyncService';
syncService.registerSyncStore(syncedByHeartStore);
syncService.registerApplyFn(STORE, (rows) => applyRemoteByHeartVerses(rows, { fullPull: true }));
