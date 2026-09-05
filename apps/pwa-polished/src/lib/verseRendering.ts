/**
 * Verse rendering utilities from classic PWA
 * Handles footnotes, cross-references, and text formatting
 */

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function stripHtmlTags(text: string): string {
  return (text ?? '').replace(/<[^>]*>/g, '');
}

function isCrossReference(noteText: string): boolean {
  const trimmed = noteText.trim();
  
  const footnoteStarters = [
    /^Or\b/i,
    /^Lit\b/i,
    /^I\.e\./i,
    /^That is/i,
    /^Some manuscripts/i,
    /^Gr\./i,
    /^Gk\./i,
    /^Heb\./i,
    /^Aram\./i,
    /^Lat\./i
  ];
  
  for (const pattern of footnoteStarters) {
    if (pattern.test(trimmed)) return false;
  }
  
  return /\b\d+:\d+\b/.test(trimmed);
}

/** Poetic line / stanza markers written by the pack builders. */
const STANZA = '\x10';
const LINE_1 = '\x11';
const LINE_2 = '\x12';

/**
 * Given the position just after a "+" note marker (with whitespace and any
 * chapter:verse marker already skipped), find where the note's content ends.
 *
 * The pack builders terminate every note with a \x01 sentinel, so the boundary
 * is read, never guessed. Returns -1 when there is no terminator: the caller
 * then treats the "+" as ordinary text rather than inventing an end, which is
 * what used to swallow scripture in packs built before the sentinel existed.
 */
function findNoteEnd(source: string, j: number): number {
  return source.indexOf('\x01', j);
}

/**
 * A "+" opens a note only at the start of the text or after whitespace.
 * Structural markers are transparent — a note can directly follow a poetic
 * line marker (LXX Psalm 2:1 begins with one).
 */
function isNoteStart(source: string, idx: number): boolean {
  if (source[idx] !== '+') return false;
  let p = idx - 1;
  while (p >= 0 && /[\x01-\x07\x0E\x0F\x10-\x12]/.test(source[p])) p--;
  if (p < 0) return true;
  const prev = source[p];
  return prev === ' ' || prev === '\n' || prev === '\t';
}

function renderTextWithInlineNotes(text: string): { html: string; noteCount: number } {
  const source = text ?? '';
  let out = '';
  let i = 0;
  let noteIndex = 0;

  while (i < source.length) {
    const plusPos = source.indexOf('+', i);
    if (plusPos === -1) {
      out += escapeHtml(source.slice(i));
      break;
    }

    if (!isNoteStart(source, plusPos)) {
      out += escapeHtml(source.slice(i, plusPos + 1));
      i = plusPos + 1;
      continue;
    }

    // Parse note
    let j = plusPos + 1;
    while (j < source.length && /\s/.test(source[j])) j++;

    const noteEnd = findNoteEnd(source, j);
    if (noteEnd === -1) {
      // Unterminated: this pack predates the sentinel, so there is no honest way
      // to know where the note stops. Show it verbatim rather than guess — a
      // guess here used to eat the rest of the verse.
      out += escapeHtml(source.slice(i, plusPos + 1));
      i = plusPos + 1;
      continue;
    }

    // Emit text before note
    out += escapeHtml(source.slice(i, plusPos));

    // Optional leading chapter:verse marker (e.g. 53:1)
    const markerMatch = source.slice(j).match(/^(\d+):(\d+)\s*/);
    if (markerMatch) {
      j += markerMatch[0].length;
    }

    const noteStart = j;
    // Structural markers never belong in a note's tooltip or data attribute —
    // and leaving one there would let a later marker→markup pass rewrite the
    // inside of an attribute.
    const rawNote = source.slice(noteStart, noteEnd).replace(/[\x10-\x13]/g, '').trim();
    if (rawNote.length > 0) {
      noteIndex++;
      const encoded = encodeURIComponent(rawNote);
      const title = rawNote.length > 80 ? rawNote.slice(0, 77) + '…' : rawNote;
      const encodedTitle = escapeHtml(title);
      
      const isXref = isCrossReference(rawNote);
      const noteColor = isXref ? '#ccc' : '#6699ff';
      const noteType = isXref ? 'Cross-reference' : 'Footnote';
      
      out += `<sup class="inline-note ${isXref ? 'inline-xref' : 'inline-footnote'}" ` +
        `data-note="${encoded}" data-note-index="${noteIndex}" ` +
        `style="color:${noteColor}; cursor:pointer; font-size:11px; margin:0 2px;" ` +
        `title="${noteType} ${noteIndex}: ${encodedTitle}">[${noteIndex}]</sup>`;
    }
    // A note with no content after its reference has nothing to show, so it is
    // dropped outright — the same thing the preview and speech paths do.

    i = noteEnd + 1;
  }

  return { html: out, noteCount: noteIndex };
}

/**
 * Build a mapping from clean-text positions (footnote markers removed) to
 * stored-text positions.  Used to insert \x02/\x03 red-letter sentinels into
 * stored text at the correct byte offsets.
 *
 * "Clean" must mean exactly what stripFootnotes() in scripts/align-red-letter.mjs
 * means when the spans are computed, so poetic line markers are skipped here too.
 *
 * Returns an array where map[cleanPos] = storedPos.
 * The last entry map[cleanLength] = storedLength covers the end position.
 */
function buildCleanToStoredMap(storedText: string): number[] {
  const map: number[] = [];
  let cleanPos = 0;
  let i = 0;
  while (i < storedText.length) {
    const ch = storedText[i];
    if (ch === STANZA || ch === LINE_1 || ch === LINE_2) {
      i++; // structural only — not part of the text the spans were measured on
      continue;
    }
    if (isNoteStart(storedText, i)) {
      const end = storedText.indexOf('\x01', i + 1);
      if (end >= 0) {
        i = end + 1; // skip footnote content entirely
        continue;
      }
    }
    map[cleanPos] = i;
    cleanPos++;
    i++;
  }
  map[cleanPos] = i; // end sentinel
  return map;
}

/**
 * Find `<b>`/`<i>` formatting regions and express them in CLEAN-text
 * coordinates (HTML tags removed, footnote markers kept) — i.e. positions in
 * `stripHtmlTags(text)`.  Only `<b>`/`<i>` are honored; all other tags are
 * ignored here and stripped as before.  These ranges feed the same sentinel
 * machinery as red-letter spans so the two coexist (e.g. NET Matthew 4:4).
 */
function extractFormattingSpans(text: string): { start: number; end: number; kind: 'b' | 'i' }[] {
  const src = text ?? '';
  const ranges: { start: number; end: number; kind: 'b' | 'i' }[] = [];
  const stacks: { b: number[]; i: number[] } = { b: [], i: [] };
  let cleanPos = 0;
  let i = 0;
  while (i < src.length) {
    if (src[i] === '<') {
      const close = src.indexOf('>', i);
      if (close === -1) {
        // No closing '>': stripHtmlTags keeps this char, so count it as text
        cleanPos++;
        i++;
        continue;
      }
      const m = src.slice(i, close + 1).match(/^<\s*(\/?)\s*([a-zA-Z]+)/);
      if (m) {
        const isClose = m[1] === '/';
        const name = m[2].toLowerCase();
        if (name === 'b' || name === 'i') {
          if (isClose) {
            const startPos = stacks[name].pop();
            if (startPos !== undefined && cleanPos > startPos) {
              ranges.push({ start: startPos, end: cleanPos, kind: name });
            }
          } else {
            stacks[name].push(cleanPos);
          }
        }
      }
      // Tags contribute nothing to clean-text length (they are stripped)
      i = close + 1;
      continue;
    }
    cleanPos++;
    i++;
  }
  return ranges;
}

export function renderVerseHtml(text: string, spans?: { s: number; e: number }[]): string {
  const cleaned = stripHtmlTags(text);

  // ⌃ (plural "you") becomes markup at the very end. Swap it for a marker now,
  // one character for one, so span offsets are untouched and the substitution
  // can never land inside an attribute of a note rendered from this text.
  let processed = cleaned.replace(/⌃/g, '\x13');
  const insertions: { pos: number; ch: string }[] = [];

  // Red-letter spans → \x02/\x03 sentinels (offsets mapped past footnote markers)
  if (spans && spans.length > 0) {
    // Map clean-text offsets → stored-text positions so sentinels interleave
    // correctly with footnote markers already in the stored text.
    const map = buildCleanToStoredMap(cleaned);
    for (const span of spans) {
      const storedS = map[Math.min(span.s, map.length - 1)];
      const storedE = map[Math.min(span.e, map.length - 1)];
      if (storedS !== undefined && storedE !== undefined && storedE > storedS) {
        insertions.push({ pos: storedE, ch: '\x03' });
        insertions.push({ pos: storedS, ch: '\x02' });
      }
    }
  }

  // Inline <b>/<i> formatting → \x04/\x05 (bold), \x06/\x07 (italic).
  // Ranges are already in `cleaned` coordinates, so no mapping is needed.
  for (const f of extractFormattingSpans(text)) {
    const [open, closeCh] = f.kind === 'b' ? ['\x04', '\x05'] : ['\x06', '\x07'];
    insertions.push({ pos: f.end, ch: closeCh });
    insertions.push({ pos: f.start, ch: open });
  }

  if (insertions.length > 0) {
    // Right-to-left insertion preserves earlier offsets
    insertions.sort((a, b) => b.pos - a.pos);
    for (const { pos, ch } of insertions) {
      processed = processed.slice(0, pos) + ch + processed.slice(pos);
    }
  }

  const { html } = renderTextWithInlineNotes(processed);

  // Wrap sentinels; clean up any orphaned ones
  return html
    .replace(/\x02([\s\S]*?)\x03/g, '<span class="red-letter">$1</span>')
    .replace(/\x04([\s\S]*?)\x05/g, '<b>$1</b>')
    .replace(/\x06([\s\S]*?)\x07/g, '<i>$1</i>')
    .replace(/[\x02\x03\x04\x05\x06\x07]/g, '')
    // Poetic lines. A leading marker opens the verse rather than breaking it,
    // so it emits no <br> — but a second-level opener still needs its indent,
    // and carrying it here rather than on the verse element means a line's
    // depth comes from its own marker instead of from whichever verse it lands
    // in. Nothing added is a text character, which keeps saved highlights, TTS
    // glow offsets and red-letter spans aligned.
    .replace(/^[\x10\x11\x12]+/, (lead) =>
      lead.includes(LINE_2) ? '<span class="poetry-indent"></span>' : '')
    .replace(/\x11/g, '<br>')
    .replace(/\x12/g, '<br><span class="poetry-indent"></span>')
    .replace(/\x10/g, '')
    // ⌃ marks a plural "you" in the LXX — a stray glyph mid-sentence unless it
    // is presented as what it is.
    .replace(/\x13/g, '<sup class="plural-marker" title="Plural &ldquo;you&rdquo;">[pl]</sup>');
}

/**
 * Structure a verse carries in its own right, rather than inside its text:
 * which poetic line it opens and whether a stanza break precedes it. The reader
 * applies these to the verse element, mirroring how `¶` drives `.para-start`.
 */
export function verseStructure(text: string): { poetryLevel: 0 | 1 | 2; stanzaBreak: boolean } {
  const lead = (text ?? '').match(/^[\x10\x11\x12]+/)?.[0] ?? '';
  return {
    poetryLevel: lead.includes(LINE_2) ? 2 : lead.includes(LINE_1) ? 1 : 0,
    stanzaBreak: lead.includes(STANZA),
  };
}

/**
 * Walk stored text dropping footnotes and cross-references, keeping everything
 * else byte-for-byte. Same heading skip and same note boundaries (findNoteEnd)
 * as the reader's renderer, so the two can never disagree about where a note
 * ends — it just discards notes instead of emitting [n] markers.
 *
 * Operates on text that may already carry \x04-\x07 formatting sentinels, so a
 * sentinel is treated as transparent when deciding whether a '+' starts a note.
 */
function dropInlineNotes(source: string): string {
  let out = '';
  let i = 0;

  while (i < source.length) {
    const plusPos = source.indexOf('+', i);
    if (plusPos === -1) {
      out += source.slice(i);
      break;
    }
    if (!isNoteStart(source, plusPos)) {
      out += source.slice(i, plusPos + 1);
      i = plusPos + 1;
      continue;
    }

    let j = plusPos + 1;
    while (j < source.length && /\s/.test(source[j])) j++;

    const noteEnd = findNoteEnd(source, j);
    if (noteEnd === -1) {
      // No terminator — keep the text as-is rather than guessing an end
      out += source.slice(i, plusPos + 1);
      i = plusPos + 1;
      continue;
    }

    out += source.slice(i, plusPos);
    i = noteEnd + 1;
  }
  return out;
}

/**
 * Verse text for a compact preview row — the ISBE and character verse lists,
 * search-result snippets, cross-reference previews.
 *
 * The reader's renderVerseHtml keeps footnotes as clickable [n] markers; a
 * two-line preview has no room for them, so they are dropped outright. What
 * survives is <b>/<i>, which in NET marks Old Testament wording quoted in the
 * New Testament and so carries meaning worth showing.
 *
 * Sentinels carry the formatting through trimming and escaping, and only become
 * real tags at the very end. That ordering is what makes `highlight` safe: no
 * tags exist when <mark> is applied, so a mark can never land inside one.
 */
export function renderVersePreviewHtml(
  text: string,
  opts: { highlight?: RegExp | null; maxLength?: number } = {},
): string {
  const src = text ?? '';
  if (!src) return '';

  // <b>/<i> positions are in stripHtmlTags coordinates, so no mapping needed.
  let work = stripHtmlTags(src);
  const insertions: { pos: number; ch: string }[] = [];
  for (const f of extractFormattingSpans(src)) {
    const [open, close] = f.kind === 'b' ? ['\x04', '\x05'] : ['\x06', '\x07'];
    insertions.push({ pos: f.end, ch: close });
    insertions.push({ pos: f.start, ch: open });
  }
  insertions.sort((a, b) => b.pos - a.pos);
  for (const { pos, ch } of insertions) work = work.slice(0, pos) + ch + work.slice(pos);

  work = dropInlineNotes(work)
    .replace(/\x01/g, '')
    .replace(/[\x10\x11\x12]/g, ' ')
    .replace(/[¶⌃]/g, '')
    .replace(/[ \t\n]+/g, ' ')
    .trim();

  // Trim to a window around the first highlight match, the way search snippets
  // do. Sentinels are one char each and any orphan is cleaned up below, so a
  // cut through a formatting pair loses the bold rather than breaking markup.
  const max = opts.maxLength ?? 0;
  if (max > 0 && work.length > max) {
    const at = opts.highlight ? work.search(opts.highlight) : -1;
    if (at < 0) {
      work = work.slice(0, max).replace(/\s\S*$/, '') + '…';
    } else {
      let start = Math.max(0, at - 60);
      let end = Math.min(work.length, start + max);
      if (start > 0) start = work.indexOf(' ', start) + 1 || start;
      if (end < work.length) end = work.lastIndexOf(' ', end);
      work = (start > 0 ? '…' : '') + work.slice(start, end) + (end < work.length ? '…' : '');
    }
  }

  // Mark with sentinels as well, so escaping can't come between a name and its
  // match — escapeHtml turns ' into &#39;, which would break a name like
  // "Diviners' Oak" if <mark> were applied to already-escaped text.
  if (opts.highlight) work = work.replace(opts.highlight, '\x0E$1\x0F');

  return escapeHtml(work)
    .replace(/\x0E([\s\S]*?)\x0F/g, '<mark>$1</mark>')
    .replace(/\x04([\s\S]*?)\x05/g, '<b>$1</b>')
    .replace(/\x06([\s\S]*?)\x07/g, '<i>$1</i>')
    .replace(/[\x02-\x07\x0E\x0F]/g, '');
}

/** Preview text with no markup at all — for surfaces that render plain text. */
export function cleanVersePreviewText(text: string): string {
  return dropInlineNotes(stripHtmlTags(text ?? ''))
    .replace(/\x01/g, '')
    .replace(/[\x10\x11\x12]/g, ' ')
    .replace(/[¶⌃]/g, '')
    .replace(/[ \t\n]+/g, ' ')
    .trim();
}

export function extractHeading(text: string): { heading: string | null; textWithoutHeading: string } {
  const source = text ?? '';

  // A leading note is a note, not a heading — LXX verses often open with one
  // ("+ 1:9 Gr. meeting\x01 place, and let the dry land appear"), and its text
  // can contain a period that the heading pattern would happily swallow. Only
  // the old "+ Heading. " convention, which carries no terminator, is a heading.
  let lead = 0;
  while (lead < source.length && /[\s\x10\x11\x12]/.test(source[lead])) lead++;
  if (source[lead] === '+' && source.indexOf('\x01', lead) !== -1) {
    return { heading: null, textWithoutHeading: source };
  }

  // Check if text starts with "+ Heading. "
  const headingMatch = source.match(/^\s*\+\s*([^.]+)\.\s+/);

  if (headingMatch) {
    return {
      heading: headingMatch[1].trim(),
      textWithoutHeading: source.slice(headingMatch[0].length)
    };
  }
  
  return { heading: null, textWithoutHeading: source };
}

/**
 * Plain speakable text for a verse — what read-aloud (TTS) should say.
 * Walks the stored text exactly like renderTextWithInlineNotes (same heading
 * skip, same note boundaries via findNoteEnd) but drops footnotes and
 * cross-references entirely instead of rendering [n] markers.
 */
export function extractSpeechText(text: string): string {
  // Tags are display-only; leading "+ Heading. " lives in the heading field
  const { textWithoutHeading } = extractHeading(stripHtmlTags(text ?? ''));
  const source = textWithoutHeading;
  let out = '';
  let i = 0;

  while (i < source.length) {
    const plusPos = source.indexOf('+', i);
    if (plusPos === -1) {
      out += source.slice(i);
      break;
    }

    if (!isNoteStart(source, plusPos)) {
      out += source.slice(i, plusPos + 1);
      i = plusPos + 1;
      continue;
    }

    // Parse the note the same way the renderer does
    let j = plusPos + 1;
    while (j < source.length && /\s/.test(source[j])) j++;

    const noteEnd = findNoteEnd(source, j);
    if (noteEnd === -1) {
      // No terminator — speak it rather than guess where it ends
      out += source.slice(i, plusPos + 1);
      i = plusPos + 1;
      continue;
    }

    // Emit text before the note, then drop the note content entirely
    out += source.slice(i, plusPos);
    i = noteEnd + 1;
  }

  return out
    .replace(/\x01/g, '')
    .replace(/[\x10\x11\x12]/g, ' ')
    .replace(/[¶⌃]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export { escapeHtml };
