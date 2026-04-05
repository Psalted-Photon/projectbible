/**
 * highlightRenderer.ts
 *
 * Applies and removes visual highlight effects on verse DOM elements.
 *
 * Approach:
 *  - background: SVG wavy-path overlay injected behind verse text.
 *    Path shape is deterministic (seeded by book/chapter/verse) so it looks
 *    the same on every device / reload without storing geometry.
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
// SVG wavy-path generation
// ---------------------------------------------------------------------------

/**
 * Generates an SVG `d` attribute describing a filled, slightly wavy band
 * that mimics an imperfect marker stroke across the full width.
 *
 * @param width   Element pixel width
 * @param height  Element pixel height (line height roughly)
 * @param rng     Seeded random function
 */
function generateWavyPath(width: number, height: number, rng: () => number): string {
  const POINTS = 10;
  const baseTop = height * 0.15;
  const baseBottom = height * 0.85;
  const jitter = Math.min(height * 0.18, 5); // max ±5px organic variation

  // Generate top-edge control points left → right
  const topPoints: [number, number][] = [];
  for (let i = 0; i <= POINTS; i++) {
    const x = (width / POINTS) * i;
    const y = baseTop + (rng() - 0.5) * 2 * jitter;
    topPoints.push([x, y]);
  }

  // Generate bottom-edge control points right → left (so path closes cleanly)
  const bottomPoints: [number, number][] = [];
  for (let i = POINTS; i >= 0; i--) {
    const x = (width / POINTS) * i;
    const y = baseBottom + (rng() - 0.5) * 2 * jitter;
    bottomPoints.push([x, y]);
  }

  // Build path: M then smooth quadratic curves
  const pathParts: string[] = [`M ${topPoints[0][0].toFixed(1)} ${topPoints[0][1].toFixed(1)}`];

  for (let i = 1; i < topPoints.length; i++) {
    const [x, y] = topPoints[i];
    pathParts.push(`L ${x.toFixed(1)} ${y.toFixed(1)}`);
  }

  for (const [x, y] of bottomPoints) {
    pathParts.push(`L ${x.toFixed(1)} ${y.toFixed(1)}`);
  }

  pathParts.push('Z');
  return pathParts.join(' ');
}

// ---------------------------------------------------------------------------
// Apply / remove helpers
// ---------------------------------------------------------------------------

const SVG_CLASS = 'hl-svg-overlay';
const WORD_WRAP_CLASS = 'hl-word-span';

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
  span.style.removeProperty('--hl-text-color');
  span.style.removeProperty('text-decoration');
  const existingSvg = span.querySelector(`.${SVG_CLASS}`);
  if (existingSvg) existingSvg.remove();

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

function _applyBackground(el: HTMLElement, color: string, seed: string): void {
  const rng = seededRandom(seed);
  const opacity = 0.35 + rng() * 0.20; // 0.35 – 0.55

  // Make element a positioning context for the SVG overlay
  const existingPosition = el.style.position;
  if (!existingPosition || existingPosition === 'static') {
    el.style.position = 'relative';
  }

  const width = el.offsetWidth || 300;
  const height = el.offsetHeight || 28;
  const path = generateWavyPath(width, height, rng);

  const svgNS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(svgNS, 'svg') as SVGSVGElement;
  svg.classList.add(SVG_CLASS);
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('width', String(width));
  svg.setAttribute('height', String(height));
  svg.style.cssText = `
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    pointer-events: none;
    z-index: 0;
    overflow: visible;
  `;

  const pathEl = document.createElementNS(svgNS, 'path');
  pathEl.setAttribute('d', path);
  pathEl.setAttribute('fill', color);
  pathEl.setAttribute('fill-opacity', opacity.toFixed(3));

  svg.appendChild(pathEl);
  el.insertBefore(svg, el.firstChild);

  // Ensure text content sits above the SVG
  const textSpan = el.querySelector<HTMLElement>('.verse-text');
  if (textSpan) textSpan.style.position = 'relative';
}

/**
 * Remove all highlight effects from a .verse element.
 */
export function removeHighlightFromElement(el: HTMLElement): void {
  // Remove SVG overlay
  el.querySelector(`.${SVG_CLASS}`)?.remove();

  // Remove text-color
  const textSpan = el.querySelector<HTMLElement>('.verse-text');
  if (textSpan) {
    textSpan.style.removeProperty('--hl-text-color');
    textSpan.style.removeProperty('text-decoration');
    textSpan.style.removeProperty('text-underline-offset');
    textSpan.style.removeProperty('position');
    textSpan.classList.remove('hl-text-colored', 'hl-text-underlined');
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
