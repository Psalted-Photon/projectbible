/**
 * NotebookStore — local IndexedDB CRUD for free-form notes.
 *
 * A notebook is a named folder; a page is one note inside it. Verse-anchored
 * notes are a separate thing entirely and live in UserDataStore/user_notes.
 *
 * This is the plain local layer. SyncedNotebookStore wraps it to add cloud
 * sync — components should import that singleton, not this class.
 */

import { generateId, writeTransaction } from './db.js';
import type { DBNotebook, DBNotebookPage } from './db.js';

export interface Notebook {
  id: string;
  name: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface NotebookPage {
  id: string;
  notebookId: string;
  title?: string;
  text: string;
  sortOrder: number;
  createdAt: Date;
  updatedAt: Date;
}

function toNotebook(row: DBNotebook): Notebook {
  return {
    id: row.id,
    name: row.name,
    createdAt: new Date(row.createdAt),
    updatedAt: new Date(row.updatedAt),
  };
}

function toPage(row: DBNotebookPage): NotebookPage {
  return {
    id: row.id,
    notebookId: row.notebookId,
    title: row.title,
    text: row.text,
    sortOrder: row.sortOrder ?? 0,
    createdAt: new Date(row.createdAt),
    updatedAt: new Date(row.updatedAt),
  };
}

export class IndexedDBNotebookStore {
  // ========== NOTEBOOKS ==========

  async getNotebooks(): Promise<Notebook[]> {
    try {
      const db = await import('./db.js').then((m) => m.openDB());
      return new Promise((resolve, reject) => {
        const tx = db.transaction('notebooks', 'readonly');
        const request = tx.objectStore('notebooks').getAll();
        request.onsuccess = () => {
          const rows = (request.result as DBNotebook[]).map(toNotebook);
          // Oldest first — a notebook list that reshuffles itself every time you
          // type is disorienting, unlike a page list where recency is the point.
          rows.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
          resolve(rows);
        };
        request.onerror = () => reject(request.error);
      });
    } catch (error) {
      console.error('Error getting notebooks:', error);
      return [];
    }
  }

  async getNotebook(id: string): Promise<Notebook | null> {
    try {
      const db = await import('./db.js').then((m) => m.openDB());
      return new Promise((resolve, reject) => {
        const tx = db.transaction('notebooks', 'readonly');
        const request = tx.objectStore('notebooks').get(id);
        request.onsuccess = () => {
          const row = request.result as DBNotebook | undefined;
          resolve(row ? toNotebook(row) : null);
        };
        request.onerror = () => reject(request.error);
      });
    } catch (error) {
      console.error('Error getting notebook:', error);
      return null;
    }
  }

  async createNotebook(name: string): Promise<Notebook> {
    const now = Date.now();
    const id = generateId();
    const row: DBNotebook = { id, name, createdAt: now, updatedAt: now };
    await writeTransaction('notebooks', (store) => store.put(row));
    return toNotebook(row);
  }

  async renameNotebook(id: string, name: string): Promise<void> {
    const db = await import('./db.js').then((m) => m.openDB());
    return new Promise((resolve, reject) => {
      const tx = db.transaction('notebooks', 'readwrite');
      const store = tx.objectStore('notebooks');
      const getRequest = store.get(id);
      getRequest.onsuccess = () => {
        const row = getRequest.result as DBNotebook | undefined;
        if (!row) {
          reject(new Error(`Notebook ${id} not found`));
          return;
        }
        row.name = name;
        row.updatedAt = Date.now();
        const putRequest = store.put(row);
        putRequest.onsuccess = () => resolve();
        putRequest.onerror = () => reject(putRequest.error);
      };
      getRequest.onerror = () => reject(getRequest.error);
    });
  }

  /** Deletes the notebook only. Page cascade is the caller's job (see SyncedNotebookStore). */
  async deleteNotebook(id: string): Promise<void> {
    await writeTransaction('notebooks', (store) => store.delete(id));
  }

  // ========== PAGES ==========

  /** Pages in one notebook, most recently edited first. */
  async getPages(notebookId: string): Promise<NotebookPage[]> {
    try {
      const db = await import('./db.js').then((m) => m.openDB());
      return new Promise((resolve, reject) => {
        const tx = db.transaction('notebook_pages', 'readonly');
        const index = tx.objectStore('notebook_pages').index('notebookId');
        const request = index.getAll(IDBKeyRange.only(notebookId));
        request.onsuccess = () => {
          const rows = (request.result as DBNotebookPage[]).map(toPage);
          rows.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
          resolve(rows);
        };
        request.onerror = () => reject(request.error);
      });
    } catch (error) {
      console.error('Error getting notebook pages:', error);
      return [];
    }
  }

  /** Every page across every notebook — used to count without N queries. */
  async getAllPages(): Promise<NotebookPage[]> {
    try {
      const db = await import('./db.js').then((m) => m.openDB());
      return new Promise((resolve, reject) => {
        const tx = db.transaction('notebook_pages', 'readonly');
        const request = tx.objectStore('notebook_pages').getAll();
        request.onsuccess = () => {
          const rows = (request.result as DBNotebookPage[]).map(toPage);
          rows.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
          resolve(rows);
        };
        request.onerror = () => reject(request.error);
      });
    } catch (error) {
      console.error('Error getting all notebook pages:', error);
      return [];
    }
  }

  async getPage(id: string): Promise<NotebookPage | null> {
    try {
      const db = await import('./db.js').then((m) => m.openDB());
      return new Promise((resolve, reject) => {
        const tx = db.transaction('notebook_pages', 'readonly');
        const request = tx.objectStore('notebook_pages').get(id);
        request.onsuccess = () => {
          const row = request.result as DBNotebookPage | undefined;
          resolve(row ? toPage(row) : null);
        };
        request.onerror = () => reject(request.error);
      });
    } catch (error) {
      console.error('Error getting notebook page:', error);
      return null;
    }
  }

  async createPage(page: {
    notebookId: string;
    title?: string;
    text?: string;
    sortOrder?: number;
  }): Promise<NotebookPage> {
    const now = Date.now();
    const id = generateId();
    const row: DBNotebookPage = {
      id,
      notebookId: page.notebookId,
      title: page.title,
      text: page.text ?? '',
      sortOrder: page.sortOrder ?? 0,
      createdAt: now,
      updatedAt: now,
    };
    await writeTransaction('notebook_pages', (store) => store.put(row));
    return toPage(row);
  }

  async updatePage(
    id: string,
    updates: { title?: string; text?: string; notebookId?: string; sortOrder?: number },
  ): Promise<void> {
    const db = await import('./db.js').then((m) => m.openDB());
    return new Promise((resolve, reject) => {
      const tx = db.transaction('notebook_pages', 'readwrite');
      const store = tx.objectStore('notebook_pages');
      const getRequest = store.get(id);
      getRequest.onsuccess = () => {
        const row = getRequest.result as DBNotebookPage | undefined;
        if (!row) {
          reject(new Error(`Notebook page ${id} not found`));
          return;
        }
        if (updates.title !== undefined) row.title = updates.title;
        if (updates.text !== undefined) row.text = updates.text;
        if (updates.notebookId !== undefined) row.notebookId = updates.notebookId;
        if (updates.sortOrder !== undefined) row.sortOrder = updates.sortOrder;
        row.updatedAt = Date.now();
        const putRequest = store.put(row);
        putRequest.onsuccess = () => resolve();
        putRequest.onerror = () => reject(putRequest.error);
      };
      getRequest.onerror = () => reject(getRequest.error);
    });
  }

  async deletePage(id: string): Promise<void> {
    await writeTransaction('notebook_pages', (store) => store.delete(id));
  }
}
