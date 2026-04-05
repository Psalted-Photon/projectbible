/**
 * highlightRenderer.ts
 *
 * Applies and removes visual highlight effects on verse DOM elements.
 *
 * Approach:
 *  - background: CSS background-color on the inline .verse-text span so the
 *    highlight wraps to text width, not the full block container.
 *    Opacity is seeded-random (0.42–0.62) for natural variation per verse.
 *    box-decoration-break:clone gives each wrapped line its own swatch.
 *  - text-color: CSS custom property on the verse-text span.
 *  - underline: CSS text-decoration on the verse-text span.
 *
 * Future-ready: HighlightStyle can gain an `animatedEffect` field;
 * applyHighlightToElement handles it as a new branch without breaking callers.
 */

import type { HighlightStyle, UserHighlight, UserWordHighlight } from '@projectbible/core';

// ---------------------------------------------------------------------------
// Seeded deterministic PRNG (LCG — no external deps)
// ---------------------------------------------------------------------------

function seededRandom(seed: string): () => number {
  // Hash the seed string into a 32-bit integer
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = (Math.imul(h, 0x01000193)) >>> 0;
  }
  // LCG state
  let state = h;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0xFFFFFFFF;
  };
}

// ---------------------------------------------------------------------------
// Apply / remove helpers
// ---------------------------------------------------------------------------

const SVG_CLASS = 'hl-svg-overlay'; // kept only for cleaning up any legacy DOM nodes
const HL_BG_CLASS = 'hl-bg-colored';
const WORD_WRAP_CLASS = 'hl-word-span';

function hexToRgba(hex: string, opacity: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${opacity.toFixed(2)})`;
}

/**
 * Apply a highlight style to a .verse element.
 * Safe to call multiple times — removes previous overlay first.
 */
export function applyHighlightToElement(
  el: HTMLElement,
  style: HighlightStyle,
  seed: string
): void {
  removeHighlightFromElement(el);

  switch (style.type) {
    case 'background': {
      _applyBackground(el, style.color, seed);
      break;
    }
    case 'text-color': {
      const textSpan = el.querySelector<HTMLElement>('.verse-text');
      if (textSpan) {
        textSpan.style.setProperty('--hl-text-color', style.color);
        textSpan.classList.add('hl-text-colored');
      }
      break;
    }
    case 'underline': {
      const textSpan = el.querySelector<HTMLElement>('.verse-text');
      if (textSpan) {
        textSpan.style.textDecoration = `underline ${style.underlineStyle ?? 'solid'} ${style.color}`;
        textSpan.style.textUnderlineOffset = '3px';
        textSpan.classList.add('hl-text-underlined');
      }
      break;
    }
  }
}

/**
 * Apply a highlight style to an inline word <span>.
 */
export function applyWordHighlightToSpan(
  span: HTMLElement,
  style: HighlightStyle,
  seed: string
): void {
  span.removeAttribute('data-hl-style');
  span.style.removeProperty('background-color');
  span.style.removeProperty('-webkit-box-decoration-break');
  span.style.removeProperty('box-decoration-break');
  span.style.removeProperty('--hl-text-color');
  span.style.removeProperty('text-decoration');
  span.style.removeProperty('text-underline-offset');
  span.classList.remove(HL_BG_CLASS);
  span.querySelector(`.${SVG_CLASS}`)?.remove();

  switch (style.type) {
    case 'background': {
      _applyBackground(span, style.color, seed);
      break;
    }
    case 'text-color': {
      span.style.setProperty('--hl-text-color', style.color);
      span.classList.add('hl-text-colored');
      break;
    }
    case 'underline': {
      span.style.textDecoration = `underline ${style.underlineStyle ?? 'solid'} ${style.color}`;
      span.style.textUnderlineOffset = '3px';
      break;
    }
  }
  span.setAttribute('data-hl-style', JSON.stringify(style));
}

/**
 * Apply a background colour to an element.
 *
 * For verse containers (.verse): resolves to the inline .verse-text child so
 * the highlight wraps only the text width, not the full block container.
 * For word spans (no .verse-text child): applies directly to the span.
 *
 * box-decoration-break:clone ensures each wrapped line of text gets its own
 * background swatch — exactly how a real highlighter marker works.
 */
function _applyBackground(el: HTMLElement, color: string, seed: string): void {
  const rng = seededRandom(seed);
  const opacity = 0.42 + rng() * 0.20; // 0.42 – 0.62, seeded for natural variation

  const target = el.querySelector<HTMLElement>('.verse-text') ?? el;
  target.style.backgroundColor = hexToRgba(color, opacity);
  target.style.setProperty('-webkit-box-decoration-break', 'clone');
  target.style.setProperty('box-decoration-break', 'clone');
  target.classList.add(HL_BG_CLASS);
}

/**
 * Remove all highlight effects from a .verse element.
 */
export function removeHighlightFromElement(el: HTMLElement): void {
  // Remove SVG overlay
  el.querySelector(`.${SVG_CLASS}`)?.remove();

  // Remove text-color and background
  const textSpan = el.querySelector<HTMLElement>('.verse-text');
  if (textSpan) {
    textSpan.style.removeProperty('background-color');
    textSpan.style.removeProperty('-webkit-box-decoration-break');
    textSpan.style.removeProperty('box-decoration-break');
    textSpan.style.removeProperty('--hl-text-color');
    textSpan.style.removeProperty('text-decoration');
    textSpan.style.removeProperty('text-underline-offset');
    textSpan.classList.remove('hl-text-colored', 'hl-text-underlined', HL_BG_CLASS);
  }

  // Remove any injected word spans
  el.querySelectorAll<HTMLElement>(`.${WORD_WRAP_CLASS}`).forEach(span => {
    const parent = span.parentNode;
    if (parent) {
      while (span.firstChild) parent.insertBefore(span.firstChild, span);
      parent.removeChild(span);
    }
  });
}

// ---------------------------------------------------------------------------
// Word-level injection helpers
// ---------------------------------------------------------------------------

/**
 * Given the plain text of a verse, inject a <span> wrapper at the given
 * character offset inside the .verse-text element so we can apply word-level
 * styles. Returns the injected span or null if the range cannot be located.
 *
 * Note: This uses a simple text-node walk which is safe because verse text
 * has minimal inline markup (mainly footnote superscripts injected by
 * renderVerseHtml — those live in separate elements and don't overlap user
 * text positions).
 */
export function injectWordSpan(
  verseTextEl: HTMLElement,
  wordStart: number,
  wordLength: number
): HTMLSpanElement | null {
  // Collect all text nodes, tracking cumulative character offset
  const textNodes: { node: Text; start: number }[] = [];
  let cursor = 0;

  const walk = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      const tn = node as Text;
      textNodes.push({ node: tn, start: cursor });
      cursor += tn.length;
    } else {
      node.childNodes.forEach(walk);
    }
  };
  walk(verseTextEl);

  // Find the text nodes that the range spans
  const endOffset = wordStart + wordLength;
  const span = document.createElement('span');
  span.className = WORD_WRAP_CLASS;

  // Range API approach: more robust across node boundaries
  const range = document.createRange();
  let startSet = false;

  for (const { node, start } of textNodes) {
    const nodeEnd = start + node.length;

    if (!startSet && start <= wordStart && wordStart < nodeEnd) {
      range.setStart(node, wordStart - start);
      startSet = true;
    }

    if (startSet && start < endOffset && endOffset <= nodeEnd) {
      range.setEnd(node, endOffset - start);
      break;
    }

    if (startSet && nodeEnd <= endOffset && endOffset > nodeEnd) {
      // end is in a later node — continue scanning
    }
  }

  if (!startSet) return null;

  try {
    range.surroundContents(span);
    return span;
  } catch {
    // Range crosses element boundaries — fall back to no injection
    return null;
  }
}

// ---------------------------------------------------------------------------
// Batch chapter apply (called after chapter loads)
// ---------------------------------------------------------------------------

/**
 * Apply all verse and word highlights for a chapter after its DOM has rendered.
 *
 * @param chapterRoot      The container element holding all .verse elements
 * @param verseHighlights  Verse-level highlights for this chapter
 * @param wordHighlights   All word highlights for this chapter
 * @param currentTranslation  The translation currently displayed
 */
export function applyChapterHighlights(
  chapterRoot: HTMLElement,
  verseHighlights: UserHighlight[],
  wordHighlights: UserWordHighlight[],
  currentTranslation: string
): void {
  // Index verse elements by verse number for O(1) lookup
  const verseEls = new Map<number, HTMLElement>();
  chapterRoot.querySelectorAll<HTMLElement>('.verse[data-verse]').forEach(el => {
    const v = parseInt(el.getAttribute('data-verse') ?? '', 10);
    if (!isNaN(v)) verseEls.set(v, el);
  });

  // Clean sweep: remove all existing highlight effects before re-applying current state
  verseEls.forEach(el => removeHighlightFromElement(el));

  // Apply verse-level highlights
  for (const hl of verseHighlights) {
    const el = verseEls.get(hl.reference.verse);
    if (el) {
      const seed = `${hl.reference.book}-${hl.reference.chapter}-${hl.reference.verse}`;
      applyHighlightToElement(el, hl.style, seed);
    }
  }

  // Apply word highlights
  for (const whl of wordHighlights) {
    const el = verseEls.get(whl.reference.verse);
    if (!el) continue;

    const seed = `word-${whl.reference.book}-${whl.reference.chapter}-${whl.reference.verse}-${whl.wordStart}`;

    if (whl.translation === currentTranslation) {
      // Precise word-level: inject a span and style it
      const textSpan = el.querySelector<HTMLElement>('.verse-text');
      if (textSpan) {
        const wordSpan = injectWordSpan(textSpan, whl.wordStart, whl.wordLength);
        if (wordSpan) {
          applyWordHighlightToSpan(wordSpan, whl.style, seed);
        } else {
          // Injection failed — fall back to verse-level
          applyHighlightToElement(el, whl.style, seed);
        }
      }
    } else {
      // Different translation — degrade to verse-level highlight
      applyHighlightToElement(el, whl.style, seed);
    }
  }
}
