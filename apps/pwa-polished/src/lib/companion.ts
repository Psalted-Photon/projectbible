/**
 * The English verse shown under a Greek or Hebrew one.
 *
 * Which English: the translation you are reading when it isn't Greek or
 * Hebrew; reading an original, your Settings default for that testament when
 * that isn't one either; otherwise NET. A Septuagint verse always pairs with
 * lxx2012, the English made from it.
 *
 * The verse is found through lib/versification.ts, so Hebrew Malachi 3:19
 * shows English 4:1 and a Hebrew psalm title shows only the English title.
 */

import { get } from 'svelte/store';
import { IndexedDBTextStore } from '../adapters/TextStore';
import { DEFAULT_TRANSLATION } from './bibleData';
import { defaultTranslationFor, testamentOf } from './testamentDefaults';
import { isOriginalLanguage } from './translationKind';
import { convertRef, schemeOf, type MappedRef, type VerseRef } from './versification';
import { cleanVersePreviewText } from './verseRendering';
import { availableTranslations } from '../stores/navigationStore';

/** lxx2012 is English, but only for the Old Testament. */
function canPair(translationId: string | null | undefined, book: string): translationId is string {
  if (!translationId || isOriginalLanguage(translationId)) return false;
  return !(schemeOf(translationId) === 'lxx2012' && testamentOf(book) !== 'OT');
}

export function companionTranslationFor(readerTranslation: string | null | undefined, book: string): string {
  if (canPair(readerTranslation, book)) return readerTranslation;
  const pick = defaultTranslationFor(book, get(availableTranslations));
  if (canPair(pick, book)) return pick;
  return DEFAULT_TRANSLATION;
}

export interface CompanionPiece {
  ref: MappedRef;
  /** Stored verse text, notes and all; render with renderCompanionHtml. */
  stored: string;
}

export interface CompanionVerse {
  translation: string;
  /** Usually one verse; more when the original's verse holds several English ones. */
  pieces: CompanionPiece[];
  /** The translation has nothing here (Matthew 17:21 in NET). */
  missing: boolean;
  /** KJV's verse instead, when the pick is missing and KJV is installed. */
  fallback: { translation: string; pieces: CompanionPiece[] } | null;
}

// --- Chapters, cached ------------------------------------------------------
// A list of thirty verses from one chapter reads it once, not thirty times.
const textStore = new IndexedDBTextStore();
const chapters = new Map<string, Promise<Map<number, string>>>();
const CHAPTER_CACHE = 120;

function chapterOf(translation: string, book: string, chapter: number): Promise<Map<number, string>> {
  const key = `${translation.toLowerCase()}|${book}|${chapter}`;
  let found = chapters.get(key);
  if (!found) {
    found = textStore
      .getChapter(translation, book, chapter)
      .then((verses) => new Map(verses.map((v) => [v.verse, v.text] as const)))
      .catch(() => new Map<number, string>());
    chapters.set(key, found);
    if (chapters.size > CHAPTER_CACHE) chapters.delete(chapters.keys().next().value!);
  }
  return found;
}

/** No row, nothing left once notes go, or NET's "[[EMPTY]]" placeholder. */
function isMissing(stored: string | undefined): boolean {
  if (!stored || stored.includes('[[EMPTY]]')) return true;
  return cleanVersePreviewText(stored) === '';
}

async function piecesIn(translation: string, source: string, ref: VerseRef): Promise<CompanionPiece[] | null> {
  const targets = convertRef(source, translation, ref);
  if (!targets.length) return null;
  const pieces: CompanionPiece[] = [];
  for (const t of targets) {
    const stored = (await chapterOf(translation, t.book, t.chapter)).get(t.verse);
    if (!isMissing(stored)) pieces.push({ ref: t, stored: stored! });
  }
  return pieces.length ? pieces : null;
}

const installed = (id: string) => get(availableTranslations).some((t) => t.toLowerCase() === id);

/**
 * `sourceTranslation`'s verse in English. Never throws: a verse that can't be
 * found comes back missing.
 */
export async function loadCompanionVerse(
  sourceTranslation: string,
  book: string,
  chapter: number,
  verse: number,
  readerTranslation: string | null | undefined,
): Promise<CompanionVerse> {
  const ref = { book, chapter, verse };
  const translation =
    schemeOf(sourceTranslation) === 'lxx' ? 'lxx2012' : companionTranslationFor(readerTranslation, book);
  const pieces = await piecesIn(translation, sourceTranslation, ref);
  if (pieces) return { translation, pieces, missing: false, fallback: null };

  let fallback: CompanionVerse['fallback'] = null;
  if (translation.toLowerCase() !== 'kjv' && installed('kjv')) {
    const kjv = await piecesIn('KJV', sourceTranslation, ref);
    if (kjv) fallback = { translation: 'KJV', pieces: kjv };
  }
  return { translation, pieces: [], missing: true, fallback };
}
