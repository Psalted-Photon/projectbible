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

function renderTextWithInlineNotes(text: string): { html: string; noteCount: number } {
  const source = text ?? '';
  let out = '';
  let i = 0;
  let noteIndex = 0;

  const isPlusStart = (idx: number) => {
    const ch = source[idx];
    if (ch !== '+') return false;
    const prev = idx > 0 ? source[idx - 1] : ' ';
    return prev === ' ' || prev === '\n' || prev === '\t' || idx === 0;
  };

  while (i < source.length) {
    const plusPos = source.indexOf('+', i);
    if (plusPos === -1) {
      out += escapeHtml(source.slice(i));
      break;
    }

    if (!isPlusStart(plusPos)) {
      out += escapeHtml(source.slice(i, plusPos + 1));
      i = plusPos + 1;
      continue;
    }

    // Emit text before note
    out += escapeHtml(source.slice(i, plusPos));

    // Parse note
    let j = plusPos + 1;
    while (j < source.length && /\s/.test(source[j])) j++;

    // Check if this is a heading (ends with period followed by capital letter)
    const headingMatch = source.slice(j).match(/^([^.]+)\.\s+([A-Z])/);
    if (headingMatch && plusPos < 50) {
      // This is a heading at start of verse - skip it (it's in v.heading field)
      i = j + headingMatch[0].length - 2; // -2 to keep the capital letter
      continue;
    }

    // Optional leading chapter:verse marker (e.g. 53:1)
    const markerMatch = source.slice(j).match(/^(\d+):(\d+)\s*/);
    if (markerMatch) {
      j += markerMatch[0].length;
    }

    const noteStart = j;
    let hasRefToken = false;
    let noteEnd = source.length;

    for (let k = j; k < source.length; k++) {
      // Unambiguous sentinel inserted by pack builder
      if (source.charCodeAt(k) === 1) {
        noteEnd = k;
        break;
      }

      if (!hasRefToken && /\b\d+:\d+\b/.test(source.slice(j, k + 1))) {
        hasRefToken = true;
      }

      if (source[k] === '.' && k + 2 < source.length && source[k + 1] === ' ' && /[a-z]/.test(source[k + 2])) {
        const tokenStart = Math.max(
          source.lastIndexOf(' ', k - 1) + 1,
          source.lastIndexOf('\n', k - 1) + 1,
          source.lastIndexOf('\t', k - 1) + 1
        );
        const token = source.slice(tokenStart, k).trim();
        const abbrev = token.replace(/[^A-Za-z]/g, '');
        const nonTerminalAbbrevs = new Set(['Gr', 'Gk', 'Heb', 'Aram', 'Lat', 'Syr', 'LXX', 'Vg']);
        if (nonTerminalAbbrevs.has(abbrev)) {
          continue;
        }

        noteEnd = k + 1;
        break;
      }

      if (hasRefToken && source[k] === ' ' && k + 1 < source.length && /[a-z]/.test(source[k + 1])) {
        noteEnd = k;
        break;
      }

      if (k > j && source[k] === '+' && (source[k - 1] === ' ' || source[k - 1] === '\n' || source[k - 1] === '\t')) {
        noteEnd = k;
        break;
      }
    }

    const rawNote = source.slice(noteStart, noteEnd).trim();
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
    } else {
      out += escapeHtml(source.slice(plusPos, noteEnd));
    }

    i = noteEnd;
    // Skip sentinel if present
    if (i < source.length && source.charCodeAt(i) === 1) i++;
  }

  return { html: out, noteCount: noteIndex };
}

/**
 * Build a mapping from clean-text positions (footnote markers removed) to
 * stored-text positions.  Used to insert \x02/\x03 red-letter sentinels into
 * stored text at the correct byte offsets.
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
    const prev = i > 0 ? storedText[i - 1] : ' ';
    const isFootnoteStart = ch === '+' && (prev === ' ' || prev === '\n' || prev === '\t' || i === 0);
    if (isFootnoteStart) {
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

  let processed = cleaned;
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
    .replace(/[\x02\x03\x04\x05\x06\x07]/g, '');
}

export function extractHeading(text: string): { heading: string | null; textWithoutHeading: string } {
  const source = text ?? '';
  
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

export { escapeHtml };
