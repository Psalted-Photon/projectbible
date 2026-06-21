/**
 * linkifyCommentaryRefs
 *
 * Post-processes commentary HTML to wrap detected Bible references in
 * clickable <span class="commentary-ref"> elements. Only text nodes are
 * touched — HTML tags are left completely intact.
 */

import { parseRefString } from './parseRefString';
import { getBookColor } from './bibleData';

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

// Chapter + optional verse + optional range  (e.g. 3, 3:4, 3:4a, 3:4-7, 3:4-5:2)
// [ab]? after verse allows half-verse suffixes like "2a" or "2b" without breaking the match
const CV_PATTERN = '\\d+(?::\\d+[ab]?(?:[\\-\u2013]\\d+(?::\\d+)?)?)?';

// Full ref pattern: book name/abbrev + whitespace + chapter[:verse[-range]].
// Also captures a trailing continuation tail of bare verse numbers separated
// by semicolons or commas — e.g. "Matt 5:6-8; 10; 17" or "Rom 8:1, 5, 28".
// Group 1 = book, Group 2 = first cv, Group 3 = continuation tail (may be empty).
const PROSE_REF_RE = new RegExp(
  `\\b(${BOOK_PATTERN})\\s+(${CV_PATTERN})((?:\\s*[;,]\\s*\\d+[ab]?(?![A-Za-z]))*)`,
  'g',
);

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

  // Step 1: linkify book + chapter[:verse] refs, plus any continuation verses
  // separated by semicolons/commas (e.g. "Matt 5:6-8; 10; 17").
  let out = text.replace(PROSE_REF_RE, (match, _book, _cv, tail: string) => {
    // mainText is everything before the continuation tail
    const mainText = tail ? match.slice(0, match.length - tail.length) : match;
    const target = parseRefString(mainText.trim(), contextBook, contextChapter);
    if (!target) return match;

    const refColor = getBookColor(target.book);
    let result = wrapRef(mainText, refColor);

    // Link each bare number in the tail as a verse in the same book+chapter
    if (tail) {
      result += tail.replace(/([;,]\s*)(\d+[ab]?)/g, (_, sep, num) => {
        const contRef = `${target.book} ${target.chapter}:${num}`;
        return (
          sep +
          `<span class="commentary-ref" style="--ref-color:${refColor}" data-ref="${escAttr(contRef)}" tabindex="0" role="link">${num}</span>`
        );
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
