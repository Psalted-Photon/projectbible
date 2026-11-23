/**
 * The Back list: one list of everything the phone's Back can undo, newest last.
 *
 * Back does one thing per press, newest first. It closes anything that a tap
 * outside it would close, and it walks back through crumbs. When the list is
 * empty there is nothing left to do, and Back leaves the app.
 *
 * Every screen reports here instead of handling Back itself. That is what the
 * old version lacked: the family tree and Harmonies each caught Back on their
 * own, and their presses fought each other. Now one place decides.
 *
 * Three kinds of thing go in the list:
 *
 * - a step: something open that Back closes (backStep, trackOpen).
 * - a crumb trail: one step per crumb behind you (backDepth).
 * - a wall: a view only its × closes (backWall, trackWall, mountWall). Back
 *   still walks steps added after the wall, then does nothing until × takes
 *   the wall down. Crumbs of the reader hidden underneath are never walked
 *   while a wall is up, whenever they were added.
 *
 * Who presses Back: the Android app (lib/android/back.ts) asks goBackOne()
 * on each press. Nothing else calls it yet.
 */

import { onDestroy } from 'svelte';
import { writable, type Readable } from 'svelte/store';

/**
 * What undoing a step came to:
 *  done  it undid itself.
 *  skip  it had nothing left to undo; it's dropped and the next one is tried.
 *  stay  it said no for now (busy); it stays, and the press is used up.
 */
type Undo = 'done' | 'skip' | 'stay';

interface Owner {
  undo(): Undo;
  /** The entry left the list because Back took it. */
  taken(entry: Entry): void;
  /** Back took it, but it had nothing to undo. */
  failed?(entry: Entry): void;
}

interface Entry {
  seq: number;
  rank: number;
  wall: boolean;
  /** A reader's crumb: never walked while a wall is up below it. */
  reader: boolean;
  owner: Owner;
}

/**
 * Where an entry sits. Crumbs already on the bar at launch go at the bottom:
 * the main reader's lowest, so they are the last thing Back walks before it
 * leaves, and Bible windows' just above them. Everything added after launch
 * goes above both, in the order it happened.
 */
export const RANK_OLD_MAIN = 0;
export const RANK_OLD_WINDOW = 1;
const RANK_NOW = 2;

let seq = 0;
const entries: Entry[] = [];
const active = writable(false);

/** True while the list has anything in it, a wall included: Back is ours to answer. */
export const backListActive: Readable<boolean> = { subscribe: active.subscribe };

function changed(): void {
  active.set(entries.length > 0);
}

function add(owner: Owner, opts: { wall?: boolean; reader?: boolean; rank?: number } = {}): Entry {
  const entry: Entry = {
    seq: ++seq,
    rank: opts.rank ?? RANK_NOW,
    wall: !!opts.wall,
    reader: !!opts.reader,
    owner,
  };
  put(entry);
  return entry;
}

function put(entry: Entry): void {
  entries.push(entry);
  entries.sort((a, b) => a.rank - b.rank || a.seq - b.seq);
  changed();
}

function drop(entry: Entry): void {
  const i = entries.indexOf(entry);
  if (i < 0) return;
  entries.splice(i, 1);
  changed();
}

/**
 * The entry the next press undoes: the newest that isn't a reader's crumb
 * under a wall. Null when the top is a wall (nothing to do but wait for ×).
 */
function nextEntry(): Entry | null {
  const lowestWall = entries.findIndex((e) => e.wall);
  for (let i = entries.length - 1; i >= 0; i--) {
    const e = entries[i];
    if (e.wall) return null;
    if (e.reader && lowestWall >= 0 && lowestWall < i) continue;
    return e;
  }
  return null;
}

/**
 * One press of Back: undo the newest step. Returns false only when the list
 * is empty, which means Back should leave the app. At a wall the press is
 * used up doing nothing, so it returns true.
 */
export function goBackOne(): boolean {
  while (entries.length > 0) {
    const entry = nextEntry();
    if (!entry) return true;
    drop(entry);
    entry.owner.taken(entry);
    let result: Undo;
    try {
      result = entry.owner.undo();
    } catch (err) {
      console.warn('[back] a step failed to undo itself', err);
      return true;
    }
    if (result === 'done') return true;
    if (result === 'stay') {
      put(entry);
      return true;
    }
    entry.owner.failed?.(entry);
  }
  return false;
}

// ── Steps and walls ─────────────────────────────────────────────────────────

export interface BackHandle {
  /** Open (in the list) or closed (out of it). */
  set(open: boolean): void;
  /** Out of the list for good. */
  dispose(): void;
}

function handle(make: (owner: Owner) => Entry, undo: () => Undo): BackHandle {
  let open = false;
  let entry: Entry | null = null;
  let lastTaken: Entry | null = null;
  const owner: Owner = {
    undo: () => {
      const result = undo();
      // goBackOne puts the same entry back; it is still this handle's.
      if (result === 'stay') entry = lastTaken;
      return result;
    },
    taken: (e) => {
      lastTaken = e;
      entry = null;
    },
  };
  return {
    set(next) {
      // Only a change counts: Back took the entry while it was still open, so
      // being told "open" again must not put it back.
      if (next === open) return;
      open = next;
      if (next) {
        entry = make(owner);
      } else if (entry) {
        drop(entry);
        entry = null;
      }
    },
    dispose() {
      open = false;
      if (entry) drop(entry);
      entry = null;
    },
  };
}

/**
 * Something Back closes, by calling `close` — the same function its backdrop
 * or outside tap calls. `close` returning false means it refused (busy), so
 * the step stays for the next press.
 */
export function backStep(close: () => boolean | void): BackHandle {
  return handle(
    (owner) => add(owner),
    () => (close() === false ? 'stay' : 'done'),
  );
}

/** A view only its × closes. Back walks what's above it, then waits. */
export function backWall(): BackHandle {
  return handle((owner) => add(owner, { wall: true }), () => 'stay');
}

/** A step for as long as `open` is truthy. Returns the call that stops it. */
export function trackOpen(open: Readable<unknown>, close: () => boolean | void): () => void {
  const step = backStep(close);
  const unsubscribe = open.subscribe((v) => step.set(!!v));
  return () => {
    unsubscribe();
    step.dispose();
  };
}

/**
 * A step for each thing `key` names, in turn: when the key changes, the old
 * one's step goes and the new one's comes. For a queue where only the first
 * is on screen (the confirm box).
 */
export function trackKeyed<K>(key: Readable<K | null | undefined>, close: (k: K) => void): () => void {
  let current: K | null = null;
  let step: BackHandle | null = null;
  const unsubscribe = key.subscribe((k) => {
    const next = k ?? null;
    if (next === current) return;
    step?.dispose();
    step = null;
    current = next;
    if (next !== null) {
      step = backStep(() => close(next));
      step.set(true);
    }
  });
  return () => {
    unsubscribe();
    step?.dispose();
  };
}

/** A wall for as long as `open` is truthy. Returns the call that stops it. */
export function trackWall(open: Readable<unknown>): () => void {
  const wall = backWall();
  const unsubscribe = open.subscribe((v) => wall.set(!!v));
  return () => {
    unsubscribe();
    wall.dispose();
  };
}

/**
 * For a component that is on screen exactly while it is mounted. Call while
 * the component starts up: a step (with `close`) or a wall (without) from
 * now until it unmounts.
 */
export function whileMounted(close?: () => boolean | void): void {
  const h = close ? backStep(close) : backWall();
  h.set(true);
  onDestroy(() => h.dispose());
}

/**
 * For a component that shows a tap-away popup only some of the time: a step
 * to `set` as it opens and closes, gone when the component unmounts. Back
 * calls `close`, the same function the popup's outside tap calls.
 * Call while the component starts up.
 */
export function mountStep(close: () => boolean | void): BackHandle {
  const step = backStep(close);
  onDestroy(() => step.dispose());
  return step;
}

/**
 * For a component that shows a × -only view only some of the time: a wall to
 * `set` as it opens and closes, taken down when the component unmounts.
 * Call while the component starts up.
 */
export function mountWall(): BackHandle {
  const wall = backWall();
  onDestroy(() => wall.dispose());
  return wall;
}

// ── Crumb trails ────────────────────────────────────────────────────────────

export interface BackDepthHandle {
  /** How many crumbs are behind you now. */
  set(depth: number): void;
  dispose(): void;
}

/**
 * A crumb trail: one step per crumb behind you. Back calls `back`, which
 * walks one crumb and says whether it moved. The trail's own depth, reported
 * through `set`, keeps the steps in line with the bar whichever way the
 * crumbs come and go (a link, a crumb tapped, Clear trail).
 *
 * The first depth reported is what was already there: those steps go in at
 * `oldRank` when given (crumbs saved from before the app was closed).
 */
export function backDepth(
  back: () => boolean,
  opts: { reader?: boolean; oldRank?: number } = {},
): BackDepthHandle {
  let depth: number | null = null;
  let mine: Entry[] = [];
  const owner: Owner = {
    undo: () => (back() ? 'done' : 'skip'),
    taken: (entry) => {
      mine = mine.filter((e) => e !== entry);
      // The walk is about to report one less; that one is this entry.
      if (depth !== null) depth--;
    },
    failed: () => {
      // Nothing moved, so the trail is as deep as it was. The entry stays gone.
      if (depth !== null) depth++;
    },
  };
  return {
    set(next) {
      const first = depth === null;
      const was = depth ?? 0;
      depth = next;
      if (next > was) {
        const rank = first && opts.oldRank !== undefined ? opts.oldRank : RANK_NOW;
        for (let i = was; i < next; i++) mine.push(add(owner, { reader: opts.reader, rank }));
      } else if (next < was) {
        // The newest crumbs went: their steps go with them.
        for (let i = next; i < was && mine.length > 0; i++) drop(mine.pop()!);
      }
    },
    dispose() {
      for (const e of mine) drop(e);
      mine = [];
      depth = null;
    },
  };
}
