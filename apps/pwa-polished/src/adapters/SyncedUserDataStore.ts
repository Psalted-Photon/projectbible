/**
 * SyncedUserDataStore - User data store with cloud sync
 * 
 * Wraps IndexedDB operations with:
 * - Queue sync operations for upload
 * - Apply remote changes from Realtime
 * - Conflict resolution using timestamps
 */

import type { UserDataStore, UserNote, UserHighlight, UserWordHighlight, UserBookmark, BCV } from '@projectbible/core';
import { IndexedDBUserDataStore } from './UserDataStore';
import { syncQueue } from '../lib/sync/SyncQueueService';
import { realtimeService } from '../lib/sync/RealtimeService';
import { shouldApplyRemoteChange, nowISO } from '../lib/sync/conflictResolver';
import { reconcileDeletedRows } from '../lib/sync/reconcileDeletes';
import { notifyHighlightChange } from './SyncedHighlightAdapter';
import { openDB, writeTransaction } from './db';
import type { DBUserNote, DBUserHighlight, DBUserBookmark } from './db';

/**
 * Lightweight event emitter — fires when a remote user-data change is applied.
 * Components call subscribeToUserDataRemoteChanges() to react.
 */
const userDataChangeListeners = new Set<() => void>();

export function subscribeToUserDataRemoteChanges(fn: () => void): () => void {
  userDataChangeListeners.add(fn);
  return () => userDataChangeListeners.delete(fn);
}

/**
 * Apply remote notes to local IndexedDB
 * Called by SyncService on initial pull
 */
export async function applyRemoteNotes(
  rows: any[],
  opts: { fullPull?: boolean } = {},
): Promise<void> {
  const db = await openDB();

  // Full pulls only: remove local notes deleted on another device. The
  // pending-op guard inside also stops the sign-in flicker where a local
  // note not yet uploaded was deleted and then re-appeared.
  if (opts.fullPull) {
    await reconcileDeletedRows('user_notes', rows);
  }

  if (!rows || rows.length === 0) return;

  // Upsert remote rows
  for (const row of rows) {
    const local = await new Promise<DBUserNote | undefined>((resolve) => {
      const tx = db.transaction('user_notes', 'readonly');
      const req = tx.objectStore('user_notes').get(row.id);
      req.onsuccess = () => resolve(req.result as DBUserNote | undefined);
      req.onerror = () => resolve(undefined);
    });
    if (!local || shouldApplyRemoteChange(local.updatedAt, row.updated_at)) {
      await writeTransaction('user_notes', (store) => store.put({
        id: row.id,
        book: row.book,
        chapter: row.chapter,
        verse: row.verse,
        text: row.text,
        createdAt: new Date(row.created_at).getTime(),
        updatedAt: new Date(row.updated_at).getTime(),
      }));
    }
  }
}

/**
 * Apply remote highlights to local IndexedDB
 */
export async function applyRemoteHighlights(
  rows: any[],
  opts: { fullPull?: boolean } = {},
): Promise<void> {
  if (opts.fullPull) {
    await reconcileDeletedRows('user_highlights', rows);
  }
  if (!rows || rows.length === 0) return;
  const db = await openDB();
  for (const row of rows) {
    const local = await new Promise<DBUserHighlight | undefined>((resolve) => {
      const tx = db.transaction('user_highlights', 'readonly');
      const req = tx.objectStore('user_highlights').get(row.id);
      req.onsuccess = () => resolve(req.result as DBUserHighlight | undefined);
      req.onerror = () => resolve(undefined);
    });
    if (!local || shouldApplyRemoteChange(local.createdAt, row.created_at)) {
      await writeTransaction('user_highlights', (store) => store.put({
        id: row.id,
        book: row.book,
        chapter: row.chapter,
        verse: row.verse,
        color: row.color,
        style: row.style ? (typeof row.style === 'string' ? row.style : JSON.stringify(row.style)) : undefined,
        createdAt: new Date(row.created_at).getTime(),
      }));
    }
  }
}

/**
 * Apply remote bookmarks to local IndexedDB
 */
export async function applyRemoteBookmarks(
  rows: any[],
  opts: { fullPull?: boolean } = {},
): Promise<void> {
  if (opts.fullPull) {
    await reconcileDeletedRows('user_bookmarks', rows);
  }
  if (!rows || rows.length === 0) return;
  const db = await openDB();
  for (const row of rows) {
    const local = await new Promise<DBUserBookmark | undefined>((resolve) => {
      const tx = db.transaction('user_bookmarks', 'readonly');
      const req = tx.objectStore('user_bookmarks').get(row.id);
      req.onsuccess = () => resolve(req.result as DBUserBookmark | undefined);
      req.onerror = () => resolve(undefined);
    });
    if (!local || shouldApplyRemoteChange(local.createdAt, row.created_at)) {
      await writeTransaction('user_bookmarks', (store) => store.put({
        id: row.id,
        book: row.book,
        chapter: row.chapter,
        verse: row.verse,
        label: row.label,
        createdAt: new Date(row.created_at).getTime(),
      }));
    }
  }
}

/**
 * Synced UserDataStore implementation
 */
export class SyncedUserDataStore implements UserDataStore {
  private local = new IndexedDBUserDataStore();
  private unsubscribes: (() => void)[] = [];
  private initialized = false;
  
  /**
   * Initialize realtime subscriptions
   * Call after user signs in
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;
    this.initialized = true;
    
    // Subscribe to remote changes for notes
    this.unsubscribes.push(
      realtimeService.onTableChange('user_notes', async (change) => {
        if (change.eventType === 'DELETE' && change.old?.id) {
          await this.local.deleteNote(change.old.id);
        } else if (change.new) {
          await applyRemoteNotes([change.new]);
        }
        userDataChangeListeners.forEach(fn => fn());
      })
    );
    
    // Subscribe to remote changes for highlights. This is the ONLY realtime
    // handler for user_highlights — notifyHighlightChange bridges into the
    // emitter BibleReader watches for highlight re-renders.
    this.unsubscribes.push(
      realtimeService.onTableChange('user_highlights', async (change) => {
        if (change.eventType === 'DELETE' && change.old?.id) {
          await this.local.deleteHighlight(change.old.id);
        } else if (change.new) {
          await applyRemoteHighlights([change.new]);
        }
        notifyHighlightChange();
        userDataChangeListeners.forEach(fn => fn());
      })
    );
    
    // Subscribe to remote changes for bookmarks
    this.unsubscribes.push(
      realtimeService.onTableChange('user_bookmarks', async (change) => {
        if (change.eventType === 'DELETE' && change.old?.id) {
          await this.local.deleteBookmark(change.old.id);
        } else if (change.new) {
          await applyRemoteBookmarks([change.new]);
        }
        userDataChangeListeners.forEach(fn => fn());
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
  
  // ========== NOTES ==========
  
  async getNotes(reference?: BCV): Promise<UserNote[]> {
    return this.local.getNotes(reference);
  }
  
  async saveNote(note: Omit<UserNote, 'id' | 'createdAt' | 'updatedAt'>): Promise<UserNote> {
    // 1. Save locally (optimistic)
    const saved = await this.local.saveNote(note);
    
    // 2. Queue for sync
    await syncQueue.enqueue({
      type: 'INSERT',
      table: 'user_notes',
      id: saved.id,
      data: {
        id: saved.id,
        book: note.reference.book,
        chapter: note.reference.chapter,
        verse: note.reference.verse,
        text: note.text,
        created_at: saved.createdAt.toISOString(),
        updated_at: saved.updatedAt.toISOString(),
      },
    });
    
    return saved;
  }
  
  async updateNote(noteId: string, text: string): Promise<void> {
    // 1. Update locally
    await this.local.updateNote(noteId, text);
    
    // 2. Queue for sync
    await syncQueue.enqueue({
      type: 'UPDATE',
      table: 'user_notes',
      id: noteId,
      data: { text, updated_at: nowISO() },
    });
  }
  
  async deleteNote(noteId: string): Promise<void> {
    // 1. Delete locally
    await this.local.deleteNote(noteId);
    
    // 2. Queue for sync
    await syncQueue.enqueue({
      type: 'DELETE',
      table: 'user_notes',
      id: noteId,
    });
  }
  
  // ========== HIGHLIGHTS ==========
  
  async getHighlights(reference?: BCV): Promise<UserHighlight[]> {
    return this.local.getHighlights(reference);
  }
  
  async getChapterHighlights(book: string, chapter: number): Promise<UserHighlight[]> {
    return this.local.getChapterHighlights(book, chapter);
  }

  async saveHighlight(highlight: Omit<UserHighlight, 'id' | 'createdAt' | 'color'>): Promise<UserHighlight> {
    const saved = await this.local.saveHighlight(highlight);

    await syncQueue.enqueue({
      type: 'INSERT',
      table: 'user_highlights',
      id: saved.id,
      data: {
        id: saved.id,
        book: highlight.reference.book,
        chapter: highlight.reference.chapter,
        verse: highlight.reference.verse,
        color: highlight.style.color,
        style: highlight.style,
        created_at: saved.createdAt.toISOString(),
      },
    });

    return saved;
  }

  async getWordHighlights(reference?: BCV, translation?: string): Promise<UserWordHighlight[]> {
    return this.local.getWordHighlights(reference, translation);
  }

  async getChapterWordHighlights(book: string, chapter: number): Promise<UserWordHighlight[]> {
    return this.local.getChapterWordHighlights(book, chapter);
  }

  async getBookWordHighlights(book: string): Promise<UserWordHighlight[]> {
    return this.local.getBookWordHighlights(book);
  }

  async saveWordHighlight(highlight: Omit<UserWordHighlight, 'id' | 'createdAt'>): Promise<UserWordHighlight> {
    const saved = await this.local.saveWordHighlight(highlight);

    await syncQueue.enqueue({
      type: 'INSERT',
      table: 'user_word_highlights',
      id: saved.id,
      data: {
        id: saved.id,
        book: highlight.reference.book,
        chapter: highlight.reference.chapter,
        verse: highlight.reference.verse,
        translation: highlight.translation,
        word_start: highlight.wordStart,
        word_length: highlight.wordLength,
        style: highlight.style,
        created_at: saved.createdAt.toISOString(),
      },
    });

    return saved;
  }

  async deleteWordHighlight(highlightId: string): Promise<void> {
    await this.local.deleteWordHighlight(highlightId);

    await syncQueue.enqueue({
      type: 'DELETE',
      table: 'user_word_highlights',
      id: highlightId,
    });
  }
  
  async deleteHighlight(highlightId: string): Promise<void> {
    await this.local.deleteHighlight(highlightId);
    
    await syncQueue.enqueue({
      type: 'DELETE',
      table: 'user_highlights',
      id: highlightId,
    });
  }
  
  // ========== BOOKMARKS ==========
  
  async getBookmarks(): Promise<UserBookmark[]> {
    return this.local.getBookmarks();
  }
  
  async saveBookmark(bookmark: Omit<UserBookmark, 'id' | 'createdAt'>): Promise<UserBookmark> {
    const saved = await this.local.saveBookmark(bookmark);
    
    await syncQueue.enqueue({
      type: 'INSERT',
      table: 'user_bookmarks',
      id: saved.id,
      data: {
        id: saved.id,
        book: bookmark.reference.book,
        chapter: bookmark.reference.chapter,
        verse: bookmark.reference.verse,
        label: bookmark.label,
        created_at: saved.createdAt.toISOString(),
      },
    });
    
    return saved;
  }
  
  async deleteBookmark(bookmarkId: string): Promise<void> {
    await this.local.deleteBookmark(bookmarkId);
    
    await syncQueue.enqueue({
      type: 'DELETE',
      table: 'user_bookmarks',
      id: bookmarkId,
    });
  }
  
  // ========== ADDITIONAL METHODS ==========
  
  async isBookmarked(reference: BCV): Promise<boolean> {
    const bookmarks = await this.getBookmarks();
    return bookmarks.some(
      b => b.reference.book === reference.book && 
           b.reference.chapter === reference.chapter && 
           b.reference.verse === reference.verse
    );
  }
  
  async toggleBookmark(reference: BCV): Promise<boolean> {
    const isCurrentlyBookmarked = await this.isBookmarked(reference);
    
    if (isCurrentlyBookmarked) {
      // Find and delete the bookmark
      const bookmarks = await this.getBookmarks();
      const bookmark = bookmarks.find(
        b => b.reference.book === reference.book && 
             b.reference.chapter === reference.chapter && 
             b.reference.verse === reference.verse
      );
      if (bookmark) {
        await this.deleteBookmark(bookmark.id);
      }
      return false;
    } else {
      // Create new bookmark
      await this.saveBookmark({ reference });
      return true;
    }
  }
}

/**
 * Singleton instance — import this instead of creating new SyncedUserDataStore().
 * Registers itself with SyncService so initialize()/dispose() are called automatically.
 */
export const syncedUserDataStore = new SyncedUserDataStore();

// Self-register with SyncService so no circular imports are needed in SyncService.
import { syncService } from '../lib/sync/SyncService';
syncService.registerSyncStore(syncedUserDataStore);
syncService.registerApplyFn('user_notes', (rows) => applyRemoteNotes(rows, { fullPull: true }));
syncService.registerApplyFn('user_highlights', async (rows) => {
  await applyRemoteHighlights(rows, { fullPull: true });
  notifyHighlightChange();
});
syncService.registerApplyFn('user_bookmarks', (rows) => applyRemoteBookmarks(rows, { fullPull: true }));
