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
import { originalAt } from './wordLinks';

/** The translation an English Repeat made before Repeats remembered one reads in. */
const OLDER_REPEATS_TRANSLATION = 'NET';

/** What one verse gets painted with: Strong's number → color index. */
export type CrossPlan = Map<number, Map<string, number>>;

/** The groups' part in a plan, for caching one per chapter. */
export function crossPlanKey(groups: RepeatGroup[]): string {
  return JSON.stringify(groups.map((g) => [g.word, g.colorIndex, g.translation ?? '']));
}

/** English Repeats, the ones that can light the original. */
function englishGroups(groups: RepeatGroup[]): RepeatGroup[] {
  return groups.filter((g) => !isOriginalLanguage(g.translation ?? OLDER_REPEATS_TRANSLATION));
}

/** True when an original-language chapter has anything to work out. */
export function hasCrossRepeats(groups: RepeatGroup[]): boolean {
  return englishGroups(groups).length > 0;
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
  if (!english.length) return plan;
  await Promise.all(
    verses.map(async (verse) => {
      const colors = new Map<string, number>();
      for (const g of english) {
        try {
          const ids = await numbersBehind(g.word, g.translation ?? OLDER_REPEATS_TRANSLATION, source, { book, chapter, verse });
          for (const id of ids) if (!colors.has(id)) colors.set(id, g.colorIndex);
        } catch {
          // Nothing lit is the safe answer.
        }
      }
      if (colors.size) plan.set(verse, colors);
    }),
  );
  return plan;
}

const inRepeat = (node: Text) => !!node.parentElement?.closest('.repeat-hl');
const repeatClass = (colorIndex: number) => `repeat-hl repeat-hl-${colorIndex}`;

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

/**
 * Paint a plan onto an original-language chapter section. Interlinear words
 * carry their number; plain text asks `numberAt` for the word a tap at that
 * spot would read. Text already in a Repeat is left as it is.
 */
export function paintOriginalPlan(
  section: HTMLElement,
  colorsFor: (verse: number) => Map<string, number> | undefined,
  numberAt: (verseText: HTMLElement, verse: number, index: number, text: string) => string | null,
): void {
  section.querySelectorAll<HTMLElement>('.verse[data-verse]').forEach((verseEl) => {
    const verse = Number(verseEl.dataset.verse);
    const colors = colorsFor(verse);
    const verseText = verseEl.querySelector<HTMLElement>('.verse-text');
    if (!colors?.size || !verseText) return;

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
  });
}
