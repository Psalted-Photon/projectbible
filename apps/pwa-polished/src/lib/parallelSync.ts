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
 * All motion goes through `moveTo`, which hands the target to the re-aimable
 * tween in smoothScrollTo. That one seam is why the 90ms tick is safe to fire
 * as often as it does: a target arriving while a follower is still gliding
 * re-aims it rather than restarting it.
 */

import { get } from 'svelte/store';
import { windowStore } from './stores/windowStore';
import { parallelStore } from '../stores/parallelStore';
import {
  bestParallel,
  followerTarget,
  passageFor,
  robertsonSectionAt,
  type HeadingVerses,
  type ParallelGroup,
} from './parallelIndex';
import { cancelSmoothScroll, smoothScrollTo } from './smoothScrollTo';

/** How long a pane stays the user's after they touch it. */
const GRACE_MS = 1200;

/** Debounce on the master's position before followers are moved. */
const TICK_MS = 90;

/** How long to wait for a chapter the follower did not already have. */
const LOAD_TIMEOUT_MS = 800;

/**
 * The same wait, for a move made while the view is still opening.
 *
 * 800ms is right mid-session, when the panes are mounted and a chapter change
 * is a database read. It is not right at open: four readers are booting at once
 * and the first chapter has to come up through all of them, which on a phone
 * can take longer than the whole budget — and giving up there would leave the
 * reader at the top of the chapter, which is the bug this exists to fix.
 */
const COLD_LOAD_TIMEOUT_MS = 6000;

/** How often to look for the verse element while a chapter is loading. */
const LOAD_POLL_MS = 60;

/**
 * How long after a move to look again and correct the landing.
 *
 * The reader injects repeat markers, place markers and note icons after the
 * verses themselves are on screen, so a target measured before they land is a
 * few pixels stale by the time the tween gets there. The reader does the same
 * correction for its own navigation at ~360ms; this is a little later because
 * the tween is still gliding at that point and there is nothing yet to correct.
 */
const SETTLE_MS = 400;

/** Landing error, in px, worth correcting. Below this nobody can see it. */
const SETTLE_TOLERANCE_PX = 4;

interface PaneRuntime {
  /** Wall-clock time the user last touched this pane. */
  touchedAt: number;
  /** Cancels the in-flight wait for a chapter that is still loading. */
  cancelPendingLoad: (() => void) | null;
  /** Where the tween is currently headed, so an identical target is a no-op. */
  aimedAt: string | null;
  /** Cancels the pending settle check for this pane's last move. */
  cancelSettle: (() => void) | null;
}

let container: HTMLElement | null = null;
/** When the view attached, so the first moments get the cold load budget. */
let attachedAt = 0;
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
  attachedAt = Date.now();

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
  for (const rt of runtime.values()) {
    rt.cancelPendingLoad?.();
    rt.cancelSettle?.();
  }
  // Stop every follower mid-glide. A tween holds its own rAF handle, so a view
  // torn down while one is running would otherwise keep scrolling a detached
  // pane until it happened to arrive.
  for (const scroller of trackedScrollers()) cancelSmoothScroll(scroller);
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
    rt = { touchedAt: 0, cancelPendingLoad: null, aimedAt: null, cancelSettle: null };
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

  // The master's own tween is killed first. When the role has just moved, the
  // new master may still be gliding towards a target it was given while it was
  // a follower — and the engine never touches the master again, so nothing else
  // would ever stop it. It would glide on, driving everyone else from a
  // position the user did not choose.
  const masterId = parallelStore.snapshot().masterId;
  if (masterId) freeze(masterId);

  tick(book, chapter, verse);
}

/**
 * Re-align from wherever the master is standing right now.
 *
 * The anchor being switched on, and the master role moving, both need the
 * master's position at a moment when nothing has scrolled — and the position
 * only otherwise arrives as an argument to `masterMoved`, from inside the
 * reader's scroll observer. Waiting for the next scroll would mean turning the
 * anchor on appears to do nothing until you move, which is the one moment the
 * feature has to prove it is working.
 *
 * So the position is read off the master's own DOM instead of being remembered.
 * Remembering it would mean a second copy of the truth kept in step with a
 * reader this feature deliberately does not touch, and it would be stale in
 * exactly the case that matters: the master pane scrolled while the anchor was
 * off, which is the whole point of switching it off.
 */
export function realignFromMaster(): void {
  const at = masterPosition();
  if (at) realign(at.book, at.chapter, at.verse);
}

/**
 * The master's current verse, read from the DOM: the first verse whose top edge
 * has not yet passed above the reading line.
 *
 * The reading line is a fifth of the way down rather than the very top, which is
 * what the reader's own observer effectively reports — a verse is "where you
 * are" once it is properly on screen, not the instant its first pixel appears.
 * Verses are walked in document order and the first match wins, so a long verse
 * spanning the line is the answer rather than the one after it.
 */
function masterPosition(): { book: string; chapter: number; verse: number } | null {
  const state = parallelStore.snapshot();
  if (!state.masterId || !container) return null;

  const pane = paneElement(state.masterId);
  const scroller = scrollerOf(state.masterId);
  if (!pane || !scroller) return null;

  const line = scroller.getBoundingClientRect().top + scroller.clientHeight * 0.2;

  for (const verseEl of pane.querySelectorAll<HTMLElement>('.verse[data-verse]')) {
    const rect = verseEl.getBoundingClientRect();
    if (rect.bottom <= line) continue;

    // The book and chapter come from the enclosing section rather than from the
    // pane's window state: the reader appends chapters as it scrolls, so the
    // verse on screen is often not in the chapter the state still names.
    const section = verseEl.closest<HTMLElement>('[data-book][data-chapter]');
    const book = section?.dataset.book;
    const chapter = Number(section?.dataset.chapter);
    const verse = Number(verseEl.dataset.verse);
    if (!book || !Number.isFinite(chapter) || !Number.isFinite(verse)) continue;

    return { book, chapter, verse };
  }

  return null;
}

/**
 * Move the whole harmony to a Robertson section.
 *
 * Only the master is moved. Every follower then arrives through the ordinary
 * tick, which is the point: a step is not a special kind of motion, it is the
 * master being somewhere new, and routing it through the same path means the
 * followers snap to headings and dim for a missing Gospel exactly as they do
 * when the master is scrolled by hand. A version that positioned all four
 * directly would be a second alignment implementation to keep in step with the
 * first.
 *
 * The master's own passage in the section is where it goes. For a solo section
 * that is the one Gospel that has it, and if the master is not that Gospel the
 * step still lands — the master is navigated to the book the section is in,
 * because a step that refused to move because the master happened to be in
 * Matthew would make most of the harmony unreachable by arrow.
 */
export function goToSection(group: ParallelGroup, opts: { cold?: boolean } = {}): void {
  const state = parallelStore.snapshot();
  const masterId = state.masterId;
  if (!masterId) return;

  const masterBook = state.panes.find((p) => p.paneId === masterId)?.book;
  const passage =
    (masterBook ? passageFor(group, masterBook) : null) ?? group.passages[0];
  if (!passage) return;

  // The master may be changing book, so the store's record of which book this
  // pane shows has to change with it or the next tick would look up the
  // master's parallels under the book it used to be in.
  parallelStore.setPaneBook(masterId, passage.book);

  // Every follower's aim is cleared first. `aimedAt` exists to stop a pane
  // being re-driven to a target it is already heading for, and after a step the
  // whole harmony has moved — a follower that happens to be aimed at the same
  // verse it was before would otherwise sit still while the others moved.
  for (const pane of state.panes) runtimeFor(pane.paneId).aimedAt = null;

  parallelStore.setCurrentGroup(group.id);
  // Set now rather than waiting for the master's scroll to report back, so the
  // arrows and the section name in the strip update on the press instead of a
  // beat later — pressing next twice quickly must step two sections, not aim
  // at the same one twice because the strip had not caught up.
  parallelStore.setCurrentSection(group.id);
  moveMasterTo(
    masterId,
    passage.book,
    passage.startChapter,
    passage.startVerse,
    opts.cold ? COLD_LOAD_TIMEOUT_MS : LOAD_TIMEOUT_MS,
  );
}

/**
 * Scroll the master to a verse, loading the chapter first if it has not got it.
 *
 * This is `awaitChapter` for the one pane that function deliberately never
 * touches. The master is normally moved by the user's own finger, so the engine
 * has no path to it at all; a step is the single case where the master is moved
 * for them, and it needs the same load-then-poll treatment because a section
 * can be several chapters away from where the reader is sitting.
 *
 * The followers are not driven from here. Once the master's scroll lands, its
 * own observer reports the new position through `masterMoved` exactly as it
 * would after any other movement, and the ordinary tick takes it from there.
 */
function moveMasterTo(
  paneId: string,
  book: string,
  chapter: number,
  verse: number,
  timeoutMs: number = LOAD_TIMEOUT_MS,
): void {
  const rt = runtimeFor(paneId);
  rt.cancelPendingLoad?.();

  const el = verseElement(paneId, book, chapter, verse);
  if (el) {
    rt.cancelPendingLoad = null;
    moveTo(paneId, el);
    return;
  }

  const current = get(windowStore).find((w) => w.id === paneId)?.contentState;
  if (current?.book !== book || current?.chapter !== chapter) {
    windowStore.updateContentState(paneId, { book, chapter, highlightedVerse: null });
  }

  const deadline = Date.now() + timeoutMs;
  const timer = setInterval(() => {
    const found = verseElement(paneId, book, chapter, verse);
    if (found) {
      stop();
      moveTo(paneId, found);
      return;
    }
    if (Date.now() > deadline) stop();
  }, LOAD_POLL_MS);

  function stop() {
    clearInterval(timer);
    rt.cancelPendingLoad = null;
  }
  rt.cancelPendingLoad = stop;
}

/**
 * Stop every follower where it stands, and clear the dimming with it.
 *
 * This is the anchor going off. The followers become ordinary readers, so the
 * dim has to go too — a fade that meant "there is no parallel here" says nothing
 * once nothing is being followed, and a pane left dimmed with no explanation is
 * indistinguishable from a bug. Positions are untouched: switching the anchor
 * off is not a reason to move anything.
 */
export function freezeFollowers(): void {
  if (tickTimer) clearTimeout(tickTimer);
  tickTimer = null;
  pending = null;

  const state = parallelStore.snapshot();
  for (const pane of state.panes) {
    if (pane.paneId === state.masterId) continue;
    freeze(pane.paneId);
    parallelStore.setDim(pane.paneId, false);
  }
  parallelStore.setCurrentGroup(null);
  // Cleared with the group. Nothing ticks while the anchor is off, so a section
  // left here would sit frozen at wherever the master happened to be when it
  // was switched off, and the strip would go on naming that section however far
  // the master was afterwards scrolled away from it.
  parallelStore.setCurrentSection(null);
}

// ---------------------------------------------------------------------------
// The tick
// ---------------------------------------------------------------------------

function tick(book: string, chapter: number, verse: number): void {
  const state = parallelStore.snapshot();
  if (!state.active || !state.anchorOn || !container) return;

  const group = bestParallel(book, chapter, verse);
  parallelStore.setCurrentGroup(group?.id ?? null);
  // Worked out here rather than by the strip, which would otherwise have to
  // read the master's position back out of the DOM on every tick just to find
  // out something this function already knows the inputs for.
  parallelStore.setCurrentSection(robertsonSectionAt(book, chapter, verse)?.id ?? null);

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

  // A follower asked for within the cold window is one of the four readers the
  // view has only just mounted, and it gets the longer budget for the same
  // reason the master does — giving up there would dim a pane for a chapter
  // that was simply still booting.
  const deadline =
    Date.now() +
    (Date.now() - attachedAt < COLD_LOAD_TIMEOUT_MS ? COLD_LOAD_TIMEOUT_MS : LOAD_TIMEOUT_MS);
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
// Motion
// ---------------------------------------------------------------------------

/**
 * Put a verse at the top of a pane, easing.
 *
 * Every follower movement in the feature comes through here, which is what lets
 * the tick fire as often as it likes: smoothScrollTo re-aims a tween already in
 * flight instead of starting a second one, so a master scrolling steadily
 * produces one continuous glide rather than a new animation every 90ms.
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

  smoothScrollTo(scroller, targetTopFor(scroller, verseEl));
  scheduleSettle(paneId, verseEl);
}

/**
 * Where the scroller has to sit for this element to be at its top.
 *
 * Recomputed on every retarget rather than cached, because getBoundingClientRect
 * is relative to the current scroll: a rect measured one tick ago describes a
 * pane that has since moved, and reusing it would aim the tween at a position
 * off by however far it has travelled in between.
 */
function targetTopFor(scroller: HTMLElement, verseEl: HTMLElement): number {
  const target = withHeading(verseEl);
  return Math.max(
    0,
    scroller.scrollTop +
      (target.getBoundingClientRect().top - scroller.getBoundingClientRect().top) -
      8,
  );
}

/**
 * Look again once the dust settles, and correct the landing if it is off.
 *
 * Two things move the ground under a tween. The reader injects markers and icons
 * into verses after they render, which shifts everything below them; and a
 * follower that loaded a chapter is still measuring web fonts when the tween is
 * aimed. Both leave the verse a few pixels from the top of the pane.
 *
 * The correction goes through smoothScrollTo like everything else, so it reads
 * as the tail of the same movement rather than a separate hop. It is abandoned
 * if the user has touched the pane, if the element is gone, or if the engine has
 * since aimed this pane somewhere else — in that last case there is a newer
 * tween in flight and correcting the old target would drag it backwards.
 */
function scheduleSettle(paneId: string, verseEl: HTMLElement): void {
  const rt = runtimeFor(paneId);
  rt.cancelSettle?.();

  const aimed = rt.aimedAt;
  const timer = setTimeout(() => {
    rt.cancelSettle = null;
    if (rt.aimedAt !== aimed) return;
    if (Date.now() - rt.touchedAt < GRACE_MS) return;
    if (!verseEl.isConnected) return;

    const scroller = scrollerOf(paneId);
    if (!scroller) return;

    const want = targetTopFor(scroller, verseEl);
    if (Math.abs(want - scroller.scrollTop) > SETTLE_TOLERANCE_PX) {
      smoothScrollTo(scroller, want);
    }
  }, SETTLE_MS);

  rt.cancelSettle = () => {
    clearTimeout(timer);
    rt.cancelSettle = null;
  };
}

/**
 * Stop a follower where it is.
 *
 * Never scrolls it back to anything: the tween is killed at whatever position it
 * had reached, because losing the parallel is not a reason to undo the reading
 * already on screen. The settle check goes too — it would otherwise fire 400ms
 * later and pull a frozen pane to a target that no longer applies.
 */
function freeze(paneId: string): void {
  const rt = runtimeFor(paneId);
  rt.cancelPendingLoad?.();
  rt.cancelPendingLoad = null;
  rt.cancelSettle?.();
  cancelSmoothScroll(scrollerOf(paneId));
  rt.aimedAt = null;
}

/** Every pane scroller the engine currently knows about, for teardown. */
function trackedScrollers(): HTMLElement[] {
  const found: HTMLElement[] = [];
  for (const paneId of runtime.keys()) {
    const scroller = scrollerOf(paneId);
    if (scroller) found.push(scroller);
  }
  return found;
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
