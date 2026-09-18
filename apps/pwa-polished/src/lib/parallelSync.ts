/**
 * The parallel-accounts sync engine.
 *
 * One master reader's scroll position drives up to three followers through the
 * same event. The master tells this module where it is; this module works out
 * where each follower should be and moves it there.
 *
 * Two shapes matter more than anything else in here:
 *
 * **Followers are never driven through the reader.** BibleReader.svelte is a
 * 6,900-line component and this feature adds exactly one guarded block to it
 * (the masterMoved call). Everything on the receiving end is done by resolving
 * DOM elements out of the container the view hands over on attach. That keeps
 * the reader untouched and means a follower can be scrolled without a Svelte
 * update, which is what makes a 90ms tick affordable with four of them mounted.
 *
 * **The user's hand always wins.** The commentary window's anchor does not do
 * this, and scrolling it by hand while anchored yanks it away mid-gesture. Here
 * a pane the user has touched inside the last GRACE_MS is skipped whole: not
 * moved, not dimmed, not retargeted.
 *
 * Phase 4 moves followers with a direct scroll assignment. Phase 5 replaces the
 * body of `moveTo` with the re-aimable rAF tween; nothing else in this file
 * changes, which is why the seam exists.
 */

import { get } from 'svelte/store';
import { windowStore } from './stores/windowStore';
import { parallelStore } from '../stores/parallelStore';
import {
  bestParallel,
  followerTarget,
  passageFor,
  type HeadingVerses,
  type ParallelGroup,
} from './parallelIndex';

/** How long a pane stays the user's after they touch it. */
const GRACE_MS = 1200;

/** Debounce on the master's position before followers are moved. */
const TICK_MS = 90;

/** How long to wait for a chapter the follower did not already have. */
const LOAD_TIMEOUT_MS = 800;

/** How often to look for the verse element while a chapter is loading. */
const LOAD_POLL_MS = 60;

interface PaneRuntime {
  /** Wall-clock time the user last touched this pane. */
  touchedAt: number;
  /** Cancels the in-flight wait for a chapter that is still loading. */
  cancelPendingLoad: (() => void) | null;
  /** Where the tween is currently headed, so an identical target is a no-op. */
  aimedAt: string | null;
}

let container: HTMLElement | null = null;
let tickTimer: ReturnType<typeof setTimeout> | null = null;
let pending: { book: string; chapter: number; verse: number } | null = null;
const runtime = new Map<string, PaneRuntime>();

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

/**
 * Hand the engine the element the panes live inside.
 *
 * Every element lookup is scoped to this rather than to `document`, which is
 * the same mistake phase 0 fixed in the navbar: with four panes on screen a
 * document-wide query for a pane's scroller finds whichever one the DOM happens
 * to list first.
 *
 * The touch listeners are captured on the container rather than bound per pane,
 * so panes appearing and disappearing need no bookkeeping — the target's
 * ancestor tag says which pane was touched.
 */
export function attach(containerEl: HTMLElement): void {
  detach();
  container = containerEl;

  for (const type of ['pointerdown', 'wheel', 'touchstart'] as const) {
    containerEl.addEventListener(type, onUserTouch, { capture: true, passive: true });
  }
}

export function detach(): void {
  if (container) {
    for (const type of ['pointerdown', 'wheel', 'touchstart'] as const) {
      container.removeEventListener(type, onUserTouch, { capture: true });
    }
  }
  if (tickTimer) clearTimeout(tickTimer);
  tickTimer = null;
  pending = null;
  for (const rt of runtime.values()) rt.cancelPendingLoad?.();
  runtime.clear();
  container = null;
}

function onUserTouch(event: Event): void {
  const el = (event.target as HTMLElement | null)?.closest?.('[data-parallel-pane]');
  const paneId = (el as HTMLElement | null)?.dataset?.parallelPane;
  if (paneId) runtimeFor(paneId).touchedAt = Date.now();
}

function runtimeFor(paneId: string): PaneRuntime {
  let rt = runtime.get(paneId);
  if (!rt) {
    rt = { touchedAt: 0, cancelPendingLoad: null, aimedAt: null };
    runtime.set(paneId, rt);
  }
  return rt;
}

// ---------------------------------------------------------------------------
// Master → engine
// ---------------------------------------------------------------------------

/**
 * Called from the reader's existing scroll-observer debounce, for the master
 * pane only. Debounced again here rather than relying on the reader's 150ms:
 * the reader's debounce is per instance and exists for the commentary anchor,
 * and the two would otherwise compound differently depending on which one won.
 */
export function masterMoved(book: string, chapter: number, verse: number): void {
  pending = { book, chapter, verse };
  if (tickTimer) return;
  tickTimer = setTimeout(() => {
    tickTimer = null;
    const at = pending;
    pending = null;
    if (at) tick(at.book, at.chapter, at.verse);
  }, TICK_MS);
}

/**
 * Re-align everyone from where the master is right now, skipping the debounce.
 * Used when the anchor is switched back on and when the master role moves.
 */
export function realign(book: string, chapter: number, verse: number): void {
  if (tickTimer) clearTimeout(tickTimer);
  tickTimer = null;
  pending = null;
  for (const rt of runtime.values()) rt.aimedAt = null;
  tick(book, chapter, verse);
}

// ---------------------------------------------------------------------------
// The tick
// ---------------------------------------------------------------------------

function tick(book: string, chapter: number, verse: number): void {
  const state = parallelStore.snapshot();
  if (!state.active || !state.anchorOn || !container) return;

  const group = bestParallel(book, chapter, verse);
  parallelStore.setCurrentGroup(group?.id ?? null);

  for (const pane of state.panes) {
    if (pane.paneId === state.masterId) continue;

    // The user's hand wins before anything else is even computed. A pane they
    // are holding is not dimmed either: a fade arriving mid-gesture is the same
    // interruption as a scroll, just quieter.
    if (Date.now() - runtimeFor(pane.paneId).touchedAt < GRACE_MS) continue;

    if (!group) {
      // No parallel at all. Everyone dims and nothing moves — a follower is left
      // exactly where it was rather than snapped back to anything.
      freeze(pane.paneId);
      parallelStore.setDim(pane.paneId, true, { kind: 'no-group' });
      continue;
    }

    driveFollower(group, pane.paneId, pane.book, book, chapter, verse);
  }
}

/**
 * One follower, for one group.
 *
 * Per pane rather than all-or-nothing: in a four-Gospel view the common case is
 * three books carrying the event and one not, and dimming all four because John
 * is missing would throw away the three that line up.
 */
function driveFollower(
  group: ParallelGroup,
  paneId: string,
  paneBook: string,
  masterBook: string,
  masterChapter: number,
  masterVerse: number,
): void {
  if (!passageFor(group, paneBook)) {
    freeze(paneId);
    parallelStore.setDim(paneId, true, { kind: 'no-passage', book: paneBook });
    return;
  }

  const target = followerTarget(
    group,
    masterBook,
    masterChapter,
    masterVerse,
    paneBook,
    headingsFor(paneId),
  );
  if (!target) {
    freeze(paneId);
    parallelStore.setDim(paneId, true, { kind: 'no-passage', book: paneBook });
    return;
  }

  parallelStore.setDim(paneId, false);

  const rt = runtimeFor(paneId);
  const aim = `${paneBook}|${target.chapter}|${target.verse}`;
  if (rt.aimedAt === aim) return;
  rt.aimedAt = aim;

  const el = verseElement(paneId, paneBook, target.chapter, target.verse);
  if (el) {
    rt.cancelPendingLoad?.();
    rt.cancelPendingLoad = null;
    moveTo(paneId, el);
    return;
  }

  // The chapter is not on screen. Ask the reader for it through the state it
  // already watches, then wait for the element to appear.
  awaitChapter(paneId, paneBook, target.chapter, target.verse);
}

/**
 * Load a chapter the follower does not have, and scroll to it once it lands.
 *
 * The load is asked for by writing the pane's own window state, which is the
 * path the reader already reacts to for every other kind of navigation — there
 * is no imperative "load this" to call, and adding one would mean touching the
 * reader.
 *
 * Polling rather than a MutationObserver: the reader replaces the whole verse
 * list on a chapter change, so an observer would fire dozens of times for one
 * load and still need the same "is my verse there yet" test on each.
 */
function awaitChapter(
  paneId: string,
  book: string,
  chapter: number,
  verse: number,
): void {
  const rt = runtimeFor(paneId);
  rt.cancelPendingLoad?.();

  const current = get(windowStore).find((w) => w.id === paneId)?.contentState;
  if (current?.book !== book || current?.chapter !== chapter) {
    windowStore.updateContentState(paneId, { book, chapter, highlightedVerse: null });
  }

  const deadline = Date.now() + LOAD_TIMEOUT_MS;
  const timer = setInterval(() => {
    // Whatever happens next, this pane is the user's again the moment they
    // touch it — a load that lands after they have taken over must not scroll.
    if (Date.now() - rt.touchedAt < GRACE_MS) {
      stop();
      return;
    }
    const el = verseElement(paneId, book, chapter, verse);
    if (el) {
      stop();
      moveTo(paneId, el);
      parallelStore.setDim(paneId, false);
      return;
    }
    if (Date.now() > deadline) {
      stop();
      // Giving up dims rather than retries. The chapter may genuinely not be in
      // the installed pack, and a retry loop on a missing chapter would poll for
      // as long as the master stayed put.
      parallelStore.setDim(paneId, true, { kind: 'not-loaded', book, chapter });
      rt.aimedAt = null;
    }
  }, LOAD_POLL_MS);

  function stop() {
    clearInterval(timer);
    rt.cancelPendingLoad = null;
  }
  rt.cancelPendingLoad = stop;
}

// ---------------------------------------------------------------------------
// DOM
// ---------------------------------------------------------------------------

function paneElement(paneId: string): HTMLElement | null {
  return (
    container?.querySelector<HTMLElement>(
      `[data-parallel-pane="${CSS.escape(paneId)}"]`,
    ) ?? null
  );
}

/** A pane's scrolling element — the reader's own root. */
function scrollerOf(paneId: string): HTMLElement | null {
  return paneElement(paneId)?.querySelector<HTMLElement>('.bible-reader') ?? null;
}

/**
 * The verse element for a reference in a pane, or null if that chapter is not
 * rendered. The book and chapter are checked on the section wrapper rather than
 * trusting the pane's state, because a reader mid-load still has the previous
 * chapter's verses on screen and its verse 4 is not the one being asked for.
 */
function verseElement(
  paneId: string,
  book: string,
  chapter: number,
  verse: number,
): HTMLElement | null {
  const pane = paneElement(paneId);
  if (!pane) return null;
  const section = pane.querySelector<HTMLElement>(
    `[data-book="${CSS.escape(book)}"][data-chapter="${chapter}"]`,
  );
  return section?.querySelector<HTMLElement>(`.verse[data-verse="${verse}"]`) ?? null;
}

/**
 * Which verses open a section in a pane's rendered chapters, read straight off
 * the DOM.
 *
 * parallelIndex asks for this as a lookup rather than reading it itself, because
 * headings are per translation and live behind an async IndexedDB read while
 * that module stays pure. Taking them from the DOM sidesteps the read entirely:
 * a `.section-heading` is rendered immediately before the verse it introduces,
 * so the heading's own next verse sibling is the answer — and it is necessarily
 * the translation the pane is actually showing, which an IndexedDB read keyed on
 * a translation id could get wrong the moment a pane's chip is changed.
 *
 * Only rendered chapters have headings, and a chapter with none returns
 * undefined, which costs the refinement and nothing else.
 */
function headingsFor(paneId: string): HeadingVerses {
  const cache = new Map<number, ReadonlySet<number> | undefined>();

  return (chapter: number) => {
    if (cache.has(chapter)) return cache.get(chapter);

    const pane = paneElement(paneId);
    const section = pane?.querySelector<HTMLElement>(`[data-chapter="${chapter}"]`);
    if (!section) {
      cache.set(chapter, undefined);
      return undefined;
    }

    const verses = new Set<number>();
    for (const heading of section.querySelectorAll<HTMLElement>('.section-heading')) {
      let next = heading.nextElementSibling as HTMLElement | null;
      // Walk forward rather than taking the immediate sibling: in paragraph
      // layout the heading can be followed by wrapper markup before the verse.
      while (next && !next.matches('.verse[data-verse]')) {
        next = next.nextElementSibling as HTMLElement | null;
      }
      const verse = Number(next?.dataset.verse ?? 0);
      if (verse > 0) verses.add(verse);
    }

    const result = verses.size > 0 ? verses : undefined;
    cache.set(chapter, result);
    return result;
  };
}

// ---------------------------------------------------------------------------
// Motion — the seam phase 5 replaces
// ---------------------------------------------------------------------------

/**
 * Put a verse at the top of a pane.
 *
 * Phase 4 assigns scrollTop directly, which is correct but abrupt. Phase 5
 * replaces the inside of this function with a re-aimable rAF tween; everything
 * above stays as it is, which is the point of routing all motion through one
 * call. `freeze` is the other half of that seam — phase 5 cancels the running
 * tween there, where today there is nothing to cancel.
 *
 * The heading walk mirrors scrollToVerseEl in BibleReader.svelte (~line 1491):
 * a section heading within 55% of the screen above the verse is pulled in, so a
 * follower entering a passage shows what the passage is called rather than
 * cutting in above its first line. Duplicated rather than exported to leave the
 * reader untouched — if one changes, change the other.
 */
function moveTo(paneId: string, verseEl: HTMLElement): void {
  const scroller = scrollerOf(paneId);
  if (!scroller) return;

  const target = withHeading(verseEl);
  const top =
    scroller.scrollTop +
    (target.getBoundingClientRect().top - scroller.getBoundingClientRect().top) -
    8;
  scroller.scrollTop = Math.max(0, top);
}

/** Stop a follower where it is. Never scrolls it back to anything. */
function freeze(paneId: string): void {
  const rt = runtimeFor(paneId);
  rt.cancelPendingLoad?.();
  rt.cancelPendingLoad = null;
  rt.aimedAt = null;
}

function withHeading(verseEl: HTMLElement): HTMLElement {
  const budget = window.innerHeight * 0.55;
  const verseTop = verseEl.getBoundingClientRect().top;
  let prev = verseEl.previousElementSibling as HTMLElement | null;
  while (prev) {
    if (verseTop - prev.getBoundingClientRect().top > budget) break;
    if (prev.classList.contains('section-heading')) return prev;
    prev = prev.previousElementSibling as HTMLElement | null;
  }
  return verseEl;
}
