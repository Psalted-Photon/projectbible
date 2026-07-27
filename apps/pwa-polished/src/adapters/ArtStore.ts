import type { ArtStore, ArtScene, ArtWork, BCV } from '@projectbible/core';
import { openDB } from './db';
import type { DBArtScene, DBArtImage } from './db';
import { BIBLE_BOOKS } from '../lib/bibleData';

/** Canonical book order for sorting the browsable gallery. */
const CANONICAL_ORDER: string[] = BIBLE_BOOKS.map((b) => b.name);

/** Session cache of image id → object URL (created once, reused across renders). */
const imageUrlCache = new Map<string, string>();

/**
 * IndexedDB implementation of ArtStore.
 * Reads biblical-art scenes (famous paintings anchored to passages) from the
 * `art_scenes` store, populated when the user installs the art.sqlite pack.
 */
export class IndexedDBArtStore implements ArtStore {
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
    if (!id) return null;
    const cached = imageUrlCache.get(id);
    if (cached) return cached;
    try {
      const db = await openDB();
      const row = await new Promise<DBArtImage | undefined>((resolve, reject) => {
        const tx = db.transaction('art_images', 'readonly');
        const req = tx.objectStore('art_images').get(id);
        req.onsuccess = () => resolve(req.result as DBArtImage | undefined);
        req.onerror = () => reject(req.error);
      });
      if (!row?.data) return null;
      const url = URL.createObjectURL(new Blob([row.data], { type: row.mime || 'image/jpeg' }));
      imageUrlCache.set(id, url);
      return url;
    } catch {
      return null;
    }
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
