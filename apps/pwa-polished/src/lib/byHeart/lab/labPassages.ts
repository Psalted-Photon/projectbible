/**
 * The lab's test passages, read from the translation the reader is on. Whistle
 * only hears English here, so a Greek or Hebrew reader tests in NET.
 */

import { get } from 'svelte/store';
import { navigationStore } from '../../../stores/navigationStore';
import { IndexedDBTextStore } from '../../adapters';
import { DEFAULT_TRANSLATION, translationLabel } from '../../bibleData';
import { cardWords } from '../../shareCard';
import { isOriginalLanguage } from '../../translationKind';
import { cleanVersePreviewText, extractHeading } from '../../verseRendering';

export interface LabPassage {
  passage: string;
  reference: string;
  translation: string;
  label: string;
  words: string[];
}

const textStore = new IndexedDBTextStore();

/** A stored verse as the words on a card. */
const plainVerse = (text: string | null | undefined) => cleanVersePreviewText(extractHeading(text ?? '').textWithoutHeading);

export function labTranslation(): string {
  const t = get(navigationStore).translation || DEFAULT_TRANSLATION;
  return isOriginalLanguage(t) ? DEFAULT_TRANSLATION : t;
}

export function makePassage(passage: string, reference: string, translation: string): LabPassage {
  return { passage, reference, translation, label: translationLabel(translation), words: cardWords(passage) };
}

/** Some verses of one chapter, or the whole of it when `to` is left out and `from` is 0. */
export async function readPassage(book: string, chapter: number, from = 0, to = from): Promise<LabPassage | null> {
  const translation = labTranslation();
  const verses = await textStore.getChapter(translation, book, chapter);
  const wanted = (verses ?? []).filter((v) => from === 0 || (v.verse >= from && v.verse <= to));
  if (!wanted.length) return null;
  const passage = wanted.map((v) => plainVerse(v.text)).join(' ').trim();
  const verseRange = from === 0 ? '' : from === to ? `:${from}` : `:${from}-${to}`;
  return makePassage(passage, `${book} ${chapter}${verseRange}`, translation);
}

/** The first `count` words of a chapter, for trying word limits on real text. */
export async function firstWords(book: string, chapter: number, count: number): Promise<LabPassage | null> {
  const whole = await readPassage(book, chapter);
  if (!whole) return null;
  const words = whole.words.slice(0, count);
  return makePassage(words.join(' '), `${book} ${chapter}, ${words.length} words`, whole.translation);
}

/** A few words from somewhere in Proverbs, so the reader can't guess them from memory. */
export async function randomWords(count: number): Promise<string> {
  const translation = labTranslation();
  for (let tries = 0; tries < 6; tries++) {
    const verses = await textStore.getChapter(translation, 'Proverbs', 1 + Math.floor(Math.random() * 31));
    const verse = verses?.[Math.floor(Math.random() * (verses?.length ?? 0))];
    const words = cardWords(plainVerse(verse?.text));
    if (words.length >= count) return words.slice(0, count).join(' ').replace(/[;:,.]+$/, '');
  }
  return 'wisdom calls beside the gates';
}
