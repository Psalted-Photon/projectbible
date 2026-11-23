/**
 * The saved opening: about the first minute of the next alarm's reading, made
 * ahead of time so Start reading speaks at once (lib/tts/readingEngine.ts,
 * makeOpening). One item, replaced each time, about 3 MB.
 *
 * Its own small database, apart from the app's, so it never waits on a pack
 * install's upgrade and losing it costs nothing: the alarm screen just makes
 * one live instead.
 */

export interface SavedOpening {
  translation: string;
  book: string;
  chapter: number;
  /** The session voice it was made with. */
  voiceId: string;
  /**
   * Each line it holds, word for word with its voice and pause, in order. A
   * start uses it only when its own first lines are exactly these.
   */
  lines: string[];
  /** One WAV, pauses included. */
  wav: Blob;
  sampleRate: number;
  /** Where each line starts in the WAV, and how long its speech runs. */
  marks: { startSeconds: number; seconds: number }[];
  seconds: number;
  madeAt: number;
}

const DB_NAME = 'projectbible-saved-opening';
const STORE = 'opening';
const KEY = 'next';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** The saved opening, or null when there is none or it can't be read. */
export async function readSavedOpening(): Promise<SavedOpening | null> {
  try {
    const db = await openDb();
    try {
      return await new Promise<SavedOpening | null>((resolve, reject) => {
        const req = db.transaction(STORE, 'readonly').objectStore(STORE).get(KEY);
        req.onsuccess = () => resolve((req.result as SavedOpening | undefined) ?? null);
        req.onerror = () => reject(req.error);
      });
    } finally {
      db.close();
    }
  } catch (err) {
    console.warn('[Opening] could not read the saved opening:', err);
    return null;
  }
}

export async function writeSavedOpening(opening: SavedOpening): Promise<void> {
  const db = await openDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(opening, KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}
