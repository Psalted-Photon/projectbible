/**
 * linkifyNoteRefs
 *
 * Turns a stored footnote body into the HTML the footnote card shows: italics
 * where the translation set the alternate wording in italics, and a tappable
 * span on every reference.
 *
 * References arrive two ways. Some carry a target the publisher resolved --
 * BSB's USJ edition tags 985 of them, WEB's USFX 351 -- and those are exact, so
 * they are used as given. The rest are plain prose ("also in verse 4; see
 * 1 Kings 4:6 and 2 Chronicles 10:18"), and are found the same way commentary
 * references are, by lib/bibleRefs. Both matter: a source usually tags only the
 * first reference in a note and leaves the rest as words.
 */

import { findRefs } from './bibleRefs';
import { parseOsisRef } from './parseRefString';
import { getBookColor } from './bibleData';

/** Note sentinels; the definitive list is in packtools/usfm-scanner.mjs. */
const REF_OPEN = '\x17';
const REF_SEP = '\x18';
const REF_CLOSE = '\x19';
const NOTE_I_OPEN = '\x1A';
const NOTE_I_CLOSE = '\x1B';

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * One reference, as a span the card's click handler picks up. `ref` is what
 * gets navigated to; `label` is what the note actually said.
 */
function wrapRef(label: string, ref: string, book: string): string {
  return (
    `<span class="note-ref" style="--ref-color:${getBookColor(book)}" ` +
    `data-ref="${escapeHtml(ref)}" tabindex="0" role="link">${escapeHtml(label)}</span>`
  );
}

/** Linkify a run of plain prose, leaving everything that isn't a reference alone. */
function linkifyProse(text: string, contextBook: string, contextChapter: number): string {
  // Loose mode, the same rules the commentary linker uses: a note quotes
  // references against whichever versification its translation follows, so
  // checking them verse by verse would reject real ones.
  const matches = findRefs(text, {
    requireBook: false,
    contextBook,
    contextChapter,
    strict: false,
  });

  let out = '';
  let cursor = 0;
  for (const ref of matches) {
    if (ref.start < cursor) continue;
    out += escapeHtml(text.slice(cursor, ref.start));
    out += wrapRef(ref.raw, `${ref.book} ${ref.chapter}:${ref.verse}`, ref.book);
    cursor = ref.end;
  }
  out += escapeHtml(text.slice(cursor));
  return out;
}

/**
 * Render a stored note body as HTML.
 *
 * @param body           The note as stored, sentinels and all.
 * @param contextBook    Book the note sits in, for references that name no book.
 * @param contextChapter Chapter it sits in, for the same reason.
 */
export function linkifyNoteRefs(body: string, contextBook: string, contextChapter: number): string {
  if (!body) return '';

  let out = '';
  let i = 0;

  while (i < body.length) {
    const ch = body[i];

    if (ch === NOTE_I_OPEN) {
      out += '<i>';
      i++;
      continue;
    }
    if (ch === NOTE_I_CLOSE) {
      out += '</i>';
      i++;
      continue;
    }

    if (ch === REF_OPEN) {
      const sep = body.indexOf(REF_SEP, i);
      const close = body.indexOf(REF_CLOSE, sep === -1 ? i : sep);
      if (sep !== -1 && close !== -1) {
        const osis = body.slice(i + 1, sep);
        // The label can carry italics of its own; they are not part of the ref.
        const label = body.slice(sep + 1, close).replace(/[\x1A\x1B]/g, '');
        const target = parseOsisRef(osis);
        out += target
          ? wrapRef(label, `${target.book} ${target.chapter}:${target.verse}`, target.book)
          : // A target this app cannot reach -- a deuterocanonical book, say --
            // is still what the note says, so it stays as words.
            escapeHtml(label);
        i = close + 1;
        continue;
      }
      // Malformed run: treat the sentinel as nothing and carry on.
      i++;
      continue;
    }

    // Plain prose up to the next sentinel, linkified as one piece so a
    // reference is never cut in half by a markup boundary.
    let j = i;
    while (j < body.length && !'\x17\x18\x19\x1A\x1B'.includes(body[j])) j++;
    out += linkifyProse(body.slice(i, j), contextBook, contextChapter);
    i = j;
  }

  return out;
}
