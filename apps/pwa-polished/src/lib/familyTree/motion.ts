/**
 * The Grand Entrance: what happens when someone is tapped on the tree.
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
