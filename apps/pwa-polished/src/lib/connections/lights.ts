/**
 * The light travelling over the arcs.
 *
 * Tapping a book, a chapter or a dragged range lights what it touches and dims
 * the rest, and the light arrives rather than appearing: it spreads outward
 * from the tap, so what a passage reaches is read in the order the eye would
 * have walked it. An optional opening sweeps the whole Bible once, Genesis to
 * Revelation, when the picture first appears.
 *
 * This is the tree's lighting, borrowed on purpose — `ease` and the spread,
 * order curve, jitter, flash and flicker of `familyTree/motion.ts`'s `Wave`
 * are the same dials here, so the two pictures move like one app. What is
 * *not* borrowed is `Wave` itself, and the reason is worth keeping:
 *
 *   `Wave` holds a Map of per-id light and refills it every frame. The tree has
 *   a few hundred people. This has 344,799 arcs, and a Map of that size rebuilt
 *   per frame is the whole frame. So the same arithmetic is expressed as a pure
 *   function of one number — how far an arc is from the tap — which the draw
 *   loop evaluates inline and quantizes into the brightness steps it already
 *   batches by. A travelling wave then costs what a static light costs.
 *
 * Nothing here reads the clock or the Motion setting; the caller passes a time
 * and asks for the level it wants, so a saved image is a still of a known
 * moment rather than whenever the encoder got to it.
 */

import { ease, type Curve } from '../familyTree/motion';
import type { ConnectionsData } from './data';

/** A stretch of the Bible, in absolute verse positions. */
export interface Span {
  start: number;
  end: number;
}

/** Where a light started, and what it lit. */
export interface LitSet {
  /** The spans the reader asked for. */
  spans: Span[];
  /**
   * Where the wave starts from, as a verse position. Normally the middle of
   * the tapped span; the spread is measured outward from here.
   */
  origin: number;
  /** When the light began, on the same clock the draw is given. */
  startedAt: number;
}

/** How a light spreads. The tree's `WaveSpec`, over arcs instead of people. */
export interface WaveShape {
  /** First arc starting to last arc starting. 0 lights everything at once. */
  spreadMs: number;
  /** One arc's own fade, once its turn comes. */
  fadeMs: number;
  /** How the starts are spaced across the spread. */
  orderCurve: Curve;
  /** 0 keeps the order exact, 1 scatters it. */
  jitter: number;
  /** Extra glow mid-fade, as the tree's flash. 0 is none. */
  flash: number;
  /** How hard an arc flickers while its light changes. 0 is steady. */
  flicker: number;
  /** Flickers a second. */
  flickerHz: number;
}

/** How the arcs are ordered as the light spreads. */
export type LightOrder = 'outward' | 'forward' | 'backward' | 'votes' | 'together';

export const LIGHT_ORDER_NAMES: Record<LightOrder, string> = {
  outward: 'outward from the tap',
  forward: 'toward Revelation',
  backward: 'toward Genesis',
  votes: 'strongest first',
  together: 'all at once',
};

/** The opening sweep, which has a direction of its own and no origin. */
export interface OpenShape extends WaveShape {
  /** How bright an arc is before its turn. 0 is not there at all. */
  floor: number;
}

export interface ConnectionsLights {
  /** The picture lighting up when it first opens. */
  open: OpenShape;
  /** A tapped book, chapter or range coming on over the rest dimmed. */
  tap: WaveShape;
  /** Which way a tap's light travels. */
  order: LightOrder;
  /** Whether the opening sweep runs at all. */
  openOnLoad: boolean;
}

/** What the app ships, and what the lab's Reset puts back. */
export const LIGHTS: ConnectionsLights = {
  open: {
    spreadMs: 1600,
    fadeMs: 180,
    orderCurve: [0.25, 0.57, 0.75, 0.47],
    jitter: 0.1,
    flash: 0.25,
    flicker: 0,
    flickerHz: 12,
    floor: 0,
  },
  tap: {
    spreadMs: 700,
    fadeMs: 160,
    orderCurve: [0.18, 0.07, 0.54, 0.97],
    jitter: 0.12,
    flash: 0.35,
    flicker: 0,
    flickerHz: 12,
  },
  order: 'outward',
  openOnLoad: true,
};

/**
 * How many levels an animated light is rounded to.
 *
 * The draw batches arcs by brightness, so a continuous wave would mean a batch
 * per arc. Rounding the wave to a few levels keeps the batch count flat while
 * the light is moving, and at these alphas the banding is invisible on a thin
 * translucent line. This is the same bargain `STRENGTH_STEPS` makes in
 * render.ts, for the same reason.
 *
 * Measured over the real set, resting against mid-wave (stub canvas, so the
 * browser is slower, and the batches are rebuilt every frame while a light
 * travels because every arc's brightness has changed):
 *
 *     cap 20,000      1ms / 3,427 batches  →   3ms / 3,635 batches
 *     cap 50,000      2ms / 4,292          →   7ms / 4,690
 *     vote floor 25   1ms / 3,395          →   2ms / 3,518
 *     everything     21ms / 8,713          →  40ms / 9,859
 *
 * The batch count barely moves, which is the whole point of quantising. Only
 * the uncapped set is dear while lighting, and that is already a picture to
 * look at rather than to work in.
 */
export const LIGHT_STEPS = 6;

/**
 * Is a position inside any span?
 *
 * Spans are few — a book, a chapter, a dragged range — so a walk beats
 * anything cleverer, and this is called twice per arc per frame.
 */
export function inSpans(spans: Span[] | undefined, position: number): boolean {
  if (!spans?.length) return true;
  for (let i = 0; i < spans.length; i++) {
    if (position >= spans[i].start && position < spans[i].end) return true;
  }
  return false;
}

/**
 * An arc's place in the order, 0 goes first and 1 goes last.
 *
 * Pure arithmetic on verse positions: no per-arc state, nothing allocated, so
 * the draw loop can call it 344,799 times a frame. `total` is the whole Bible's
 * length, which is what makes a rank comparable between orders.
 */
export function rankOf(
  order: LightOrder,
  from: number,
  to: number,
  votes: number,
  maxVotes: number,
  origin: number,
  total: number,
): number {
  switch (order) {
    case 'together':
      return 0;
    case 'forward':
      return total > 0 ? Math.min(from, to) / total : 0;
    case 'backward':
      return total > 0 ? 1 - Math.max(from, to) / total : 0;
    case 'votes':
      // Strongest first, so the links a reader would have looked up arrive
      // before the long tail.
      return maxVotes > 0 ? 1 - Math.min(Math.max(votes, 0), maxVotes) / maxVotes : 0;
    case 'outward':
    default: {
      // How far the nearer foot is from the tap. An arc with a foot in the
      // tapped passage starts at once; the far reaches of the Bible come last.
      if (total <= 0) return 0;
      const d = Math.min(Math.abs(from - origin), Math.abs(to - origin));
      return Math.min(d / total, 1);
    }
  }
}

/**
 * One arc's light at a moment: `from` before its turn, `to` after, the fade
 * and the flash in between.
 *
 * This is `Wave.sample`'s body for a single item, with the rank passed in
 * rather than looked up. `seed` stands in for the tree's per-item random phase
 * — an arc has no identity to hang one on, so its index serves, which also
 * makes the jitter and the flicker reproducible frame to frame. Without that
 * the picture would seethe.
 */
export function lightAt(
  shape: WaveShape,
  elapsedMs: number,
  rank: number,
  from: number,
  to: number,
  seed: number,
): number {
  if (Math.abs(from - to) < 0.004) return to;

  // The jitter is deterministic per arc: a hash of the index, not a random.
  const j = Math.min(Math.max(shape.jitter, 0), 1);
  const r = j > 0 ? rank * (1 - j) + hash01(seed) * j : rank;
  const at = shape.spreadMs * ease(shape.orderCurve, Math.min(Math.max(r, 0), 1));

  const t = shape.fadeMs > 0 ? (elapsedMs - at) / shape.fadeMs : elapsedMs >= at ? 1 : 0;
  if (t <= 0) return from;
  if (t >= 1) return to;

  const bump = Math.sin(Math.PI * t);
  let v = from + (to - from) * ease('sine', t) + shape.flash * bump;
  if (shape.flicker > 0) {
    // Two sines at odd ratios read as an uneven gutter, not a strobe — the
    // tree's trick, kept.
    const phase = hash01(seed * 2 + 1) * Math.PI * 2;
    const a = (elapsedMs / 1000) * shape.flickerHz * Math.PI * 2 + phase;
    const n = (Math.sin(a) + Math.sin(a * 1.73 + phase * 2)) / 4 + 0.5;
    v *= 1 - shape.flicker * n * bump;
  }
  return v < 0 ? 0 : v;
}

/** 0..1 from an integer, well mixed. A hash, so an arc jitters the same way every frame. */
export function hash01(n: number): number {
  let x = (n | 0) + 0x9e3779b9;
  x = Math.imul(x ^ (x >>> 16), 0x21f0aaad);
  x = Math.imul(x ^ (x >>> 15), 0x735a2d97);
  x ^= x >>> 15;
  return (x >>> 0) / 4294967296;
}

/**
 * How long a wave takes from first start to last finish, in milliseconds.
 *
 * Used to know when the light has settled and the canvas can stop redrawing —
 * a still picture should not hold a repaint loop open. The jitter can push an
 * arc a whole spread late, so it counts toward the end.
 */
export function waveDurationMs(shape: WaveShape): number {
  return shape.spreadMs + shape.fadeMs + 1;
}

/**
 * The state the draw needs to light a frame, worked out once per frame rather
 * than per arc.
 *
 * `settled` says the light has finished moving, which lets the caller stop
 * asking for frames. When it is true the wave arithmetic is skipped entirely
 * and arcs take their resting light, so an idle picture costs what it did
 * before any of this existed.
 */
export interface LightFrame {
  /** The spans lit, or empty for "everything". */
  spans: Span[];
  origin: number;
  /** Milliseconds since the light began. */
  elapsedMs: number;
  shape: WaveShape | null;
  order: LightOrder;
  /** What an unlit arc rests at, from the config's dimFloor. */
  dimFloor: number;
  /** What an arc not yet reached by the opening sweep sits at. */
  floor: number;
  /** True once nothing is moving. */
  settled: boolean;
  /** True while the opening sweep is running, which has no dimmed set. */
  opening: boolean;
}

/**
 * Work out the frame's lighting from the lit set and the clock.
 *
 * `motion` is the app's level, passed in rather than read: at 'off' the light
 * is simply there, at 'reduced' it crossfades without travelling, and at
 * 'full' it spreads. That is the Motion setting honored in one place for the
 * whole feature.
 */
export function lightFrame(
  lights: ConnectionsLights,
  lit: LitSet | null,
  opening: { startedAt: number } | null,
  now: number,
  dimFloor: number,
  motion: 'full' | 'reduced' | 'off',
): LightFrame {
  // Motion off: no wave at all, just the end state.
  if (motion === 'off') {
    return {
      spans: lit?.spans ?? [],
      origin: lit?.origin ?? 0,
      elapsedMs: 0,
      shape: null,
      order: 'together',
      dimFloor,
      floor: 0,
      settled: true,
      opening: false,
    };
  }

  // Reduced motion keeps the fade but drops the travel, so the light changes
  // without anything crossing the screen.
  const flatten = (s: WaveShape): WaveShape => ({
    ...s,
    spreadMs: 0,
    jitter: 0,
    flash: 0,
    flicker: 0,
  });

  if (opening) {
    const shape = motion === 'reduced' ? flatten(lights.open) : lights.open;
    const elapsedMs = now - opening.startedAt;
    const settled = elapsedMs >= waveDurationMs(shape);
    if (!settled) {
      return {
        spans: [],
        origin: 0,
        elapsedMs,
        shape,
        // The sweep always runs Genesis to Revelation; that is what makes it an
        // opening rather than a light from nowhere.
        order: motion === 'reduced' ? 'together' : 'forward',
        dimFloor,
        floor: lights.open.floor,
        settled: false,
        opening: true,
      };
    }
  }

  if (!lit) {
    return {
      spans: [],
      origin: 0,
      elapsedMs: 0,
      shape: null,
      order: 'together',
      dimFloor,
      floor: 0,
      settled: true,
      opening: false,
    };
  }

  const shape = motion === 'reduced' ? flatten(lights.tap) : lights.tap;
  const elapsedMs = now - lit.startedAt;
  const settled = elapsedMs >= waveDurationMs(shape);
  return {
    spans: lit.spans,
    origin: lit.origin,
    elapsedMs,
    shape: settled ? null : shape,
    order: motion === 'reduced' ? 'together' : lights.order,
    dimFloor,
    floor: 0,
    settled,
    opening: false,
  };
}

/** The middle of a set of spans, which is where a tap's light starts. */
export function originOf(spans: Span[]): number {
  if (!spans.length) return 0;
  let lo = Infinity;
  let hi = -Infinity;
  for (const s of spans) {
    if (s.start < lo) lo = s.start;
    if (s.end > hi) hi = s.end;
  }
  return (lo + hi) / 2;
}

/** A lit set from spans, stamped with the moment the light began. */
export function litSetFor(spans: Span[], now: number): LitSet {
  return { spans, origin: originOf(spans), startedAt: now };
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
