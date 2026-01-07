import type { CrossReferenceStore, CrossReference, BCV } from '@projectbible/core';
import { generateId, readTransaction, writeTransaction } from './db.js';
import type { DBCrossReference } from './db.js';

export class IndexedDBCrossReferenceStore implements CrossReferenceStore {
  /**
   * Get all cross-references FROM a specific verse
   */
  async getCrossReferences(reference: BCV): Promise<CrossReference[]> {
    try {
      const db = await import('./db.js').then(m => m.openDB());
      
      return new Promise((resolve, reject) => {
        const transaction = db.transaction('cross_references', 'readonly');
        const store = transaction.objectStore('cross_references');
        const index = store.index('from_verse');
        
        const range = IDBKeyRange.only([reference.book, reference.chapter, reference.verse]);
        const request = index.getAll(range);
        
        request.onsuccess = () => {
          const dbRefs = request.result as DBCrossReference[];
          const crossRefs: CrossReference[] = dbRefs
            .map(r => this.dbToModel(r))
            .sort((a, b) => (b.votes || 0) - (a.votes || 0)); // Highest votes first
          
          resolve(crossRefs);
        };
        
        request.onerror = () => reject(request.error);
      });
    } catch (error) {
      console.error('Error getting cross-references:', error);
      return [];
    }
  }
  
  /**
   * Get cross-references pointing TO a specific verse
   */
  async getReferencesToVerse(reference: BCV): Promise<CrossReference[]> {
    try {
      const db = await import('./db.js').then(m => m.openDB());
      
      return new Promise((resolve, reject) => {
        const transaction = db.transaction('cross_references', 'readonly');
        const store = transaction.objectStore('cross_references');
        const index = store.index('to_verse');
        
        const range = IDBKeyRange.only([reference.book, reference.chapter, reference.verse]);
        const request = index.getAll(range);
        
        request.onsuccess = () => {
          const dbRefs = request.result as DBCrossReference[];
          const crossRefs: CrossReference[] = dbRefs
            .map(r => this.dbToModel(r))
            .sort((a, b) => (b.votes || 0) - (a.votes || 0)); // Highest votes first
          
          resolve(crossRefs);
        };
        
        request.onerror = () => reject(request.error);
      });
    } catch (error) {
      console.error('Error getting references to verse:', error);
      return [];
    }
  }
  
  /**
   * Save a user-created cross-reference
   */
  async saveCrossReference(crossRef: Omit<CrossReference, 'id'>): Promise<CrossReference> {
    const id = generateId();
    
    const dbRef: DBCrossReference = {
      id,
      fromBook: crossRef.from.book,
      fromChapter: crossRef.from.chapter,
      fromVerse: crossRef.from.verse,
      toBook: crossRef.to.book,
      toChapter: crossRef.to.chapter,
      toVerseStart: crossRef.to.verseStart,
      toVerseEnd: crossRef.to.verseEnd,
      description: crossRef.description,
      source: crossRef.source,
      votes: crossRef.votes || 0
    };
    
    await writeTransaction('cross_references', (store) => store.put(dbRef));
    
    return {
      id,
      ...crossRef,
      votes: crossRef.votes || 0
    };
  }
  
  /**
   * Delete a cross-reference
   */
  async deleteCrossReference(id: string): Promise<void> {
    await writeTransaction('cross_references', (store) => store.delete(id));
  }
  
  /**
   * Vote on a cross-reference (upvote/downvote)
   */
  async voteCrossReference(id: string, delta: number): Promise<void> {
    try {
      const db = await import('./db.js').then(m => m.openDB());
      
      return new Promise((resolve, reject) => {
        const transaction = db.transaction('cross_references', 'readwrite');
        const store = transaction.objectStore('cross_references');
        
        const getRequest = store.get(id);
        
        getRequest.onsuccess = () => {
          const ref = getRequest.result as DBCrossReference | undefined;
          
          if (!ref) {
            reject(new Error(`Cross-reference ${id} not found`));
            return;
          }
          
          ref.votes = (ref.votes || 0) + delta;
          
          const putRequest = store.put(ref);
          
          putRequest.onsuccess = () => resolve();
          putRequest.onerror = () => reject(putRequest.error);
        };
        
        getRequest.onerror = () => reject(getRequest.error);
      });
    } catch (error) {
      console.error('Error voting on cross-reference:', error);
      throw error;
    }
  }
  
  /**
   * Convert database model to domain model
   */
  private dbToModel(dbRef: DBCrossReference): CrossReference {
    return {
      id: dbRef.id,
      from: {
        book: dbRef.fromBook,
        chapter: dbRef.fromChapter,
        verse: dbRef.fromVerse
      },
      to: {
        book: dbRef.toBook,
        chapter: dbRef.toChapter,
        verseStart: dbRef.toVerseStart,
        verseEnd: dbRef.toVerseEnd
      },
      description: dbRef.description,
      source: dbRef.source,
      votes: dbRef.votes
    };
  }
}
