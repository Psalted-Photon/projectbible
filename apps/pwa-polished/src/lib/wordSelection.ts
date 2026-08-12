/**
 * wordSelection.ts
 *
 * Whole-word selection for the reader: resolve the word under a point, extend a
 * selection from an anchor word to a focus word, and paint it.
 *
 * Positions are expressed as character offsets into a `.verse-text` element's
 * textContent — never as live DOM Ranges. That matters because painting the
 * selection splits text nodes, which would invalidate any Range we were holding.
 * Wrapping never changes textContent, so character offsets survive a repaint.
 * They are also exactly what UserWordHighlight stores, so saving is a direct
 * translation with no second offset calculation.
 */

import { collectTextNodes, wrapCharRange } from './highlightRenderer';

export const SEL_CLASS = 'sel-word-span';

/** A single word, located as a character range inside one verse. */
export interface WordPos {
  verseEl: HTMLElement;
  textEl: HTMLElement;
  verse: number;
  start: number;
  end: number;
}

/** A contiguous character run inside one verse — one row of a selection. */
export interface Segment {
  verseEl: HTMLElement;
  textEl: HTMLElement;
  verse: number;
  start: number;
  length: number;
}

// ---------------------------------------------------------------------------
// Word boundaries
// ---------------------------------------------------------------------------

/** Unicode-aware so Greek and Hebrew (and combining marks) count as word chars. */
const isWordChar = (ch: string) => /[\p{L}\p{M}\p{N}]/u.test(ch);

/**
 * Expand from a character offset out to the whole word containing it.
 * Returns null when the offset sits in a run of non-word characters.
 */
export function getWordBounds(
  text: string,
  offset: number
): { start: number; end: number } | null {
  let start = offset;
  let end = offset;

  while (start > 0 && isWordChar(text[start - 1])) start--;
  while (end < text.length && isWordChar(text[end])) end++;

  return start < end ? { start, end } : null;
}

/**
 * Same as getWordBounds, but when the offset lands in whitespace it snaps to the
 * closest word instead of giving up. Dragging across a wide gap (a poetry indent,
 * the space around a footnote marker) should keep tracking a word, not stall.
 */
function getWordBoundsNear(
  text: string,
  offset: number,
  maxScan = 40
): { start: number; end: number } | null {
  const direct = getWordBounds(text, offset);
  if (direct) return direct;

  for (let d = 1; d <= maxScan; d++) {
    const left = offset - d;
    if (left >= 0 && isWordChar(text[left])) return getWordBounds(text, left);
    const right = offset + d;
    if (right < text.length && isWordChar(text[right])) return getWordBounds(text, right);
  }
  return null;
}

// ---------------------------------------------------------------------------
// Point → word
// ---------------------------------------------------------------------------

/** caretRangeFromPoint with a Firefox fallback. */
function caretAt(x: number, y: number): { node: Node; offset: number } | null {
  const doc = document as Document & {
    caretRangeFromPoint?: (x: number, y: number) => Range | null;
    caretPositionFromPoint?: (
      x: number,
      y: number
    ) => { offsetNode: Node; offset: number } | null;
  };

  if (typeof doc.caretRangeFromPoint === 'function') {
    const r = doc.caretRangeFromPoint(x, y);
    return r ? { node: r.startContainer, offset: r.startOffset } : null;
  }
  if (typeof doc.caretPositionFromPoint === 'function') {
    const p = doc.caretPositionFromPoint(x, y);
    return p ? { node: p.offsetNode, offset: p.offset } : null;
  }
  return null;
}

/** Cumulative character offset of `node`'s start within `root`'s textContent. */
function charOffsetOfNode(root: HTMLElement, node: Node): number | null {
  for (const entry of collectTextNodes(root)) {
    if (entry.node === node) return entry.start;
  }
  return null;
}

function verseInfo(textEl: HTMLElement): { verseEl: HTMLElement; verse: number } | null {
  const verseEl = textEl.closest<HTMLElement>('.verse[data-verse]');
  if (!verseEl) return null;
  const verse = parseInt(verseEl.getAttribute('data-verse') ?? '', 10);
  return isNaN(verse) ? null : { verseEl, verse };
}

/**
 * The whole word at viewport point (x, y), or null if the point is not over
 * selectable verse text.
 *
 * Returning null means "no change" to a caller mid-drag — dragging across a
 * footnote marker or the margin simply leaves the selection end where it was,
 * rather than collapsing it.
 */
export function resolveWordAt(
  x: number,
  y: number,
  opts: { interlinear: boolean }
): WordPos | null {
  if (opts.interlinear) {
    const el = document.elementFromPoint(x, y) as HTMLElement | null;
    const ilWord = el?.closest<HTMLElement>('.il-word');
    if (!ilWord) return null;

    const textEl = ilWord.closest<HTMLElement>('.verse-text');
    if (!textEl) return null;
    const info = verseInfo(textEl);
    if (!info) return null;

    // Anchor on the original-language layer; it is the one that is always shown.
    const orig = ilWord.querySelector<HTMLElement>('.il-orig');
    const node = orig?.firstChild;
    if (!node || node.nodeType !== Node.TEXT_NODE) return null;

    const base = charOffsetOfNode(textEl, node);
    if (base === null) return null;

    return {
      verseEl: info.verseEl,
      textEl,
      verse: info.verse,
      start: base,
      end: base + (node.textContent?.length ?? 0),
    };
  }

  const caret = caretAt(x, y);
  if (!caret || caret.node.nodeType !== Node.TEXT_NODE) return null;

  const node = caret.node as Text;
  const parent = node.parentElement;
  if (!parent) return null;

  // Footnote markers and verse numbers are not selectable words.
  if (parent.closest('.inline-note') || parent.closest('.verse-number')) return null;

  const textEl = parent.closest<HTMLElement>('.verse-text');
  if (!textEl) return null;
  const info = verseInfo(textEl);
  if (!info) return null;

  const bounds = getWordBoundsNear(node.textContent ?? '', caret.offset);
  if (!bounds) return null;

  const base = charOffsetOfNode(textEl, node);
  if (base === null) return null;

  return {
    verseEl: info.verseEl,
    textEl,
    verse: info.verse,
    start: base + bounds.start,
    end: base + bounds.end,
  };
}

// ---------------------------------------------------------------------------
// Anchor + focus → segments
// ---------------------------------------------------------------------------

/** Document order: negative if a precedes b. Verses are ascending within a chapter. */
export function comparePos(a: WordPos, b: WordPos): number {
  if (a.verse !== b.verse) return a.verse - b.verse;
  return a.start - b.start;
}

/** True when both words sit in the same chapter section. */
export function sameSection(a: WordPos, b: WordPos): boolean {
  return (
    a.verseEl.closest('[data-chapter-section]') ===
    b.verseEl.closest('[data-chapter-section]')
  );
}

/**
 * Every verse element between two verses within the same chapter section,
 * inclusive, in document order.
 */
function versesBetween(a: WordPos, b: WordPos): HTMLElement[] {
  const section = a.verseEl.closest('[data-chapter-section]');
  if (!section) return [a.verseEl];

  const all = Array.from(section.querySelectorAll<HTMLElement>('.verse[data-verse]'));
  const lo = Math.min(a.verse, b.verse);
  const hi = Math.max(a.verse, b.verse);

  return all.filter(el => {
    const v = parseInt(el.getAttribute('data-verse') ?? '', 10);
    return !isNaN(v) && v >= lo && v <= hi;
  });
}

/**
 * Expand an anchor word and a focus word into the character runs they cover.
 * Handles a backwards drag by ordering the pair first, and spans verses by
 * taking the tail of the first verse, all of the middle ones, and the head of
 * the last. Selections are clamped to a single chapter section by the caller.
 */
export function selectionSegments(anchor: WordPos, focus: WordPos): Segment[] {
  const [first, last] = comparePos(anchor, focus) <= 0 ? [anchor, focus] : [focus, anchor];

  if (first.verse === last.verse) {
    return [
      {
        verseEl: first.verseEl,
        textEl: first.textEl,
        verse: first.verse,
        start: first.start,
        length: last.end - first.start,
      },
    ];
  }

  const segments: Segment[] = [];
  for (const verseEl of versesBetween(first, last)) {
    const textEl = verseEl.querySelector<HTMLElement>('.verse-text');
    if (!textEl) continue;
    const verse = parseInt(verseEl.getAttribute('data-verse') ?? '', 10);
    if (isNaN(verse)) continue;

    const full = (textEl.textContent ?? '').length;
    const start = verse === first.verse ? first.start : 0;
    const end = verse === last.verse ? last.end : full;
    if (end <= start) continue;

    segments.push({ verseEl, textEl, verse, start, length: end - start });
  }
  return segments;
}

/**
 * The readable text of one segment.
 *
 * Cannot just slice textContent: the offsets are measured against it (so they
 * stay compatible with what gets saved), but the characters themselves include
 * things nobody selected. Footnote markers sit inside the phrase as "[1]", and
 * in interlinear mode every word carries its gloss, transliteration, lemma,
 * parsing and Strong's number in the same textContent even when CSS hides them.
 * Both are dropped here, so Search and the toast get the words as read.
 */
function segmentText(seg: Segment): string {
  const end = seg.start + seg.length;
  let out = '';

  for (const { node, start } of collectTextNodes(seg.textEl)) {
    const nodeEnd = start + node.length;
    if (nodeEnd <= seg.start || start >= end) continue;

    const parent = node.parentElement;
    const skip =
      !!parent?.closest('.inline-note') ||
      // Inside an interlinear word, keep only the original-language layer.
      (!!parent?.closest('.il-word') && !parent?.closest('.il-orig'));

    if (skip) {
      // Leave a gap so the words either side of a dropped run stay apart.
      out += ' ';
      continue;
    }

    out += node.data.slice(
      Math.max(0, seg.start - start),
      Math.min(node.length, end - start),
    );
  }
  return out;
}

/** The selected text, verses joined by a space. */
export function segmentsText(segments: Segment[]): string {
  return segments
    .map(s => segmentText(s).trim())
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** How many words the selection covers — drives which toast buttons show. */
export function segmentsWordCount(segments: Segment[]): number {
  return (segmentsText(segments).match(/[\p{L}\p{N}]+/gu) || []).length;
}

// ---------------------------------------------------------------------------
// Painting
// ---------------------------------------------------------------------------

/** Wrap every selected run so CSS can tint it. Safe to call repeatedly. */
export function paintSelection(segments: Segment[], root: HTMLElement | null): void {
  clearPaintedSelection(root);
  for (const seg of segments) {
    wrapCharRange(seg.textEl, seg.start, seg.length, SEL_CLASS);
  }
}

/** Unwrap all painted selection spans and re-merge the split text nodes. */
export function clearPaintedSelection(root: HTMLElement | null): void {
  if (!root) return;
  const spans = root.querySelectorAll<HTMLElement>(`.${SEL_CLASS}`);
  if (spans.length === 0) return;

  const parents = new Set<Node>();
  spans.forEach(span => {
    const parent = span.parentNode;
    if (!parent) return;
    while (span.firstChild) parent.insertBefore(span.firstChild, span);
    parent.removeChild(span);
    parents.add(parent);
  });
  parents.forEach(p => (p as HTMLElement).normalize?.());
}

// ---------------------------------------------------------------------------
// Bridging back to DOM Ranges (for callers that still need one)
// ---------------------------------------------------------------------------

/**
 * Build a DOM Range over a character run inside an element. Used for the
 * post-release drag bumpers, which need client rects to position themselves.
 */
export function charRangeToDomRange(
  root: HTMLElement,
  start: number,
  length: number
): Range | null {
  const nodes = collectTextNodes(root);
  const end = start + length;
  const range = document.createRange();
  let startSet = false;

  for (const { node, start: base } of nodes) {
    const nodeEnd = base + node.length;
    if (!startSet && base <= start && start <= nodeEnd) {
      range.setStart(node, start - base);
      startSet = true;
    }
    if (startSet && base <= end && end <= nodeEnd) {
      range.setEnd(node, end - base);
      return range;
    }
  }
  return startSet ? range : null;
}

/**
 * Convert a DOM Range back into a WordPos. Used to fold the existing
 * single-word click paths (English, Greek/Hebrew, interlinear) into the same
 * anchor/focus model the drag engine uses, without rewriting any of them.
 *
 * Returns null when the range's ends are not both inside one .verse-text.
 */
export function posFromRange(range: Range | null): WordPos | null {
  if (!range) return null;

  const startEl =
    range.startContainer.nodeType === Node.TEXT_NODE
      ? range.startContainer.parentElement
      : (range.startContainer as HTMLElement);
  const textEl = startEl?.closest<HTMLElement>('.verse-text');
  if (!textEl) return null;

  const endEl =
    range.endContainer.nodeType === Node.TEXT_NODE
      ? range.endContainer.parentElement
      : (range.endContainer as HTMLElement);
  if (endEl?.closest('.verse-text') !== textEl) return null;

  const info = verseInfo(textEl);
  if (!info) return null;

  // Measure by spanning from the start of the verse text to the boundary and
  // taking the length of what that covers. This handles element boundaries —
  // the interlinear path hands us selectNodeContents(.il-orig), where the
  // offsets count child nodes rather than characters — without special cases.
  const offsetOf = (container: Node, offset: number): number | null => {
    try {
      const probe = document.createRange();
      probe.selectNodeContents(textEl);
      probe.setEnd(container, offset);
      return probe.toString().length;
    } catch {
      return null;
    }
  };

  const start = offsetOf(range.startContainer, range.startOffset);
  const end = offsetOf(range.endContainer, range.endOffset);
  if (start === null || end === null || end <= start) return null;

  return { verseEl: info.verseEl, textEl, verse: info.verse, start, end };
}

/** A Range spanning the whole selection, from the first segment to the last. */
export function segmentsToDomRange(segments: Segment[]): Range | null {
  if (segments.length === 0) return null;

  const first = segments[0];
  const last = segments[segments.length - 1];
  const a = charRangeToDomRange(first.textEl, first.start, first.length);
  const b =
    first === last ? a : charRangeToDomRange(last.textEl, last.start, last.length);
  if (!a || !b) return null;

  const range = document.createRange();
  range.setStart(a.startContainer, a.startOffset);
  range.setEnd(b.endContainer, b.endOffset);
  return range;
}

/** Up to 3 words each side of a single-word selection, for ISBE phrase expansion. */
export function wordContextAround(
  text: string,
  start: number,
  end: number
): { before: string[]; after: string[] } {
  const tokenize = (s: string) => (s.match(/[\p{L}\p{N}]+/gu) || []) as string[];
  return {
    before: tokenize(text.slice(0, start)).slice(-3),
    after: tokenize(text.slice(end)).slice(0, 3),
  };
}
