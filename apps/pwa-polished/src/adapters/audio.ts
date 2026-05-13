/**
 * Audio adapter for BSB audio packs.
 *
 * Install flow
 * ────────────
 * Stream-fetches the 1.76 / 1.65 GB SQLite pack directly to OPFS
 * (no full ArrayBuffer in memory).  Once written, wa-sqlite + OPFSAnyContextVFS
 * reads only the metadata table and chapter list into IndexedDB.
 *
 * Playback flow
 * ─────────────
 * 1. Check `audio_cache` IndexedDB store — return cached Blob URL instantly.
 * 2. On cache miss: open the OPFS SQLite read-only, query a single chapter's
 *    `audio_data` BLOB, store to cache, return a new Blob URL.
 */

import { readTransaction, writeTransaction, batchWriteTransaction, openDB } from './db.js';

const OPFS_DIR = 'audio-packs';

// ─── lazy-init wa-sqlite (load WASM only once) ──────────────────────────────

let _sqlite3: any = null;

async function getSQLite(): Promise<any> {
  if (_sqlite3) return _sqlite3;

  const [{ default: SQLiteESMFactory }, { OPFSAnyContextVFS }, { Factory }] =
    await Promise.all([
      import('@journeyapps/wa-sqlite/dist/wa-sqlite-async.mjs'),
      import('@journeyapps/wa-sqlite/src/examples/OPFSAnyContextVFS.js'),
      import('@journeyapps/wa-sqlite'),
    ]);

  const module = await SQLiteESMFactory();
  _sqlite3 = Factory(module);

  const vfs = await OPFSAnyContextVFS.create('pb-audio', module);
  _sqlite3.vfs_register(vfs, false);

  return _sqlite3;
}

// ─── OPFS helpers ────────────────────────────────────────────────────────────

async function getOPFSDir(): Promise<FileSystemDirectoryHandle> {
  const root = await navigator.storage.getDirectory();
  return root.getDirectoryHandle(OPFS_DIR, { create: true });
}

export function opfsPathForPack(packId: string): string {
  return `/${OPFS_DIR}/${packId}.sqlite`;
}

// ─── install ─────────────────────────────────────────────────────────────────

/**
 * Streams an audio pack from `url` directly to OPFS, then indexes its
 * chapter list into IndexedDB.  Never holds the full file in memory.
 *
 * @param url     Download URL (GitHub Releases CDN or local dev server)
 * @param packId  e.g. "bsb-audio-pt1"
 * @param onProgress  called with (bytesLoaded, bytesTotal) during download
 */
export async function installAudioPackToOPFS(
  url: string,
  packId: string,
  onProgress?: (loaded: number, total: number) => void
): Promise<void> {
  const dir = await getOPFSDir();
  const fileHandle = await dir.getFileHandle(`${packId}.sqlite`, { create: true });
  const writable = await fileHandle.createWritable();

  const response = await fetch(url);
  if (!response.ok) throw new Error(`Failed to fetch audio pack: ${response.statusText}`);

  const total = parseInt(response.headers.get('content-length') ?? '0', 10);
  let loaded = 0;
  const reader = response.body!.getReader();

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      await writable.write(value);
      loaded += value.length;
      onProgress?.(loaded, total);
    }
  } finally {
    await writable.close();
  }

  await _indexPackMetadata(packId);
}

/**
 * Writes an in-memory File (from drag-and-drop) to OPFS then indexes it.
 * The file is already in memory at this point, so we just pipe it straight through.
 */
export async function installAudioPackFromFile(
  file: File,
  packId: string,
  onProgress?: (loaded: number, total: number) => void
): Promise<void> {
  const dir = await getOPFSDir();
  const fileHandle = await dir.getFileHandle(`${packId}.sqlite`, { create: true });
  const writable = await fileHandle.createWritable();

  const total = file.size;
  let loaded = 0;
  const reader = file.stream().getReader();

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      await writable.write(value);
      loaded += value.length;
      onProgress?.(loaded, total);
    }
  } finally {
    await writable.close();
  }

  await _indexPackMetadata(packId);
}

async function _indexPackMetadata(packId: string): Promise<void> {
  const sqlite3 = await getSQLite();
  const { SQLITE_OPEN_READONLY, SQLITE_ROW } = await import('@journeyapps/wa-sqlite');
  const opfsPath = opfsPathForPack(packId);

  const db = await sqlite3.open_v2(opfsPath, SQLITE_OPEN_READONLY, 'pb-audio');
  try {
    // Read pack metadata
    const meta: Record<string, string> = {};
    for await (const stmt of sqlite3.statements(db, 'SELECT key, value FROM metadata')) {
      while ((await sqlite3.step(stmt)) === SQLITE_ROW) {
        meta[sqlite3.column_text(stmt, 0)] = sqlite3.column_text(stmt, 1);
      }
    }

    // Read chapter list (no blobs — just identifiers)
    const chapters: Array<{
      id: string;
      book: string;
      chapter: number;
      packId: string;
      format: string;
    }> = [];

    for await (const stmt of sqlite3.statements(
      db,
      'SELECT book, chapter, format FROM audio_chapters ORDER BY rowid'
    )) {
      while ((await sqlite3.step(stmt)) === SQLITE_ROW) {
        const book = sqlite3.column_text(stmt, 0);
        const chapter = sqlite3.column_int(stmt, 1);
        const format = sqlite3.column_text(stmt, 2);
        chapters.push({ id: `audio:${book}:${chapter}`, book, chapter, packId, format });
      }
    }

    // Persist pack record (opfsPath lets playback know where to find the file)
    await writeTransaction('packs', (store) =>
      store.put({
        id: packId,
        version: meta.pack_version ?? '1.0.0',
        type: 'audio' as const,
        translationId: meta.translation_id ?? 'BSB',
        translationName: meta.translation_name ?? 'BSB Audio',
        license: meta.license,
        size: 0,
        installedAt: Date.now(),
        description: meta.description,
        opfsPath,
      })
    );

    // Persist chapter index
    const CHUNK = 500;
    for (let i = 0; i < chapters.length; i += CHUNK) {
      const chunk = chapters.slice(i, i + CHUNK);
      await batchWriteTransaction('audio_chapters', (store) => {
        chunk.forEach((ch) => store.put(ch));
      });
    }

    console.log(`✅ Audio pack ${packId} indexed: ${chapters.length} chapters`);
  } finally {
    await sqlite3.close(db);
  }
}

// ─── playback ────────────────────────────────────────────────────────────────

/**
 * Returns a Blob URL for the given chapter's audio.
 * Checks IndexedDB cache first; on miss, reads from the OPFS SQLite file.
 * Returns null if no audio pack covering this chapter is installed.
 */
export async function getChapterAudio(
  book: string,
  chapter: number
): Promise<string | null> {
  const cacheKey = `audio:${book}:${chapter}`;

  // 1. Check IndexedDB cache
  const cached = await readTransaction<{ id: string; blob: Blob } | undefined>(
    'audio_cache',
    (store) => store.get(cacheKey)
  );
  if (cached?.blob) return URL.createObjectURL(cached.blob);

  // 2. Find the chapter index record (which pack + format)
  const chapMeta = await readTransaction<
    { packId: string; format: string } | undefined
  >('audio_chapters', (store) => store.get(cacheKey));
  if (!chapMeta) return null;

  // 3. Get the OPFS path from the pack record
  const packRecord = await readTransaction<{ opfsPath?: string } | undefined>(
    'packs',
    (store) => store.get(chapMeta.packId)
  );
  if (!packRecord?.opfsPath) return null;

  // 4. Read the blob from OPFS SQLite
  const audioData = await _readBlobFromOPFS(packRecord.opfsPath, book, chapter);
  if (!audioData) return null;

  // 5. Cache and return
  const blob = new Blob([audioData], { type: `audio/${chapMeta.format}` });
  await writeTransaction('audio_cache', (store) =>
    store.put({ id: cacheKey, blob })
  );

  return URL.createObjectURL(blob);
}

async function _readBlobFromOPFS(
  opfsPath: string,
  book: string,
  chapter: number
): Promise<Uint8Array | null> {
  const sqlite3 = await getSQLite();
  const { SQLITE_OPEN_READONLY, SQLITE_ROW } = await import('@journeyapps/wa-sqlite');

  const db = await sqlite3.open_v2(opfsPath, SQLITE_OPEN_READONLY, 'pb-audio');
  try {
    let result: Uint8Array | null = null;
    for await (const stmt of sqlite3.statements(
      db,
      'SELECT audio_data FROM audio_chapters WHERE book=? AND chapter=?'
    )) {
      sqlite3.bind_collection(stmt, [book, chapter]);
      if ((await sqlite3.step(stmt)) === SQLITE_ROW) {
        // .slice() copies out of WASM heap before the buffer can be invalidated
        result = sqlite3.column_blob(stmt, 0).slice();
      }
    }
    return result;
  } finally {
    await sqlite3.close(db);
  }
}

// ─── status helpers ───────────────────────────────────────────────────────────

/**
 * Returns true if audio for this chapter is available
 * (either cached or the pack is indexed).
 */
export async function isAudioAvailable(
  book: string,
  chapter: number
): Promise<boolean> {
  const key = `audio:${book}:${chapter}`;
  const cached = await readTransaction<any>('audio_cache', (s) => s.get(key));
  if (cached) return true;
  const meta = await readTransaction<any>('audio_chapters', (s) => s.get(key));
  return !!meta;
}

/**
 * Clears all cached audio blobs from IndexedDB.
 * Does NOT remove the OPFS pack files themselves.
 */
export async function clearAudioCache(): Promise<void> {
  const db = await openDB();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction('audio_cache', 'readwrite');
    tx.objectStore('audio_cache').clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
