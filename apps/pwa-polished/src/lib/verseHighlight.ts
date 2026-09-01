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
  overlay: HTMLElement | null;
  observer: ResizeObserver | null;
  timers: number[];
}

const active = new Map<HighlightSlot, Active>();

const HL_CLASS = 'vh-hl';
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
 * Measure one line of the verse's text, in coordinates relative to `origin`.
 *
 * A Range is used rather than the element box because a verse is frequently
 * several lines tall, and in paragraph layout it is an inline box whose own
 * rect is the union of every line it touches. The first client rect is the
 * line the verse actually begins on — the line the highlight is supposed to be
 * marking, whatever the typeface, size, spacing or wrapping.
 */
function measureLine(
  verseEl: HTMLElement,
  origin: HTMLElement,
  which: 'first' | 'last',
): DOMRect | null {
  const textEl = verseEl.querySelector<HTMLElement>('.verse-text') ?? verseEl;
  const range = document.createRange();
  let rect: DOMRect | null = null;
  try {
    range.selectNodeContents(textEl);
    const rects = range.getClientRects();
    if (which === 'first') {
      for (let i = 0; i < rects.length; i++) {
        const r = rects[i];
        if (r.width > 0 && r.height > 0) { rect = r; break; }
      }
    } else {
      for (let i = rects.length - 1; i >= 0; i--) {
        const r = rects[i];
        if (r.width > 0 && r.height > 0) { rect = r; break; }
      }
    }
    if (!rect) rect = textEl.getBoundingClientRect();
  } catch {
    return null;
  } finally {
    range.detach?.();
  }
  if (!rect || rect.height === 0) return null;
  const originRect = origin.getBoundingClientRect();
  return new DOMRect(
    rect.left - originRect.left,
    rect.top - originRect.top,
    rect.width,
    rect.height,
  );
}

function textContainerOf(verseEl: HTMLElement): HTMLElement | null {
  return verseEl.closest<HTMLElement>('.text-container');
}

/**
 * A verse is a block in the default layout but `display: inline` in the two
 * paragraph layouts. A gradient background cannot be positioned on a multi-line
 * inline box — the browser treats it as one unbroken run and slices it across
 * lines — so those get a placed element instead. Same gradient either way.
 */
function isInlineVerse(verseEl: HTMLElement): boolean {
  return getComputedStyle(verseEl).display === 'inline';
}

function stripBackground(el: HTMLElement): void {
  el.classList.remove(HL_CLASS, 'vh-ltr', 'vh-rtl');
  el.style.removeProperty('--vh-color');
  el.style.removeProperty('--vh-h');
  el.style.removeProperty('--vh-pos');
}

function place(a: Active): void {
  const verseEl = a.verseEl;
  if (!verseEl || !verseEl.isConnected) return;

  const wantEnd = a.side === 'end';
  const fromRight = a.rtl || wantEnd;
  const inline = isInlineVerse(verseEl);
  const container = textContainerOf(verseEl);
  const origin = inline ? container : verseEl;
  if (!origin) return;

  const rect = measureLine(verseEl, origin, wantEnd ? 'last' : 'first');
  if (!rect) return;

  const rgba = hexToRgba(a.color, ALPHA);
  const dirClass = fromRight ? 'vh-rtl' : 'vh-ltr';

  if (inline && container) {
    // Placed element, prepended to the text container so it paints beneath the
    // verses rather than over them.
    let el = a.overlay;
    if (!el || !el.isConnected) {
      el = document.createElement('div');
      el.className = OVERLAY_CLASS;
      el.setAttribute('aria-hidden', 'true');
      container.insertBefore(el, container.firstChild);
      a.overlay = el;
    }
    el.classList.remove('vh-ltr', 'vh-rtl');
    el.classList.add(dirClass);
    el.style.setProperty('--vh-color', rgba);
    // Resolve the 30ch width against the verse's own font, so the gradient is
    // the same visual length here as it is in the background version.
    const cs = getComputedStyle(verseEl);
    el.style.fontFamily = cs.fontFamily;
    el.style.fontSize = cs.fontSize;
    el.style.height = rect.height + 'px';
    el.style.top = rect.top + 'px';
    if (fromRight) {
      el.style.left = 'auto';
      el.style.right = Math.max(0, container.clientWidth - (rect.left + rect.width)) + 'px';
    } else {
      el.style.right = 'auto';
      el.style.left = rect.left + 'px';
    }
    stripBackground(verseEl);
    return;
  }

  // Block verse — the original approach, with the band measured, not guessed.
  if (a.overlay) { a.overlay.remove(); a.overlay = null; }
  verseEl.style.setProperty('--vh-color', rgba);
  verseEl.style.setProperty('--vh-h', rect.height + 'px');
  if (fromRight) {
    const rightInset = Math.max(0, verseEl.clientWidth - (rect.left + rect.width));
    verseEl.style.setProperty('--vh-pos', 'right ' + rightInset + 'px top ' + rect.top + 'px');
  } else {
    verseEl.style.setProperty('--vh-pos', rect.left + 'px ' + rect.top + 'px');
  }
  verseEl.classList.remove('vh-ltr', 'vh-rtl');
  verseEl.classList.add(HL_CLASS, dirClass);
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
    overlay: null,
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
  if (a.overlay) { a.overlay.remove(); a.overlay = null; }
  if (a.verseEl) stripBackground(a.verseEl);
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
      if (a.verseEl) stripBackground(a.verseEl);
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
