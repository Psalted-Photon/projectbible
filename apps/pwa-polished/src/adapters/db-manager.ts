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
/** The encyclopedia's six stores, and Nave's five. */
const ISBE_STORES = [
  'isbe_entries',
  'isbe_entry_names',
  'isbe_tokens',
  'isbe_places',
  'isbe_place_names',
  'isbe_place_verses',
];
const NAVES_STORES = ['naves_topics', 'naves_names', 'naves_points', 'naves_verses', 'naves_tokens'];

/**
 * Stores that a finished install of each pack must have put rows in.
 *
 * Only the reference works whose import fills every one of their own stores in
 * a single run. Deliberately not 'art': its images arrive in separate shard
 * packs, so an art install with an empty art_images store is normal, and
 * treating that as damage would re-download it on every launch forever.
 */
const REQUIRED_STORES_BY_TYPE: Record<string, string[]> = {
  isbe: ISBE_STORES,
  encyclotopical: [...ISBE_STORES, ...NAVES_STORES],
  people: ['people', 'person_names', 'person_verses'],
};

/**
 * Did this pack's data actually all arrive?
 *
 * A pack is imported one table at a time, and an import can be killed partway
 * through — Chrome reclaiming the tab under memory pressure is the usual way.
 * What that leaves behind is a registry row saying "installed" over stores that
 * are partly or entirely empty. The Encyclotopical pack failed exactly this way:
 * the encyclopedia and the topic list arrived, the outline points stopped a
 * fifth of the way in, and the verse links never started — so every topic past
 * the letter C showed a header promising references above an empty card.
 *
 * An empty store is the cheap, unambiguous signal. A store that is short rather
 * than empty isn't caught here, but the tables import in order, so a run that
 * died anywhere leaves at least one of the later ones with nothing in it.
 */
export async function packDataLooksComplete(packId: string, packType: string): Promise<boolean> {
  const required = REQUIRED_STORES_BY_TYPE[packType];
  if (!required) return true;

  const db = await openDB();
  // A pack whose schema postdates this database has stores that aren't there to
  // count; that's a migration matter, not a half-finished install.
  const present = required.filter((name) => db.objectStoreNames.contains(name));
  if (!present.length) return true;

  for (const name of present) {
    const count = await new Promise<number>((resolve) => {
      const req = db.transaction(name, 'readonly').objectStore(name).count();
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(0);
    });
    if (count === 0) {
      console.warn(`[packs] ${packId}: "${name}" is empty — the last install did not finish`);
      return false;
    }
  }
  return true;
}

export async function removePack(packId: string): Promise<void> {
  // Step 1: Read all pack metadata to determine type and collect sub-pack IDs / translation IDs.
  // Virtual sub-packs (e.g. 'translations-consolidated-KJV') share the packId prefix.
  let allPacks: Array<{ id: string; type: string; translationId?: string }> = [];
  await withTx('packs', 'readonly', tx => {
    const req = tx.objectStore('packs').getAll();
    req.onsuccess = () => { allPacks = req.result ?? []; };
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

  // Step 2: Clear type-specific data stores. Every transaction goes through
  // withTx, which re-acquires the connection and rejects on abort — without
  // that, a removal interrupted partway just stopped, silently.

  if (packType === 'references') {
    await withTx(['tsk_references'], 'readwrite', tx => {
      tx.objectStore('tsk_references').clear();
    });

  } else if (packType === 'commentary') {
    await withTx(['commentary_entries'], 'readwrite', tx => {
      tx.objectStore('commentary_entries').clear();
    });

  } else if (packType === 'lexicon') {
    const lexStores = [
      'greek_strongs_entries', 'hebrew_strongs_entries', 'lexicon_entries',
      'english_words', 'english_grammar', 'word_occurrences', 'strongs_entries'
    ] as const;
    await withTx([...lexStores], 'readwrite', tx => {
      lexStores.forEach(s => tx.objectStore(s).clear());
    });

  } else if (packType === 'dictionary') {
    const dictStores = [
      'english_definitions_modern', 'english_definitions_historic', 'word_mapping'
    ] as const;
    await withTx([...dictStores], 'readwrite', tx => {
      dictStores.forEach(s => tx.objectStore(s).clear());
    });

  } else if (packType === 'study') {
    const studyStores = [
      'chronological_order', 'places', 'pleiades_places', 'pleiades_names',
      'pleiades_locations', 'openbible_locations', 'openbible_places',
      'openbible_identifications', 'place_name_links', 'historical_layers', 'map_tiles'
    ] as const;
    await withTx([...studyStores], 'readwrite', tx => {
      studyStores.forEach(s => tx.objectStore(s).clear());
    });
    // Delete non-user cross-references (preserve any user-added ones)
    await withTx(['cross_references'], 'readwrite', tx => {
      const cursor = tx.objectStore('cross_references').openCursor();
      cursor.onsuccess = (event) => {
        const c = (event.target as IDBRequest).result as IDBCursorWithValue | null;
        if (c) { if (c.value.source !== 'user') c.delete(); c.continue(); }
      };
    });

  } else if (packType === 'audio') {
    await withTx(['audio_chapters'], 'readwrite', tx => {
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
    });

  } else if (packType === 'text') {
    // Both cursors run concurrently inside one transaction — IDB keeps it open
    // until all pending cursor activity is exhausted.
    await withTx(['verses', 'morphology'], 'readwrite', tx => {
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
    });

  } else {
    // Reference works: every row belongs to the one pack, so the stores are
    // simply emptied. These had no branch at all, which meant deleting the
    // encyclopedia removed its registry row and left all of its data in place
    // — the pack looked gone but every article still worked.
    const STORES_BY_TYPE: Record<string, string[]> = {
      ...REQUIRED_STORES_BY_TYPE,
      // Removal covers more than the completeness check does: art's images
      // arrive in shard packs, but deleting art should still take them with it.
      art: ['art_scenes', 'art_images'],
      geonames: ['modern_places'],
      headings: ['section_headings'],
    };

    // Only clear stores this database actually has — the list spans packs whose
    // schema may predate or postdate any given install.
    const db = await openDB();
    const stores = (STORES_BY_TYPE[packType] ?? []).filter(name =>
      db.objectStoreNames.contains(name),
    );

    if (stores.length) {
      await withTx(stores, 'readwrite', tx => {
        stores.forEach(name => tx.objectStore(name).clear());
      });
    }
  }

  // Step 3: Delete pack metadata for main pack and all virtual sub-packs
  await withTx(['packs'], 'readwrite', tx => {
    const store = tx.objectStore('packs');
    allPackIds.forEach(id => store.delete(id));
  });

  // Step 4: Drop the downloaded file the loader kept. Without this a deleted
  // pack leaves its whole payload behind — 77 MB for the encyclopedia — and
  // reinstalling replays those bytes instead of fetching anything.
  try {
    const { getPackLoader } = await import('../lib/progressive-init');
    await getPackLoader().removeCachedPack(packId);
  } catch (error) {
    // The blob is a cache; failing to clear it must not fail the removal.
    console.warn(`Could not clear cached file for ${packId}:`, error);
  }
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

/**
 * Run one transaction on a freshly-acquired connection.
 *
 * Two failure modes this exists to close, both of which used to surface as the
 * UI simply going quiet:
 *
 * - A connection closed by `versionchange` (the Clear Cache button deletes the
 *   database) leaves any handle held across an await dead, so the next
 *   `db.transaction()` throws InvalidStateError. Re-acquiring per transaction
 *   means there is no stale handle to hold.
 * - An aborted transaction fires neither `oncomplete` nor `onerror`. Without an
 *   `onabort` handler the promise never settles and the caller waits forever.
 *
 * `setup` must issue its requests synchronously — capture results in a closure
 * rather than awaiting inside it, or the transaction will auto-commit early.
 */
async function withTx(
  stores: string | string[],
  mode: IDBTransactionMode,
  setup: (tx: IDBTransaction) => void
): Promise<void> {
  const db = await openDB();
  const tx = db.transaction(stores, mode);

  const settled = new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error(`Transaction failed on ${stores}`));
    tx.onabort = () => reject(tx.error ?? new Error(`Transaction aborted on ${stores}`));
  });

  setup(tx);
  return settled;
}
