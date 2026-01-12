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
  }

  return { html: out, noteCount: noteIndex };
}

export function renderVerseHtml(text: string): string {
  const cleaned = stripHtmlTags(text);
  const { html } = renderTextWithInlineNotes(cleaned);
  return html;
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
