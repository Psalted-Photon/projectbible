/**
 * SyncedUserDataStore - User data store with cloud sync
 * 
 * Wraps IndexedDB operations with:
 * - Queue sync operations for upload
 * - Apply remote changes from Realtime
 * - Conflict resolution using timestamps
 */

import type { UserDataStore, UserNote, UserHighlight, UserBookmark, BCV } from '@projectbible/core';
import { IndexedDBUserDataStore } from './UserDataStore';
import { syncQueue } from '../lib/sync/SyncQueueService';
import { realtimeService } from '../lib/sync/RealtimeService';
import { shouldApplyRemoteChange, nowISO } from '../lib/sync/conflictResolver';
import { openDB } from './db';
import type { DBUserNote, DBUserHighlight, DBUserBookmark } from './db';
import { writable } from 'svelte/store';

/**
 * Svelte store that increments whenever a remote user-data change is applied.
 * Components subscribe to re-load notes/highlights/bookmarks when this fires.
 */
export const userDataRemoteChanges = writable(0);

/**
 * Apply remote notes to local IndexedDB
 * Called by SyncService on initial pull
 */
export async function applyRemoteNotes(rows: any[]): Promise<void> {
  const db = await openDB();
  const tx = db.transaction('user_notes', 'readwrite');
  const store = tx.objectStore('user_notes');
  
  for (const row of rows) {
    // Check if local version exists
    const localReq = store.get(row.id);
    await new Promise<void>((resolve) => {
      localReq.onsuccess = () => {
        const local = localReq.result as DBUserNote | undefined;
        if (!local || shouldApplyRemoteChange(local.updatedAt, row.updated_at)) {
          store.put({
            id: row.id,
            book: row.book,
            chapter: row.chapter,
            verse: row.verse,
            text: row.text,
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
 * Apply remote highlights to local IndexedDB
 */
export async function applyRemoteHighlights(rows: any[]): Promise<void> {
  const db = await openDB();
  const tx = db.transaction('user_highlights', 'readwrite');
  const store = tx.objectStore('user_highlights');
  
  for (const row of rows) {
    const localReq = store.get(row.id);
    await new Promise<void>((resolve) => {
      localReq.onsuccess = () => {
        const local = localReq.result as DBUserHighlight | undefined;
        if (!local || shouldApplyRemoteChange(local.createdAt, row.created_at)) {
          store.put({
            id: row.id,
            book: row.book,
            chapter: row.chapter,
            verse: row.verse,
            color: row.color,
            createdAt: new Date(row.created_at).getTime(),
          });
        }
        resolve();
      };
      localReq.onerror = () => resolve();
    });
  }
}

/**
 * Apply remote bookmarks to local IndexedDB
 */
export async function applyRemoteBookmarks(rows: any[]): Promise<void> {
  const db = await openDB();
  const tx = db.transaction('user_bookmarks', 'readwrite');
  const store = tx.objectStore('user_bookmarks');
  
  for (const row of rows) {
    const localReq = store.get(row.id);
    await new Promise<void>((resolve) => {
      localReq.onsuccess = () => {
        const local = localReq.result as DBUserBookmark | undefined;
        if (!local || shouldApplyRemoteChange(local.createdAt, row.created_at)) {
          store.put({
            id: row.id,
            book: row.book,
            chapter: row.chapter,
            verse: row.verse,
            label: row.label,
            createdAt: new Date(row.created_at).getTime(),
          });
        }
        resolve();
      };
      localReq.onerror = () => resolve();
    });
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
        userDataRemoteChanges.update(n => n + 1);
      })
    );
    
    // Subscribe to remote changes for highlights
    this.unsubscribes.push(
      realtimeService.onTableChange('user_highlights', async (change) => {
        if (change.eventType === 'DELETE' && change.old?.id) {
          await this.local.deleteHighlight(change.old.id);
        } else if (change.new) {
          await applyRemoteHighlights([change.new]);
        }
        userDataRemoteChanges.update(n => n + 1);
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
        userDataRemoteChanges.update(n => n + 1);
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
  
  async saveHighlight(highlight: Omit<UserHighlight, 'id' | 'createdAt'>): Promise<UserHighlight> {
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
        color: highlight.color,
        created_at: saved.createdAt.toISOString(),
      },
    });
    
    return saved;
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
  
  // ========== READING POSITION ==========
  
  async saveReadingPosition(reference: BCV): Promise<void> {
    return this.local.saveReadingPosition(reference);
  }
  
  async getReadingPosition(): Promise<BCV | null> {
    return this.local.getReadingPosition();
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
 * Call initialize() from SyncService on sign-in; dispose() on sign-out.
 */
export const syncedUserDataStore = new SyncedUserDataStore();
