/**
 * translationBooks.ts
 *
 * Which books a translation actually has. The Greek texts (TR, BYZ) are New
 * Testament only, the Hebrew and the Septuagint Old Testament only, and the
 * LXX lemma pack has no Nehemiah (the Septuagint folds it into Ezra), so the
 * answer is read from the installed verses rather than written down here.
 *
 * Walks the translation_book index one key per book, so it is ~66 steps, not
 * a pass over every verse. Results are kept per translation; an empty answer
 * (pack still importing, or the read failed) is not kept and comes back null,
 * which callers treat as "don't know" and leave every book alone.
 */

import { openDB } from '../adapters/db.js';

const cache = new Map<string, Set<string>>();

/** Book names as the app spells them (packs store "Psalms"; the app says "Psalm"). */
function appName(book: string): string {
  return book === 'Psalms' ? 'Psalm' : book;
}

export async function booksInTranslation(translation: string): Promise<Set<string> | null> {
  const id = translation.toLowerCase();
  const known = cache.get(id);
  if (known) return known;

  try {
    const db = await openDB();
    const books = await new Promise<Set<string>>((resolve, reject) => {
      const index = db.transaction('verses', 'readonly').objectStore('verses').index('translation_book');
      // [id] up to [id, []]: arrays sort after every string, so this spans every book.
      const request = index.openKeyCursor(IDBKeyRange.bound([id], [id, []]), 'nextunique');
      const found = new Set<string>();
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) return resolve(found);
        found.add(appName((cursor.key as [string, string])[1]));
        cursor.continue();
      };
      request.onerror = () => reject(request.error);
    });
    if (books.size === 0) return null;
    cache.set(id, books);
    return books;
  } catch (error) {
    console.error('[translationBooks] Could not read books for', translation, error);
    return null;
  }
}
