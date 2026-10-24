/**
 * Repeats across languages.
 *
 * A Repeat on an English word also lights the Greek or Hebrew word behind it.
 * In each Greek or Hebrew verse, the word is found in the English verse of the
 * translation it was marked in, the number linked to each place it appears is
 * read (originalAt, as a tap reads it), and the original words with that
 * number take the Repeat's color. So "truth" lights aletheia in the New
 * Testament and 'emet in the Old, and only where the English says "truth".
 * A word with no number behind it stays a plain Repeat in its own language.
 *
 * The other way round, a Repeat on a Greek or Hebrew word keeps its number:
 * in the original it lights every form of the word (aletheia, aletheias,
 * aletheian), and in English the words the Word Links pack ties to it.
 *
 * The lookups are async, so a chapter's plan is worked out first and painted
 * after, on top of the plain spelling matches (repeatRenderer.ts).
 */

import type { RepeatGroup } from '../stores/repeatsStore';
import { normalizeRepeatWord } from '../stores/repeatsStore';
import { piecesIn } from './companion';
import { wrapCharRange } from './highlightRenderer';
import { classicId } from './strongs/entry';
import { isOriginalLanguage } from './translationKind';
import { companionText } from './verseRendering';
import { domPiecesOfClean, getVerseLinks, originalAt, spansForStrongs } from './wordLinks';

/** The translation an English Repeat made before Repeats remembered one reads in. */
const OLDER_REPEATS_TRANSLATION = 'NET';

/** English words to light: clean-text offsets, as the Word Links pack gives them. */
export interface ColoredSpan {
  s: number;
  e: number;
  colorIndex: number;
}

/**
 * What one verse gets painted with. A Greek or Hebrew chapter lights words by
 * number (Strong's → color index); an English one lights stretches of text.
 */
export interface VersePaint {
  ids: Map<string, number>;
  spans: ColoredSpan[];
}

export type CrossPlan = Map<number, VersePaint>;

/** The groups' part in a plan, for caching one per chapter. */
export function crossPlanKey(groups: RepeatGroup[]): string {
  return JSON.stringify(groups.map((g) => [g.word, g.colorIndex, g.translation ?? '', g.strongs ?? '']));
}

/** English Repeats, the ones that can light the original. */
function englishGroups(groups: RepeatGroup[]): RepeatGroup[] {
  return groups.filter((g) => !g.strongs && !isOriginalLanguage(g.translation ?? OLDER_REPEATS_TRANSLATION));
}

/** Greek and Hebrew Repeats that carry a number. */
function numberGroups(groups: RepeatGroup[]): (RepeatGroup & { strongs: string })[] {
  return groups.filter((g): g is RepeatGroup & { strongs: string } => !!g.strongs);
}

/** True when a chapter of an original (or an English) text has anything to work out. */
export function hasCrossRepeats(groups: RepeatGroup[], original: boolean): boolean {
  return numberGroups(groups).length > 0 || (original && englishGroups(groups).length > 0);
}

/** Where `word` starts in `text`, inside [start, end), at its first letter. */
function wordOffsets(text: string, word: string, start: number, end: number): number[] {
  const out: number[] = [];
  for (const m of text.matchAll(/\S+/g)) {
    if (m.index < start || m.index >= end || normalizeRepeatWord(m[0]) !== word) continue;
    out.push(m.index + Math.max(0, m[0].search(/[\p{L}\p{N}]/u)));
  }
  return out;
}

/** The numbers behind each place `word` appears in `english`'s verse for one `source` verse. */
async function numbersBehind(
  word: string,
  english: string,
  source: string,
  ref: { book: string; chapter: number; verse: number },
): Promise<string[]> {
  const ids: string[] = [];
  for (const p of (await piecesIn(english, source, ref)) ?? []) {
    const { text, start, end } = companionText(p.stored, p.ref.part);
    for (const offset of wordOffsets(text, word, start, end)) {
      const id = await originalAt(english, p.ref.book, p.ref.chapter, p.ref.verse, { offset, text });
      if (id) ids.push(classicId(id));
    }
  }
  return ids;
}

/** The plan for one Greek or Hebrew chapter of `source`. Never throws. */
export async function originalChapterPlan(
  source: string,
  book: string,
  chapter: number,
  verses: number[],
  groups: RepeatGroup[],
): Promise<CrossPlan> {
  const plan: CrossPlan = new Map();
  const english = englishGroups(groups);
  const numbered = numberGroups(groups);
  if (!english.length && !numbered.length) return plan;
  await Promise.all(
    verses.map(async (verse) => {
      // Every form of a Greek or Hebrew Repeat's word, whatever the English says.
      const colors = new Map<string, number>(numbered.map((g) => [g.strongs, g.colorIndex]));
      for (const g of english) {
        try {
          const ids = await numbersBehind(g.word, g.translation ?? OLDER_REPEATS_TRANSLATION, source, { book, chapter, verse });
          for (const id of ids) if (!colors.has(id)) colors.set(id, g.colorIndex);
        } catch {
          // Nothing lit is the safe answer.
        }
      }
      if (colors.size) plan.set(verse, { ids: colors, spans: [] });
    }),
  );
  return plan;
}

/** The plan for one chapter of an English `translation`: the words linked to each numbered Repeat. */
export async function englishChapterPlan(
  translation: string,
  book: string,
  chapter: number,
  verses: number[],
  groups: RepeatGroup[],
): Promise<CrossPlan> {
  const plan: CrossPlan = new Map();
  const numbered = numberGroups(groups);
  if (!numbered.length) return plan;
  await Promise.all(
    verses.map(async (verse) => {
      const links = await getVerseLinks(translation, book, chapter, verse).catch(() => null);
      if (!links?.length) return;
      const spans = numbered.flatMap((g) =>
        spansForStrongs(links, g.strongs).map((sp) => ({ ...sp, colorIndex: g.colorIndex })),
      );
      if (spans.length) plan.set(verse, { ids: new Map(), spans });
    }),
  );
  return plan;
}

const inRepeat = (node: Text) => !!node.parentElement?.closest('.repeat-hl');
const repeatClass = (colorIndex: number) => `repeat-hl repeat-hl-${colorIndex}`;

type NumberAt = (verseText: HTMLElement, verse: number, index: number, text: string) => string | null;

/**
 * Paint a plan onto a chapter section. English stretches are mapped from clean
 * text onto the verse's markup, notes left out. In the original, interlinear
 * words carry their number; plain text asks `numberAt` for the word a tap at
 * that spot would read. Text already in a Repeat is left as it is.
 */
export function paintCrossPlan(section: HTMLElement, plan: CrossPlan, numberAt: NumberAt): void {
  section.querySelectorAll<HTMLElement>('.verse[data-verse]').forEach((verseEl) => {
    const verse = Number(verseEl.dataset.verse);
    const paint = plan.get(verse);
    const verseText = verseEl.querySelector<HTMLElement>('.verse-text');
    if (!paint || !verseText) return;
    if (paint.spans.length) paintSpans(verseText, paint.spans);
    if (paint.ids.size) paintNumbers(verseText, verse, paint.ids, numberAt);
  });
}

function paintSpans(verseText: HTMLElement, spans: ColoredSpan[]): void {
  const pieces = domPiecesOfClean(verseText);
  for (const sp of spans) {
    for (const p of pieces) {
      const s = Math.max(sp.s, p.clean);
      const e = Math.min(sp.e, p.clean + p.length);
      if (e > s) wrapCharRange(verseText, p.dom + (s - p.clean), e - s, repeatClass(sp.colorIndex), inRepeat);
    }
  }
}

function paintNumbers(verseText: HTMLElement, verse: number, colors: Map<string, number>, numberAt: NumberAt): void {
  const ilWords = verseText.querySelectorAll<HTMLElement>('.il-word');
  if (ilWords.length) {
    ilWords.forEach((w) => {
      const color = colors.get(classicId(w.dataset.strongs ?? ''));
      const orig = w.querySelector<HTMLElement>('.il-orig');
      if (color === undefined || !orig) return;
      wrapCharRange(orig, 0, orig.textContent?.length ?? 0, repeatClass(color), inRepeat);
    });
    return;
  }
  for (const w of wordsOf(verseText.textContent ?? '')) {
    const id = numberAt(verseText, verse, w.index, w.text);
    const color = id ? colors.get(classicId(id)) : undefined;
    if (color !== undefined) wrapCharRange(verseText, w.start, w.end - w.start, repeatClass(color), inRepeat);
  }
}

/**
 * The words of a plain Greek or Hebrew verse as a tap counts them
 * (getClickWordInfo in BibleReader): Unicode word segments, numbered in order.
 */
function wordsOf(text: string): { index: number; start: number; end: number; text: string }[] {
  const shown = (w: string) => w.normalize('NFC').replace(/⁠/g, '');
  const out: { index: number; start: number; end: number; text: string }[] = [];
  if (typeof Intl !== 'undefined' && 'Segmenter' in Intl) {
    const segmenter = new (Intl as any).Segmenter('und', { granularity: 'word' });
    for (const seg of segmenter.segment(text) as Iterable<{ index: number; segment: string; isWordLike: boolean }>) {
      if (!seg.isWordLike) continue;
      out.push({ index: out.length, start: seg.index, end: seg.index + seg.segment.length, text: shown(seg.segment) });
    }
    return out;
  }
  for (const m of text.matchAll(/[\p{L}\p{M}⁠]+/gu)) {
    out.push({ index: out.length, start: m.index, end: m.index + m[0].length, text: shown(m[0]) });
  }
  return out;
}
