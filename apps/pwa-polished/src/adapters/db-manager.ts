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

  // Step 1: Read all pack metadata to determine type and collect sub-pack IDs / translation IDs.
  // Virtual sub-packs (e.g. 'translations-consolidated-KJV') share the packId prefix.
  const allPacks: Array<{ id: string; type: string; translationId?: string }> =
    await new Promise((resolve, reject) => {
      const tx = db.transaction('packs', 'readonly');
      const req = tx.objectStore('packs').getAll();
      req.onsuccess = () => resolve(req.result ?? []);
      req.onerror = () => reject(req.error);
    });

  const pack = allPacks.find(p => p.id === packId);
  if (!pack) return; // already gone

  const subPackIds = allPacks
    .filter(p => p.id !== packId && p.id.startsWith(packId + '-'))
    .map(p => p.id);
  const allPackIds = [packId, ...subPackIds];

  const translationIds = new Set<string>(
    allPackIds
      .map(id => allPacks.find(p => p.id === id)?.translationId)
      .filter((t): t is string => Boolean(t))
  );

  const packType = pack.type;

  // Step 2: Clear type-specific data stores using separate transactions so there
  // is no risk of the IDB transaction auto-committing between awaited cursor calls.

  if (packType === 'references') {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(['tsk_references'], 'readwrite');
      tx.objectStore('tsk_references').clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });

  } else if (packType === 'commentary') {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(['commentary_entries'], 'readwrite');
      tx.objectStore('commentary_entries').clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });

  } else if (packType === 'lexicon') {
    const lexStores = [
      'greek_strongs_entries', 'hebrew_strongs_entries', 'lexicon_entries',
      'english_words', 'english_synonyms', 'thesaurus_synonyms', 'thesaurus_antonyms',
      'english_grammar', 'word_occurrences', 'strongs_entries'
    ] as const;
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction([...lexStores], 'readwrite');
      lexStores.forEach(s => tx.objectStore(s).clear());
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });

  } else if (packType === 'dictionary') {
    const dictStores = [
      'english_definitions_modern', 'english_definitions_historic', 'word_mapping'
    ] as const;
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction([...dictStores], 'readwrite');
      dictStores.forEach(s => tx.objectStore(s).clear());
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });

  } else if (packType === 'study') {
    const studyStores = [
      'chronological_order', 'places', 'pleiades_places', 'pleiades_names',
      'pleiades_locations', 'openbible_locations', 'openbible_places',
      'openbible_identifications', 'place_name_links', 'historical_layers', 'map_tiles'
    ] as const;
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction([...studyStores], 'readwrite');
      studyStores.forEach(s => tx.objectStore(s).clear());
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    // Delete non-user cross-references (preserve any user-added ones)
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(['cross_references'], 'readwrite');
      const cursor = tx.objectStore('cross_references').openCursor();
      cursor.onsuccess = (event) => {
        const c = (event.target as IDBRequest).result as IDBCursorWithValue | null;
        if (c) { if (c.value.source !== 'user') c.delete(); c.continue(); }
      };
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });

  } else if (packType === 'audio') {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(['audio_chapters'], 'readwrite');
      const cursor = tx.objectStore('audio_chapters').openCursor();
      cursor.onsuccess = (event) => {
        const c = (event.target as IDBRequest).result as IDBCursorWithValue | null;
        if (c) {
          if (
            translationIds.has(c.value.translationId) ||
            allPackIds.some(id => c.value.id?.startsWith(id + ':'))
          ) c.delete();
          c.continue();
        }
      };
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });

  } else if (packType === 'text') {
    // Both cursors run concurrently inside one transaction — IDB keeps it open
    // until all pending cursor activity is exhausted.
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(['verses', 'morphology'], 'readwrite');

      const versesCursor = tx.objectStore('verses').openCursor();
      versesCursor.onsuccess = (event) => {
        const c = (event.target as IDBRequest).result as IDBCursorWithValue | null;
        if (c) {
          if (
            translationIds.has(c.value.translationId) ||
            allPackIds.some(id => c.value.id?.startsWith(id + ':'))
          ) c.delete();
          c.continue();
        }
      };

      const morphCursor = tx.objectStore('morphology').openCursor();
      morphCursor.onsuccess = (event) => {
        const c = (event.target as IDBRequest).result as IDBCursorWithValue | null;
        if (c) {
          if (
            translationIds.has(c.value.translationId) ||
            allPackIds.some(id => c.value.id?.startsWith(id + ':'))
          ) c.delete();
          c.continue();
        }
      };

      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  // Step 3: Delete pack metadata for main pack and all virtual sub-packs
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(['packs'], 'readwrite');
    const store = tx.objectStore('packs');
    allPackIds.forEach(id => store.delete(id));
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/**
 * Clear only non-user data (packs, verses, places, maps)
 * Keeps user notes, highlights, bookmarks
 */
export async function clearPacksOnly(): Promise<void> {
  const db = await openDB();

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
}

/**
 * List all installed packs
 */
export async function listInstalledPacks(): Promise<Array<{ id: string; type: string; version: string; size: number }>> {
  const db = await openDB();

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
}

/**
 * Returns true if the audio pack has chapter index entries in IndexedDB.
 * False means the OPFS file may still exist but the index was evicted —
 * the pack should be offered a Re-index rather than a full re-download.
 */
export async function audioPackHasChapters(packId: string): Promise<boolean> {
  const db = await openDB();

  const packRecord = await new Promise<{ translationId?: string } | undefined>((resolve, reject) => {
    const tx = db.transaction('packs', 'readonly');
    const req = tx.objectStore('packs').get(packId);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });

  if (!packRecord?.translationId) return false;

  const chapter = await new Promise<unknown>((resolve, reject) => {
    const tx = db.transaction('audio_chapters', 'readonly');
    const req = tx.objectStore('audio_chapters').index('translationId').get(packRecord.translationId!);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });

  return !!chapter;
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
