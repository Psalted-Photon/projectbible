/**
 * Ticks today's reading off as Read Aloud plays it.
 *
 * A module-level subscriber, not component state, for the same reason the sleep
 * timer is one: the player is destroyed and remounted on every chapter handoff,
 * so anything that has to outlive a whole day's reading cannot live inside a
 * component.
 *
 * It watches the reading position and ticks a passage the moment playback
 * leaves it — the one the user just heard, not the one starting. The last
 * passage is ticked when playback stops, since nothing comes after it to move
 * off of.
 */

import { readingPosition, readingState, readingFinished, type ReadingPosition } from './readingEngine';
import { readingProgressStore } from '../../stores/ReadingProgressStore';
import { bumpReadingProgressVersion } from '../../stores/readingProgressVersionStore';
import type { PlanPlaylist } from './planPlaylist';

/** The run being followed, or null when playback is not a plan run. */
let active: PlanPlaylist | null = null;
/** Passage indexes already ticked, so a rewind does not untick anything. */
let ticked = new Set<number>();
/** Highest passage index reached, which is the one still playing. */
let furthest = 0;
/**
 * True once the last passage has been heard through to its end.
 *
 * Only then does the final passage get ticked. Pressing stop in the middle of
 * it means it was not read, and the whole point of the tick is that it records
 * what was actually heard.
 */
let reachedEnd = false;
/**
 * Set between `beginPlanRun` and the run actually starting.
 *
 * `startReadingPlaylist` stops the previous session first, which sets the state
 * to `idle`, and that arrives before a single note has played. Without this the
 * run would end before it began.
 */
let awaitingStart = false;

/**
 * Follow this playlist until playback stops. Called just before the engine is
 * started, so the first position it publishes is already being watched.
 *
 * Starting the engine begins by tearing down whatever was playing, which passes
 * through `idle` on the way. That is not the end of this run, so the subscriber
 * below is told to let the first one by.
 */
export function beginPlanRun(playlist: PlanPlaylist): void {
  active = playlist;
  ticked = new Set();
  furthest = 0;
  reachedEnd = false;
  awaitingStart = true;
}

/**
 * Mark one passage read.
 *
 * A harmony passage that was split across chapters shares its label with the
 * pieces either side of it, so a repeat is skipped — ticking twice would
 * *untick* it, `togglePassageComplete` being a toggle.
 */
async function tick(playlist: PlanPlaylist, index: number): Promise<void> {
  if (ticked.has(index)) return;
  ticked.add(index);

  try {
    if (playlist.planType === 'harmony') {
      const ref = playlist.harmonyRefs[index];
      if (!ref) return;
      // The label may already have been ticked by an earlier piece of the same
      // passage, or by hand before playback started. Either way, leave it —
      // togglePassageComplete is a toggle, so a second tick would untick it.
      const already = await isPassageDone(playlist, ref.sectionId, ref.label);
      if (already) return;
      await readingProgressStore.togglePassageComplete(
        playlist.planId, playlist.dayNumber, ref.sectionId, ref.label
      );
    } else {
      const passage = playlist.passages[index];
      if (!passage) return;
      await readingProgressStore.setChapterAction(
        playlist.planId,
        playlist.dayNumber,
        playlist.chapters,
        { book: passage.book, chapter: passage.chapter },
        'checked'
      );
    }
    bumpReadingProgressVersion();
  } catch (error) {
    // A failed tick should never interrupt the reading.
    console.warn('Read Aloud could not tick off a passage', error);
  }
}

/** Is this harmony passage already marked read? */
async function isPassageDone(
  playlist: PlanPlaylist,
  sectionId: number | string,
  label: string
): Promise<boolean> {
  const entry = await readingProgressStore.getDayProgress(playlist.planId, playlist.dayNumber);
  const section = entry?.harmonySections?.find((s) => s.sectionId === sectionId);
  return section?.passages.find((p) => p.label === label)?.completed ?? false;
}

if (typeof window !== 'undefined') {
  // The engine played its queue out rather than being stopped. That is what
  // separates "the day finished" from "you pressed stop", and it always fires
  // before the stop that follows it.
  readingFinished.subscribe(() => {
    if (active) reachedEnd = true;
  });

  readingPosition.subscribe((position: ReadingPosition | null) => {
    const playlist = active;
    if (!playlist || !position) return;

    // Key off the passage index alone. An announcement publishes a position
    // with a null verse, and on a harmony day the same chapter can appear
    // twice — book and chapter would read either of those as a move.
    if (position.passageIndex <= furthest) return;

    const left = furthest;
    furthest = position.passageIndex;
    void tick(playlist, left);
  });

  // The end of the run. Nothing comes after the last passage to move off of,
  // so it is ticked when playback goes quiet — but only when the run actually
  // reached it. Stopping halfway through Genesis 12 should not mark Genesis 12
  // read; leaving it for the end of the last passage should.
  readingState.subscribe((state) => {
    if (state !== 'idle') {
      // The run is under way; from here an idle really is the end of it.
      awaitingStart = false;
      return;
    }
    if (awaitingStart) return;
    const playlist = active;
    if (!playlist) return;
    active = null;

    const last = playlist.passages.length - 1;
    if (furthest === last && reachedEnd) void tick(playlist, last);
    ticked = new Set();
    furthest = 0;
    reachedEnd = false;
  });
}
