import { openDB, type DBSectionHeading } from './db.js';

/**
 * Reads section headings (pericope titles) from the section_headings IndexedDB store.
 * Populated when the user installs headings.sqlite pack.
 */
export class HeadingsStore {
  /**
   * Returns a Map<verseNumber, { heading, level }> for a given book + chapter.
   * Returns an empty map if the pack is not installed or has no data for this chapter.
   */
  async getChapterHeadings(
    book: string,
    chapter: number
  ): Promise<Map<number, { heading: string; level: number }>> {
    try {
      const db = await openDB();
      return new Promise((resolve, reject) => {
        const tx = db.transaction('section_headings', 'readonly');
        const store = tx.objectStore('section_headings');
        const index = store.index('book_chapter');
        const range = IDBKeyRange.only([book, chapter]);
        const request = index.getAll(range);

        request.onsuccess = () => {
          const map = new Map<number, { heading: string; level: number }>();
          for (const row of request.result as DBSectionHeading[]) {
            map.set(row.verse, { heading: row.heading, level: row.level });
          }
          resolve(map);
        };

        request.onerror = () => reject(request.error);
      });
    } catch {
      return new Map();
    }
  }

  /**
   * Returns true if the section-headings pack has been installed.
   */
  async isInstalled(): Promise<boolean> {
    try {
      const db = await openDB();
      return new Promise((resolve) => {
        const tx = db.transaction('packs', 'readonly');
        const store = tx.objectStore('packs');
        const req = store.get('section-headings');
        req.onsuccess = () => resolve(!!req.result);
        req.onerror = () => resolve(false);
      });
    } catch {
      return false;
    }
  }
}
