/**
 * A small floating thing the reader can drag anywhere, that remembers where it
 * was left.
 *
 * The Comms Read Aloud pill was the first, and the Bible player is getting the
 * same treatment, so the gesture lives here once: place it at the saved spot
 * (or bottom-right), keep it wholly on screen and clear of the safe area, drag
 * it by anything that is not a control, and save the spot on release.
 *
 * Positions are against the box `position: fixed` really resolves from — see
 * lib/fixedOrigin.ts — and that box is measured once at the start of a drag, so
 * a layout shift mid-gesture can't make it jump under the finger.
 *
 * The component binds its element and hands it to `place()` when it shows,
 * calls `teardown()` when it hides, and reads `left`, `top`, `ready`,
 * `dragging` and `moved` from the store.
 */

import { tick } from 'svelte';
import { writable, type Readable } from 'svelte/store';
import { fixedOrigin } from './fixedOrigin';
import { safeInsets, type Insets } from '../tutorial/engine/safe-area';

/** Gap kept from the screen's edges, for the default spot and the clamp. */
const MARGIN = 8;
/** How far a press travels before it counts as a drag rather than a touch. */
const SLOP = 4;
/** Controls, which keep their own presses; everything else is the handle. */
const NOT_A_HANDLE = 'button, select, input';

export interface FloatPos {
  x: number;
  y: number;
}

/** Measured once per drag, so a layout shift mid-gesture can't move the goalposts. */
interface Bounds {
  width: number;
  height: number;
  insets: Insets;
}

/** A pointer that is already down somewhere else, to carry on from. */
export interface HeldPointer {
  pointerId: number;
  clientX: number;
  clientY: number;
}

export interface FloatDragOptions {
  /** The spot it was last left in, or null for its default spot. */
  load: () => FloatPos | null;
  /** Remember the spot it was let go in. */
  save: (pos: FloatPos) => void;
  /** Where a drag would put it, nudged: the Bible pill leaning toward its slot. */
  adjust?: (pos: FloatPos) => FloatPos;
  /** Let go: true when that was taken care of (docked), so the spot is not saved. */
  drop?: () => boolean;
}

export interface FloatDragState {
  left: number;
  top: number;
  /** False until placed, so it never flashes in the top-left corner. */
  ready: boolean;
  dragging: boolean;
  /** This drag has gone past the slop: it is being carried, not just touched. */
  moved: boolean;
}

export interface FloatDrag extends Readable<FloatDragState> {
  /** First showing: the remembered spot, or bottom-right. Later calls do nothing until `teardown()`. */
  place(el: HTMLElement): Promise<void>;
  /** It has been hidden, or is going away; the next `place()` starts afresh. */
  teardown(): void;
  /** The pointerdown handler. Controls are controls; everything else is the handle. */
  start(e: PointerEvent): void;
  /**
   * Carry on a drag that began on something else — the Bible player's tab in
   * the navbar. Puts the point `grab` (in its own box) under the pointer and
   * follows it from there, already counted as moved. Placed first.
   */
  pickUp(pointer: HeldPointer, grab: FloatPos): void;
}

export function floatDrag(options: FloatDragOptions): FloatDrag {
  const state = writable<FloatDragState>({ left: 0, top: 0, ready: false, dragging: false, moved: false });

  let el: HTMLElement | null = null;
  let left = 0;
  let top = 0;
  let placed = false;
  let ready = false;

  let dragging = false;
  let moved = false;
  let startX = 0;
  let startY = 0;
  let startLeft = 0;
  let startTop = 0;
  let gestureBounds: Bounds | null = null;
  let observer: ResizeObserver | null = null;

  function publish() {
    state.set({ left, top, ready, dragging, moved });
  }

  async function place(target: HTMLElement) {
    if (placed) return;
    placed = true;
    el = target;
    await tick();
    if (!el?.isConnected) return;
    const saved = options.load();
    const { width, height } = bounds();
    if (saved) {
      left = saved.x;
      top = saved.y;
    } else {
      left = width - el.offsetWidth - MARGIN;
      top = height - el.offsetHeight - MARGIN;
    }
    clamp();
    ready = true;
    publish();
    // What it shows changes length as the reading moves on, and unfolding or
    // turning the phone changes the screen — any of them can push it off an
    // edge. A turn can report before the new layout is in, so that one waits a
    // frame.
    window.addEventListener('resize', clampIntoView);
    screen.orientation?.addEventListener('change', onTurn);
    observer = new ResizeObserver(() => clampIntoView());
    observer.observe(el);
  }

  function teardown() {
    // Hidden mid-drag (the reading ran out): keep the spot it had reached.
    finish(false);
    placed = false;
    ready = false;
    el = null;
    window.removeEventListener('resize', clampIntoView);
    screen.orientation?.removeEventListener('change', onTurn);
    observer?.disconnect();
    observer = null;
    publish();
  }

  function onTurn() {
    requestAnimationFrame(clampIntoView);
  }

  /** The box it is placed in (see lib/fixedOrigin.ts), and the safe area's insets. */
  function measure(): Bounds {
    const origin = fixedOrigin(el);
    return { width: origin.width, height: origin.height, insets: safeInsets() };
  }

  function bounds(): Bounds {
    return gestureBounds ?? measure();
  }

  /**
   * Wholly on screen — it is small enough that a sliver would be useless — and
   * clear of a notch, the status bar or the home indicator.
   */
  function clamp() {
    if (!el) return;
    const { width, height, insets } = bounds();
    const minX = MARGIN + insets.left;
    const minY = MARGIN + insets.top;
    const maxX = width - el.offsetWidth - MARGIN - insets.right;
    const maxY = height - el.offsetHeight - MARGIN - insets.bottom;
    left = Math.min(Math.max(left, minX), Math.max(minX, maxX));
    top = Math.min(Math.max(top, minY), Math.max(minY, maxY));
  }

  function clampIntoView() {
    clamp();
    publish();
  }

  function start(e: PointerEvent) {
    if ((e.target as HTMLElement).closest(NOT_A_HANDLE)) return;
    e.preventDefault();
    gestureBounds = measure();
    begin(e, e.currentTarget as HTMLElement, false);
  }

  function pickUp(pointer: HeldPointer, grab: FloatPos) {
    if (!el || !ready || dragging) return;
    const origin = fixedOrigin(el);
    gestureBounds = measure();
    left = pointer.clientX - origin.left - grab.x;
    top = pointer.clientY - origin.top - grab.y;
    clamp();
    begin(pointer, el, true);
  }

  function begin(pointer: HeldPointer, captor: HTMLElement | null, alreadyMoved: boolean) {
    startX = pointer.clientX;
    startY = pointer.clientY;
    startLeft = left;
    startTop = top;
    dragging = true;
    moved = alreadyMoved;
    publish();
    try {
      captor?.setPointerCapture(pointer.pointerId);
    } catch {
      /* capture is a nicety — the window listeners below still work */
    }
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', endDrag);
    window.addEventListener('pointercancel', endDrag);
  }

  function onMove(e: PointerEvent) {
    if (!dragging) return;
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    if (!moved && dx * dx + dy * dy > SLOP * SLOP) moved = true;
    left = startLeft + dx;
    top = startTop + dy;
    if (options.adjust) {
      const nudged = options.adjust({ x: left, y: top });
      left = nudged.x;
      top = nudged.y;
    }
    clampIntoView();
  }

  function endDrag() {
    finish(true);
  }

  /** `letGo`: a real release, which `drop` may take. Not when it is just being hidden. */
  function finish(letGo: boolean) {
    if (!dragging) return;
    dragging = false;
    moved = false;
    gestureBounds = null;
    removeDragListeners();
    const taken = letGo && (options.drop?.() ?? false);
    if (!taken) options.save({ x: Math.round(left), y: Math.round(top) });
    publish();
  }

  function removeDragListeners() {
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', endDrag);
    window.removeEventListener('pointercancel', endDrag);
  }

  return { subscribe: state.subscribe, place, teardown, start, pickUp };
}
