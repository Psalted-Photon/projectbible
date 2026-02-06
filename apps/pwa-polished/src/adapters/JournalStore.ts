import type { JournalStore, JournalEntry } from '@projectbible/core';
import { generateId, writeTransaction } from './db.js';
import type { DBJournalEntry } from './db.js';

export class IndexedDBJournalStore implements JournalStore {
  // ========== GET ENTRIES ==========
  
  async getEntries(startDate?: string, endDate?: string): Promise<JournalEntry[]> {
    try {
      const db = await import('./db.js').then(m => m.openDB());
      
      return new Promise((resolve, reject) => {
        const transaction = db.transaction('journal_entries', 'readonly');
        const store = transaction.objectStore('journal_entries');
        const index = store.index('date');
        
        let request: IDBRequest<DBJournalEntry[]>;
        
        if (startDate && endDate) {
          // Get entries within date range
          const range = IDBKeyRange.bound(startDate, endDate);
          request = index.getAll(range);
        } else if (startDate) {
          // Get entries from startDate onwards
          const range = IDBKeyRange.lowerBound(startDate);
          request = index.getAll(range);
        } else if (endDate) {
          // Get entries up to endDate
          const range = IDBKeyRange.upperBound(endDate);
          request = index.getAll(range);
        } else {
          // Get all entries
          request = store.getAll();
        }
        
        request.onsuccess = () => {
          const dbEntries = request.result;
          const entries: JournalEntry[] = dbEntries.map(e => ({
            id: e.id,
            date: e.date,
            title: e.title,
            text: e.text,
            textLinkified: e.textLinkified,
            createdAt: new Date(e.createdAt),
            updatedAt: new Date(e.updatedAt)
          }));
          resolve(entries);
        };
        
        request.onerror = () => reject(request.error);
      });
    } catch (error) {
      console.error('Error getting journal entries:', error);
      return [];
    }
  }
  
  async getEntryByDate(date: string): Promise<JournalEntry | null> {
    try {
      const db = await import('./db.js').then(m => m.openDB());
      
      return new Promise((resolve, reject) => {
        const transaction = db.transaction('journal_entries', 'readonly');
        const store = transaction.objectStore('journal_entries');
        const index = store.index('date');
        
        const request = index.get(date);
        
        request.onsuccess = () => {
          const dbEntry = request.result as DBJournalEntry | undefined;
          
          if (!dbEntry) {
            resolve(null);
            return;
          }
          
          resolve({
            id: dbEntry.id,
            date: dbEntry.date,
            title: dbEntry.title,
            text: dbEntry.text,
            textLinkified: dbEntry.textLinkified,
            createdAt: new Date(dbEntry.createdAt),
            updatedAt: new Date(dbEntry.updatedAt)
          });
        };
        
        request.onerror = () => reject(request.error);
      });
    } catch (error) {
      console.error('Error getting journal entry by date:', error);
      return null;
    }
  }
  
  async saveEntry(entry: Omit<JournalEntry, 'id' | 'createdAt' | 'updatedAt'>): Promise<JournalEntry> {
    const now = Date.now();
    const id = generateId();
    
    const dbEntry: DBJournalEntry = {
      id,
      date: entry.date,
      title: entry.title,
      text: entry.text,
      textLinkified: entry.textLinkified,
      createdAt: now,
      updatedAt: now
    };
    
    await writeTransaction('journal_entries', (store) => store.put(dbEntry));
    
    return {
      id,
      date: entry.date,
      title: entry.title,
      text: entry.text,
      textLinkified: entry.textLinkified,
      createdAt: new Date(now),
      updatedAt: new Date(now)
    };
  }
  
  async updateEntry(id: string, updates: { title?: string; text?: string; textLinkified?: string }): Promise<void> {
    try {
      const db = await import('./db.js').then(m => m.openDB());
      
      return new Promise((resolve, reject) => {
        const transaction = db.transaction('journal_entries', 'readwrite');
        const store = transaction.objectStore('journal_entries');
        
        const getRequest = store.get(id);
        
        getRequest.onsuccess = () => {
          const entry = getRequest.result as DBJournalEntry | undefined;
          
          if (!entry) {
            reject(new Error(`Journal entry ${id} not found`));
            return;
          }
          
          // Update fields
          if (updates.title !== undefined) {
            entry.title = updates.title;
          }
          if (updates.text !== undefined) {
            entry.text = updates.text;
          }
          if (updates.textLinkified !== undefined) {
            entry.textLinkified = updates.textLinkified;
          }
          
          // Always update timestamp
          entry.updatedAt = Date.now();
          
          const putRequest = store.put(entry);
          
          putRequest.onsuccess = () => resolve();
          putRequest.onerror = () => reject(putRequest.error);
        };
        
        getRequest.onerror = () => reject(getRequest.error);
      });
    } catch (error) {
      console.error('Error updating journal entry:', error);
      throw error;
    }
  }
  
  async deleteEntry(id: string): Promise<void> {
    await writeTransaction('journal_entries', (store) => store.delete(id));
  }
  
  async getDateRange(): Promise<{ oldest: string | null; newest: string | null }> {
    try {
      const db = await import('./db.js').then(m => m.openDB());
      
      return new Promise((resolve, reject) => {
        const transaction = db.transaction('journal_entries', 'readonly');
        const store = transaction.objectStore('journal_entries');
        const index = store.index('date');
        
        // Get oldest (first entry)
        const oldestRequest = index.openCursor(null, 'next');
        let oldest: string | null = null;
        
        oldestRequest.onsuccess = () => {
          const cursor = oldestRequest.result;
          if (cursor) {
            oldest = (cursor.value as DBJournalEntry).date;
          }
          
          // Get newest (last entry)
          const newestRequest = index.openCursor(null, 'prev');
          let newest: string | null = null;
          
          newestRequest.onsuccess = () => {
            const cursor = newestRequest.result;
            if (cursor) {
              newest = (cursor.value as DBJournalEntry).date;
            }
            
            resolve({ oldest, newest });
          };
          
          newestRequest.onerror = () => reject(newestRequest.error);
        };
        
        oldestRequest.onerror = () => reject(oldestRequest.error);
      });
    } catch (error) {
      console.error('Error getting journal date range:', error);
      return { oldest: null, newest: null };
    }
  }
}
