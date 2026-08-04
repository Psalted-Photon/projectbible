/**
 * linkifyCommentaryRefs
 *
 * Post-processes commentary HTML to wrap detected Bible references in
 * clickable <span class="commentary-ref"> elements. Only text nodes are
 * touched — HTML tags are left completely intact.
 */

import { parseRefString } from './parseRefString';
import { findRefs } from './bibleRefs';
import { getBookColor } from './bibleData';

// NOTE: reference detection now lives in lib/bibleRefs.ts, shared with the
// notes editor. What remains here is this file's own job: walking stored HTML
// without touching tags, and the author-specific formatting below.


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

  // Step 1: linkify references. Detection lives in lib/bibleRefs so notes and
  // commentary agree on what a reference is; 'loose' mode reproduces this
  // file's original rules exactly — book-less leads get their chapter checked,
  // nothing else is validated or trimmed.
  const matches = findRefs(text, {
    requireBook: false,
    contextBook,
    contextChapter,
    strict: false,
  });

  let out = '';
  let cursor = 0;
  for (const ref of matches) {
    // Skip a match that overlaps one already emitted (defensive; findRefs
    // returns them in order and non-overlapping).
    if (ref.start < cursor) continue;
    out += text.slice(cursor, ref.start);
    out += wrapAbs(ref.raw, ref.book, ref.chapter, ref.verse, getBookColor(ref.book));
    cursor = ref.end;
  }
  out += text.slice(cursor);

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
