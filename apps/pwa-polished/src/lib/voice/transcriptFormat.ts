/**
 * A transcript's words made into a note, a piece at a time, after Whistle
 * and the punctuation add-on (transcribeWorker.ts):
 *
 * 1. References put the way the editor links them: "Romans, six, verse
 *    four" is "Romans 6:4" (rules.ts tidyRefs).
 * 2. Spoken cues: "new paragraph" (or "next paragraph", "new line") starts a
 *    paragraph; "heading" or "new heading", then the words, is a heading;
 *    "the first point is …", "point two …" and "number three, …" are
 *    numbered items. Anything said another way stays plain text.
 * 3. Bible names get capitals: the books, people, places, God, Lord, Jesus,
 *    Holy Spirit (bibleNames.ts). Names that are everyday words too (Job,
 *    Mark, Eve) only where the words around them say so: "the book of Job",
 *    "Mark 5", "Adam and Eve".
 * 4. A capital at the start of every sentence, and "I".
 *
 * A pause of a few seconds starts a new paragraph; that is the piece's gap,
 * decided before it gets here.
 */

import { BIBLE_NAMES, EVERYDAY_NAMES } from './bibleNames';
import { tidyRefs, BOOK_TITLES, isEverydayBook } from './rules';
import type { TranscriptBlock } from './transcriptSink';

/**
 * Words the Bible itself never uses that a talk about it does. May and March
 * are left out, being everyday words too.
 */
const MORE_NAMES = `Bible Bibles English Christianity Catholic Protestant Baptist Methodist Lutheran Presbyterian
  Christmas Easter Monday Tuesday Wednesday Thursday Friday Saturday Sunday January February April June July
  August September October November December`.split(/\s+/);

const NAMES = new Map([...BIBLE_NAMES, ...MORE_NAMES].map((n) => [n.toLowerCase(), n]));
const IN_CONTEXT = new Map(EVERYDAY_NAMES.map((n) => [n.toLowerCase(), n]));
const BOOKS_ALWAYS = new Map<string, string>();
const BOOKS_IN_CONTEXT = new Map<string, string>();
for (const b of BOOK_TITLES) (isEverydayBook(b) ? BOOKS_IN_CONTEXT : BOOKS_ALWAYS).set(b.toLowerCase(), b);

const cap = (w: string) => (w ? w[0].toUpperCase() + w.slice(1) : w);

/** Said together, they're one name. */
const PHRASES: Array<[RegExp, (m: string, a?: string) => string]> = [
  [/\bholy (spirit|ghost|one)\b/gi, (_m, w) => `Holy ${cap(w!)}`],
  [/\bmost high\b/gi, () => 'Most High'],
  [/\b(old|new) testament\b/gi, (_m, w) => `${cap(w!.toLowerCase())} Testament`],
  [/\bson of (god|man)\b/gi, (_m, w) => `Son of ${cap(w!)}`],
  [/\b(god|lord) the father\b/gi, (_m, w) => `${cap(w!)} the Father`],
  [/\bheavenly father\b/gi, () => 'heavenly Father'],
  [/\balpha and (?:the )?omega\b/gi, (m) => m.replace(/alpha/i, 'Alpha').replace(/omega/i, 'Omega')],
  [/\bsong of (solomon|songs)\b/gi, (_m, w) => `Song of ${cap(w!)}`],
];

/** Before these, "god" is any god, not God. */
const A_GOD = /\b(a|another|false|other|strange|foreign|pagan|little|own)\s+$/i;

/** Words before a name that is an everyday word too, saying it's the name: "the book of Job", "son of Ham". */
const NAMED_BEFORE = /\b(?:(?:book|gospel|patience|story|life|son|sons|daughter|daughters|wife|husband|father|mother|brother|sister|tribe|land|house)\s+of|named|called)\s+$/i;
/** Words before a book whose name is an everyday word, saying it's the book. */
const BOOK_BEFORE = /\b(?:book|gospel|epistle|letter)\s+of\s+(?:the\s+)?$|\b[123]\s+$|\b(?:in|from|read|reading|turn to|open to|go to)\s+$/i;

/** One sentence with its names capitalized. */
function capitalizeNames(s: string): string {
  for (const [re, to] of PHRASES) s = s.replace(re, to);
  // Names, word by word; possessives by their name.
  const words = [...s.matchAll(/[A-Za-z]+(?:'[A-Za-z]+)*/g)];
  let out = '';
  let at = 0;
  words.forEach((m, i) => {
    const word = m[0];
    const lower = word.toLowerCase();
    const base = lower.replace(/'s$/, '');
    const tail = word.slice(base.length);
    const before = s.slice(0, m.index);
    const after = s.slice(m.index! + word.length);
    let to: string | null = null;
    // "Adam and Eve", "Shem, Ham and Japheth": next to another name, with "and" or a comma between.
    const neighborIsName = () => {
      const near = [words[i - 1]?.[0], words[i - 2]?.[0], words[i + 1]?.[0], words[i + 2]?.[0]];
      const joined = /\band\s*$|,\s*$/.test(before) || /^\s*(?:,|and\b)/.test(after);
      return joined && near.some((w) => w && NAMES.has(w.toLowerCase().replace(/'s$/, '')));
    };
    if (base === 'i' && !tail) to = 'I';
    else if (/^i'(m|ve|ll|d)$/.test(lower)) to = 'I' + word.slice(1);
    else if (base === 'god' && A_GOD.test(before)) to = null;
    else if (BOOKS_ALWAYS.has(base)) to = BOOKS_ALWAYS.get(base)! + tail;
    else if (BOOKS_IN_CONTEXT.has(base) && (/^\s+(?:\d|chapter\b)/i.test(after) || BOOK_BEFORE.test(before) && /^\s*(?:\d|chapter\b|[,.;:?!]|$)/i.test(after)))
      to = BOOKS_IN_CONTEXT.get(base)! + tail;
    else if (NAMES.has(base)) to = NAMES.get(base)! + tail;
    else if (IN_CONTEXT.has(base) && (NAMED_BEFORE.test(before) || /^\s+(?:\d|chapter\b)/i.test(after) || neighborIsName()))
      to = IN_CONTEXT.get(base)! + tail;
    // Only ever raised: a capital the punctuation add-on gave stays.
    if (to && to !== word && word[0] === word[0].toLowerCase()) {
      out += s.slice(at, m.index) + to;
      at = m.index! + word.length;
    }
  });
  return out + s.slice(at);
}

/** Its first letter a capital. */
const startSentence = (s: string) => s.replace(/^(\W*)([a-z])/, (_m, lead: string, c: string) => lead + c.toUpperCase());

/** A heading or item reads without the period the add-on gave it. */
const bare = (s: string) => startSentence(s.trim().replace(/[.,;:]+$/, ''));

const ORDINAL_N: Record<string, number> = {
  first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7, eighth: 8, ninth: 9, tenth: 10,
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
};

const PARA_CUE = /\b(?:new|next)\s+paragraph\b[.,!]?|\bnew\s+line\b[.,!]?/gi;
const HEADING_CUE = /^(?:new\s+heading|heading\s*[,:.]|title\s*[,:.])\s*(.*)$/i;
// "The first point is …" or "My second point:", but not "the first point of contact".
const POINT_CUE = /^(?:(?:and|so|now|okay|ok)[,\s]+)?(?:(?:the|my|our)\s+)?(first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|next|last|final)\s+point(?:\s+(?:is|was)\s+(?:that\s+)?|\s*[,:.]\s*|\s*$)(.*)$/i;
const NUMBERED_CUE = /^(?:point\s+(?:number\s+)?|number\s+)(one|two|three|four|five|six|seven|eight|nine|ten|\d{1,2})\s*[,:.]\s*(.*)$/i;

/** What carries over from one piece to the next. */
export interface FormatState {
  /** The last numbered item, for "the next point". */
  item: number;
  /** A heading or item was asked for, and its words come next. */
  waiting: 'h' | 'li' | null;
  /** The item number waiting. */
  waitingN: number;
}

export const freshFormat = (): FormatState => ({ item: 0, waiting: null, waitingN: 0 });

/**
 * One piece's words (punctuated) as blocks for the page. `joins` says the
 * piece followed on with no real pause, so its first paragraph carries on the
 * last one.
 */
export function formatPiece(text: string, joins: boolean, state: FormatState): TranscriptBlock[] {
  const blocks: TranscriptBlock[] = [];
  let para: string[] = [];
  let paraJoins = joins;
  const closePara = () => {
    if (para.length) blocks.push({ kind: 'p', text: para.join(' '), joins: paraJoins });
    para = [];
    paraJoins = false;
  };

  // "New paragraph" can come mid-sentence: each part after one starts afresh.
  const parts = tidyRefs(text).split(PARA_CUE);
  parts.forEach((part, pi) => {
    if (pi > 0) {
      closePara();
      paraJoins = false;
    }
    const sentences = part.match(/[^.?!]+(?:[.?!]+|$)/g) ?? [];
    for (let raw of sentences) {
      raw = raw.trim();
      if (!raw || /^[.,;:?!]+$/.test(raw)) continue;
      const s = startSentence(capitalizeNames(raw));

      // The words a heading or an item was waiting for.
      if (state.waiting) {
        closePara();
        blocks.push(state.waiting === 'h' ? { kind: 'h', text: bare(s) } : { kind: 'li', text: bare(s), n: state.waitingN });
        state.waiting = null;
        continue;
      }

      const heading = HEADING_CUE.exec(s);
      if (heading) {
        closePara();
        const rest = heading[1].trim();
        if (rest.replace(/[.,;:?!]/g, '')) blocks.push({ kind: 'h', text: bare(rest) });
        else state.waiting = 'h';
        continue;
      }

      const point = POINT_CUE.exec(s) ?? NUMBERED_CUE.exec(s);
      if (point) {
        const word = point[1].toLowerCase();
        const n = ORDINAL_N[word] ?? (/^\d+$/.test(word) ? +word : state.item + 1);
        state.item = n;
        closePara();
        const rest = point[2].trim();
        if (rest.replace(/[.,;:?!]/g, '')) blocks.push({ kind: 'li', text: bare(rest), n });
        else {
          state.waiting = 'li';
          state.waitingN = n;
        }
        continue;
      }

      para.push(s);
    }
  });
  closePara();
  return blocks;
}
