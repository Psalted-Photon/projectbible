/**
 * The arcs flying in.
 *
 * Tapping a book, a chapter or a dragged range hides everything else and
 * shoots what it touches: each arc leaves its source as a dot and draws itself
 * out behind the dot until it lands — an arrow loosed, not a light coming up on
 * an arc that was already sitting there. The opening does the same for the
 * whole Bible, launching Genesis first so the volley rolls across to
 * Revelation.
 *
 * The flight is linear in the curve's own parameter on purpose. An arc is a
 * quadratic whose control point sits over its midpoint, which makes it a
 * parabola with the parameter running evenly along the axis — so stepping that
 * parameter at a steady rate is exactly how a thrown ball moves: an even pace
 * across, slowing as it climbs, quickening as it falls. No easing curve is
 * needed to make it look thrown, because it already is.
 *
 * Nothing per arc is stored. An arc's launch time is its source's place in the
 * lit set, so the draw loop works out how far each one has flown from two
 * numbers, and a volley of 344,799 costs no memory.
 *
 * Nothing here reads the clock or the Motion setting; the caller passes a time
 * and a level, so a saved image is a still of a known moment rather than of
 * whenever the encoder got to it.
 */

import type { ConnectionsData } from './data';

/** A stretch of the Bible, in absolute verse positions. */
export interface Span {
  start: number;
  end: number;
}

/** What is lit, and when its volley was loosed. */
export interface LitSet {
  spans: Span[];
  /** When the arcs were launched, on the same clock the draw is given. */
  startedAt: number;
}

/** How a set of arcs flies in. */
export interface Volley {
  /** How long one arc takes from leaving its source to landing. */
  flightMs: number;
  /**
   * First launch to last launch. 0 looses every arc at once; above that they
   * leave in Bible order, Genesis first, so the volley rolls along the line.
   */
  staggerMs: number;
}

export interface ConnectionsLights {
  /** The whole Bible flying in when the picture first opens. */
  open: Volley;
  /** A tapped book, chapter or range. */
  tap: Volley;
  /** Whether the opening volley runs at all. */
  openOnLoad: boolean;
}

/** What the app ships, and what the lab's Reset puts back. */
export const LIGHTS: ConnectionsLights = {
  open: { flightMs: 900, staggerMs: 1500 },
  tap: { flightMs: 650, staggerMs: 250 },
  openOnLoad: true,
};

/**
 * Is a position inside any span?
 *
 * Spans are few — a book, a chapter, a dragged range — so a walk beats
 * anything cleverer. No spans means everything is lit.
 */
export function inSpans(spans: Span[] | undefined, position: number): boolean {
  if (!spans?.length) return true;
  for (let i = 0; i < spans.length; i++) {
    if (position >= spans[i].start && position < spans[i].end) return true;
  }
  return false;
}

/** First launch to last landing, in milliseconds. */
export function volleyMs(volley: Volley): number {
  return Math.max(volley.staggerMs, 0) + Math.max(volley.flightMs, 1);
}

/**
 * What the draw needs to fly a frame, worked out once per frame rather than per
 * arc.
 *
 * `volley` is null once everything has landed, which is the draw's signal to
 * skip the flight arithmetic entirely: a still picture costs what it did before
 * any of this existed.
 */
export interface FlightFrame {
  /** The spans lit, or empty for "everything". */
  spans: Span[];
  /** Milliseconds since the volley was loosed. */
  elapsedMs: number;
  /** The volley in the air, or null when every arc has landed. */
  volley: Volley | null;
  /** True once nothing is moving, so the caller can stop asking for frames. */
  settled: boolean;
  /** True while the opening volley is in the air. */
  opening: boolean;
}

/**
 * Work out the frame's flight from the lit set and the clock.
 *
 * `motion` is the app's level, passed in rather than read. At 'full' the arcs
 * fly; at 'reduced' and 'off' they are simply there, since a dot crossing the
 * screen is exactly the movement reduced motion asks to be spared. That is the
 * Motion setting honored in one place for the whole feature.
 */
export function flightFrame(
  lights: ConnectionsLights,
  lit: LitSet | null,
  opening: { startedAt: number } | null,
  now: number,
  motion: 'full' | 'reduced' | 'off',
): FlightFrame {
  const spans = lit?.spans ?? [];
  const still: FlightFrame = { spans, elapsedMs: 0, volley: null, settled: true, opening: false };
  if (motion !== 'full') return still;

  if (opening) {
    const elapsedMs = now - opening.startedAt;
    if (elapsedMs < volleyMs(lights.open)) {
      // The opening flies the whole Bible, whatever was lit before it.
      return { spans: [], elapsedMs, volley: lights.open, settled: false, opening: true };
    }
  }

  if (!lit) return still;
  const elapsedMs = now - lit.startedAt;
  if (elapsedMs >= volleyMs(lights.tap)) return still;
  return { spans, elapsedMs, volley: lights.tap, settled: false, opening: false };
}

/** A lit set from spans, stamped with the moment it was loosed. */
export function litSetFor(spans: Span[], now: number): LitSet {
  return { spans, startedAt: now };
}

/** How many links leave and arrive in a span. For the readout. */
export function countReach(data: ConnectionsData, span: Span): { out: number; in: number } {
  let out = 0;
  let incoming = 0;
  for (let i = 0; i < data.count; i++) {
    const f = data.from[i];
    const t = data.toStart[i];
    if (f >= span.start && f < span.end) out++;
    if (t >= span.start && t < span.end) incoming++;
  }
  return { out, in: incoming };
}
