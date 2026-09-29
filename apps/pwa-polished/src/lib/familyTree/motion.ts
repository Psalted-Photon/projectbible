/**
 * The Grand Entrance: what happens when someone is tapped on the tree. And
 * the Lights (end of the file): people coming on one by one.
 *
 * The camera pulls out to the whole tree, holds there with only God lit, then
 * climbs the line from God to the person while it lights, landing on them.
 * A golden burst goes off round God as the climb starts and a burst in the
 * person's own colour as it lands.
 *
 * Every number lives in MOTION. The viewer and the motion lab
 * (tree-motion-lab.html) both run this file, so what the lab plays is what
 * ships; its Copy values button prints a MOTION block to paste back here.
 */

import { generationOf, isPlaced, type TreeModel, type TreeRec } from './layout';
import { toScreen, toWorld, viewFor, type View } from './render';

// ── Curves ───────────────────────────────────────────────────────────────

/** A named in-out curve, or a CSS-style cubic-bezier [x1, y1, x2, y2]. */
export type Curve = 'cubic' | 'sine' | 'quint' | 'expo' | 'linear' | [number, number, number, number];

export const CURVE_NAMES = ['cubic', 'sine', 'quint', 'expo', 'linear'] as const;

/** Progress 0..1 through a curve, for time 0..1. */
export function ease(c: Curve, t: number): number {
  t = Math.max(0, Math.min(1, t));
  if (Array.isArray(c)) return bezier(c, t);
  switch (c) {
    case 'linear':
      return t;
    case 'sine':
      return -(Math.cos(Math.PI * t) - 1) / 2;
    case 'quint':
      return t < 0.5 ? 16 * t ** 5 : 1 - (-2 * t + 2) ** 5 / 2;
    case 'expo':
      if (t === 0 || t === 1) return t;
      return t < 0.5 ? 2 ** (20 * t - 10) / 2 : (2 - 2 ** (-20 * t + 10)) / 2;
    case 'cubic':
    default:
      return t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
  }
}

/** cubic-bezier(x1, y1, x2, y2) at time x: find the curve's own parameter
 *  for x (Newton, with bisection if it stalls), then read y there. */
function bezier([x1, y1, x2, y2]: [number, number, number, number], x: number): number {
  const at = (a: number, b: number, u: number) => 3 * a * u * (1 - u) ** 2 + 3 * b * u * u * (1 - u) + u ** 3;
  const slope = (a: number, b: number, u: number) => 3 * a * (1 - u) ** 2 + 6 * (b - a) * u * (1 - u) + 3 * (1 - b) * u * u;
  let u = x;
  for (let i = 0; i < 8; i++) {
    const d = slope(x1, x2, u);
    if (Math.abs(d) < 1e-6) break;
    const next = u - (at(x1, x2, u) - x) / d;
    if (next < 0 || next > 1) break;
    u = next;
  }
  if (Math.abs(at(x1, x2, u) - x) > 1e-4) {
    let lo = 0;
    let hi = 1;
    u = x;
    for (let i = 0; i < 30; i++) {
      if (at(x1, x2, u) < x) lo = u;
      else hi = u;
      u = (lo + hi) / 2;
    }
  }
  return at(y1, y2, u);
}

// ── The numbers ──────────────────────────────────────────────────────────

/** One burst's look. Sizes are screen px, so a burst is the same size at
 *  any zoom. */
export interface BurstSpec {
  /** A soft glow blooming out from the centre. */
  flare: boolean;
  /** A ring racing outward. */
  ring: boolean;
  /** Firework sparks thrown out and falling. */
  sparks: boolean;
  /** Thin rays of light turning slowly. */
  rays: boolean;
  /** How far out it reaches, px. */
  size: number;
  ms: number;
  /** Sparks. */
  count: number;
  /** The fan the sparks are thrown in, degrees, centred on straight up.
   *  360 is a full circle. */
  spread: number;
  /** Pull on the sparks, px/s². Negative floats them upward. */
  gravity: number;
  /** Spark radius, px. */
  particleSize: number;
  /** How the burst fades: 1 is even, higher stays bright longer then drops. */
  fade: number;
  /** Strength of the flare and of each spark's halo. 0 is none. */
  glow: number;
}

export interface Motion {
  /** Glide out to the whole tree. Skipped when the view is already there. */
  outMs: number;
  /** The pause on the whole tree, God alone lit. */
  holdMs: number;
  /** God to the person: the line lights and the camera follows. */
  climbMs: number;
  /** The zoom the climb lands at. */
  endZoom: number;
  outCurve: Curve;
  /** The camera during the climb. */
  cameraCurve: Curve;
  /** The line lighting during the climb. */
  lineCurve: Curve;
  /** Round God as the climb starts. */
  godBurst: BurstSpec;
  /** Round the person as the camera lands. */
  landBurst: BurstSpec;
  /** With the Grand entrance off, a tap still gets a landing burst, this
   *  much smaller (size and spark count). */
  plainBurstScale: number;
}

export const MOTION: Motion = {
  outMs: 525,
  holdMs: 225,
  climbMs: 2600,
  endZoom: 1,
  outCurve: [0.69, 0.03, 0.32, 1],
  cameraCurve: [0.65, 0.38, 0.44, 0.89],
  lineCurve: [0.61, 0.53, 0.53, 0.93],
  godBurst: {
    flare: true,
    ring: false,
    sparks: true,
    rays: false,
    size: 70,
    ms: 1200,
    count: 36,
    spread: 360,
    gravity: 0,
    particleSize: 2.9,
    fade: 5,
    glow: 2.5,
  },
  landBurst: {
    flare: true,
    ring: false,
    sparks: true,
    rays: false,
    size: 50,
    ms: 900,
    count: 9,
    spread: 360,
    gravity: 70,
    particleSize: 5,
    fade: 0.6,
    glow: 0.8,
  },
  plainBurstScale: 1,
};

// ── Bursts ───────────────────────────────────────────────────────────────

interface Spark {
  a: number;
  v: number;
  s: number;
}

export interface Burst {
  /** World point, so it rides along with the camera. */
  x: number;
  y: number;
  rgb: [number, number, number];
  spec: BurstSpec;
  t0: number;
  sparks: Spark[];
  rayPhase: number;
}

function rgbOf(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? [...h].map((c) => c + c).join('') : h;
  const n = parseInt(full, 16) || 0;
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** A burst at world point (x, y). `scale` shrinks size and spark count. */
export function makeBurst(x: number, y: number, colour: string, spec: BurstSpec, now: number, scale = 1): Burst {
  const s: BurstSpec = { ...spec, size: spec.size * scale, count: Math.round(spec.count * scale) };
  const fan = (Math.max(0, Math.min(360, s.spread)) * Math.PI) / 180;
  const sparks: Spark[] = [];
  for (let i = 0; i < s.count; i++) {
    sparks.push({
      a: -Math.PI / 2 + (Math.random() - 0.5) * fan,
      v: 0.45 + Math.random() * 0.55,
      s: 0.6 + Math.random() * 0.7,
    });
  }
  return { x, y, rgb: rgbOf(colour), spec: s, t0: now, sparks, rayPhase: Math.random() * Math.PI * 2 };
}

/**
 * Draw every live burst over the finished frame, in screen space, and return
 * the ones still going. Additive blending, so they light the tree beneath
 * rather than paint over it.
 */
export function drawBursts(
  ctx: CanvasRenderingContext2D,
  bursts: Burst[],
  view: View,
  W: number,
  H: number,
  DPR: number,
  now: number,
): Burst[] {
  if (!bursts.length) return bursts;
  const live: Burst[] = [];
  ctx.save();
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  ctx.globalCompositeOperation = 'lighter';
  for (const b of bursts) {
    const sp = b.spec;
    const p = (now - b.t0) / Math.max(1, sp.ms);
    if (p >= 1) continue;
    live.push(b);
    if (p < 0) continue;
    const c = toScreen(b.x, b.y, view, W, H);
    const [r, g, bl] = b.rgb;
    const col = (a: number) => `rgba(${r},${g},${bl},${Math.max(0, Math.min(1, a))})`;
    const life = (1 - p) ** sp.fade;
    const out = 1 - (1 - p) ** 3;

    if (sp.flare && sp.glow > 0) {
      const rad = Math.max(1, sp.size * (0.35 + 0.65 * out));
      const grad = ctx.createRadialGradient(c.x, c.y, 0, c.x, c.y, rad);
      grad.addColorStop(0, col(0.85 * sp.glow * life));
      grad.addColorStop(0.3, col(0.35 * sp.glow * life));
      grad.addColorStop(1, col(0));
      ctx.fillStyle = grad;
      ctx.fillRect(c.x - rad, c.y - rad, rad * 2, rad * 2);
      // A white-hot core that goes first.
      const core = (1 - p) ** 3 * sp.glow;
      if (core > 0.01) {
        const cr = sp.size * 0.22;
        const cg = ctx.createRadialGradient(c.x, c.y, 0, c.x, c.y, cr);
        cg.addColorStop(0, `rgba(255,250,235,${Math.min(1, core)})`);
        cg.addColorStop(1, 'rgba(255,250,235,0)');
        ctx.fillStyle = cg;
        ctx.fillRect(c.x - cr, c.y - cr, cr * 2, cr * 2);
      }
    }

    if (sp.rays) {
      const n = 12;
      for (let i = 0; i < n; i++) {
        const a = b.rayPhase + (i * Math.PI * 2) / n + p * 0.35;
        const len = sp.size * 1.5 * (0.4 + 0.6 * out) * (i % 2 ? 0.6 : 1);
        const w = sp.size * 0.05;
        const tx = c.x + Math.cos(a) * len;
        const ty = c.y + Math.sin(a) * len;
        const grad = ctx.createLinearGradient(c.x, c.y, tx, ty);
        grad.addColorStop(0, col(0.55 * life));
        grad.addColorStop(1, col(0));
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.moveTo(c.x + Math.cos(a + Math.PI / 2) * w, c.y + Math.sin(a + Math.PI / 2) * w);
        ctx.lineTo(tx, ty);
        ctx.lineTo(c.x + Math.cos(a - Math.PI / 2) * w, c.y + Math.sin(a - Math.PI / 2) * w);
        ctx.closePath();
        ctx.fill();
      }
    }

    if (sp.ring) {
      ctx.strokeStyle = col(0.9 * life);
      ctx.lineWidth = Math.max(0.5, 3.5 * (1 - p));
      ctx.beginPath();
      ctx.arc(c.x, c.y, Math.max(0.1, sp.size * 1.15 * out), 0, Math.PI * 2);
      ctx.stroke();
      // A fainter second ring a step behind.
      ctx.strokeStyle = col(0.45 * life);
      ctx.lineWidth = Math.max(0.4, 1.8 * (1 - p));
      ctx.beginPath();
      ctx.arc(c.x, c.y, Math.max(0.1, sp.size * 0.75 * out), 0, Math.PI * 2);
      ctx.stroke();
    }

    if (sp.sparks && b.sparks.length) {
      const tSec = (p * sp.ms) / 1000;
      const drop = 0.5 * sp.gravity * tSec * tSec;
      for (const s of b.sparks) {
        const d = sp.size * s.v * out;
        const x = c.x + Math.cos(s.a) * d;
        const y = c.y + Math.sin(s.a) * d + drop;
        const rad = Math.max(0.3, sp.particleSize * s.s * (1 - 0.5 * p));
        if (sp.glow > 0) {
          ctx.fillStyle = col(0.22 * sp.glow * life);
          ctx.beginPath();
          ctx.arc(x, y, rad * 3, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.fillStyle = col(life);
        ctx.beginPath();
        ctx.arc(x, y, rad, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }
  ctx.restore();
  return live;
}

// ── The sequence ─────────────────────────────────────────────────────────

export type Pt = { x: number; y: number };
export type Phase = 'out' | 'hold' | 'climb' | 'done';

export interface EntranceInit {
  /** Ids along the line, its start (God) first. */
  line: string[];
  /** Placed world points along the same line, start first. */
  pts: Pt[];
  /** Where the camera is now, and the whole-tree view. */
  from: View;
  fit: View;
  W: number;
  H: number;
  /** Where the person lands on screen. Null leaves the camera alone. */
  anchor: Pt | null;
  kEnd: number;
  /** The view is already the whole tree, so there is nothing to glide out of. */
  skipOut: boolean;
  /** Burst colours; null for no burst. */
  startColour: string | null;
  landColour: string | null;
  /** Overrides, for a line lit without the entrance (a tribe from its stone). */
  holdMs?: number;
  climbMs?: number;
  curve?: Curve;
  now: number;
}

export interface EntranceFrame {
  /** Where the camera should be, or null when it is not being driven. */
  view: View | null;
  /** How many of `line` are lit, from its start. */
  lit: number;
  /** Bursts that go off this frame. */
  bursts: Burst[];
  done: boolean;
}

/**
 * One tap's sequence, in phases: out → hold → climb → done. The climb cannot
 * start while the camera is still travelling out, which is what used to snap
 * it back. Timings are read from MOTION when it starts.
 */
export class Entrance {
  phase: Phase;
  private t0: number;
  /** False once a pan, pinch or wheel takes the camera. The line still
   *  finishes on schedule. */
  private cam: boolean;
  private readonly i: EntranceInit;
  private readonly outMs: number;
  private readonly holdMs: number;
  private readonly climbMs: number;
  private readonly outCurve: Curve;
  private readonly cameraCurve: Curve;
  private readonly lineCurve: Curve;

  constructor(init: EntranceInit) {
    this.i = init;
    this.cam = !!init.anchor && init.pts.length >= 2;
    this.outMs = MOTION.outMs;
    this.holdMs = init.holdMs ?? MOTION.holdMs;
    this.climbMs = init.climbMs ?? MOTION.climbMs;
    this.outCurve = MOTION.outCurve;
    this.cameraCurve = init.curve ?? MOTION.cameraCurve;
    this.lineCurve = init.curve ?? MOTION.lineCurve;
    this.phase = this.cam && !init.skipOut && this.outMs > 0 ? 'out' : 'hold';
    this.t0 = init.now;
  }

  /** Let go of the camera. */
  release(): void {
    this.cam = false;
  }

  step(now: number): EntranceFrame {
    const { line, pts } = this.i;
    const bursts: Burst[] = [];
    let view: View | null = null;

    if (this.phase === 'out') {
      const t = (now - this.t0) / this.outMs;
      if (t < 1) {
        if (this.cam) view = this.outView(ease(this.outCurve, t));
        return { view, lit: 1, bursts, done: false };
      }
      this.phase = 'hold';
      this.t0 += this.outMs;
    }

    if (this.phase === 'hold') {
      if (now - this.t0 < this.holdMs) {
        if (this.cam) view = this.i.fit;
        return { view, lit: 1, bursts, done: false };
      }
      this.phase = 'climb';
      this.t0 += this.holdMs;
      if (this.i.startColour && pts.length) {
        bursts.push(makeBurst(pts[0].x, pts[0].y, this.i.startColour, MOTION.godBurst, now));
      }
    }

    if (this.phase === 'climb') {
      const t = (now - this.t0) / Math.max(1, this.climbMs);
      if (t < 1) {
        const sl = ease(this.lineCurve, t);
        if (this.cam) view = this.followView(ease(this.cameraCurve, t));
        return { view, lit: 1 + Math.floor(sl * (line.length - 1)), bursts, done: false };
      }
      this.phase = 'done';
      if (this.cam) view = this.followView(1);
      if (this.i.landColour && pts.length) {
        const end = pts[pts.length - 1];
        bursts.push(makeBurst(end.x, end.y, this.i.landColour, MOTION.landBurst, now));
      }
    }

    return { view, lit: line.length, bursts, done: true };
  }

  /** Whatever the view was, eased onto the whole tree about the screen centre. */
  private outView(e: number): View {
    const { from, fit, W, H } = this.i;
    const a = { x: W / 2, y: H / 2 };
    const s = toWorld(a.x, a.y, from, W, H);
    const f = toWorld(a.x, a.y, fit, W, H);
    const k = Math.exp(Math.log(from.k) + (Math.log(fit.k) - Math.log(from.k)) * e);
    return viewFor(s.x + (f.x - s.x) * e, s.y + (f.y - s.y) * e, k, a.x, a.y, W, H);
  }

  /**
   * The camera riding the tip of the lighting line at progress `s` (0–1):
   * the whole tree at s = 0, closing in to kEnd, with the person at the
   * anchor at s = 1.
   */
  private followView(s: number): View {
    const { pts, fit, kEnd, W, H } = this.i;
    const anchor = this.i.anchor!;
    const last = pts.length - 1;
    const pos = s * last;
    const i = Math.min(Math.floor(pos), last - 1);
    const u = pos - i;
    const a = pts[i];
    const b = pts[i + 1];
    const tip = { x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u };
    const k = Math.exp(Math.log(fit.k) + (Math.log(kEnd) - Math.log(fit.k)) * s);
    // The tip starts where it sits in the whole-tree view and slides over to
    // the anchor as the zoom closes in.
    const o = toWorld(0, 0, fit, W, H);
    const sx = (tip.x - o.x) * fit.k;
    const sy = (tip.y - o.y) * fit.k;
    return viewFor(tip.x, tip.y, k, sx + (anchor.x - sx) * s, sy + (anchor.y - sy) * s, W, H);
  }
}

// ── Lights ───────────────────────────────────────────────────────────────
// People lighting one by one rather than all at once: the tree coming on
// when it opens, and a tribe coming on in order from its stone. A Wave moves every person from
// the light they have now to the light they should end on, each starting at
// their own moment across a spread. The renderer draws whatever light each
// person has (RenderState.light). Tuned in the motion lab, like MOTION.

/** Who goes first. */
export type Order = 'generation' | 'sequence' | 'random' | 'outward' | 'inward';

export const ORDER_NAMES: Record<Order, string> = {
  generation: 'by generation',
  sequence: 'one at a time',
  random: 'random',
  outward: 'outward from them',
  inward: 'inward to them',
};

export interface WaveSpec {
  /** First person starting to last person starting. */
  spreadMs: number;
  /** Each person's own fade. */
  fadeMs: number;
  order: Order;
  /** How the starts are spaced across the spread: linear is even, an
   *  ease-in holds back then rushes. */
  orderCurve: Curve;
  /** 0 keeps the order exact, 1 is fully scattered. */
  jitter: number;
  /** A burst of extra glow mid-fade. 0 is none. */
  flash: number;
  /** How hard a person flickers while their light changes. 0 is steady. */
  flicker: number;
  /** Flickers a second. */
  flickerHz: number;
}

export interface OpenSpec extends WaveSpec {
  /** How bright a person is before their turn. 0 is not there at all. */
  floor: number;
  /** The zoom the camera starts at, as a share of the whole-tree zoom; it
   *  settles to 1 as the tree lights. 1 holds still. */
  zoomFrom: number;
  cameraCurve: Curve;
  /** God's golden burst as the first light goes on. */
  godBurst: boolean;
}

export interface Lights {
  /** The tree coming on when it first opens. */
  open: OpenSpec;
  /** A tribe coming on from its stone, over the rest of the tree dimmed. */
  tribe: WaveSpec;
}

export const LIGHTS: Lights = {
  open: {
    spreadMs: 2000,
    fadeMs: 10,
    order: 'sequence',
    orderCurve: [0.25, 0.57, 0.75, 0.47],
    jitter: 0.18,
    flash: 0.45,
    flicker: 0,
    flickerHz: 12,
    floor: 0.02,
    zoomFrom: 0.9,
    cameraCurve: 'sine',
    godBurst: true,
  },
  tribe: {
    spreadMs: 1000,
    fadeMs: 30,
    order: 'sequence',
    orderCurve: [0.18, 0.07, 0.54, 0.97],
    jitter: 0.18,
    flash: 0.5,
    flicker: 0,
    flickerHz: 12,
  },
};

/**
 * Each id's place in the order, 0 first to 1 last. Generations count from
 * God; outward and inward measure from the focus person. An id that is not
 * a person (the crown lines) is placed as Jesus, where both lines end.
 */
export function rankBy(order: Order, ids: string[], model: TreeModel, focus: TreeRec | null): Map<string, number> {
  const out = new Map<string, number>();
  if (!ids.length) return out;
  const recOf = (id: string) => model.nodes.get(id) || model.rootById.get(id) || model.nodes.get(model.jesusId) || null;
  const f = focus && isPlaced(focus) ? focus : { x: 0, y: 0 };
  if (order === 'random') {
    for (const id of ids) out.set(id, Math.random());
    return out;
  }
  if (order === 'outward' || order === 'inward') {
    const d = new Map<string, number>();
    let max = 1;
    for (const id of ids) {
      const r = recOf(id);
      const v = r && isPlaced(r) ? Math.hypot(r.x - f.x, r.y - f.y) : 0;
      d.set(id, v);
      max = Math.max(max, v);
    }
    for (const id of ids) {
      const v = d.get(id)! / max;
      out.set(id, order === 'outward' ? v : 1 - v);
    }
    return out;
  }
  const gen = new Map<string, number>();
  let maxGen = 1;
  for (const id of ids) {
    const g = generationOf(model, recOf(id)?.id ?? id) ?? 0;
    gen.set(id, g);
    maxGen = Math.max(maxGen, g);
  }
  if (order === 'generation') {
    for (const id of ids) out.set(id, gen.get(id)! / maxGen);
    return out;
  }
  // One at a time: generation by generation, and left to right round the
  // tree within each.
  const angle = (id: string) => {
    const r = recOf(id);
    return r && isPlaced(r) ? Math.atan2(r.x, -r.y) : 0;
  };
  const sorted = [...ids].sort((a, b) => gen.get(a)! - gen.get(b)! || angle(a) - angle(b));
  sorted.forEach((id, i) => out.set(id, sorted.length > 1 ? i / (sorted.length - 1) : 0));
  return out;
}

interface WaveItem {
  from: number;
  to: number;
  at: number;
  spec: WaveSpec;
  phase: number;
}

export interface WaveInit {
  /** Everyone the renderer will ask about. */
  ids: string[];
  /** Each person's light now, and the light they end on (0 or 1). */
  from: (id: string) => number;
  to: (id: string) => number;
  /** For people coming on, and for people going out. Null is instant. */
  rise: WaveSpec | null;
  fall: WaveSpec | null;
  /** Each spec's order, over the people it moves. */
  rank: (spec: WaveSpec, ids: string[]) => Map<string, number>;
  now: number;
}

/** Every person moving from their light now to their end light. */
export class Wave {
  private readonly t0: number;
  private readonly items = new Map<string, WaveItem>();
  private readonly ends = new Map<string, number>();
  private readonly endAt: number;
  private readonly light = new Map<string, number>();

  constructor(init: WaveInit) {
    this.t0 = init.now;
    const rising: string[] = [];
    const falling: string[] = [];
    for (const id of init.ids) {
      const from = init.from(id);
      const to = init.to(id);
      this.ends.set(id, to);
      if (Math.abs(from - to) < 0.01) continue;
      const spec = to > from ? init.rise : init.fall;
      if (!spec) continue;
      (to > from ? rising : falling).push(id);
      this.items.set(id, { from, to, at: 0, spec, phase: Math.random() * Math.PI * 2 });
    }
    let endAt = 0;
    for (const [ids, spec] of [
      [rising, init.rise],
      [falling, init.fall],
    ] as const) {
      if (!spec || !ids.length) continue;
      const rank = init.rank(spec, ids);
      const j = Math.max(0, Math.min(1, spec.jitter));
      for (const id of ids) {
        const r = (rank.get(id) ?? 0) * (1 - j) + Math.random() * j;
        const it = this.items.get(id)!;
        it.at = spec.spreadMs * ease(spec.orderCurve, r);
        endAt = Math.max(endAt, it.at + spec.fadeMs);
      }
    }
    this.endAt = endAt;
  }

  done(now: number): boolean {
    return now - this.t0 >= this.endAt;
  }

  /** Everyone's light at `now`. The same map each call, refilled. */
  sample(now: number): Map<string, number> {
    const el = now - this.t0;
    for (const [id, end] of this.ends) {
      const it = this.items.get(id);
      if (!it) {
        this.light.set(id, end);
        continue;
      }
      const sp = it.spec;
      const t = sp.fadeMs > 0 ? (el - it.at) / sp.fadeMs : el >= it.at ? 1 : 0;
      if (t <= 0) {
        this.light.set(id, it.from);
        continue;
      }
      if (t >= 1) {
        this.light.set(id, it.to);
        continue;
      }
      const bump = Math.sin(Math.PI * t);
      let v = it.from + (it.to - it.from) * ease('sine', t) + sp.flash * bump;
      if (sp.flicker > 0) {
        // Two sines at odd ratios read as an uneven gutter, not a strobe.
        const a = (el / 1000) * sp.flickerHz * Math.PI * 2 + it.phase;
        const n = (Math.sin(a) + Math.sin(a * 1.73 + it.phase * 2)) / 4 + 0.5;
        v *= 1 - sp.flicker * n * bump;
      }
      this.light.set(id, Math.max(0, v));
    }
    return this.light;
  }
}
