/**
 * bibleRefs — one place that decides what counts as a Bible reference.
 *
 * Both reference linkers call this: the commentary linker, which walks stored
 * HTML and allows book-less references because it knows what chapter you are
 * reading, and the notes editor, which requires a book on every reference
 * because a note has no such context.
 *
 * The matching itself was lifted from linkifyCommentaryRefs so commentary keeps
 * behaving exactly as it did — only its home changed.
 *
 * Everything here is a pure function and the stateful regexes are reset at the
 * top of every call, so two panels (a Commentary window and a Notes window, say)
 * can be detecting at the same moment without interfering.
 */

import { VERSE_COUNTS } from '@projectbible/core';
import { BOOK_MAP, parseRefString } from './parseRefString';
import { getBookChapters, normalizeBookName } from './bibleData';

// ---------------------------------------------------------------------------
// Book name resolution
// ---------------------------------------------------------------------------

/**
 * Written-out ordinals, so "first timothy 1:1" resolves the same as "1 Timothy 1:1".
 * Bare "Timothy" is deliberately absent from every table — it is ambiguous
 * between 1 and 2 Timothy, and a reference we cannot place is better left as
 * ordinary text than guessed at.
 */
const ORDINAL_WORDS: Record<string, string> = {
  first: '1', second: '2', third: '3',
  '1st': '1', '2nd': '2', '3rd': '3',
  i: '1', ii: '2', iii: '3',
};

/** Prefixes people write before a book name that carry no reference meaning. */
const DROPPED_PREFIX_RE = /^(?:the\s+)?(?:gospel|book|epistle|letter|psalm)\s+(?:of|to|according\s+to)\s+(?:the\s+)?/i;

/**
 * Resolve however the user wrote a book name to the app's canonical spelling,
 * or null when it isn't a book we recognise.
 */
export function resolveBook(raw: string): string | null {
  if (!raw) return null;

  let s = raw.trim().toLowerCase().replace(/\.\s*/g, ' ').replace(/\s+/g, ' ').trim();
  s = s.replace(DROPPED_PREFIX_RE, '').trim();

  // "first timothy" → "1 timothy"
  const ordinal = s.match(/^([a-z0-9]+)\s+(.+)$/);
  if (ordinal && ORDINAL_WORDS[ordinal[1]]) {
    s = `${ORDINAL_WORDS[ordinal[1]]} ${ordinal[2]}`;
  }

  const direct = BOOK_MAP[s];
  if (direct) return normalizeBookName(direct);

  // "1timothy" written without the space
  const squashed = s.match(/^([123])\s*(.+)$/);
  if (squashed) {
    const spaced = BOOK_MAP[`${squashed[1]} ${squashed[2]}`] ?? BOOK_MAP[`${squashed[1]}${squashed[2]}`];
    if (spaced) return normalizeBookName(spaced);
  }

  return null;
}

// ---------------------------------------------------------------------------
// Range validation
// ---------------------------------------------------------------------------

/**
 * The verse-count table is generated from the pack database, which spells
 * Psalms in the plural. The app says Psalm. Translate rather than rename the
 * generated data.
 */
function verseCountKey(book: string): string {
  if (VERSE_COUNTS[book]) return book;
  if (book === 'Psalm') return 'Psalms';
  return book;
}

export function isValidChapter(book: string, chapter: number): boolean {
  return chapter >= 1 && chapter <= getBookChapters(book);
}

/**
 * The longest leading run of digits that still passes `ok`, or '' if even the
 * first digit fails. "32" against Acts 28 (31 verses) gives "3".
 */
function longestValidPrefix(digits: string, ok: (n: number) => boolean): string {
  for (let len = digits.length; len > 0; len--) {
    const slice = digits.slice(0, len);
    if (ok(parseInt(slice))) return slice;
  }
  return '';
}

export function isValidVerse(book: string, chapter: number, verse: number): boolean {
  const counts = VERSE_COUNTS[verseCountKey(book)];
  // No data for this book — don't reject on ignorance, only on knowledge.
  if (!counts) return verse >= 1;
  const max = counts[chapter - 1];
  if (!max) return verse >= 1;
  return verse >= 1 && verse <= max;
}

// ---------------------------------------------------------------------------
// Patterns (lifted verbatim from linkifyCommentaryRefs)
// ---------------------------------------------------------------------------

// Book names and abbreviations recognised in prose. Ordered longest-first so
// the alternation engine matches greedily.
//
// This list is commentary's, character for character, so nothing about how
// commentary reads its own data changes. Notes extend it below rather than
// editing it.
const BOOK_PATTERN = [
  // Multi-word full names with number prefix: "1 Samuel 3:4", "2 Kings 5:1"
  '[123]\\s+(?:Samuel|Kings|Chronicles|Corinthians|Thessalonians|Timothy|Peter|John)',
  // Song of Solomon / Songs
  'Song\\s+of\\s+(?:Solomon|Songs?)',
  // Long single-word full names (low false-positive risk)
  'Deuteronomy|Lamentations|Ecclesiastes|Philippians|Colossians|Revelation',
  'Ephesians|Galatians|Habakkuk|Zephaniah|Zechariah|Nehemiah|Proverbs',
  'Genesis|Exodus|Leviticus|Numbers|Joshua|Judges|Psalms?|Isaiah|Jeremiah|Ezekiel|Hebrews',
  'Matthew|Obadiah|Haggai|Malachi|Romans|Hosea|Daniel',
  'Ruth|Esther|Job|Joel|Amos|Jonah|Micah|Nahum|Luke|Acts|James|Jude',
  // Numbered abbreviations: 1Sa, 2Ki, 1Co, etc.
  '[123](?:Sam?|Kgs?|Ki|Chr?(?:on)?|Cor?|Thess?|Tim?|Pet?|J(?:oh?n?|n))',
  // Common 2-3 char abbreviations missing from patterns above
  'Rth|Luc|Jdg|Mt|Mk|Mr|Lk|Jn|Ru|Dt',
  // Standard abbreviations (3+ chars)
  'Gen|Exo?d?|Lev|Nu(?:m)?|De(?:ut?)?|Jos(?:h)?|Jud?g?|Neh|Es(?:th?)?|Psa?|Pro?v?|Eccl?',
  'Isa|Jer|Lam|Eze?k?|Da(?:n)?|Hos|Joe?l?|Amo?s?|Oba?d?|Jon(?:ah)?|Mic|Na(?:h)?|Ha(?:b)?',
  'Ze(?:ph?)?|Ha(?:g)?|Ze(?:ch?)?|Mal|Matt?|Ma(?:rk?)?|Lu(?:ke?)?|Joh?n?|Act?s?|Ro(?:m)?',
  'Ga(?:l)?|Ep(?:h)?|Ph(?:il?p?|p)|Co(?:l)?|He(?:b)?|Ja(?:s)?|Ti(?:t)?|Phlm?|Ph(?:ile)?|Re(?:v)?|Jb',
  // Terse SWORD/JFB two-letter abbreviations not covered above
  'Ge|Le|Jr|Is|Ne|Ezr|Ho|Ec|Mi|So|La',
].join('|');

// A full chapter:verse token, with optional half-verse suffix and range
// (e.g. 3:4, 3:4a, 3:4-7, 3:4-5:2). Colon is mandatory.
const CV_FULL = '\\d+:\\d+[ab]?(?:[\\-–]\\d+(?::\\d+)?)?';
// A lead reference following an explicit book: chapter, with optional :verse[-range].
// The verse is optional so "Ro 14" (chapter-only) is matched.
const CV_LEAD = '\\d+(?::\\d+[ab]?(?:[\\-–]\\d+(?::\\d+)?)?)?';
// A continuation segment after a ';' or ',' — either a full chapter:verse or a
// bare number. The bare-number form must NOT be followed by a letter so we don't
// swallow the leading digit of a book abbreviation (e.g. the "1" in "1Pet 2:5").
const CONT_SEG = `(?:${CV_FULL}|\\d+[ab]?)`;

/**
 * Book optional — a bare "3:16" resolves against the chapter being read.
 * Case-sensitive, matching commentary's long-standing behaviour.
 */
const REF_RE_CONTEXTUAL = new RegExp(
  `\\b(?:(${BOOK_PATTERN})\\s+(${CV_LEAD})|(${CV_FULL}))((?:\\s*[;,]\\s*${CONT_SEG}(?![A-Za-z]))*)`,
  'g',
);

/**
 * The notes pattern. Two differences from commentary's:
 *
 * It is case-insensitive, because people type "luke 12:1" and "psalms 50" in
 * their own notes. That is safe only because of the lowercase guard in
 * resolveLead below — without it, "the answer is 5" would sprout an Isaiah link
 * off the two-letter abbreviation "Is".
 *
 * And it accepts the long way of writing a book: "first timothy", "gospel of
 * luke", "the book of romans".
 */
const NAME_PREFIX = '(?:(?:the\\s+)?(?:gospel|book|epistle|letter)\\s+(?:of|to|according\\s+to)\\s+(?:the\\s+)?)?';
const NUMBERED = '(?:Samuel|Kings|Chronicles|Corinthians|Thessalonians|Timothy|Peter|John)';
const NUMBERED_ABBREV = '(?:Sam?|Kgs?|Ki|Chr?(?:on)?|Cor?|Thess?|Tim?|Pet?|J(?:oh?n?|n))';
const BOOK_PATTERN_NOTES = [
  // "first Timothy", "second Peter", "III John" — safe despite "I" being a
  // pronoun, because a full book name has to follow immediately.
  `(?:first|second|third|1st|2nd|3rd|iii|ii|i)\\s+${NUMBERED}`,
  // "1 Cor 13:4" — a space between the number and a short form, which people
  // write constantly but commentary data does not.
  `[123]\\s+${NUMBERED_ABBREV}\\b`,
  // Three full names the commentary pattern never needed, because its source
  // data only ever abbreviates them. Someone writing a note types them out.
  'Ezra|Titus|Philemon',
  BOOK_PATTERN,
].join('|');

/**
 * Between the book and the numbers: whitespace, or the abbreviation period that
 * print uses — "Ps. 119:5", "Rom. 8:28".
 *
 * The period form additionally requires a chapter:verse to follow. Without that
 * guard, "I finished the job. 5 minutes later" would light up as Job 5, because
 * a sentence ending in a book name followed by a numeral looks identical to a
 * reference. Requiring the colon makes the two impossible to confuse.
 */
const BOOK_NUMBER_GAP = '(?:\\s+|\\.\\s+(?=\\d+:))';

const REF_RE_BOOK_REQUIRED = new RegExp(
  `\\b(${NAME_PREFIX}(?:${BOOK_PATTERN_NOTES}))${BOOK_NUMBER_GAP}(${CV_LEAD})((?:\\s*[;,]\\s*${CONT_SEG}(?![A-Za-z]))*)`,
  'gi',
);

/**
 * The book name on its own, with whatever numbers are half-typed after it.
 *
 * Used while someone is editing an existing link. Backspacing "Acts 5:4" passes
 * through "Acts " — not a reference, but plainly on its way to being one again.
 * Recognising that lets the link hold together instead of falling apart at the
 * halfway point and stranding the edit.
 */
const PARTIAL_RE = new RegExp(
  `^\\s*(${NAME_PREFIX}(?:${BOOK_PATTERN_NOTES}))\\s*\\.?\\s*[\\d:;,\\s–-]*$`,
  'i',
);

/**
 * Could this text still become a reference if the writer keeps going?
 *
 * True for "Acts", "Acts ", "1 Cor " — a book name followed by nothing but the
 * characters references are made of. False once a real word appears.
 *
 * Only ever asked about text that holds NO complete reference yet. That is what
 * makes the trailing whitespace here safe: "Acts " is plainly on its way back to
 * being a reference, whereas "Acts 5:4 " already contains a finished one, so its
 * space ends it rather than holding it open.
 */
export function couldBecomeRef(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  const m = trimmed.match(PARTIAL_RE);
  if (!m) return false;
  const bookToken = m[1];
  if (shortFormNeedsCapital(bookToken)) return false;
  return resolveBook(bookToken) !== null;
}

/**
 * The only abbreviations that genuinely turn up in ordinary sentences followed
 * by a number — "the answer is 5 minutes", "I am 5 foot ten", "he 3 times
 * refused", "so 1 more thing". Lowercase, these are prose; capitalised
 * ("Is 5:8", "Am 5:18") they are books.
 *
 * Everything else is accepted in any case, because the cost of being strict is
 * that the abbreviations people actually type — ps, ro, ge, ex, lk — stop
 * working, and that is felt far more often than a stray link on "is 5".
 */
const AMBIGUOUS_SHORT_FORMS = new Set(['is', 'am', 'he', 'so']);

function shortFormNeedsCapital(bookToken: string): boolean {
  const bare = bookToken.replace(/^[123]\s*/, '').replace(/\.$/, '');
  if (!AMBIGUOUS_SHORT_FORMS.has(bare.toLowerCase())) return false;
  return bare[0] === bare[0]?.toLowerCase();
}

/** Matches one continuation segment (separator + ref) inside a tail. */
const CONT_SEG_RE = new RegExp(`([;,]\\s*)(${CV_FULL}|\\d+[ab]?)`, 'g');

// ---------------------------------------------------------------------------
// Detection
// ---------------------------------------------------------------------------

export interface RefMatch {
  /** Index into the scanned string where this reference's text begins. */
  start: number;
  /** Index just past its last character. */
  end: number;
  /** The text as it appeared. */
  raw: string;
  /** Canonical "Book 12:1" or "Book 12" — what a note displays and stores. */
  canonical: string;
  book: string;
  chapter: number;
  verse: number;
  /** True when the reference named only a chapter, so there is no verse to expand. */
  chapterOnly: boolean;
}

export interface FindRefsOptions {
  /** When false, a book-less "3:16" resolves against contextBook/contextChapter. */
  requireBook?: boolean;
  contextBook?: string;
  contextChapter?: number;
  /**
   * Strict mode (notes) checks both chapter and verse against the real book and
   * trims a match back to the part that is genuinely a reference.
   *
   * Loose mode (commentary) only rejects a book-less reference whose chapter
   * cannot exist — exactly what the commentary linker did before this file
   * existed. Commentary quotes KJV-era references against a verse-count table
   * generated from one particular translation, so verse-level checking there
   * would reject perfectly good references.
   */
  strict?: boolean;
}

/**
 * Find every Bible reference in a plain-text string.
 *
 * Only the part that is genuinely a reference is reported. "Luke 75" yields a
 * match covering just "Luke" (Luke 1:1), and "Luke 12:200" one covering just
 * "Luke 12" — the leftover characters are left for the caller to render as
 * ordinary text.
 */
export function findRefs(text: string, opts: FindRefsOptions = {}): RefMatch[] {
  const { requireBook = true, contextBook = '', contextChapter = 1, strict = true } = opts;
  if (!text) return [];
  if (!requireBook && !contextBook) return [];

  const re = requireBook ? REF_RE_BOOK_REQUIRED : REF_RE_CONTEXTUAL;
  re.lastIndex = 0;

  const out: RefMatch[] = [];
  let m: RegExpExecArray | null;

  while ((m = re.exec(text)) !== null) {
    // Guard against a zero-length match spinning forever.
    if (m[0].length === 0) { re.lastIndex++; continue; }

    const book = m[1];
    const tail = (requireBook ? m[3] : m[4]) ?? '';
    const leadText = tail ? m[0].slice(0, m[0].length - tail.length) : m[0];
    const leadStart = m.index;

    const lead = resolveLead(leadText, book, leadStart, contextBook, contextChapter, strict);
    if (!lead) continue;
    out.push(lead);

    if (!tail) continue;

    // Continuations: after "Psa 89:28", a bare "29" is another verse of chapter
    // 89, and "110:4" moves to chapter 110 of the same book. A lead with no
    // verse ("Ro 14") makes bare numbers chapters instead.
    let mode: 'verse' | 'chapter' = leadText.includes(':') ? 'verse' : 'chapter';
    let runningChapter = lead.chapter;
    const tailStart = leadStart + leadText.length;

    CONT_SEG_RE.lastIndex = 0;
    let c: RegExpExecArray | null;
    while ((c = CONT_SEG_RE.exec(tail)) !== null) {
      const segStart = tailStart + c.index + c[1].length;
      const seg = c[2];
      const colon = seg.match(/^(\d+):(\d+)/);

      if (colon) {
        runningChapter = parseInt(colon[1]);
        mode = 'verse';
        const verse = parseInt(colon[2]);
        pushIfValid(out, lead.book, runningChapter, verse, seg, segStart, false, strict);
        continue;
      }

      const num = parseInt(seg);
      if (mode === 'chapter') {
        runningChapter = num;
        pushIfValid(out, lead.book, num, 1, seg, segStart, true, strict);
      } else {
        pushIfValid(out, lead.book, runningChapter, num, seg, segStart, false, strict);
      }
    }
  }

  return out;
}

/**
 * Turn the lead portion of a match into a validated reference, trimming it back
 * to the part that is actually real when the chapter or verse is out of range.
 */
function resolveLead(
  leadText: string,
  bookToken: string | undefined,
  leadStart: number,
  contextBook: string,
  contextChapter: number,
  strict: boolean,
): RefMatch | null {
  const hasBook = !!bookToken;
  // Where the chapter:verse part starts — measured past the book name, so the
  // leading "1" of "1 Samuel" is not mistaken for a chapter.
  const cvOffset = bookToken ? leadText.indexOf(bookToken) + bookToken.length : 0;
  const numbers = leadText.slice(cvOffset).match(/\d/);
  const numberAt = numbers?.index === undefined ? undefined : cvOffset + numbers.index;

  let target: { book: string; chapter: number; verse: number } | null;

  if (strict) {
    // Notes resolve the book themselves, so "first timothy" and "gospel of
    // luke" work — parseRefString only knows the plain forms.
    if (!bookToken || numberAt === undefined) return null;
    if (shortFormNeedsCapital(bookToken)) return null;
    const resolved = resolveBook(bookToken);
    if (!resolved) return null;
    const cv = leadText.slice(numberAt);
    const full = cv.match(/^(\d+):(\d+)/);
    const bare = cv.match(/^(\d+)/);
    if (full) target = { book: resolved, chapter: parseInt(full[1]), verse: parseInt(full[2]) };
    else if (bare) target = { book: resolved, chapter: parseInt(bare[1]), verse: 1 };
    else return null;
  } else {
    target = parseRefString(leadText.trim(), contextBook, contextChapter);
  }
  if (!target) return null;

  const book = normalizeBookName(target.book);
  const chapterOK = isValidChapter(book, target.chapter);

  // Loose mode reproduces the commentary linker's original rule exactly: only a
  // book-less reference gets its chapter checked, and nothing gets trimmed.
  if (!strict) {
    if (!hasBook && !chapterOK) return null;
    const chapterOnlyLoose = !leadText.includes(':');
    return {
      start: leadStart,
      end: leadStart + leadText.length,
      raw: leadText,
      canonical: chapterOnlyLoose
        ? `${book} ${target.chapter}`
        : `${book} ${target.chapter}:${target.verse}`,
      book,
      chapter: target.chapter,
      verse: target.verse,
      chapterOnly: chapterOnlyLoose,
    };
  }

  // A number that has run past what the book actually has: keep the digits that
  // are still real and leave the rest as ordinary text. Typing "acts 28:32"
  // links "Acts 28:3" and drops the trailing "2" outside — Acts 28 stops at
  // verse 31. Nothing is deleted; the writer sees their own mistake sitting
  // there. The same applies to chapters, so "Luke 75" links "Luke 7".
  const chapterOnly = !leadText.includes(':');

  if (!chapterOK) {
    if (!hasBook || numberAt === undefined) return null; // book-less "99:1" is just numbers
    const digits = leadText.slice(numberAt).match(/^\d+/)?.[0] ?? '';
    const keep = longestValidPrefix(digits, (n) => isValidChapter(book, n));
    if (!keep) return null; // not even the first digit is a real chapter
    const trimmed = leadText.slice(0, numberAt + keep.length);
    return {
      start: leadStart,
      end: leadStart + trimmed.length,
      raw: trimmed,
      canonical: `${book} ${parseInt(keep)}`,
      book,
      chapter: parseInt(keep),
      verse: 1,
      chapterOnly: true,
    };
  }

  if (!chapterOnly && !isValidVerse(book, target.chapter, target.verse)) {
    const colonAt = leadText.indexOf(':');
    const digits = leadText.slice(colonAt + 1).match(/^\d+/)?.[0] ?? '';
    const keep = longestValidPrefix(digits, (n) => isValidVerse(book, target.chapter, n));
    // Not even the first digit is a real verse — keep the chapter alone.
    const trimmed = keep ? leadText.slice(0, colonAt + 1 + keep.length) : leadText.slice(0, colonAt);
    return {
      start: leadStart,
      end: leadStart + trimmed.length,
      raw: trimmed,
      canonical: keep ? `${book} ${target.chapter}:${parseInt(keep)}` : `${book} ${target.chapter}`,
      book,
      chapter: target.chapter,
      verse: keep ? parseInt(keep) : 1,
      chapterOnly: !keep,
    };
  }

  return {
    start: leadStart,
    end: leadStart + leadText.length,
    raw: leadText,
    canonical: chapterOnly ? `${book} ${target.chapter}` : `${book} ${target.chapter}:${target.verse}`,
    book,
    chapter: target.chapter,
    verse: target.verse,
    chapterOnly,
  };
}

function pushIfValid(
  out: RefMatch[],
  book: string,
  chapter: number,
  verse: number,
  raw: string,
  start: number,
  chapterOnly: boolean,
  strict: boolean,
): void {
  if (strict && !isValidChapter(book, chapter)) return;
  if (strict && !chapterOnly && !isValidVerse(book, chapter, verse)) return;
  out.push({
    start,
    end: start + raw.length,
    raw,
    canonical: chapterOnly ? `${book} ${chapter}` : `${book} ${chapter}:${verse}`,
    book,
    chapter,
    verse,
    chapterOnly,
  });
}
