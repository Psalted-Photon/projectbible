import type { ArtStore, ArtScene, ArtWork, BCV } from '@projectbible/core';
import { openDB } from './db';
import type { DBArtScene, DBArtImage } from './db';
import { BIBLE_BOOKS } from '../lib/bibleData';
import { downscaleBlob, enqueueThumbTask, thumbKey, THUMB_SKIP_BYTES } from '../lib/artThumbs';

/**
 * Re-view stored bytes so they can go into a Blob.
 *
 * IndexedDB hands back a Uint8Array typed against ArrayBufferLike, which the
 * DOM lib won't take as a BlobPart. Wrapping the same memory in a fresh view
 * satisfies it without copying the megabytes back out.
 */
function asBlobPart(data: Uint8Array) {
  return new Uint8Array(data.buffer as ArrayBuffer, data.byteOffset, data.byteLength);
}

/** Canonical book order for sorting the browsable gallery. */
const CANONICAL_ORDER: string[] = BIBLE_BOOKS.map((b) => b.name);


/**
 * IndexedDB implementation of ArtStore.
 * Reads biblical-art scenes (famous paintings anchored to passages) from the
 * `art_scenes` store, populated when the user installs the art.sqlite pack.
 */
export class IndexedDBArtStore implements ArtStore {
  /**
   * Image id → object URL, created once and reused across renders.
   *
   * Per instance, not per module: object URLs hold their blob in memory until
   * they are revoked, and a module-level cache outlived the pane that made it,
   * so browsing the gallery pinned the whole pack until a reload. Each pane owns
   * its own map and drops it in releaseImages(), which keeps one pane's cleanup
   * from breaking images another pane is still showing.
   */
  private imageUrlCache = new Map<string, string>();

  /**
   * Set by releaseImages(), which is a teardown call -- the pane is going away.
   * Previews are generated in the background, so without this a slow one could
   * finish afterwards and mint an object URL that nothing is left to revoke.
   */
  private disposed = false;

  /** Get a scene (with its artworks) by id */
  async getScene(id: string): Promise<ArtScene | null> {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('art_scenes', 'readonly');
      const req = tx.objectStore('art_scenes').get(id);
      req.onsuccess = () => resolve(req.result ? this.toScene(req.result as DBArtScene) : null);
      req.onerror = () => reject(req.error);
    });
  }

  /** Scenes anchored exactly at this verse (icon tap → gallery) */
  async getScenesForVerse(reference: BCV): Promise<ArtScene[]> {
    try {
      const db = await openDB();
      return await new Promise((resolve, reject) => {
        const tx = db.transaction('art_scenes', 'readonly');
        const index = tx.objectStore('art_scenes').index('anchor');
        const range = IDBKeyRange.only([reference.book, reference.chapter, reference.verse]);
        const req = index.getAll(range);
        req.onsuccess = () => resolve((req.result as DBArtScene[]).map((r) => this.toScene(r)));
        req.onerror = () => reject(req.error);
      });
    } catch {
      return [];
    }
  }

  /** All scenes anchored within a chapter (reader marks which verses get an icon) */
  async getScenesForChapter(book: string, chapter: number): Promise<ArtScene[]> {
    try {
      const db = await openDB();
      return await new Promise((resolve, reject) => {
        const tx = db.transaction('art_scenes', 'readonly');
        const index = tx.objectStore('art_scenes').index('book_chapter');
        const range = IDBKeyRange.only([book, chapter]);
        const req = index.getAll(range);
        req.onsuccess = () => resolve((req.result as DBArtScene[]).map((r) => this.toScene(r)));
        req.onerror = () => reject(req.error);
      });
    } catch {
      return [];
    }
  }

  /** Every installed scene, for a browsable gallery (canonical order) */
  async getAllScenes(): Promise<ArtScene[]> {
    try {
      const db = await openDB();
      const scenes = await new Promise<ArtScene[]>((resolve, reject) => {
        const tx = db.transaction('art_scenes', 'readonly');
        const req = tx.objectStore('art_scenes').getAll();
        req.onsuccess = () => resolve((req.result as DBArtScene[]).map((r) => this.toScene(r)));
        req.onerror = () => reject(req.error);
      });
      return scenes.sort((a, b) => {
        const ai = CANONICAL_ORDER.indexOf(a.book);
        const bi = CANONICAL_ORDER.indexOf(b.book);
        if (ai !== bi) return ai - bi;
        if (a.chapter !== b.chapter) return a.chapter - b.chapter;
        return a.verse - b.verse;
      });
    } catch {
      return [];
    }
  }

  /** Free-text search across scene titles, artists, and work titles */
  async searchScenes(query: string): Promise<ArtScene[]> {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    try {
      const db = await openDB();
      return await new Promise((resolve, reject) => {
        const tx = db.transaction('art_scenes', 'readonly');
        const req = tx.objectStore('art_scenes').getAll();
        req.onsuccess = () => {
          const scenes = (req.result as DBArtScene[]).map((r) => this.toScene(r));
          resolve(
            scenes.filter(
              (s) =>
                s.title.toLowerCase().includes(q) ||
                s.works.some(
                  (w) =>
                    (!!w.title && w.title.toLowerCase().includes(q)) ||
                    (!!w.artist && w.artist.toLowerCase().includes(q))
                )
            )
          );
        };
        req.onerror = () => reject(req.error);
      });
    } catch {
      return [];
    }
  }

  /**
   * Resolve a bundled image id to a displayable object URL.
   * Reads the blob from the art_images store and caches the URL for the session
   * (so repeated renders reuse it). Returns null if the image isn't installed.
   */
  async getImageUrl(id: string): Promise<string | null> {
    if (!id || this.disposed) return null;
    const cached = this.imageUrlCache.get(id);
    if (cached) return cached;
    try {
      const db = await openDB();
      const row = await this.readImage(db, id);
      if (!row?.data) return null;
      return this.cacheBlobUrl(id, row.data, row.mime);
    } catch {
      return null;
    }
  }

  /**
   * Resolve an image id to a small preview URL, generating one if needed.
   *
   * The art pack has no usable thumbnails -- `thumbId` falls back to the full
   * image everywhere -- so the browse grid would otherwise decode dozens of
   * multi-megabyte JPEGs to paint small squares. The downscaled copy is written
   * back into `art_images` under a prefixed key, which needs no schema change:
   * every read of that store is a keyed `.get`, so the extra rows are invisible
   * to the rest of the app, and importing or removing the pack clears them
   * along with everything else, so the cache heals itself.
   *
   * Falls back to the full image if the preview can't be made, so a decode
   * failure costs memory rather than showing a blank tile.
   */
  async getThumbUrl(id: string): Promise<string | null> {
    if (!id || this.disposed) return null;
    const key = thumbKey(id);

    const cached = this.imageUrlCache.get(key);
    if (cached) return cached;

    try {
      const db = await openDB();
      const existing = await this.readImage(db, key);
      if (existing?.data) return this.cacheBlobUrl(key, existing.data, existing.mime);

      // Collapse duplicate work: two panes browsing at once ask for the same
      // previews, and generating is far more expensive than the read above.
      //
      // The shared task yields bytes rather than an object URL on purpose. URLs
      // are owned per instance and revoked in releaseImages(), so handing one
      // pane's URL to another would break its images the moment the first pane
      // closed -- the same trap the imageUrlCache comment describes.
      const made = await enqueueThumbTask(key, async () => {
        // Another instance may have generated and stored it while this call
        // waited its turn in the queue.
        const raced = await this.readImage(db, key);
        if (raced?.data) return { data: raced.data, mime: raced.mime };

        const source = await this.readImage(db, id);
        if (!source?.data) return null;

        const mime = source.mime || 'image/jpeg';

        // Already small enough that re-encoding would only lose quality.
        if (source.data.byteLength <= THUMB_SKIP_BYTES) return { data: source.data, mime };

        const small = await downscaleBlob(new Blob([asBlobPart(source.data)], { type: mime }));
        if (!small) return { data: source.data, mime };

        const bytes = new Uint8Array(await small.arrayBuffer());

        // Persisting is an optimisation for next time, not part of showing the
        // image now -- a full quota must not blank the gallery.
        try {
          await new Promise<void>((resolve, reject) => {
            const tx = db.transaction('art_images', 'readwrite');
            tx.objectStore('art_images').put({ id: key, mime: 'image/jpeg', data: bytes });
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
            tx.onabort = () => reject(tx.error);
          });
        } catch {
          // Keep the generated preview for this session anyway.
        }

        return { data: bytes, mime: 'image/jpeg' };
      });

      if (!made || this.disposed) return null;
      return this.cacheBlobUrl(key, made.data, made.mime);
    } catch {
      return null;
    }
  }

  /** One keyed read from the image store. */
  private readImage(db: IDBDatabase, key: string): Promise<DBArtImage | undefined> {
    return new Promise((resolve, reject) => {
      const tx = db.transaction('art_images', 'readonly');
      const req = tx.objectStore('art_images').get(key);
      req.onsuccess = () => resolve(req.result as DBArtImage | undefined);
      req.onerror = () => reject(req.error);
    });
  }

  /** Wrap stored bytes in an object URL and remember it for releaseImages(). */
  private cacheBlobUrl(key: string, data: Uint8Array, mime?: string): string {
    const url = URL.createObjectURL(new Blob([asBlobPart(data)], { type: mime || 'image/jpeg' }));
    this.imageUrlCache.set(key, url);
    return url;
  }

  /**
   * Revoke every object URL this store handed out and forget them.
   *
   * Call when the pane using it goes away; the URLs are dead afterwards, so the
   * caller must drop any it is still holding.
   */
  releaseImages(): void {
    this.disposed = true;
    for (const url of this.imageUrlCache.values()) URL.revokeObjectURL(url);
    this.imageUrlCache.clear();
  }

  // ===== Conversion helpers =====

  private toScene(row: DBArtScene): ArtScene {
    let works: ArtWork[] = [];
    try {
      works = row.works ? JSON.parse(row.works) : [];
    } catch {
      works = [];
    }
    return {
      id: row.id,
      title: row.title,
      book: row.book,
      chapter: row.chapter,
      verse: row.verse,
      passageLabel: row.passageLabel,
      works,
    };
  }
}
