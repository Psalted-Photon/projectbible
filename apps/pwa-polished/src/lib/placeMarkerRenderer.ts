/**
 * placeMarkerRenderer.ts
 *
 * Optional, opt-in overlay that draws a faint dotted underline under recognised
 * multi-word biblical place names ("Red Sea", "Abel Beth Maacah") in the reading
 * text, so the reader can see what is clickable as a single place unit.
 *
 * Only multi-word phrases are marked — single words are obviously one unit, and
 * marking them would be noisy. The gazetteer comes from the ISBE pack's
 * isbe_place_names (is_phrase = 1 rows).
 *
 * Coexistence with repeatRenderer.ts: this pass only ever wraps runs of *pure
 * text* (it skips text nodes already inside a repeat or marker span), so a marker
 * span never contains a repeat span and the two systems can't corrupt each other.
 * Apply order is always repeats first, then markers.
 */

import { openDB } from '../adapters/db';

const MARKER_CLASS = 'place-marker';
const MAX_PHRASE_WORDS = 4;

let phraseSet: Set<string> | null = null;
let starterSet: Set<string> | null = null;
let loadPromise: Promise<void> | null = null;

function normWord(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/** Load (once) the multi-word place-name gazetteer from the installed ISBE pack. */
export async function loadPlacePhrases(): Promise<void> {
  if (phraseSet) return;
  if (loadPromise) return loadPromise;
  loadPromise = (async () => {
    const phrases = new Set<string>();
    const starters = new Set<string>();
    try {
      const db = await openDB();
      if (db.objectStoreNames.contains('isbe_place_names')) {
        const rows = await new Promise<any[]>((resolve) => {
          const req = db.transaction('isbe_place_names', 'readonly').objectStore('isbe_place_names').getAll();
          req.onsuccess = () => resolve(req.result || []);
          req.onerror = () => resolve([]);
        });
        for (const r of rows) {
          if (r.isPhrase && typeof r.nameLower === 'string' && r.nameLower.includes(' ')) {
            phrases.add(r.nameLower);
            starters.add(r.nameLower.split(' ')[0]);
          }
        }
      }
    } catch {
      /* pack not installed — leave sets empty */
    }
    phraseSet = phrases;
    starterSet = starters;
  })();
  return loadPromise;
}

/** True once the gazetteer has loaded at least one phrase. */
export function hasPlacePhrases(): boolean {
  return !!phraseSet && phraseSet.size > 0;
}

/** Remove all marker spans inside a root, restoring plain text. */
export function clearPlaceMarkers(root: HTMLElement): void {
  const spans = root.querySelectorAll<HTMLElement>(`.${MARKER_CLASS}`);
  spans.forEach((span) => {
    const parent = span.parentNode;
    if (!parent) return;
    // Marker spans only ever wrap plain text, so textContent is lossless.
    parent.replaceChild(document.createTextNode(span.textContent || ''), span);
    parent.normalize();
  });
}

function markSection(root: HTMLElement): void {
  if (!phraseSet || phraseSet.size === 0 || !starterSet) return;

  const verseTexts = root.querySelectorAll<HTMLElement>('.verse-text');
  verseTexts.forEach((verseText) => {
    const walker = document.createTreeWalker(verseText, NodeFilter.SHOW_TEXT, null);
    const textNodes: Text[] = [];
    let node: Node | null;
    while ((node = walker.nextNode())) {
      const parentEl = (node as Text).parentElement;
      // Skip text already inside a repeat or marker span so we never nest.
      if (parentEl?.classList.contains(MARKER_CLASS) || parentEl?.classList.contains('repeat-hl')) continue;
      textNodes.push(node as Text);
    }

    textNodes.forEach((textNode) => {
      const text = textNode.textContent || '';
      const parts = text.split(/(\s+)/); // alternating word / whitespace tokens
      const wordIdx: number[] = [];
      for (let i = 0; i < parts.length; i++) if (parts[i].trim()) wordIdx.push(i);
      if (!wordIdx.length) return;

      // Quick reject: no phrase starts here.
      if (!wordIdx.some((wi) => starterSet!.has(normWord(parts[wi])))) return;

      // Greedy longest-phrase match, producing part-index ranges to wrap.
      const ranges: [number, number][] = [];
      let w = 0;
      while (w < wordIdx.length) {
        let matched = false;
        for (let len = Math.min(MAX_PHRASE_WORDS, wordIdx.length - w); len >= 2; len--) {
          const words: string[] = [];
          for (let k = 0; k < len; k++) words.push(normWord(parts[wordIdx[w + k]]));
          if (words.some((x) => !x)) continue;
          if (phraseSet!.has(words.join(' '))) {
            ranges.push([wordIdx[w], wordIdx[w + len - 1]]);
            w += len;
            matched = true;
            break;
          }
        }
        if (!matched) w++;
      }
      if (!ranges.length) return;

      const fragment = document.createDocumentFragment();
      let p = 0;
      let ri = 0;
      while (p < parts.length) {
        if (ri < ranges.length && p === ranges[ri][0]) {
          const [s, e] = ranges[ri];
          const span = document.createElement('span');
          span.className = MARKER_CLASS;
          span.textContent = parts.slice(s, e + 1).join('');
          fragment.appendChild(span);
          p = e + 1;
          ri++;
        } else {
          fragment.appendChild(document.createTextNode(parts[p]));
          p++;
        }
      }
      textNode.parentNode?.replaceChild(fragment, textNode);
    });
  });
}

/**
 * Re-apply place markers to every rendered chapter section under a root.
 * Idempotent: clears existing markers first. No-op (just clears) when disabled.
 */
export function applyPlaceMarkersToAllSections(readerRoot: HTMLElement, enabled: boolean): void {
  clearPlaceMarkers(readerRoot);
  if (!enabled) return;
  const sections = readerRoot.querySelectorAll<HTMLElement>('[data-chapter-section]');
  if (sections.length === 0) {
    markSection(readerRoot);
    return;
  }
  sections.forEach((section) => markSection(section));
}
