/**
 * shareText.ts
 *
 * Turns a selection into the block of text that leaves the app — the string the
 * OS share sheet hands to whatever the reader picks, and the same string the
 * Copy button puts on the clipboard.
 *
 * Deliberately pure and DOM-free: BibleReader resolves the selection into a
 * reference and a passage first (the ring closes and tears the painted spans
 * down, so that has to happen synchronously), and everything after that is
 * string work the share sheet can re-run on every toggle.
 */

import { normalizeBookName, translationLabel } from './bibleData';

/**
 * A shared passage's address. `endVerse` equals `startVerse` for the common
 * case; a phrase dragged across a verse boundary is what makes them differ.
 */
export interface ShareRef {
  book: string;
  chapter: number;
  startVerse: number;
  endVerse: number;
}

export interface ShareTextOpts {
  ref: ShareRef;
  /** The passage itself — the whole verse, or just the phrase that was picked. */
  passage: string;
  /** Translation id, e.g. "kjv". Rendered through translationLabel(). */
  translation: string;
  includeTranslation: boolean;
  includeLink: boolean;
}

/** "Genesis 1:1", or "Genesis 1:1-3" when the selection crossed a boundary. */
export function formatShareRef(ref: ShareRef): string {
  const book = normalizeBookName(ref.book);
  const span =
    ref.endVerse > ref.startVerse ? `${ref.startVerse}-${ref.endVerse}` : `${ref.startVerse}`;
  return `${book} ${ref.chapter}:${span}`;
}

/**
 * A link that opens the reader on this verse, in the translation it was read in.
 *
 * Built from the page's own origin *and* path rather than a baked-in domain,
 * because the same build is served from more than one host — and on a host that
 * serves the app from a subpath, dropping the path would point at the root.
 * The ref rides as a readable "Genesis 1:1" so the URL still says where it goes,
 * and parseRefString reads it back on the other end.
 *
 * The translation rides along because without it a link opens in whatever the
 * *recipient* last read — so a verse sent in KJV would arrive as NET on a device
 * that has only the starter pack. It is honoured only where it is installed.
 */
export function buildShareUrl(ref: ShareRef, translation?: string): string {
  if (typeof window === 'undefined') return '';
  const url = new URL(window.location.pathname, window.location.origin);
  url.searchParams.set('ref', formatShareRef(ref));
  if (translation) url.searchParams.set('t', translation.toUpperCase());
  return url.toString();
}

/**
 * The share block: the passage in quotes, then who said it, then where to read
 * the rest. Blank lines between the three because the middle one is an
 * attribution, not a continuation — every chat app that collapses newlines
 * still keeps the paragraph break.
 */
export function buildShareText(o: ShareTextOpts): string {
  const passage = o.passage.trim().replace(/\s+/g, ' ');
  const tag = o.includeTranslation ? ` (${translationLabel(o.translation)})` : '';

  const lines = [`"${passage}"`, '', `— ${formatShareRef(o.ref)}${tag}`];

  if (o.includeLink) {
    const url = buildShareUrl(o.ref, o.translation);
    if (url) lines.push('', url);
  }

  return lines.join('\n');
}
