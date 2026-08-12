/**
 * highlightRenderer.ts
 *
 * Applies and removes visual highlight effects on verse DOM elements.
 *
 * Approach:
 *  - background: SVG data URI applied as background-image on the inline
 *    .verse-text span. The SVG uses a seeded wavy filled path for an organic,
 *    hand-drawn highlighter appearance. box-decoration-break:clone gives
 *    each wrapped line its own swatch.
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
// SVG wavy highlight generator
// ---------------------------------------------------------------------------

/**
 * Build an SVG data URI for a wavy filled highlight shape.
 * Uses seeded randomness so the same verse always gets the same organic shape.
 * ViewBox: 0 0 100 10 — rendered via background-size:100% 100% to fill the span.
 */
function generateWavySvgDataUri(color: string, rng: () => number): string {
  const opacity = (0.38 + rng() * 0.24).toFixed(3);
  const r = parseInt(color.slice(1, 3), 16);
  const g = parseInt(color.slice(3, 5), 16);
  const b = parseInt(color.slice(5, 7), 16);

  // Random y-offsets for top (baseline y=1.2) and bottom (baseline y=9.2) edges.
  // Wider band covers full letter height (ascenders to descenders).
  // Smaller amplitude = tighter splotch edges.
  const amp = 0.4 + rng() * 0.5;
  const N = 7;
  const topY = Array.from({ length: N + 1 }, () => 1.2 + (rng() * 2 - 1) * amp);
  const botY = Array.from({ length: N + 1 }, () => 9.2 + (rng() * 2 - 1) * amp);

  // Top edge: left-to-right smooth quadratic bezier through control midpoints
  let d = `M0,${topY[0].toFixed(2)}`;
  for (let i = 1; i <= N; i++) {
    const x = (i / N * 100).toFixed(1);
    const cpX = ((i - 0.5) / N * 100).toFixed(1);
    const cpY = ((topY[i - 1] + topY[i]) / 2).toFixed(2);
    d += ` Q${cpX},${cpY} ${x},${topY[i].toFixed(2)}`;
  }

  // Right bridge + bottom edge: right-to-left
  d += ` L100,${botY[N].toFixed(2)}`;
  for (let i = N - 1; i >= 0; i--) {
    const x = (i / N * 100).toFixed(1);
    const cpX = ((i + 0.5) / N * 100).toFixed(1);
    const cpY = ((botY[i] + botY[i + 1]) / 2).toFixed(2);
    d += ` Q${cpX},${cpY} ${x},${botY[i].toFixed(2)}`;
  }
  d += ' Z';

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 10" preserveAspectRatio="none"><path d="${d}" fill="rgb(${r},${g},${b})" fill-opacity="${opacity}"/></svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;  
}

// ---------------------------------------------------------------------------
// Apply / remove helpers
// ---------------------------------------------------------------------------

const SVG_CLASS = 'hl-svg-overlay'; // kept for cleaning up any legacy DOM nodes
const WORD_WRAP_CLASS = 'hl-word-span';

/**
 * Apply a highlight style to a .verse element.
 * Safe to call multiple times — removes previous overlay first.
 */
export function applyHighlightToElement(
  el: HTMLElement,
  style: HighlightStyle,
  seed: string,
  /**
   * Skip the pre-clean. Callers that already swept the verse must pass true —
   * otherwise this would unwrap the word spans a sibling highlight in the same
   * verse just injected, which is reachable now that a verse can hold several.
   */
  skipClean = false
): void {
  if (!skipClean) removeHighlightFromElement(el);

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
        if (style.underlineStyle === 'boxed') {
          textSpan.style.setProperty('outline', `2px solid ${style.color}`);
          textSpan.style.setProperty('outline-offset', '1px');
          textSpan.style.setProperty('border-radius', '2px');
          textSpan.style.setProperty('-webkit-box-decoration-break', 'clone');
          textSpan.style.setProperty('box-decoration-break', 'clone');
        } else {
          textSpan.style.textDecoration = `underline ${style.underlineStyle ?? 'solid'} ${style.color}`;
          textSpan.style.textUnderlineOffset = '3px';
        }
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
  span.style.removeProperty('background-image');
  span.style.removeProperty('background-size');
  span.style.removeProperty('background-repeat');
  span.style.removeProperty('-webkit-box-decoration-break');
  span.style.removeProperty('box-decoration-break');
  span.style.removeProperty('--hl-text-color');
  span.style.removeProperty('text-decoration');
  span.style.removeProperty('text-underline-offset');
  span.style.removeProperty('outline');
  span.style.removeProperty('outline-offset');
  span.style.removeProperty('border-radius');
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
      if (style.underlineStyle === 'boxed') {
        span.style.setProperty('outline', `2px solid ${style.color}`);
        span.style.setProperty('outline-offset', '1px');
        span.style.setProperty('border-radius', '2px');
        span.style.setProperty('-webkit-box-decoration-break', 'clone');
        span.style.setProperty('box-decoration-break', 'clone');
      } else {
        span.style.textDecoration = `underline ${style.underlineStyle ?? 'solid'} ${style.color}`;
        span.style.textUnderlineOffset = '3px';
      }
      break;
    }
  }
  span.setAttribute('data-hl-style', JSON.stringify(style));
}

/**
 * Apply a background colour to an element using a seeded wavy SVG data URI.
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
  const dataUri = generateWavySvgDataUri(color, rng);

  const target = el.querySelector<HTMLElement>('.verse-text') ?? el;
  target.style.backgroundImage = dataUri;
  target.style.backgroundSize = '100% 100%';
  target.style.backgroundRepeat = 'no-repeat';
  target.style.setProperty('-webkit-box-decoration-break', 'clone');
  target.style.setProperty('box-decoration-break', 'clone');
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
    textSpan.style.removeProperty('background-image');
    textSpan.style.removeProperty('background-size');
    textSpan.style.removeProperty('background-repeat');
    textSpan.style.removeProperty('-webkit-box-decoration-break');
    textSpan.style.removeProperty('box-decoration-break');
    textSpan.style.removeProperty('--hl-text-color');
    textSpan.style.removeProperty('text-decoration');
    textSpan.style.removeProperty('text-underline-offset');
    textSpan.style.removeProperty('outline');
    textSpan.style.removeProperty('outline-offset');
    textSpan.style.removeProperty('border-radius');
    textSpan.classList.remove('hl-text-colored', 'hl-text-underlined');
  }

  // Remove any injected word spans
  const wrapped = el.querySelectorAll<HTMLElement>(`.${WORD_WRAP_CLASS}`);
  wrapped.forEach(span => {
    const parent = span.parentNode;
    if (parent) {
      while (span.firstChild) parent.insertBefore(span.firstChild, span);
      parent.removeChild(span);
    }
  });
  // Merge the text nodes that wrapping split apart. Without this, every
  // apply/remove cycle leaves the verse more fragmented than it found it.
  if (wrapped.length > 0) el.normalize();
}

// ---------------------------------------------------------------------------
// Word-level injection helpers
// ---------------------------------------------------------------------------

/**
 * Collect every text node under `root`, paired with its cumulative character
 * offset from the start of `root`'s textContent.
 */
export function collectTextNodes(root: Node): { node: Text; start: number }[] {
  const out: { node: Text; start: number }[] = [];
  let cursor = 0;

  const walk = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      const tn = node as Text;
      out.push({ node: tn, start: cursor });
      cursor += tn.length;
    } else {
      node.childNodes.forEach(walk);
    }
  };
  walk(root);

  return out;
}

/**
 * Wrap the character range [start, start + length) inside `root` in one or more
 * <span class={className}> wrappers, and return them in document order.
 *
 * A single surroundContents() cannot be used here: it throws whenever the range
 * crosses an element boundary. A one-word range rarely does, but a multi-word
 * phrase routinely runs through footnote superscripts, red-letter spans, <b>/<i>
 * and poetry <br> breaks. So the range is split at every text node it touches
 * and each piece is wrapped independently — inline markup in between is simply
 * left alone (a footnote marker inside a highlighted phrase stays unhighlighted,
 * which is what you want anyway).
 *
 * Returns an empty array if the range could not be located at all.
 */
export function wrapCharRange(
  root: HTMLElement,
  start: number,
  length: number,
  className: string
): HTMLSpanElement[] {
  if (length <= 0) return [];

  const end = start + length;
  // Snapshot the node list before mutating: splitText() only ever splits the
  // node it is called on, so the offsets of the other collected nodes stay valid.
  const textNodes = collectTextNodes(root);
  const spans: HTMLSpanElement[] = [];

  for (const { node, start: nodeStart } of textNodes) {
    const nodeEnd = nodeStart + node.length;
    if (nodeEnd <= start || nodeStart >= end) continue;

    const localStart = Math.max(0, start - nodeStart);
    const localEnd = Math.min(node.length, end - nodeStart);
    if (localEnd <= localStart) continue;

    // Trim the node down to exactly the slice we want, then wrap what is left.
    let target: Text = node;
    if (localStart > 0) target = target.splitText(localStart);
    if (target.length > localEnd - localStart) target.splitText(localEnd - localStart);

    const parent = target.parentNode;
    if (!parent) continue;

    const span = document.createElement('span');
    span.className = className;
    parent.insertBefore(span, target);
    span.appendChild(target);
    spans.push(span);
  }

  return spans;
}

/**
 * Inject highlight word-span wrappers over a character range inside a
 * .verse-text element. Returns every span created, in document order.
 */
export function injectWordSpans(
  verseTextEl: HTMLElement,
  wordStart: number,
  wordLength: number
): HTMLSpanElement[] {
  return wrapCharRange(verseTextEl, wordStart, wordLength, WORD_WRAP_CLASS);
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
      // Precise word-level: inject span(s) and style each one. A phrase that
      // runs through inline markup produces several spans; each is styled with
      // the same seed so the pieces read as one continuous stroke.
      const textSpan = el.querySelector<HTMLElement>('.verse-text');
      if (textSpan) {
        const wordSpans = injectWordSpans(textSpan, whl.wordStart, whl.wordLength);
        if (wordSpans.length > 0) {
          for (const wordSpan of wordSpans) {
            applyWordHighlightToSpan(wordSpan, whl.style, seed);
          }
        } else {
          // Offsets no longer resolve (text changed under us) — fall back to verse-level
          applyHighlightToElement(el, whl.style, seed, true);
        }
      }
    } else {
      // Different translation — degrade to verse-level highlight
      applyHighlightToElement(el, whl.style, seed, true);
    }
  }
}
