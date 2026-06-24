/**
 * repeatRenderer.ts
 *
 * Applies the soft, translucent "Repeats" overlay to rendered chapter DOM.
 * Each active repeat group wraps its matching words in a
 * <span class="repeat-hl repeat-hl-{colorIndex}"> so the word is visually
 * tracked everywhere in the Bible.
 *
 * This layer is intentionally separate from highlightRenderer.ts (saved
 * highlights). Repeats are always applied AFTER saved highlights and cleared
 * BEFORE re-applying saved highlights, so the two never corrupt each other.
 */

import type { RepeatGroup } from '../stores/repeatsStore';
import { normalizeRepeatWord } from '../stores/repeatsStore';

const REPEAT_CLASS = 'repeat-hl';

/** Remove all repeat spans inside a section, restoring plain text. */
export function clearRepeatsInSection(root: HTMLElement): void {
  const spans = root.querySelectorAll<HTMLElement>(`.${REPEAT_CLASS}`);
  spans.forEach((span) => {
    const parent = span.parentNode;
    if (!parent) return;
    parent.replaceChild(document.createTextNode(span.textContent || ''), span);
    parent.normalize();
  });
}

/**
 * Apply all active repeat groups to a chapter section.
 * Idempotent: clears any existing repeat spans first.
 */
export function applyRepeatsToSection(root: HTMLElement, groups: RepeatGroup[]): void {
  clearRepeatsInSection(root);
  if (groups.length === 0) return;

  // Normalized word -> colorIndex
  const colorByWord = new Map<string, number>();
  for (const g of groups) colorByWord.set(g.word, g.colorIndex);

  const verseTexts = root.querySelectorAll<HTMLElement>('.verse-text');
  verseTexts.forEach((verseText) => {
    const walker = document.createTreeWalker(verseText, NodeFilter.SHOW_TEXT, null);
    const textNodes: Text[] = [];
    let node: Node | null;
    while ((node = walker.nextNode())) {
      // Skip text already inside a repeat span (shouldn't happen after clear)
      const parentEl = (node as Text).parentElement;
      if (parentEl?.classList.contains(REPEAT_CLASS)) continue;
      textNodes.push(node as Text);
    }

    textNodes.forEach((textNode) => {
      const text = textNode.textContent || '';
      const parts = text.split(/(\s+)/); // keep whitespace tokens

      // Quick check: any token match?
      let hasMatch = false;
      for (const p of parts) {
        if (p.trim() && colorByWord.has(normalizeRepeatWord(p))) {
          hasMatch = true;
          break;
        }
      }
      if (!hasMatch) return;

      const fragment = document.createDocumentFragment();
      for (const p of parts) {
        const colorIndex = p.trim() ? colorByWord.get(normalizeRepeatWord(p)) : undefined;
        if (colorIndex !== undefined) {
          const span = document.createElement('span');
          span.className = `${REPEAT_CLASS} ${REPEAT_CLASS}-${colorIndex}`;
          span.textContent = p;
          fragment.appendChild(span);
        } else {
          fragment.appendChild(document.createTextNode(p));
        }
      }
      textNode.parentNode?.replaceChild(fragment, textNode);
    });
  });
}

/**
 * Find every occurrence of a normalized word inside a verse's rendered text,
 * returning char offsets compatible with injectWordSpan / UserWordHighlight
 * (i.e. positions within the .verse-text textContent). Each occurrence spans
 * the whole whitespace-delimited token, matching the scratch-overlay behavior.
 */
export function findRepeatOccurrences(
  renderedText: string,
  normalizedWord: string,
): { wordStart: number; wordLength: number }[] {
  const parts = renderedText.split(/(\s+)/);
  const out: { wordStart: number; wordLength: number }[] = [];
  let offset = 0;
  for (const p of parts) {
    if (p.trim() && normalizeRepeatWord(p) === normalizedWord) {
      out.push({ wordStart: offset, wordLength: p.length });
    }
    offset += p.length;
  }
  return out;
}

/** Re-apply repeats to every rendered chapter section under a root. */
export function applyRepeatsToAllSections(readerRoot: HTMLElement, groups: RepeatGroup[]): void {
  const sections = readerRoot.querySelectorAll<HTMLElement>('[data-chapter-section]');
  if (sections.length === 0) {
    // Fallback: whole reader (no per-chapter sections found)
    applyRepeatsToSection(readerRoot, groups);
    return;
  }
  sections.forEach((section) => applyRepeatsToSection(section, groups));
}
