/**
 * Database Management Utilities
 * 
 * Provides functions to manage IndexedDB data:
 * - Clear all data
 * - Remove specific packs
 * - Export/import data
 */

import { openDB } from './db';

const DB_NAME = 'projectbible';

export interface DBStats {
  packs: number;
  verses: number;
  notes: number;
  highlights: number;
  bookmarks: number;
  places: number;
  mapTiles: number;
  totalSizeEstimate: string;
}

/**
 * Get statistics about current database
 */
export async function getDatabaseStats(): Promise<DBStats> {
  const db = await openDB();
  
  try {
    const stats: DBStats = {
      packs: await countRecords(db, 'packs'),
      verses: await countRecords(db, 'verses'),
      notes: await countRecords(db, 'user_notes'),
      highlights: await countRecords(db, 'user_highlights'),
      bookmarks: await countRecords(db, 'user_bookmarks'),
      places: await countRecords(db, 'places'),
      mapTiles: await countRecords(db, 'map_tiles'),
      totalSizeEstimate: 'calculating...'
    };
    
    // Estimate storage usage
    if ('storage' in navigator && 'estimate' in navigator.storage) {
      const estimate = await navigator.storage.estimate();
      const usedMB = (estimate.usage || 0) / (1024 * 1024);
      stats.totalSizeEstimate = `${usedMB.toFixed(2)} MB`;
    }
    
    return stats;
  } finally {
    db.close();
  }
}

/**
 * Clear ALL data (nuclear option - resets everything)
 */
export async function clearAllData(): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(DB_NAME);
    
    request.onsuccess = () => {
      console.log('Database cleared successfully');
      resolve();
    };
    
    request.onerror = () => {
      reject(new Error('Failed to clear database'));
    };
    
    request.onblocked = () => {
      console.warn('Database deletion blocked - close all tabs using this app');
    };
  });
}

/**
 * Remove a specific pack and all its data
 */
export async function removePack(packId: string): Promise<void> {
  const db = await openDB();
  
  try {
    const tx = db.transaction(['packs', 'verses', 'places', 'map_tiles', 'historical_layers', 'morphology'], 'readwrite');
    
    // Delete pack metadata
    await new Promise<void>((resolve, reject) => {
      const request = tx.objectStore('packs').delete(packId);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
    
    // Delete all verses from this pack (scan all verses since there's no translationId index)
    const versesStore = tx.objectStore('verses');
    const versesCursor = versesStore.openCursor();
    
    await new Promise<void>((resolve, reject) => {
      versesCursor.onsuccess = (event) => {
        const cursor = (event.target as IDBRequest).result;
        if (cursor) {
          const verse = cursor.value;
          // Check if this verse belongs to the pack being deleted
          if (verse.translationId === packId || verse.id?.startsWith(packId + ':')) {
            cursor.delete();
          }
          cursor.continue();
        } else {
          resolve();
        }
      };
      versesCursor.onerror = () => reject(versesCursor.error);
    });
    
    // Delete morphology data from this pack
    const morphStore = tx.objectStore('morphology');
    const morphCursor = morphStore.openCursor();
    
    await new Promise<void>((resolve, reject) => {
      morphCursor.onsuccess = (event) => {
        const cursor = (event.target as IDBRequest).result;
        if (cursor) {
          const morph = cursor.value;
          if (morph.translationId === packId || morph.id?.startsWith(packId + ':')) {
            cursor.delete();
          }
          cursor.continue();
        } else {
          resolve();
        }
      };
      morphCursor.onerror = () => reject(morphCursor.error);
    });
    
    // Delete places from this pack (scan all since packId index might not exist)
    const placesStore = tx.objectStore('places');
    const placesCursor = placesStore.openCursor();
    
    await new Promise<void>((resolve, reject) => {
      placesCursor.onsuccess = (event) => {
        const cursor = (event.target as IDBRequest).result;
        if (cursor) {
          const place = cursor.value;
          if (place.packId === packId) {
            cursor.delete();
          }
          cursor.continue();
        } else {
          resolve();
        }
      };
      placesCursor.onerror = () => reject(placesCursor.error);
    });
    
    // Delete map layers from this pack
    const layersStore = tx.objectStore('historical_layers');
    const layersCursor = layersStore.openCursor();
    
    await new Promise<void>((resolve, reject) => {
      layersCursor.onsuccess = (event) => {
        const cursor = (event.target as IDBRequest).result;
        if (cursor) {
          const layer = cursor.value;
          if (layer.packId === packId) {
            cursor.delete();
          }
          cursor.continue();
        } else {
          resolve();
        }
      };
      layersCursor.onerror = () => reject(layersCursor.error);
    });
    
    await waitForTransaction(tx);
  } finally {
    db.close();
  }
}

/**
 * Clear only non-user data (packs, verses, places, maps)
 * Keeps user notes, highlights, bookmarks
 */
export async function clearPacksOnly(): Promise<void> {
  const db = await openDB();
  
  try {
    const tx = db.transaction(
      ['packs', 'verses', 'places', 'map_tiles', 'historical_layers', 'place_name_links'],
      'readwrite'
    );
    
    await Promise.all([
      clearStore(tx.objectStore('packs')),
      clearStore(tx.objectStore('verses')),
      clearStore(tx.objectStore('places')),
      clearStore(tx.objectStore('map_tiles')),
      clearStore(tx.objectStore('historical_layers')),
      clearStore(tx.objectStore('place_name_links'))
    ]);
    
    await waitForTransaction(tx);
    console.log('Cleared all pack data while preserving user data');
  } finally {
    db.close();
  }
}

/**
 * List all installed packs
 */
export async function listInstalledPacks(): Promise<Array<{ id: string; type: string; version: string; size: number }>> {
  const db = await openDB();
  
  try {
    const tx = db.transaction('packs', 'readonly');
    const store = tx.objectStore('packs');
    
    return new Promise((resolve, reject) => {
      const request = store.getAll();
      request.onsuccess = () => {
        const packs = request.result.map(pack => ({
          id: pack.id,
          type: pack.type,
          version: pack.version,
          size: pack.size
        }));
        resolve(packs);
      };
      request.onerror = () => reject(request.error);
    });
  } finally {
    db.close();
  }
}

// ===== Helper functions =====

function countRecords(db: IDBDatabase, storeName: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readonly');
    const store = tx.objectStore(storeName);
    const request = store.count();
    
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function clearStore(store: IDBObjectStore): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = store.clear();
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

function waitForTransaction(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(new Error('Transaction aborted'));
  });
}
