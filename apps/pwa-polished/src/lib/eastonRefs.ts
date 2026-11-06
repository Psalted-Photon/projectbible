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
 * The other shapes Easton writes are read too:
 *   - bare verse numbers — "(33)", "(5, 6, 12)", "ver. 7" — in the last
 *     chapter cited, while numbered lists like "(1) Peter; (2) the lad" are
 *     left alone
 *   - chapter words — "ch. 7", "chapters 7 and 8" — in the last book cited
 *   - untagged references that name their own book — "2 Pet. 2:15"
 *   - the source's broken links: "[Philemon 1]:24" and "[2 Sam. 2]: 18-32"
 *     become one link to the right verse, "[1 Kings 16]-22" takes in the end
 *     of its range, and "[2] Chr. 20:14" one 2 Chr. 20:14 link
 *
 * Nothing here touches the People pack. It runs as a bio is shown, so a wrong
 * pick is mended with one line in the fix list rather than a pack rebuild.
 */

import { findRefs, isValidChapter, isValidVerse, resolveBook, type RefMatch } from './bibleRefs';
import { parseOsisRef } from './parseRefString';
import { BIBLE_BOOKS, normalizeBookName } from './bibleData';

/** Which rule placed a link — shown by the check script, ignored by the app. */
export type BioRule =
  | 'source' // tagged by Easton
  | 'repaired' // Easton's link, mended where it broke
  | 'book' // untagged, but names its own book
  | 'verse' // a bare verse number, in the last chapter cited
  | 'chapter' // "ch. 7", in the last book cited
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

/**
 * Mend the places the source's links broke off short. Each span is changed in
 * place and never reaches past the next one.
 */
function repairLinks(plain: string, spans: Span[]) {
  for (let k = 0; k < spans.length; k++) {
    const s = spans[k];
    const text = plain.slice(s.start, s.end);
    const after = plain.slice(s.end, spans[k + 1]?.start ?? plain.length);
    let m: RegExpMatchArray | null;

    // "[Philemon 1]:24", "[2 Sam. 2]: 18-32" — the verse left outside, and the
    // link pointing at verse 1 or the whole chapter.
    m = after.match(/^:\s?(\d+)[ab]?(?:\s?[-–]\s?\d+[ab]?)?(?![\w:])/);
    if (m && !text.includes(':') && /\d$/.test(text) && exists(s.ref.book, s.ref.chapter, +m[1])) {
      s.end += m[0].length;
      s.ref = makeRef(s.ref.book, s.ref.chapter, +m[1], 'repaired');
      s.chapterOnly = false;
      continue;
    }

    // "[1 Kings 16]-22", "[31]-39" — the end of the range left outside.
    m = after.match(/^[-–]\d+(?::\d+)?(?![\w:])/);
    if (m) {
      s.end += m[0].length;
      s.ref = { ...s.ref, rule: 'repaired' };
      continue;
    }

    // "[2] Chr. 20:14" — only the book's number linked, and to somewhere else.
    m = after.match(/^\s([A-Z][a-z]+)\.?\s(\d+):(\d+)[ab]?(?:[-–]\d+)?(?![\w:])/);
    if (m && /^[1-3]$/.test(text)) {
      const book = resolveBook(`${text} ${m[1]}`);
      if (book && exists(book, +m[2], +m[3])) {
        s.end += m[0].length;
        s.ref = makeRef(book, +m[2], +m[3], 'repaired');
        s.chapterOnly = false;
      }
    }
  }
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

/** "17", "3:4a", "17:8-13", "8:21-9:17". Never runs into a word, a fraction or another colon. */
const ITEM_RE = /(\d+)[ab]?(?::(\d+)[ab]?)?(?:\s?[-–]\s?\d+[ab]?(?::\d+[ab]?)?)?(?![\w:/])/y;

/** Between items: a comma or semicolon, perhaps with "comp." after it. */
const SEP_RE = /\s*[,;]\s*(?:(?:comp|cf|see)\.?\s+)?(?=\d)/iy;
/** Chapters may also run "7 and 8", "1 to 8". */
const CHAPTER_SEP_RE = /(?:\s*[,;]\s*|\s+(?:and|to)\s+)(?=\d)/iy;

/**
 * The run of references starting at `start`: "2:1, 4; 7:7". Stops before
 * anything `blocked` claims, and before a number with thousands in it, which
 * is a count of people rather than a list.
 */
function readList(
  plain: string,
  start: number,
  limit: number,
  blocked: (i: number) => boolean,
  chapters = false,
): Item[] {
  const SEP = chapters ? CHAPTER_SEP_RE : SEP_RE;
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
    SEP.lastIndex = end;
    const s = SEP.exec(plain);
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
  /** Bare numbers after the first item are chapters, not verses. */
  chapters?: boolean;
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

/**
 * A bare verse number: "(18)", "(5, 6, 12)", "ver. 7". It belongs to the last
 * chapter cited — unless a book is named right before it ("the book of
 * Genesis (10)"), or it directly follows a whole-chapter link, when it is a
 * chapter.
 */
function chooseVerse(item: Item, ctx: Ctx, named: string | null, afterChapterLink: boolean, fixAt: FixAt): Choice | 'plain' | null {
  const n = item.a;
  const fix = fixAt(item.start, item.end);
  if (fix) {
    if (!fix.book) return 'plain';
    const chapter = fix.chapter ?? ctx.chapter;
    return exists(fix.book, chapter, n) ? { book: fix.book, chapter, verse: n, rule: 'fix' } : null;
  }
  if (named && exists(named, n)) return { book: named, chapter: n, verse: 1, rule: 'named', chapters: true };
  if (!ctx.book) return null;
  if (afterChapterLink && ctx.chapterOnly) {
    return exists(ctx.book, n) ? { book: ctx.book, chapter: n, verse: 1, rule: 'chapter', chapters: true } : null;
  }
  return exists(ctx.book, ctx.chapter, n) ? { book: ctx.book, chapter: ctx.chapter, verse: n, rule: 'verse' } : null;
}

/** "ch. 7", "chapters 7 and 8", "ch. 1:5-11" — in the book named before it, or the last book cited. */
function chooseChapter(item: Item, ctx: Ctx, named: string | null, fixAt: FixAt): Choice | 'plain' | null {
  const fix = fixAt(item.start, item.end);
  const book = fix ? fix.book : named ?? ctx.book;
  if (fix && !book) return 'plain';
  if (!book || !exists(book, item.a, item.b)) return null;
  const rule: BioRule = fix ? 'fix' : named ? 'named' : 'chapter';
  return item.b != null
    ? { book, chapter: item.a, verse: item.b, rule }
    : { book, chapter: item.a, verse: 1, rule, chapters: true };
}

/** About a sentence around [start, end), for the check script. */
function around(plain: string, start: number, end: number): string {
  return `…${plain.slice(Math.max(0, start - 50), start)}【${plain.slice(start, end)}】${plain.slice(end, end + 25)}…`;
}

/**
 * Turn a list into links, the first item placed by `choose` and the rest
 * keeping its book. The first link starts at `leadStart`, so "ver. 7" and
 * "ch. 7" are linked whole. Returns the spans it made.
 */
function placeList(
  plain: string,
  items: Item[],
  leadStart: number,
  ctx: Ctx,
  fixAt: FixAt,
  choose: () => Choice | 'plain' | null,
): Span[] {
  const first = items[0];
  const choice = choose();
  if (choice === 'plain') return [];
  if (!choice) {
    const last = items[items.length - 1];
    ctx.misses.push({ text: plain.slice(leadStart, last.end), context: around(plain, leadStart, last.end) });
    return [];
  }

  let chapters = !!choice.chapters;
  const spans: Span[] = [
    {
      start: leadStart,
      end: first.end,
      ref: makeRef(choice.book, choice.chapter, choice.verse, choice.rule),
      chapterOnly: chapters,
    },
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
        chapters = false;
      } else if (chapters) {
        chapter = item.a;
        verse = 1;
      } else {
        verse = item.a;
      }
      if (exists(book, chapter, chapters ? null : verse)) {
        spans.push({ start: item.start, end: item.end, ref: makeRef(book, chapter, verse, rule), chapterOnly: chapters });
      } else {
        ctx.misses.push({ text: plain.slice(item.start, item.end), context: around(plain, item.start, item.end) });
      }
    }
  }
  cite(ctx, book, chapter, chapters);
  return spans;
}

// ---------------------------------------------------------------------------
// One paragraph
// ---------------------------------------------------------------------------

/** A bare "chapter:verse" — not part of a longer number, a time, or a word. */
const CV_RE = /(?<![\w:.])\d+:\d+/g;
/** Words that make the numbers after them verses: "ver. 7", "(vers. 10, 11)". */
const VERSE_WORD_RE = /\b(?:verses?|vers?)\.?\s*(?=\d)/gi;
/** Words that make them chapters: "ch. 7", "chapters 7 and 8". */
const CHAPTER_WORD_RE = /\b(?:chapters?|chaps?|chs?)\.?\s*(?=\d)/gi;
/** Any other number. It counts only as a verse inside brackets: "(33)". */
const NUMBER_RE = /(?<![\w:.,$/\-–])\d+/g;
/** What a bracketed verse number follows: the bracket, a comma or semicolon, "comp.". */
const VERSE_LEAD_RE = /(?:\(|[,;]|\b(?:comp|cf|see)\.?)\s*$/i;
/** And what follows it. "(about 30 days)" or "(10 men)" isn't a reference. */
const VERSE_TAIL_RE = /^\s*(?:[).;,\]]|$)/;
/** No chapter has more verses than Psalm 119's 176, so a bigger number is a year or a count. */
const MAX_VERSE = 176;

interface Para {
  plain: string;
  fixAt: FixAt;
  /** Numbers written "(1) ", "(2) " in front of words — a numbered list. */
  markers: Set<number>;
}

/** Every match of a global regex that starts in [from, to), read against the whole text. */
function* matchesIn(re: RegExp, text: string, from: number, to: number) {
  re.lastIndex = from;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null && m.index < to) {
    yield m;
    if (m[0].length === 0) re.lastIndex++;
  }
}

/** How many brackets are open at `at`. */
function depthAt(plain: string, at: number): number {
  let depth = 0;
  for (let i = 0; i < at; i++) {
    if (plain[i] === '(') depth++;
    else if (plain[i] === ')' && depth > 0) depth--;
  }
  return depth;
}

/**
 * "(1) Peter; (2) the lad" and "No. (2)": a number standing for an item in a
 * list, not a verse. Only one with a neighbor — "(1)" and "(2)" both there —
 * so a lone "(16) till" is still read as a verse.
 */
function isMarker(plain: string, item: Item, markers: Set<number>): boolean {
  if (plain[item.start - 1] !== '(' || plain[item.end] !== ')') return false;
  if (/No\.\s*\($/.test(plain.slice(Math.max(0, item.start - 6), item.start))) return true;
  return markers.has(item.a) && (markers.has(item.a - 1) || markers.has(item.a + 1));
}

type Cand = {
  at: number;
  /** Who wins when two start at the same place. */
  order: number;
  kind: 'book' | 'verse' | 'chapter' | 'cv' | 'bare';
  /** Where the numbers begin, past any "ver." or "ch.". */
  listAt: number;
  refs?: RefMatch[];
  end?: number;
};

/**
 * Find and place the references between two of the source's links.
 * `prevLinkEnd` is where the link before this stretch ends, if there is one.
 */
function scanGap(p: Para, from: number, to: number, prevLinkEnd: number | null, ctx: Ctx, out: Span[]) {
  const { plain, fixAt } = p;

  // References that name their own book: "2 Pet. 2:15", "jer. 40:1, 2, 5, 6".
  // Only with a verse, and only when the numbers weren't cut short to fit.
  const cands: Cand[] = [];
  for (const r of findRefs(plain.slice(from, to), { requireBook: true })) {
    const ref = { ...r, start: from + r.start, end: from + r.end };
    const group = cands[cands.length - 1];
    if (/[a-z]/i.test(r.raw)) {
      cands.push({ at: ref.start, order: 0, kind: 'book', listAt: ref.start, refs: [ref], end: ref.end });
    } else if (group) {
      group.refs!.push(ref);
      group.end = ref.end;
    }
  }
  const books = cands.filter((c) => !c.refs![0].chapterOnly && !/\d/.test(plain[c.refs![0].end] ?? ''));
  cands.length = 0;
  cands.push(...books);
  const blocked = (i: number) => books.some((g) => g.at <= i && i < g.end!);

  for (const m of matchesIn(VERSE_WORD_RE, plain, from, to)) {
    cands.push({ at: m.index, order: 1, kind: 'verse', listAt: m.index + m[0].length });
  }
  for (const m of matchesIn(CHAPTER_WORD_RE, plain, from, to)) {
    cands.push({ at: m.index, order: 1, kind: 'chapter', listAt: m.index + m[0].length });
  }
  for (const m of matchesIn(CV_RE, plain, from, to)) {
    cands.push({ at: m.index, order: 2, kind: 'cv', listAt: m.index });
  }
  for (const m of matchesIn(NUMBER_RE, plain, from, to)) {
    cands.push({ at: m.index, order: 3, kind: 'bare', listAt: m.index });
  }
  cands.sort((x, y) => x.at - y.at || x.order - y.order);

  let consumed = from;
  let lastEnd = prevLinkEnd;
  for (const c of cands) {
    if (c.at < consumed) continue;

    if (c.kind === 'book') {
      for (const r of c.refs!) {
        out.push({ start: r.start, end: r.end, ref: makeRef(r.book, r.chapter, r.verse, 'book'), chapterOnly: r.chapterOnly });
      }
      const last = c.refs![c.refs!.length - 1];
      cite(ctx, last.book, last.chapter, last.chapterOnly);
      consumed = lastEnd = c.end!;
      continue;
    }

    if (blocked(c.listAt)) continue;
    const items = readList(plain, c.listAt, to, blocked, c.kind === 'chapter');
    if (!items.length) continue;
    const first = items[0];
    const listEnd = items[items.length - 1].end;
    let choose: () => Choice | 'plain' | null;

    if (c.kind === 'chapter') {
      const named = namedBookBefore(plain, c.at);
      choose = () => chooseChapter(first, ctx, named, fixAt);
    } else if (c.kind === 'cv' || first.b != null) {
      if (first.b == null) continue;
      const named = c.kind === 'cv' ? namedBookBefore(plain, c.at) : null;
      choose = () => chooseBook(first, items, ctx, named, fixAt);
    } else if (c.kind === 'verse') {
      choose = () => chooseVerse(first, ctx, null, false, fixAt);
    } else {
      // A bare number counts only inside brackets, at the start of an item,
      // standing alone, and small enough to be a verse.
      if (first.a > MAX_VERSE || depthAt(plain, c.at) < 1) continue;
      if (!VERSE_LEAD_RE.test(plain.slice(Math.max(0, c.at - 12), c.at))) continue;
      if (!VERSE_TAIL_RE.test(plain.slice(listEnd))) continue;
      if (isMarker(plain, first, p.markers)) continue;
      const named = plain[c.at - 1] === '(' ? namedBookBefore(plain, c.at) : null;
      const afterLink = lastEnd != null && /^\s*[,;]\s*$/.test(plain.slice(lastEnd, c.at));
      choose = () => chooseVerse(first, ctx, named, afterLink, fixAt);
    }

    const spans = placeList(plain, items, c.kind === 'verse' || c.kind === 'chapter' ? c.at : first.start, ctx, fixAt, choose);
    out.push(...spans);
    consumed = listEnd;
    if (spans.length) lastEnd = spans[spans.length - 1].end;
  }
}

function linkParagraph(para: string, ctx: Ctx, fixes: BioFix[]): BioPiece[] {
  const { plain, spans: source } = readLinks(para);
  repairLinks(plain, source);

  // Where each fix's words sit in this paragraph.
  const fixSpots: { start: number; end: number; fix: BioFix }[] = [];
  for (const fix of fixes) {
    for (let at = plain.indexOf(fix.text); at >= 0; at = plain.indexOf(fix.text, at + 1)) {
      fixSpots.push({ start: at, end: at + fix.text.length, fix });
    }
  }
  const fixAt: FixAt = (start, end) => fixSpots.find((f) => f.start <= start && end <= f.end)?.fix;

  const markers = new Set<number>();
  for (const m of plain.matchAll(/\((\d)\)\s+(?=[^\s,;.)])/g)) markers.add(+m[1]);
  const p: Para = { plain, fixAt, markers };

  const spans: Span[] = [];
  let cursor = 0;
  let prevLinkEnd: number | null = null;
  for (const s of source) {
    scanGap(p, cursor, s.start, prevLinkEnd, ctx, spans);
    spans.push(s);
    cite(ctx, s.ref.book, s.ref.chapter, s.chapterOnly);
    cursor = prevLinkEnd = s.end;
  }
  scanGap(p, cursor, plain.length, prevLinkEnd, ctx, spans);

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
