/**
 * The Bubbles' data: every book's size, its chapters and verses, and its most
 * used words, all from the NET (scripts/build-bubble-data.mjs writes
 * bubbleData.json). Loaded only when the Bubbles or a word cloud opens, then
 * kept for the session.
 *
 * Verses are numbered through each book from 0, in reading order, the way the
 * lab numbers them; `verseIndex` turns a chapter and verse into that number.
 */

import { BIBLE_BOOKS, normalizeBookName } from '../bibleData';
import { normalizeRepeatWord } from '../../stores/repeatsStore';
import { layoutBubbles, type BubbleMap } from './bubbles';
import type { CloudWord } from './cloud';

interface RawBook {
  b: string;
  w: number;
  /** [chapter, words, verse count | verse numbers] */
  c: Array<[number, number, number | number[]]>;
  cloud: Array<[string, number]>;
}

/** A book cut into chapters and verses. */
export interface BookVerses {
  book: string;
  words: number;
  /** Per verse: chapter * 1000 + verse. */
  verseRef: Int32Array;
  /** Per verse: which chapter (index into `chapters`) and its place in it. */
  verseChapter: Int32Array;
  verseInChapter: Int32Array;
  /** `first` is the chapter's first verse, as an index into the verse arrays. */
  chapters: Array<{ chapter: number; words: number; verses: number; first: number }>;
}

export interface BubbleData {
  books: BookVerses[];
  byBook: Map<string, BookVerses>;
  /** Each book's most used words, most used first, filler left out. */
  clouds: Map<string, CloudWord[]>;
  /** The packed map, `size` 1000. */
  map: BubbleMap;
}

/** The Bubbles world is a square this many units wide. */
export const BUBBLE_WORLD = 1000;

function readBook(raw: RawBook): BookVerses {
  const vRef: number[] = [], vCh: number[] = [], vIn: number[] = [];
  const chapters: BookVerses['chapters'] = [];
  for (const [chapter, words, verses] of raw.c) {
    const list = Array.isArray(verses) ? verses : Array.from({ length: verses }, (_, i) => i + 1);
    const ci = chapters.length;
    chapters.push({ chapter, words, verses: list.length, first: vRef.length });
    list.forEach((v, i) => {
      vRef.push(chapter * 1000 + v);
      vCh.push(ci);
      vIn.push(i);
    });
  }
  return {
    book: raw.b,
    words: raw.w,
    verseRef: Int32Array.from(vRef),
    verseChapter: Int32Array.from(vCh),
    verseInChapter: Int32Array.from(vIn),
    chapters,
  };
}

let loading: Promise<BubbleData> | null = null;

export function loadBubbleData(): Promise<BubbleData> {
  loading ??= import('./bubbleData.json')
    .then((m) => {
      const raw = (m.default ?? m) as unknown as { books: RawBook[] };
      const byName = new Map(raw.books.map((b) => [b.b, b]));
      // In the app's book order, whatever order the file has.
      const books = BIBLE_BOOKS.map((info) => byName.get(info.name)).filter((b): b is RawBook => !!b).map(readBook);
      const clouds = new Map<string, CloudWord[]>();
      for (const b of raw.books) {
        clouds.set(
          b.b,
          b.cloud.map(([text, count]) => ({ text, key: normalizeRepeatWord(text), count })),
        );
      }
      const map = layoutBubbles(
        books.map((b) => ({ book: b.book, words: b.words, chapters: b.chapters })),
        BUBBLE_WORLD,
      );
      return { books, byBook: new Map(books.map((b) => [b.book, b])), clouds, map };
    })
    .catch((error) => {
      loading = null;
      throw error;
    });
  return loading;
}

/** The verse number through the book for chapter:verse, or the nearest verse before it in that chapter; -1 when the chapter is not there. */
export function verseIndex(bv: BookVerses, chapter: number, verse: number): number {
  const ci = chapterIndex(bv, chapter);
  if (ci < 0) return -1;
  const ch = bv.chapters[ci];
  // Usually verse n is at n - 1; a chapter with a verse left out is searched.
  let i = Math.min(ch.verses - 1, Math.max(0, verse - 1));
  while (i > 0 && bv.verseRef[ch.first + i] % 1000 > verse) i--;
  while (i < ch.verses - 1 && bv.verseRef[ch.first + i + 1] % 1000 <= verse) i++;
  return ch.first + i;
}

export function chapterIndex(bv: BookVerses, chapter: number): number {
  const guess = chapter - 1;
  if (bv.chapters[guess]?.chapter === chapter) return guess;
  return bv.chapters.findIndex((c) => c.chapter === chapter);
}

/** A book name as the app spells it ("Psalms" → "Psalm"). */
export function bubbleBookName(book: string): string {
  return normalizeBookName(book);
}
