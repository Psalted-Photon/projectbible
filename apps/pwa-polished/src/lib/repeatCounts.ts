/**
 * repeatCounts.ts
 *
 * Counts how many times each repeat word occurs in a whole book, using the
 * same match rule as the highlights (whitespace tokens of the *rendered* verse
 * text, normalized) so footnote markers and stored-text artifacts aren't
 * counted. Results are cached per `translation:book`.
 */

import { IndexedDBTextStore } from './adapters';
import { renderVerseHtml, extractHeading } from './verseRendering';
import { normalizeRepeatWord } from '../stores/repeatsStore';
import { BIBLE_BOOKS } from './bibleData';

const textStore = new IndexedDBTextStore();

// translation:book -> (normalized word -> count)
const freqCache = new Map<string, Map<string, number>>();

function chapterCount(book: string): number {
  return BIBLE_BOOKS.find((b) => b.name === book)?.chapters ?? 1;
}

/** Build (and cache) the full normalized-token frequency map for a book. */
async function getBookFrequency(translation: string, book: string): Promise<Map<string, number>> {
  const key = `${translation}:${book}`;
  const cached = freqCache.get(key);
  if (cached) return cached;

  const freq = new Map<string, number>();
  const tmp = document.createElement('div');
  const n = chapterCount(book);

  for (let chapter = 1; chapter <= n; chapter++) {
    let verses: { text: string }[] = [];
    try {
      verses = (await textStore.getChapter(translation, book, chapter)) as any[];
    } catch {
      continue;
    }
    if (!verses) continue;
    for (const v of verses) {
      const { textWithoutHeading } = extractHeading(v.text);
      const cleanText = textWithoutHeading.replace(/^¶\s*/, '');
      tmp.innerHTML = renderVerseHtml(cleanText);
      const rendered = tmp.textContent || '';
      for (const tok of rendered.split(/(\s+)/)) {
        if (!tok.trim()) continue;
        const norm = normalizeRepeatWord(tok);
        if (!norm) continue;
        freq.set(norm, (freq.get(norm) ?? 0) + 1);
      }
    }
  }

  freqCache.set(key, freq);
  return freq;
}

/**
 * Count occurrences of each given (already-normalized) word in a book.
 * Returns a Map word -> count.
 */
export async function countWordsInBook(
  translation: string,
  book: string,
  words: string[],
): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (words.length === 0) return out;
  const freq = await getBookFrequency(translation, book);
  for (const w of words) out.set(w, freq.get(w) ?? 0);
  return out;
}
