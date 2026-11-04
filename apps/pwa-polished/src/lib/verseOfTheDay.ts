/**
 * The Verse of the Day list: which verse goes with which day, and reading one
 * in a translation. The Verse of the Day card and By Heart's list both use it.
 *
 * The list's references use English verse numbers. The Hebrew, the Septuagint
 * and a few English packs number some verses differently (Malachi 4:1 is Hebrew
 * 3:19); lib/versification finds where the translation keeps them, and a verse
 * it can't place says so rather than showing a different one.
 */

import verseOfDay from '../data/verse-of-the-day.json';
import { IndexedDBTextStore } from './adapters';
import { getBookChapters, translationLabel } from './bibleData';
import { testamentOf } from './testamentDefaults';
import { booksInTranslation } from './translationBooks';
import { englishRefIn } from './versification';
import { cleanVersePreviewText, extractHeading } from './verseRendering';

export interface VotdRef {
  book: string;
  chapter: number;
  startVerse: number;
  endVerse: number;
}

export interface VerseSpan {
  chapter: number;
  startVerse: number;
  endVerse: number;
}

/** A day in the list, for showing it. */
export interface VotdDay {
  /** "MM-DD". */
  key: string;
  date: Date;
  label: string;
  ref: VotdRef;
  /** "Psalm 23:1-2", as the list has it. */
  refText: string;
}

/** The verse in a translation, or why it can't be shown. */
export type VotdVerse =
  | { text: string; plain: string; at: VerseSpan }
  | { unavailable: string };

const textStore = new IndexedDBTextStore();

/** A stored verse as plain words, with no heading or note marks. */
export const plainVerse = (text: string | null | undefined): string =>
  cleanVersePreviewText(extractHeading(text ?? '').textWithoutHeading);

/**
 * "Book Ch:V" or "Book Ch:V1-V2" → structured object. A one-chapter book may
 * give verses alone ("Jude 24-25"), which means chapter 1.
 */
export function parseVotdRef(ref: string): VotdRef | null {
  const m = ref.match(/^(.+?)\s+(\d+):(\d+)(?:-(\d+))?$/);
  if (m) {
    return {
      book: m[1],
      chapter: parseInt(m[2], 10),
      startVerse: parseInt(m[3], 10),
      endVerse: m[4] ? parseInt(m[4], 10) : parseInt(m[3], 10),
    };
  }
  const one = ref.match(/^(.+?)\s+(\d+)(?:-(\d+))?$/);
  if (!one || getBookChapters(one[1]) !== 1) return null;
  return {
    book: one[1],
    chapter: 1,
    startVerse: parseInt(one[2], 10),
    endVerse: one[3] ? parseInt(one[3], 10) : parseInt(one[2], 10),
  };
}

/** The reference for a day, "MM-DD". Empty when the list has none. */
export function votdRefOn(mmdd: string): string {
  return (verseOfDay as Record<string, string>)[mmdd] ?? '';
}

const pad = (n: number) => String(n).padStart(2, '0');

/** A year of the list, from `today` ("YYYY-MM-DD") on. */
export function votdDaysFrom(today: string): VotdDay[] {
  const date = new Date(`${today}T12:00:00`);
  const days: VotdDay[] = [];
  for (let i = 0; i < 366; i++) {
    const key = `${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
    const refText = votdRefOn(key);
    const ref = parseVotdRef(refText);
    if (ref) {
      const label =
        i === 0 ? 'Today'
        : i === 1 ? 'Tomorrow'
        : date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
      days.push({ key, date: new Date(date), label, ref, refText });
    }
    date.setDate(date.getDate() + 1);
  }
  return days;
}

/** Always the translation asked for, never another one borrowed in its place. */
export async function readVotdVerse(p: VotdRef, translation: string): Promise<VotdVerse> {
  const label = translationLabel(translation);

  const books = await booksInTranslation(translation);
  if (books && !books.has(p.book)) {
    const testament = testamentOf(p.book);
    const hasTestament = [...books].some((b) => testamentOf(b) === testament);
    return {
      unavailable: hasTestament
        ? `Not available in ${label}.`
        : `Not available in ${label}, which has the ${testament === 'NT' ? 'Old' : 'New'} Testament only.`,
    };
  }

  const ref = (verse: number) => ({ book: p.book, chapter: p.chapter, verse });
  const first = englishRefIn(translation, ref(p.startVerse));
  const last = p.endVerse === p.startVerse ? first : englishRefIn(translation, ref(p.endVerse));
  const at: VerseSpan | null =
    first && last && first.chapter === last.chapter && last.verse >= first.verse
      ? { chapter: first.chapter, startVerse: first.verse, endVerse: last.verse }
      : null;
  if (!at) return { unavailable: `Not available in ${label}, which numbers the verses of this chapter differently.` };

  const parts: string[] = [];
  for (let v = at.startVerse; v <= at.endVerse; v++) {
    const t = await textStore.getVerse(translation, p.book, at.chapter, v);
    if (t) parts.push(t);
  }
  if (!parts.length) return { unavailable: `Not available in ${label}.` };
  return { text: parts.join(' '), plain: parts.map(plainVerse).join(' ').trim(), at };
}
