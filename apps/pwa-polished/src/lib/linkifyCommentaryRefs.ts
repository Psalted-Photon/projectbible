/**
 * linkifyCommentaryRefs
 *
 * Post-processes commentary HTML to wrap detected Bible references in
 * clickable <span class="commentary-ref"> elements. Only text nodes are
 * touched — HTML tags are left completely intact.
 */

import { parseRefString } from './parseRefString';
import { getBookColor, getBookChapters } from './bibleData';

// Bible book names and abbreviations recognised in commentary prose.
// Ordered longest-first so the alternation engine matches greedily.
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
  // Terse SWORD/JFB two-letter abbreviations not covered above (Ge=Genesis,
  // Le=Leviticus, Jr=Jeremiah, Is=Isaiah, Ne=Nehemiah, Ezr=Ezra, Ho=Hosea,
  // Ec=Ecclesiastes, Mi=Micah, So=Song, La=Lamentations). Listed last so longer
  // forms like "Isa"/"Gen" still match greedily first.
  'Ge|Le|Jr|Is|Ne|Ezr|Ho|Ec|Mi|So|La',
].join('|');

// A full chapter:verse token, with optional half-verse suffix and range
// (e.g. 3:4, 3:4a, 3:4-7, 3:4-5:2). Colon is mandatory.
const CV_FULL = '\\d+:\\d+[ab]?(?:[\\-\u2013]\\d+(?::\\d+)?)?';
// A lead reference following an explicit book: chapter, with optional :verse[-range].
// The verse is optional so "Ro 14" (chapter-only) is matched.
const CV_LEAD = '\\d+(?::\\d+[ab]?(?:[\\-\u2013]\\d+(?::\\d+)?)?)?';
// A continuation segment after a ';' or ',' \u2014 either a full chapter:verse or a
// bare number. The bare-number form must NOT be followed by a letter so we don't
// swallow the leading digit of a book abbreviation (e.g. the "1" in "1Pet 2:5").
const CONT_SEG = `(?:${CV_FULL}|\\d+[ab]?)`;

// Full ref pattern. The book prefix is OPTIONAL:
//   • With a book: lead may be "ch" or "ch:verse" (Group 1 = book, Group 2 = cv).
//   • Without a book: lead MUST be "ch:verse" (Group 3 = cv) — resolved against the
//     current book. A bare lone number is never linked, to avoid false positives.
// A trailing continuation tail (Group 4) captures further refs separated by ';'/','
// — e.g. "Psa 89:28, 29; 110:4" or "Da 2:44; 7:13, 14".
const PROSE_REF_RE = new RegExp(
  `\\b(?:(${BOOK_PATTERN})\\s+(${CV_LEAD})|(${CV_FULL}))((?:\\s*[;,]\\s*${CONT_SEG}(?![A-Za-z]))*)`,
  'g',
);

// Matches one continuation segment (separator + ref) inside a tail.
const CONT_SEG_RE = new RegExp(`([;,]\\s*)(${CV_FULL}|\\d+[ab]?)`, 'g');

// Bare verse reference: "v. 3", "ver. 3", "ver 3", "verse 3" (case-insensitive)
const BARE_VERSE_RE = /\b(v(?:erse|er)?\.?)\s+(\d+)\b/gi;

// Section header words that King Comments concatenates directly to body text
// e.g. "IntroductionThe book of..." → "INTRODUCTION\n\nThe book of..."
const KNOWN_HEADER_RE =
  /\b(Introduction|Background|Conclusion|Outline|Summary|Application|Interpretation|Analysis|Purpose|Theme|Context|Overview|Exposition|Notes?)([A-Z])/g;

// Spurgeon (Treasury of David) section headers embedded inline in prose.
// Matches a sentence-ending punctuation followed by the header keyword.
// e.g. "...sermon. DIVISION. This Psalm..." → break + bold header + break
const SPURGEON_HEADER_RE =
  /([.!?"\u201d])\s+((?:OVERVIEW\s+TITLE|TITLE|DIVISION[S]?|EXPOSITION|ORDER|SUBJECT|NOTES?|APPLICATION)\.?)\s+/g;

// Spurgeon "Verse N." pattern — marks the start of per-verse commentary
const SPURGEON_VERSE_RE = /\bVerse\s+(\d+)\./g;

/** Escape HTML attribute value characters. */
function escAttr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
}

/**
 * Wrap a validated Bible reference match in a clickable span.
 * @param raw     The raw matched text (used as display AND data-ref)
 * @param color   Optional theme color (hex) applied as the --ref-color CSS var
 */
function wrapRef(raw: string, color?: string): string {
  const style = color ? ` style="--ref-color:${color}"` : '';
  return `<span class="commentary-ref"${style} data-ref="${escAttr(raw.trim())}" tabindex="0" role="link">${raw}</span>`;
}

/**
 * Wrap a reference with an explicit, absolute data-ref ("Book chapter:verse"),
 * while keeping the original on-screen text as the display label. Used for
 * continuation segments where the displayed token (e.g. "110:4" or "14") differs
 * from the full resolved reference.
 */
function wrapAbs(display: string, book: string, chapter: number, verse: number, color: string): string {
  const ref = `${book} ${chapter}:${verse}`;
  return `<span class="commentary-ref" style="--ref-color:${color}" data-ref="${escAttr(ref)}" tabindex="0" role="link">${display}</span>`;
}

/**
 * Process a single plain-text segment (no HTML tags).
 * Detects Bible references and wraps them in clickable spans.
 */
function processTextSegment(
  text: string,
  contextBook: string,
  contextChapter: number,
  author?: string,
): string {
  // Reset stateful global regexes before each use
  PROSE_REF_RE.lastIndex = 0;
  BARE_VERSE_RE.lastIndex = 0;
  KNOWN_HEADER_RE.lastIndex = 0;

  // Spurgeon (Treasury of David): inject paragraph breaks + bold headers before
  // section labels and verse markers, which are buried inline with no whitespace.
  if (author === 'Charles Spurgeon') {
    SPURGEON_HEADER_RE.lastIndex = 0;
    SPURGEON_VERSE_RE.lastIndex = 0;
    text = text.replace(
      SPURGEON_HEADER_RE,
      (_: string, punct: string, header: string) =>
        `${punct}<br><br><strong>${header.trim()}</strong><br><br>`,
    );
    text = text.replace(
      SPURGEON_VERSE_RE,
      (_: string, num: string) => `<br><br><strong>Verse ${num}.</strong> `,
    );
  }

  // Pre-process: separate section headers from immediately-following body text
  // e.g. "IntroductionThe book of..." → "INTRODUCTION<br><br>The book of..."
  text = text.replace(KNOWN_HEADER_RE, (_, header: string, nextChar: string) =>
    `${header.toUpperCase()}<br><br>${nextChar}`,
  );

  // Step 1: linkify references — an optional-book lead plus any continuation
  // segments separated by ';'/',' (e.g. "Psa 89:28, 29; 110:4", "Ro 14; 15",
  // book-less "10:34; 15:25"). A segment with a colon is a new chapter:verse of
  // the same book; a bare number is a verse of the running chapter — unless the
  // lead had no verse (e.g. "Ro 14"), in which case bare numbers are chapters.
  let out = text.replace(PROSE_REF_RE, (match, book: string, _cvBook: string, _cvBare: string, tail: string) => {
    // Lead text is everything before the continuation tail.
    const leadText = tail ? match.slice(0, match.length - tail.length) : match;
    const target = parseRefString(leadText.trim(), contextBook, contextChapter);
    if (!target) return match;

    // For book-less leads, suppress stray "\d+:\d+" matches (e.g. ratios/times)
    // by requiring the chapter to be valid for the current book.
    const hasBook = !!book;
    if (!hasBook && target.chapter > getBookChapters(target.book)) return match;

    const refColor = getBookColor(target.book);
    // 'verse' mode: bare continuation numbers are verses of runningChapter.
    // 'chapter' mode: lead had no verse, so bare numbers are chapters.
    let mode: 'verse' | 'chapter' = leadText.includes(':') ? 'verse' : 'chapter';
    let runningChapter = target.chapter;

    let result = wrapAbs(leadText, target.book, target.chapter, target.verse, refColor);

    if (tail) {
      CONT_SEG_RE.lastIndex = 0;
      result += tail.replace(CONT_SEG_RE, (_m, sep: string, seg: string) => {
        const colon = seg.match(/^(\d+):(\d+)/);
        if (colon) {
          // New chapter:verse of the same book → switch into verse mode there.
          runningChapter = parseInt(colon[1]);
          mode = 'verse';
          return sep + wrapAbs(seg, target.book, runningChapter, parseInt(colon[2]), refColor);
        }
        const num = parseInt(seg);
        if (mode === 'chapter') {
          // Bare number continuing a chapter-only list → a chapter (verse 1).
          runningChapter = num;
          return sep + wrapAbs(seg, target.book, num, 1, refColor);
        }
        // Bare number → a verse of the running chapter.
        return sep + wrapAbs(seg, target.book, runningChapter, num, refColor);
      });
    }

    return result;
  });

  // Step 2: linkify bare verse refs (v. N / verse N)
  // These don't contain '<' so no need to avoid tags here.
  out = out.replace(BARE_VERSE_RE, (match) => {
    const target = parseRefString(match.trim(), contextBook, contextChapter);
    return target ? wrapRef(match, getBookColor(target.book)) : match;
  });

  // Step 3: convert stored paragraph breaks (\n\n) and line breaks (\n) to HTML.
  // These come from the pack data where OSIS paragraph markers were preserved.
  out = out.replace(/\n\n+/g, '<br><br>');
  out = out.replace(/\n/g, '<br>');

  return out;
}

/**
 * Post-process commentary HTML: detect Bible references in text content
 * and wrap them in <span class="commentary-ref"> elements.
 *
 * @param html           Raw HTML string from a CommentaryEntry
 * @param contextBook    Canonical book name (e.g. "Romans") for relative refs
 * @param contextChapter Chapter number for verse-only refs (e.g. 8)
 * @param author         Optional author name — used to apply author-specific formatting
 */
export function linkifyCommentaryRefs(
  html: string,
  contextBook: string,
  contextChapter: number,
  author?: string,
): string {
  if (!html || !contextBook) return html;

  // Split on HTML tags, preserving the tags themselves in the output array.
  // Even-indexed items are text segments; odd-indexed are tag strings.
  const parts = html.split(/(<[^>]*>)/);

  return parts
    .map((part) => {
      // Leave HTML tags untouched
      if (part.startsWith('<')) return part;
      // Process text segments
      return processTextSegment(part, contextBook, contextChapter, author);
    })
    .join('');
}
