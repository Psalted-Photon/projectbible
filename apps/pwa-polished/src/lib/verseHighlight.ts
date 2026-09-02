/**
 * The "start here" verse highlight — one implementation for the whole app.
 *
 * This is the static gradient that marks the first several words of the verse
 * you were just sent to. It is NOT the Read Aloud glow (`ttsGlow.ts`), which is
 * a separate, moving feature that estimates word timing and travels along the
 * line as the voice reads. Nothing here animates or tracks a clock.
 *
 * The reading-plan green highlight was the original and is the reference: a
 * horizontal gradient, strongest at the first word, trailing off to nothing.
 * Six later copies drifted from it. This module is that original with its
 * positioning maths fixed, and every copy now goes through it.
 *
 * ── Colour rule ────────────────────────────────────────────────────────────
 * Reading plan keeps its own two colours (green to start, brown to end).
 * EVERY other time a link brings you to a verse, the colour is that verse's
 * book category colour from CATEGORY_COLORS — and it is the colour of the book
 * the verse actually lives in, never the reader's current book, which drifts on
 * its own as you scroll. Shape, size, opacity and radius are identical in every
 * case; the hue is the only thing a caller may vary.
 *
 * ── Why the old one missed ─────────────────────────────────────────────────
 * It positioned the gradient at `center` of the verse box, so any verse that
 * wrapped to more than one line got marked in its middle rather than at its
 * first word, and it sized the band with a hardcoded `1em + 7px` that ignored
 * the user's line spacing entirely. Both are now measured from the real first
 * line box, so any typeface, size or spacing lands correctly with no per-font
 * tuning. And because the reader mounts several chapters at once, every lookup
 * here is scoped to a chapter section — asking for "verse 5" alone would find
 * verse 5 of whichever chapter happens to sit highest in the DOM.
 */

import { getBookColor, normalizeBookName } from './bibleData';

/** Reading plan start — the original green. Not used by anything else. */
export const PLAN_START_COLOR = '#22c55e';
/** Reading plan end-of-day bookmark — brown. Not used by anything else. */
export const PLAN_END_COLOR = '#8b5a2b';

/** One opacity for every highlight in the family, taken from the green. */
const ALPHA = 0.4;

/**
 * Independent highlights that may be on screen together. Each is cleared and
 * replaced on its own; two landing on the same verse is legal, last one wins.
 *
 * A slot is `<kind>:<owner>`, where owner is a window pane's id or 'main'. The
 * reader can be on screen several times at once — the main view plus any number
 * of window panes — and each keeps its own marks, so the ids have to be part of
 * the key or one pane would wipe another's.
 */
export type HighlightKind = 'plan-start' | 'plan-end' | 'nav';
export type HighlightSlot = string;

export function slotFor(kind: HighlightKind, owner: string | null | undefined): HighlightSlot {
  return kind + ':' + (owner || 'main');
}

export interface VerseTarget {
  book: string;
  chapter: number;
  /** Verse number, or null for the first verse of the chapter. */
  verse: number | null;
  /** Target the chapter's last verse instead (the end-of-day bookmark). */
  last?: boolean;
}

export interface HighlightOptions {
  /** Hex colour. Omit and the verse's own book category colour is used. */
  color?: string;
  /** Which end of the verse the gradient is strongest at. Default 'start'. */
  side?: 'start' | 'end';
  /** Hebrew and other right-to-left text reads from the right edge. */
  rtl?: boolean;
}

interface Active {
  slot: HighlightSlot;
  reader: HTMLElement;
  target: VerseTarget;
  color: string;
  side: 'start' | 'end';
  rtl: boolean;
  verseEl: HTMLElement | null;
  /** One drawn piece per line the fade wraps onto. */
  overlays: HTMLElement[];
  observer: ResizeObserver | null;
  timers: number[];
}

const active = new Map<HighlightSlot, Active>();

const OVERLAY_CLASS = 'vh-overlay';
const NEUTRAL = 'rgba(138, 143, 152, ';

function hexToRgba(hex: string, alpha: number): string {
  const m = (hex || '').replace('#', '');
  if (m.length < 6) return NEUTRAL + alpha + ')';
  const r = parseInt(m.slice(0, 2), 16);
  const g = parseInt(m.slice(2, 4), 16);
  const b = parseInt(m.slice(4, 6), 16);
  if (Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b)) {
    return NEUTRAL + alpha + ')';
  }
  return 'rgba(' + r + ', ' + g + ', ' + b + ', ' + alpha + ')';
}

/**
 * The colour any non-reading-plan highlight must use: the category colour of
 * the book the verse belongs to. Callers pass the target book, never the
 * reader's current book — the scroll handler rewrites that as the user moves,
 * so by the time a highlight paints it can name a book you already left.
 */
export function categoryColorFor(book: string): string {
  return getBookColor(book);
}

/** Book names carry spaces and digits ("1 Samuel", "Song of Solomon"). */
function cssEscape(value: string): string {
  return (value || '').replace(/["\\]/g, '\\$&');
}

export function findChapterSection(
  reader: HTMLElement | null | undefined,
  book: string,
  chapter: number,
): HTMLElement | null {
  if (!reader) return null;
  const name = cssEscape(normalizeBookName(book));
  return reader.querySelector<HTMLElement>(
    '[data-chapter-section][data-book="' + name + '"][data-chapter="' + chapter + '"]',
  );
}

/**
 * Find a verse element, always scoped to its own chapter.
 *
 * The reader keeps several chapters mounted at once (infinite scroll appends
 * ahead and prepends behind), and `data-verse` is only unique within a chapter
 * section. A bare `.verse[data-verse="5"]` therefore returns verse 5 of
 * whichever chapter sits highest in the DOM, which is how the old highlight
 * ended up a whole chapter away from where it was aimed.
 */
export function findVerseEl(
  reader: HTMLElement | null | undefined,
  book: string,
  chapter: number,
  verse: number | null,
  last = false,
): HTMLElement | null {
  const section = findChapterSection(reader, book, chapter);
  if (!section) return null;
  if (last) {
    const all = section.querySelectorAll<HTMLElement>('.verse');
    return all[all.length - 1] ?? null;
  }
  if (verse == null) return section.querySelector<HTMLElement>('.verse');
  return section.querySelector<HTMLElement>('.verse[data-verse="' + verse + '"]');
}

/**
 * Measure every line the verse's text occupies, relative to `origin`.
 *
 * A Range is used rather than the element box because a verse is frequently
 * several lines tall, and in paragraph layout it is an inline box whose own
 * rect is the union of every line it touches. `getClientRects()` hands back one
 * rect per line fragment, which is exactly the set of lines the fade has to be
 * laid across — the first rect starts where the verse starts, whatever the
 * typeface, size, spacing or wrapping.
 */
function measureLines(verseEl: HTMLElement, origin: HTMLElement): DOMRect[] {
  const textEl = verseEl.querySelector<HTMLElement>('.verse-text') ?? verseEl;
  const range = document.createRange();
  let raw: DOMRect[] = [];
  try {
    range.selectNodeContents(textEl);
    raw = Array.from(range.getClientRects()).filter((r) => r.width > 0 && r.height > 0);
    if (raw.length === 0) {
      const box = textEl.getBoundingClientRect();
      if (box.height > 0) raw = [box];
    }
  } catch {
    return [];
  } finally {
    range.detach?.();
  }
  if (raw.length === 0) return [];
  const originRect = origin.getBoundingClientRect();
  return raw.map(
    (r) => new DOMRect(r.left - originRect.left, r.top - originRect.top, r.width, r.height),
  );
}

function textContainerOf(verseEl: HTMLElement): HTMLElement | null {
  return verseEl.closest<HTMLElement>('.text-container');
}

/**
 * How long the fade runs, in pixels, for a given font.
 *
 * The design is 30ch — thirty zero-widths — which has to become a number
 * before the fade can be split across lines and still read as one gradient.
 * Cached per font, since it only changes when the typeface or size does.
 */
const fadeLengthCache = new Map<string, number>();

function fadeLength(verseEl: HTMLElement): number {
  const cs = getComputedStyle(verseEl);
  const key = cs.fontFamily + '|' + cs.fontSize;
  const cached = fadeLengthCache.get(key);
  if (cached != null) return cached;
  const probe = document.createElement('span');
  probe.style.cssText = 'position:absolute;visibility:hidden;top:0;left:0;width:30ch;';
  probe.style.fontFamily = cs.fontFamily;
  probe.style.fontSize = cs.fontSize;
  verseEl.appendChild(probe);
  const width = probe.offsetWidth || 300;
  probe.remove();
  fadeLengthCache.set(key, width);
  return width;
}

/** One drawn piece of the fade: where it sits, and how far into the gradient. */
interface Segment {
  left: number;
  top: number;
  width: number;
  height: number;
  /** Pixels of gradient already spent before this piece. */
  consumed: number;
}

/**
 * Lay the fade across the lines, wrapping when it reaches the edge.
 *
 * A verse that starts near the right margin only has a sliver of its first line
 * to work with, so the rest continues at the start of the next one — the way a
 * text selection wraps. Drawing a single band instead simply ran off the edge
 * and lost the remainder, which was also silently clipping the tail on a narrow
 * column or at a large font even when the verse began at the margin.
 *
 * A verse that ends mid-line just stops. The fade must never spill onto the
 * next verse, which is not the one being marked.
 */
function planSegments(rects: DOMRect[], total: number, fromRight: boolean, reverse: boolean): Segment[] {
  const ordered = reverse ? [...rects].reverse() : rects;
  const segments: Segment[] = [];
  let consumed = 0;
  for (const r of ordered) {
    if (consumed >= total) break;
    const width = Math.min(total - consumed, r.width);
    if (width <= 0) continue;
    segments.push({
      // Each line is filled from the edge reading starts at: the left for
      // left-to-right text, the right for Hebrew and for the end-of-day mark.
      left: fromRight ? r.left + r.width - width : r.left,
      top: r.top,
      width,
      height: r.height,
      consumed,
    });
    consumed += width;
  }
  return segments;
}

function place(a: Active): void {
  const verseEl = a.verseEl;
  if (!verseEl || !verseEl.isConnected) return;

  const container = textContainerOf(verseEl);
  if (!container) return;

  const wantEnd = a.side === 'end';
  const fromRight = a.rtl || wantEnd;

  const rects = measureLines(verseEl, container);
  if (rects.length === 0) return;

  const total = fadeLength(verseEl);
  // The end-of-day mark is anchored to the verse's last line and runs backwards
  // through the text, so it walks the lines in reverse.
  const segments = planSegments(rects, total, fromRight, wantEnd);
  if (segments.length === 0) return;

  const rgba = hexToRgba(a.color, ALPHA);
  const dirClass = fromRight ? 'vh-rtl' : 'vh-ltr';

  syncOverlayCount(a, container, segments.length);

  segments.forEach((seg, i) => {
    const el = a.overlays[i];
    el.classList.remove('vh-ltr', 'vh-rtl');
    el.classList.add(dirClass);
    el.style.setProperty('--vh-color', rgba);
    el.style.left = seg.left + 'px';
    el.style.top = seg.top + 'px';
    el.style.width = seg.width + 'px';
    el.style.height = seg.height + 'px';
    // Every piece paints the whole gradient at its full length and slides it so
    // the colour picks up where the last line left off. Without this each line
    // would restart at full strength and read as stripes rather than one fade.
    el.style.backgroundSize = total + 'px 100%';
    el.style.backgroundPositionX = fromRight
      ? seg.width + seg.consumed - total + 'px'
      : -seg.consumed + 'px';
  });
}

/** Grow or shrink the pool of drawn pieces to match what this placement needs. */
function syncOverlayCount(a: Active, container: HTMLElement, count: number): void {
  while (a.overlays.length > count) {
    a.overlays.pop()?.remove();
  }
  while (a.overlays.length < count) {
    const el = document.createElement('div');
    el.className = OVERLAY_CLASS;
    el.setAttribute('aria-hidden', 'true');
    // Prepended so it paints beneath the verses rather than over them.
    container.insertBefore(el, container.firstChild);
    a.overlays.push(el);
  }
  for (const el of a.overlays) {
    if (!el.isConnected) container.insertBefore(el, container.firstChild);
  }
}

function removeOverlays(a: Active): void {
  for (const el of a.overlays) el.remove();
  a.overlays.length = 0;
}

/**
 * Re-place for a short while after painting.
 *
 * The page keeps moving after a navigation lands: the reader's webfonts all
 * load with `font-display: swap` so the real face arrives after first paint,
 * `.main-content` animates its width for 300ms whenever a side pane opens or
 * closes, and repeat markers, place markers and note icons are injected into
 * the text later still. A single measurement taken at paint time is stale
 * within a few frames, which is what left the gradient sitting beside the words
 * instead of on them.
 */
function watch(a: Active): void {
  const verseEl = a.verseEl;
  if (!verseEl) return;
  const container = textContainerOf(verseEl);
  if (container && typeof ResizeObserver !== 'undefined') {
    a.observer = new ResizeObserver(() => place(a));
    a.observer.observe(container);
  }
  for (const delay of [0, 60, 160, 320, 520]) {
    a.timers.push(window.setTimeout(() => place(a), delay));
  }
  if (document.fonts?.ready) {
    document.fonts.ready
      .then(() => { if (active.get(a.slot) === a) place(a); })
      .catch(() => {});
  }
}

/**
 * Paint a highlight in `slot`, replacing whatever was there.
 *
 * Returns the verse element it landed on, or null if that chapter is not
 * currently in the DOM — callers use that to decide whether to try again once
 * the chapter loads.
 */
export function showVerseHighlight(
  reader: HTMLElement | null | undefined,
  slot: HighlightSlot,
  target: VerseTarget,
  options: HighlightOptions = {},
): HTMLElement | null {
  clearVerseHighlight(slot);
  if (!reader) return null;

  const verseEl = findVerseEl(reader, target.book, target.chapter, target.verse, target.last);
  if (!verseEl) return null;

  const a: Active = {
    slot,
    reader,
    target: { ...target, book: normalizeBookName(target.book) },
    color: options.color ?? categoryColorFor(target.book),
    side: options.side ?? 'start',
    rtl: options.rtl ?? false,
    verseEl,
    overlays: [],
    observer: null,
    timers: [],
  };
  active.set(slot, a);
  place(a);
  watch(a);
  return verseEl;
}

/** Remove the highlight in `slot`, along with its observer and timers. */
export function clearVerseHighlight(slot: HighlightSlot): void {
  const a = active.get(slot);
  if (!a) return;
  active.delete(slot);
  a.observer?.disconnect();
  a.observer = null;
  for (const t of a.timers) clearTimeout(t);
  a.timers.length = 0;
  removeOverlays(a);
}

/** Remove every highlight belonging to one reader instance, as it tears down. */
export function clearVerseHighlightsFor(owner: string | null | undefined): void {
  const suffix = ':' + (owner || 'main');
  for (const slot of [...active.keys()]) {
    if (slot.endsWith(suffix)) clearVerseHighlight(slot);
  }
}

/** What a slot is currently aimed at, so callers can avoid redundant repaints. */
export function currentTarget(slot: HighlightSlot): VerseTarget | null {
  return active.get(slot)?.target ?? null;
}

/**
 * Re-find and re-paint everything after the chapter DOM has been rebuilt.
 *
 * Svelte destroys and recreates verse elements on a chapter load, which drops
 * the class we put on them. Without this a highlight would survive in one
 * direction only — coming back for the reading plan (whose loader re-applied it
 * by hand) and lost forever for a link — which is exactly the "sometimes it's
 * there, sometimes it isn't" the old code produced.
 */
export function reapplyVerseHighlights(
  reader: HTMLElement | null | undefined,
  owner?: string | null,
): void {
  if (!reader) return;
  const suffix = ':' + (owner || 'main');
  for (const a of [...active.values()]) {
    if (!a.slot.endsWith(suffix)) continue;
    const el = findVerseEl(reader, a.target.book, a.target.chapter, a.target.verse, a.target.last);
    if (!el) continue;
    if (el !== a.verseEl) {
      removeOverlays(a);
      a.verseEl = el;
    }
    a.reader = reader;
    a.observer?.disconnect();
    a.observer = null;
    for (const t of a.timers) clearTimeout(t);
    a.timers.length = 0;
    place(a);
    watch(a);
  }
}

/**
 * Wait until the text has stopped moving before measuring anything against it.
 * Fonts first (all of the reader's faces load with `font-display: swap`), then
 * two frames so the browser has laid out with them.
 */
export async function waitForTextToSettle(): Promise<void> {
  try {
    if (document.fonts?.ready) await document.fonts.ready;
  } catch {
    // fonts API unavailable or rejected — fall through to the frame wait
  }
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
}
