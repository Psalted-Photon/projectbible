/**
 * eastonRefs — every scripture reference in an Easton bio, as a link.
 *
 * Easton tags most of its references as markdown links ending in an OSIS id,
 * "[Ex. 6:20](/exod#Exod.6.20)", and those are kept as they are. Several
 * hundred more it left bare: "(17:17-31)" in Paul's bio means Acts, but
 * nothing in the text says so.
 *
 * So the bio is read left to right the way a person reads it, keeping track
 * of the last book and chapter cited, and each bare reference goes to the
 * first of these that gives a verse that exists:
 *
 *   1. the fix list
 *   2. a book named in words just before it — "Epistle to the Galatians (4:13)",
 *      "called by Jeremiah (20:2)"
 *   3. the last book cited
 *   4. a colon typo for two verses — Noah's "(28:29)" after Gen. 9:21 is
 *      Gen 9:28, 29, because those are back-to-back verses of the last chapter
 *   5. earlier books cited, newest first — Paul's "(16:6)" after a 2 Timothy
 *      link is Acts
 *   6. the person's own book, for the prophets' bios
 *
 * Anything none of them places stays plain text and is reported as a miss,
 * which scripts/check-people-refs.ts lists. A list inside one bracket keeps
 * the book its first item got: "(2:1, 4; 7:7)" is three Exodus links.
 *
 * Nothing here touches the People pack. It runs as a bio is shown, so a wrong
 * pick is mended with one line in the fix list rather than a pack rebuild.
 */

import { isValidChapter, isValidVerse, resolveBook } from './bibleRefs';
import { parseOsisRef } from './parseRefString';
import { BIBLE_BOOKS, normalizeBookName } from './bibleData';

/** Which rule placed a link — shown by the check script, ignored by the app. */
export type BioRule =
  | 'source' // tagged by Easton
  | 'fix' // the fix list
  | 'named' // a book named just before it
  | 'last' // the last book cited
  | 'typo' // "28:29" read as two verses of the last chapter
  | 'earlier' // an earlier book cited
  | 'own' // the person's own book
  | 'list'; // a later item in a list, keeping the first item's book

export interface BioRef {
  book: string;
  chapter: number;
  verse: number;
  /** "Book 3:16", for remembering which links were followed. */
  key: string;
  rule: BioRule;
}

export interface BioPiece {
  text: string;
  ref: BioRef | null;
}

/** A reference-shaped piece of text no rule could place. */
export interface BioMiss {
  text: string;
  context: string;
}

export interface BioPerson {
  id?: string;
  name?: string;
}

/**
 * One line of the fix list. `text` is the words as they appear in the bio —
 * just "(48:1)", or more of the sentence when that alone could be found twice.
 * Every reference inside it goes to `book`, or stays plain when `book` is null.
 * `chapter` is for a bare verse number like "(18)", which has none of its own.
 */
export interface BioFix {
  person: string | string[];
  text: string;
  book: string | null;
  chapter?: number;
}

// ---------------------------------------------------------------------------
// Reading the source's own links
// ---------------------------------------------------------------------------

const LINK_RE = /\[([^\]]+)\]\(([^)]*)\)/g;

/** Easton's emphasis marks, which the bio doesn't draw. */
const strip = (s: string) => s.replace(/[*_`]/g, '');

/** A link laid over the paragraph's plain text. */
interface Span {
  start: number;
  end: number;
  ref: BioRef;
  /** Cites a whole chapter, so a bare number after it is a chapter too. */
  chapterOnly: boolean;
}

function makeRef(book: string, chapter: number, verse: number, rule: BioRule): BioRef {
  return { book, chapter, verse, key: `${book} ${chapter}:${verse}`, rule };
}

/** A verse that exists — or, with no verse, a chapter that does. */
function exists(book: string, chapter: number, verse?: number | null): boolean {
  if (!isValidChapter(book, chapter)) return false;
  return verse == null || isValidVerse(book, chapter, verse);
}

/** The paragraph's text with the markdown taken out, and where its links sit in it. */
function readLinks(para: string): { plain: string; spans: Span[] } {
  let plain = '';
  const spans: Span[] = [];
  let cursor = 0;
  for (const m of para.matchAll(LINK_RE)) {
    plain += strip(para.slice(cursor, m.index));
    const osis = m[2].split('#')[1] ?? '';
    const target = parseOsisRef(osis);
    if (target) {
      const book = normalizeBookName(target.book);
      spans.push({
        start: plain.length,
        end: plain.length + m[1].length,
        ref: makeRef(book, target.chapter, target.verse, 'source'),
        chapterOnly: !/^[1-9]?[A-Za-z]+\.\d+\.\d+/.test(osis),
      });
      plain += m[1];
    } else {
      // A target the app can't place stays as the words it said.
      plain += strip(m[1]);
    }
    cursor = m.index! + m[0].length;
  }
  plain += strip(para.slice(cursor));
  return { plain, spans };
}

// ---------------------------------------------------------------------------
// What the reader remembers
// ---------------------------------------------------------------------------

interface Ctx {
  /** The last book cited, and its chapter. */
  book: string | null;
  chapter: number;
  chapterOnly: boolean;
  /** Every book cited so far, most recent last. */
  history: string[];
  ownBook: string | null;
  fixes: BioFix[];
  misses: BioMiss[];
}

function cite(ctx: Ctx, book: string, chapter: number, chapterOnly: boolean) {
  ctx.book = book;
  ctx.chapter = chapter;
  ctx.chapterOnly = chapterOnly;
  ctx.history = ctx.history.filter((b) => b !== book);
  ctx.history.push(book);
}

// ---------------------------------------------------------------------------
// A book named in the words before a reference
// ---------------------------------------------------------------------------

/**
 * The last word of every book's full name. Only these count as naming a book
 * in prose: abbreviations ("Is", "Am", "Col") are ordinary words too often.
 */
const FULL_NAME_ENDS = new Set([
  ...BIBLE_BOOKS.map((b) => b.name.split(' ').pop()!.toLowerCase()),
  'psalms',
  'songs',
  'apostles',
]);

/**
 * The book whose name ends right where `at` begins — "Epistle to the
 * Galatians (", "called by Jeremiah (", "Acts of the Apostles (" — or null.
 */
function namedBookBefore(plain: string, at: number): string | null {
  const before = plain
    .slice(Math.max(0, at - 80), at)
    .replace(/[\s(,]+$/, '')
    .replace(/['’]s$/, '');
  const words = before.split(/\s+/);
  const last = words[words.length - 1]?.toLowerCase() ?? '';
  if (!FULL_NAME_ENDS.has(last)) return null;
  for (let k = Math.min(5, words.length); k >= 1; k--) {
    const phrase = words.slice(-k).join(' ');
    if (!/^[1-3A-Z]/.test(phrase)) continue;
    const book = resolveBook(phrase.replace(/\s+of\s+the\s+apostles$/i, ''));
    if (book) return book;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Lists of numbers
// ---------------------------------------------------------------------------

interface Item {
  start: number;
  end: number;
  /** The chapter when `b` is set, otherwise a lone verse (or chapter) number. */
  a: number;
  b: number | null;
  /** Just "28:29" — no range, no letter. */
  simple: boolean;
}

/** "17", "3:4a", "17:8-13", "8:21-9:17". Never runs into a word or another colon. */
const ITEM_RE = /(\d+)[ab]?(?::(\d+)[ab]?)?(?:\s?[-–]\s?\d+[ab]?(?::\d+[ab]?)?)?(?![\w:])/y;

/** Between items: a comma or semicolon, perhaps with "comp." after it. */
const SEP_RE = /\s*[,;]\s*(?:(?:comp|cf|see)\.?\s+)?(?=\d)/iy;

/**
 * The run of references starting at `start`: "2:1, 4; 7:7". Stops before
 * anything `blocked` claims, and before a number with thousands in it, which
 * is a count of people rather than a list.
 */
function readList(plain: string, start: number, limit: number, blocked: (i: number) => boolean): Item[] {
  const items: Item[] = [];
  let i = start;
  while (i < limit && !blocked(i)) {
    ITEM_RE.lastIndex = i;
    const m = ITEM_RE.exec(plain);
    if (!m || i + m[0].length > limit) break;
    const end = i + m[0].length;
    if (/^,\d{3}(?!\d)/.test(plain.slice(end, end + 5))) {
      if (!items.length) return [];
      break;
    }
    items.push({ start: i, end, a: +m[1], b: m[2] ? +m[2] : null, simple: /^\d+:\d+$/.test(m[0]) });
    SEP_RE.lastIndex = end;
    const s = SEP_RE.exec(plain);
    if (!s || end + s[0].length > limit) break;
    i = end + s[0].length;
  }
  return items;
}

// ---------------------------------------------------------------------------
// Placing a list
// ---------------------------------------------------------------------------

interface Choice {
  book: string;
  chapter: number;
  verse: number;
  rule: BioRule;
  /** The typo rule reads its one item as two verses, so nothing follows on from it. */
  single?: boolean;
}

/** The fix covering [start, end) in this paragraph, if any. */
type FixAt = (start: number, end: number) => BioFix | undefined;

/** The book for a bare "chapter:verse", by the rules at the top of this file. */
function chooseBook(item: Item, items: Item[], ctx: Ctx, named: string | null, fixAt: FixAt): Choice | 'plain' | null {
  const a = item.a;
  const b = item.b!;
  const fix = fixAt(item.start, item.end);
  if (fix) {
    if (!fix.book) return 'plain';
    return exists(fix.book, a, b) ? { book: fix.book, chapter: a, verse: b, rule: 'fix' } : null;
  }
  if (named && exists(named, a, b)) return { book: named, chapter: a, verse: b, rule: 'named' };
  if (ctx.book && exists(ctx.book, a, b)) return { book: ctx.book, chapter: a, verse: b, rule: 'last' };
  if (
    ctx.book &&
    !ctx.chapterOnly &&
    items.length === 1 &&
    item.simple &&
    b === a + 1 &&
    exists(ctx.book, ctx.chapter, a) &&
    exists(ctx.book, ctx.chapter, b)
  ) {
    return { book: ctx.book, chapter: ctx.chapter, verse: a, rule: 'typo', single: true };
  }
  for (let i = ctx.history.length - 1; i >= 0; i--) {
    const h = ctx.history[i];
    if (h !== ctx.book && exists(h, a, b)) return { book: h, chapter: a, verse: b, rule: 'earlier' };
  }
  if (ctx.ownBook && exists(ctx.ownBook, a, b)) return { book: ctx.ownBook, chapter: a, verse: b, rule: 'own' };
  return null;
}

/** About a sentence around [start, end), for the check script. */
function around(plain: string, start: number, end: number): string {
  return `…${plain.slice(Math.max(0, start - 50), start)}【${plain.slice(start, end)}】${plain.slice(end, end + 25)}…`;
}

/**
 * Turn a list into links, the first item placed by `choose` and the rest
 * keeping its book. Returns the spans it made.
 */
function placeList(
  plain: string,
  items: Item[],
  ctx: Ctx,
  fixAt: FixAt,
  choose: () => Choice | 'plain' | null,
): Span[] {
  const first = items[0];
  const choice = choose();
  if (choice === 'plain') return [];
  if (!choice) {
    const last = items[items.length - 1];
    ctx.misses.push({ text: plain.slice(first.start, last.end), context: around(plain, first.start, last.end) });
    return [];
  }

  const spans: Span[] = [
    { start: first.start, end: first.end, ref: makeRef(choice.book, choice.chapter, choice.verse, choice.rule), chapterOnly: false },
  ];
  let book = choice.book;
  let chapter = choice.chapter;
  if (!choice.single) {
    for (const item of items.slice(1)) {
      let rule: BioRule = 'list';
      const fix = fixAt(item.start, item.end);
      if (fix) {
        if (!fix.book) continue;
        book = fix.book;
        rule = 'fix';
      }
      let verse: number;
      if (item.b != null) {
        chapter = item.a;
        verse = item.b;
      } else {
        verse = item.a;
      }
      if (exists(book, chapter, verse)) {
        spans.push({ start: item.start, end: item.end, ref: makeRef(book, chapter, verse, rule), chapterOnly: false });
      } else {
        ctx.misses.push({ text: plain.slice(item.start, item.end), context: around(plain, item.start, item.end) });
      }
    }
  }
  cite(ctx, book, chapter, false);
  return spans;
}

// ---------------------------------------------------------------------------
// One paragraph
// ---------------------------------------------------------------------------

/** A bare "chapter:verse" — not part of a longer number, a time, or a word. */
const CV_RE = /(?<![\w:.])\d+:\d+/g;

/** Find and place the bare references between two of the source's links. */
function scanGap(plain: string, from: number, to: number, ctx: Ctx, fixAt: FixAt, out: Span[]) {
  const blocked = () => false;
  let consumed = from;
  CV_RE.lastIndex = from;
  let m: RegExpExecArray | null;
  while ((m = CV_RE.exec(plain)) !== null && m.index < to) {
    if (m.index < consumed) continue;
    const items = readList(plain, m.index, to, blocked);
    if (!items.length || items[0].b == null) continue;
    const named = namedBookBefore(plain, m.index);
    out.push(...placeList(plain, items, ctx, fixAt, () => chooseBook(items[0], items, ctx, named, fixAt)));
    consumed = items[items.length - 1].end;
    CV_RE.lastIndex = consumed;
  }
}

function linkParagraph(para: string, ctx: Ctx, fixes: BioFix[]): BioPiece[] {
  const { plain, spans: source } = readLinks(para);

  // Where each fix's words sit in this paragraph.
  const fixSpots: { start: number; end: number; fix: BioFix }[] = [];
  for (const fix of fixes) {
    for (let at = plain.indexOf(fix.text); at >= 0; at = plain.indexOf(fix.text, at + 1)) {
      fixSpots.push({ start: at, end: at + fix.text.length, fix });
    }
  }
  const fixAt: FixAt = (start, end) => fixSpots.find((f) => f.start <= start && end <= f.end)?.fix;

  const spans: Span[] = [];
  let cursor = 0;
  for (const s of source) {
    scanGap(plain, cursor, s.start, ctx, fixAt, spans);
    spans.push(s);
    cite(ctx, s.ref.book, s.ref.chapter, s.chapterOnly);
    cursor = s.end;
  }
  scanGap(plain, cursor, plain.length, ctx, fixAt, spans);

  const pieces: BioPiece[] = [];
  let at = 0;
  for (const s of spans) {
    if (s.start > at) pieces.push({ text: plain.slice(at, s.start), ref: null });
    pieces.push({ text: plain.slice(s.start, s.end), ref: s.ref });
    at = s.end;
  }
  if (at < plain.length) pieces.push({ text: plain.slice(at), ref: null });
  return pieces;
}

// ---------------------------------------------------------------------------
// The whole bio
// ---------------------------------------------------------------------------

/** The person's name as a book of the Bible, for the prophets' bios. */
function ownBookOf(person: BioPerson): string | null {
  const name = person.name?.trim();
  if (!name || !FULL_NAME_ENDS.has(name.split(' ').pop()!.toLowerCase())) return null;
  return resolveBook(name);
}

function fixesFor(person: BioPerson, fixes: BioFix[]): BioFix[] {
  if (!person.id) return [];
  return fixes.filter((f) => (Array.isArray(f.person) ? f.person.includes(person.id!) : f.person === person.id));
}

/**
 * The bio as paragraphs of plain text and links, plus whatever looked like a
 * reference but couldn't be placed.
 */
export function eastonBioReport(
  text: string | undefined,
  person: BioPerson = {},
  fixes: BioFix[] = [],
): { paragraphs: BioPiece[][]; misses: BioMiss[] } {
  const ctx: Ctx = {
    book: null,
    chapter: 1,
    chapterOnly: false,
    history: [],
    ownBook: ownBookOf(person),
    fixes: fixesFor(person, fixes),
    misses: [],
  };
  if (!text) return { paragraphs: [], misses: [] };
  const paragraphs = text
    .split(/\n{2,}/)
    .map((p) => p.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .map((p) => linkParagraph(p, ctx, ctx.fixes));
  return { paragraphs, misses: ctx.misses };
}

/** The bio as paragraphs of plain text and scripture links. */
export function eastonBio(text: string | undefined, person: BioPerson = {}, fixes: BioFix[] = []): BioPiece[][] {
  return eastonBioReport(text, person, fixes).paragraphs;
}
