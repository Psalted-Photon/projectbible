/**
 * repeatVerses.ts
 *
 * Every verse a repeat word is in, for the pill menu's "Show verses" list.
 * A verse counts when one of its whitespace tokens normalizes to the word —
 * the rule the in-text highlights and the pill count use (repeatCounts.ts).
 *
 * Two scopes: the current book, read chapter by chapter the way the pill
 * count reads it, so the list agrees with the pill; and every book, one pass
 * over the verse store for the current translation, the pass search makes.
 *
 * Filler words (the, and, it…) never list, and nor does any word in more than
 * MAX_LISTED verses; those report "too common" with how many verses they are
 * in. Results are cached per translation + word + scope.
 */

import { IndexedDBTextStore } from './adapters';
import { IndexedDBSearchIndex } from '../adapters/SearchIndex';
import { renderVerseHtml, extractHeading } from './verseRendering';
import { normalizeRepeatWord } from '../stores/repeatsStore';
import { BIBLE_BOOKS, normalizeBookName } from './bibleData';

export type RepeatVersesScope = 'book' | 'all';

export interface RepeatVerseHit {
  book: string;
  chapter: number;
  verse: number;
}

export type RepeatVerses =
  | { kind: 'list'; hits: RepeatVerseHit[] }
  | { kind: 'tooCommon'; count: number };

/** Past this many verses a list is no help to anyone. */
export const MAX_LISTED = 5000;

/** Words that carry no study value however few verses they are in. */
const FILLER_WORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'nor', 'but', 'yet', 'so', 'if', 'as', 'than',
  'of', 'to', 'in', 'on', 'at', 'by', 'for', 'from', 'with', 'into', 'unto',
  'upon', 'out', 'up', 'off', 'over', 'about',
  'it', 'its', 'i', 'me', 'my', 'mine', 'we', 'us', 'our', 'you', 'your', 'ye',
  'thee', 'thou', 'thy', 'thine', 'he', 'him', 'his', 'she', 'her', 'hers',
  'they', 'them', 'their', 'this', 'that', 'these', 'those', 'which', 'who',
  'whom', 'what', 'there', 'then',
  'is', 'am', 'are', 'was', 'were', 'be', 'been', 'being', 'have', 'has', 'had',
  'hath', 'do', 'did', 'does', 'shall', 'will', 'not', 'no',
]);

const textStore = new IndexedDBTextStore();
const searchIndex = new IndexedDBSearchIndex();

const cache = new Map<string, Promise<RepeatVerses>>();

function bookOrder(): Map<string, number> {
  return new Map(BIBLE_BOOKS.map((b, i) => [b.name, i]));
}

/** Does any whitespace token of this text normalize to the word? */
function hasWord(text: string, word: string): boolean {
  for (const tok of text.split(/\s+/)) {
    if (tok && normalizeRepeatWord(tok) === word) return true;
  }
  return false;
}

/** The book, chapter by chapter, matched on the rendered text as repeatCounts.ts does. */
async function findInBook(translation: string, book: string, word: string): Promise<RepeatVerseHit[]> {
  const hits: RepeatVerseHit[] = [];
  const tmp = document.createElement('div');
  const chapters = BIBLE_BOOKS.find((b) => b.name === book)?.chapters ?? 1;
  for (let chapter = 1; chapter <= chapters; chapter++) {
    let verses: { verse: number; text: string }[] = [];
    try {
      verses = (await textStore.getChapter(translation, book, chapter)) as any[];
    } catch {
      continue;
    }
    if (!verses) continue;
    for (const v of verses) {
      const { textWithoutHeading } = extractHeading(v.text);
      tmp.innerHTML = renderVerseHtml(textWithoutHeading.replace(/^¶\s*/, ''));
      if (hasWord(tmp.textContent || '', word)) hits.push({ book, chapter, verse: v.verse });
    }
  }
  return hits;
}

/** Every book of the translation, in one pass over the verse store. */
async function findEverywhere(translation: string, word: string): Promise<RepeatVerseHit[]> {
  const results = await searchIndex.scan(
    {
      test: (text) => hasWord(text, word),
      indexIn: () => -1,
    },
    // Packs store their id in lower case; take it either way.
    [...new Set([translation, translation.toLowerCase()])],
  );
  const order = bookOrder();
  return results
    .map((r) => ({ book: normalizeBookName(r.book), chapter: r.chapter, verse: r.verse }))
    .sort(
      (a, b) =>
        (order.get(a.book) ?? 999) - (order.get(b.book) ?? 999) || a.chapter - b.chapter || a.verse - b.verse,
    );
}

/**
 * The verses `word` (already normalized) is in, in the book or in every book.
 * `book` is only read for the book scope.
 */
export function findRepeatVerses(
  translation: string,
  word: string,
  scope: RepeatVersesScope,
  book: string,
): Promise<RepeatVerses> {
  const key = `${translation}|${word}|${scope}|${scope === 'book' ? book : ''}`;
  let hit = cache.get(key);
  if (!hit) {
    hit = (async (): Promise<RepeatVerses> => {
      const hits = scope === 'book' ? await findInBook(translation, book, word) : await findEverywhere(translation, word);
      if (FILLER_WORDS.has(word) || hits.length > MAX_LISTED) return { kind: 'tooCommon', count: hits.length };
      return { kind: 'list', hits };
    })();
    hit.catch(() => cache.delete(key));
    cache.set(key, hit);
  }
  return hit;
}

/**
 * A pattern marking the word in a preview, the whole token as group 1, for
 * renderVersePreviewHtml. Built on the same normalizing as the match, so the
 * repeat "lords" marks "Lord's" and "LORDS," alike: the word's letters in
 * order, with any punctuation between or around them, as one whitespace token.
 * Control characters count as edges, so the mark never straddles the bold and
 * italic sentinels the preview carries.
 */
export function repeatMarkPattern(word: string): RegExp | null {
  const letters = [...word].filter((c) => /\w/.test(c));
  if (!letters.length) return null;
  const punct = '[^\\w\\s\\x00-\\x1F]*';
  const edge = '[^\\s\\x00-\\x1F]';
  return new RegExp(`(?<!${edge})(${punct}${letters.join(punct)}${punct})(?!${edge})`, 'gi');
}
