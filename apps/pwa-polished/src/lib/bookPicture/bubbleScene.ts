/**
 * The Bubbles' drawing and touch code, shared by the book picture lab
 * (book-picture-lab.ts, "All books") and the app's Bubble view
 * (BubbleView.svelte), so the two stay alike.
 *
 * ZoomView is the pan and zoom: pinch, scroll, drag, double-tap and the
 * smooth zoom the buttons use, over any picture in world units. drawBubbles
 * paints the map (bubbles.ts) at one view; hitBubbles says what a tap landed
 * on. The clouds inside the bubbles are packed a few books at a time between
 * frames (queueBubbleClouds) on the circle mask bubbleCloudMask gives.
 *
 * Lit words ("glows") each have a color. A verse holding more than one lit
 * word gets its dot cut into slices, one per word. Each book shows one count
 * per lit word under its name, in that word's color, counting verses.
 */

import { bookTitle, shortBookName } from '../bibleData';
import { BUBBLE_ZOOM, chapterMix, verseShare, verseSpot, type BookBubble, type BubbleMap } from './bubbles';
import { cloudWordAt, packCloud, type Cloud, type CloudWord } from './cloud';
import { buildMask, type Mask } from './layout';

const TAU = Math.PI * 2;

// ─── Colors ────────────────────────────────────────────────────────────────

/** Blend `t` of `toward` into `hex` (both #rrggbb). */
export function mixHex(hex: string, toward: string, t: number): string {
  const a = parseInt(hex.slice(1, 7), 16), b = parseInt(toward.slice(1, 7), 16);
  const ch = (s: number) => {
    const x = (a >> s) & 255, y = (b >> s) & 255;
    return Math.round(x + (y - x) * t);
  };
  return `rgb(${ch(16)}, ${ch(8)}, ${ch(0)})`;
}

/** A steady number per name, so a cloud comes out the same each time. */
export function hashSeed(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

// ─── Pan and zoom ──────────────────────────────────────────────────────────

export interface ZoomHooks {
  /** The picture's size in its own units. */
  world(): { w: number; h: number };
  /** How far out and in, given the scale that fits the whole picture. */
  limits(fitK: number): [number, number];
  /** Draw at the current view. `settled` is false while a gesture or zoom is moving. */
  draw(settled: boolean): void;
  /** A tap (not a drag, not a double-tap), in CSS px from the canvas's top left. */
  tap(x: number, y: number): void;
}

export interface ZoomOptions {
  /** Space kept round the picture when it is fitted, CSS px. */
  pad?: number;
  /** How much of the picture must stay on screen, CSS px. */
  keep?: number;
}

/** Where the view is, as a world point in the middle and a zoom next to the fitted one. */
export interface ZoomSpot {
  cx: number;
  cy: number;
  zoom: number;
}

/**
 * The view over a picture: world units map to CSS px as css = world * k + t.
 * It owns the canvas's pointer and wheel input and asks for frames; the
 * owner draws.
 */
export class ZoomView {
  k = 1;
  tx = 0;
  ty = 0;
  cssW = 1;
  cssH = 1;
  dpr = 1;
  /** False until the view is first fitted. */
  viewSet = false;

  private raf = 0;
  private settleTimer = 0;
  private anim = 0;
  private pointers = new Map<number, { x: number; y: number }>();
  private pinch: { d: number; mx: number; my: number; k: number; tx: number; ty: number } | null = null;
  private press: { x: number; y: number; moved: boolean } | null = null;
  private lastTap = { t: 0, x: 0, y: 0 };
  private readonly unbind: Array<() => void> = [];
  private readonly pad: number;
  private readonly keep: number;

  constructor(readonly canvas: HTMLCanvasElement, private readonly hooks: ZoomHooks, opts: ZoomOptions = {}) {
    this.pad = opts.pad ?? 16;
    this.keep = opts.keep ?? 60;
    canvas.style.touchAction = 'none';
    const on = (type: string, fn: (e: any) => void, o?: AddEventListenerOptions) => {
      canvas.addEventListener(type, fn, o);
      this.unbind.push(() => canvas.removeEventListener(type, fn, o));
    };
    on('pointerdown', (e: PointerEvent) => this.down(e));
    on('pointermove', (e: PointerEvent) => this.move(e));
    on('pointerup', (e: PointerEvent) => this.up(e));
    on('pointercancel', (e: PointerEvent) => this.up(e));
    on('wheel', (e: WheelEvent) => this.wheel(e), { passive: false });
  }

  destroy(): void {
    for (const off of this.unbind) off();
    cancelAnimationFrame(this.raf);
    cancelAnimationFrame(this.anim);
    clearTimeout(this.settleTimer);
  }

  fitK(): number {
    const { w, h } = this.hooks.world();
    return Math.max(1e-4, Math.min((this.cssW - this.pad * 2) / w, (this.cssH - this.pad * 2) / h));
  }

  limits(): [number, number] {
    return this.hooks.limits(this.fitK());
  }

  /** The whole picture, centered. */
  fitView(): void {
    const { w, h } = this.hooks.world();
    this.k = this.fitK();
    this.tx = (this.cssW - w * this.k) / 2;
    this.ty = (this.cssH - h * this.k) / 2;
    this.viewSet = true;
  }

  /** Inside the zoom limits, with some of the picture on screen. */
  clampView(): void {
    const { w, h } = this.hooks.world();
    const [kMin, kMax] = this.limits();
    this.k = Math.min(kMax, Math.max(kMin, this.k));
    this.tx = Math.min(this.cssW - this.keep, Math.max(this.keep - w * this.k, this.tx));
    this.ty = Math.min(this.cssH - this.keep, Math.max(this.keep - h * this.k, this.ty));
  }

  zoomAt(cx: number, cy: number, factor: number): void {
    const [kMin, kMax] = this.limits();
    const nk = Math.min(kMax, Math.max(kMin, this.k * factor));
    this.tx = cx - (cx - this.tx) * (nk / this.k);
    this.ty = cy - (cy - this.ty) * (nk / this.k);
    this.k = nk;
    this.clampView();
  }

  /** The canvas's new size in CSS px; the same point stays in the middle. */
  resize(w: number, h: number): void {
    const cx = (this.cssW / 2 - this.tx) / this.k, cy = (this.cssH / 2 - this.ty) / this.k;
    this.cssW = Math.max(1, w);
    this.cssH = Math.max(1, h);
    this.dpr = Math.min(3, window.devicePixelRatio || 1);
    this.canvas.width = Math.round(this.cssW * this.dpr);
    this.canvas.height = Math.round(this.cssH * this.dpr);
    if (!this.viewSet) this.fitView();
    else {
      this.tx = this.cssW / 2 - cx * this.k;
      this.ty = this.cssH / 2 - cy * this.k;
      this.clampView();
    }
    this.hooks.draw(true);
  }

  /** A frame soon, and a settled one once things go quiet. */
  requestFrame(): void {
    if (!this.raf) {
      this.raf = requestAnimationFrame(() => {
        this.raf = 0;
        this.hooks.draw(false);
      });
    }
    clearTimeout(this.settleTimer);
    this.settleTimer = window.setTimeout(() => this.hooks.draw(true), 160);
  }

  stopAnimation(): void {
    cancelAnimationFrame(this.anim);
  }

  /**
   * Glide to a new view. The zoom moves in log space so it feels even, and
   * the middle of the screen moves in a straight line.
   */
  animateTo(nk: number, ntx: number, nty: number, dur = 240): void {
    cancelAnimationFrame(this.anim);
    const k0 = this.k, tx0 = this.tx, ty0 = this.ty;
    const t0 = performance.now();
    const step = (now: number) => {
      const t = Math.min(1, (now - t0) / dur);
      const e = 1 - Math.pow(1 - t, 3);
      this.k = k0 * Math.pow(nk / k0, e);
      const c0x = (this.cssW / 2 - tx0) / k0, c1x = (this.cssW / 2 - ntx) / nk;
      const c0y = (this.cssH / 2 - ty0) / k0, c1y = (this.cssH / 2 - nty) / nk;
      this.tx = this.cssW / 2 - (c0x + (c1x - c0x) * e) * this.k;
      this.ty = this.cssH / 2 - (c0y + (c1y - c0y) * e) * this.k;
      if (t < 1) {
        this.requestFrame();
        this.anim = requestAnimationFrame(step);
      } else {
        this.k = nk;
        this.tx = ntx;
        this.ty = nty;
        this.clampView();
        clearTimeout(this.settleTimer);
        this.hooks.draw(true);
      }
    };
    this.anim = requestAnimationFrame(step);
  }

  animateZoomAt(cx: number, cy: number, factor: number): void {
    const [kMin, kMax] = this.limits();
    const nk = Math.min(kMax, Math.max(kMin, this.k * factor));
    this.animateTo(nk, cx - (cx - this.tx) * (nk / this.k), cy - (cy - this.ty) * (nk / this.k));
  }

  /** Glide so world point (x, y) is in the middle at scale `nk` (kept inside the limits). */
  animateCenter(x: number, y: number, nk: number): void {
    const [kMin, kMax] = this.limits();
    const k = Math.min(kMax, Math.max(kMin, nk));
    this.animateTo(k, this.cssW / 2 - x * k, this.cssH / 2 - y * k);
  }

  /** Glide back to the whole picture. */
  animateFit(): void {
    const { w, h } = this.hooks.world();
    const nk = this.fitK();
    this.animateTo(nk, (this.cssW - w * nk) / 2, (this.cssH - h * nk) / 2);
  }

  spot(): ZoomSpot {
    return {
      cx: (this.cssW / 2 - this.tx) / this.k,
      cy: (this.cssH / 2 - this.ty) / this.k,
      zoom: this.k / this.fitK(),
    };
  }

  /** Back to a spot taken earlier, at once. */
  goTo(s: ZoomSpot): void {
    this.k = s.zoom * this.fitK();
    this.tx = this.cssW / 2 - s.cx * this.k;
    this.ty = this.cssH / 2 - s.cy * this.k;
    this.viewSet = true;
    this.clampView();
  }

  private local(e: PointerEvent | WheelEvent): { x: number; y: number } {
    const r = this.canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  private startPinch(): void {
    const [a, b] = [...this.pointers.values()];
    this.pinch = {
      d: Math.max(1, Math.hypot(b.x - a.x, b.y - a.y)),
      mx: (a.x + b.x) / 2,
      my: (a.y + b.y) / 2,
      k: this.k,
      tx: this.tx,
      ty: this.ty,
    };
  }

  private down(e: PointerEvent): void {
    cancelAnimationFrame(this.anim);
    try {
      this.canvas.setPointerCapture(e.pointerId);
    } catch {
      // A pointer the browser has already let go of.
    }
    const p = this.local(e);
    this.pointers.set(e.pointerId, p);
    if (this.pointers.size === 1) this.press = { x: p.x, y: p.y, moved: false };
    else {
      this.press = null;
      if (this.pointers.size === 2) this.startPinch();
    }
  }

  private move(e: PointerEvent): void {
    const prev = this.pointers.get(e.pointerId);
    if (!prev) return;
    const p = this.local(e);
    this.pointers.set(e.pointerId, p);
    if (this.pointers.size === 1) {
      if (this.press && Math.hypot(p.x - this.press.x, p.y - this.press.y) > 6) this.press.moved = true;
      if (this.press && !this.press.moved) return;
      this.tx += p.x - prev.x;
      this.ty += p.y - prev.y;
      this.clampView();
      this.requestFrame();
    } else if (this.pointers.size === 2 && this.pinch) {
      const [a, b] = [...this.pointers.values()];
      const d = Math.max(1, Math.hypot(b.x - a.x, b.y - a.y));
      const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
      const [kMin, kMax] = this.limits();
      const nk = Math.min(kMax, Math.max(kMin, this.pinch.k * (d / this.pinch.d)));
      // The world point that was under the starting midpoint stays under the fingers.
      const wx = (this.pinch.mx - this.pinch.tx) / this.pinch.k, wy = (this.pinch.my - this.pinch.ty) / this.pinch.k;
      this.k = nk;
      this.tx = mx - wx * nk;
      this.ty = my - wy * nk;
      this.clampView();
      this.requestFrame();
    }
  }

  private up(e: PointerEvent): void {
    if (!this.pointers.has(e.pointerId)) return;
    this.pointers.delete(e.pointerId);
    if (this.pointers.size === 1) {
      this.pinch = null;
      this.press = null;
    } else if (this.pointers.size === 0) {
      this.pinch = null;
      if (this.press && !this.press.moved && e.type === 'pointerup') {
        const p = this.local(e);
        const now = performance.now();
        if (now - this.lastTap.t < 320 && Math.hypot(p.x - this.lastTap.x, p.y - this.lastTap.y) < 30) {
          this.animateZoomAt(p.x, p.y, 3);
          this.lastTap = { t: 0, x: 0, y: 0 };
        } else {
          this.lastTap = { t: now, x: p.x, y: p.y };
          this.hooks.tap(p.x, p.y);
        }
      }
      this.press = null;
    }
  }

  private wheel(e: WheelEvent): void {
    e.preventDefault();
    cancelAnimationFrame(this.anim);
    const p = this.local(e);
    const dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
    this.zoomAt(p.x, p.y, Math.exp(-dy * (e.ctrlKey ? 0.01 : 0.0018)));
    this.requestFrame();
  }
}

// ─── What the drawing needs ────────────────────────────────────────────────

/** A book's verses: chapter * 1000 + verse each, and where each sits. */
export interface BubbleVerseIndex {
  verseRef: Int32Array;
  verseChapter: Int32Array;
  verseInChapter: Int32Array;
  chapters: ReadonlyArray<{ first: number }>;
}

/** One lit word. */
export interface BubbleGlow {
  /** Its dots and counts; null uses each book's own color (the lab's one word). */
  color: string | null;
  /** The color on the cream ground; `color` darkened when left out. */
  deep?: string;
  /** Book → the verses holding the word, as indexes into that book's verses, in order. */
  perBook: Map<string, Int32Array>;
}

export interface BubbleLook {
  ground: { bg: string; neutral: string; light: boolean };
  family: string;
  weight: number;
  colorOf: (book: string) => string;
  /** An outline for text in this book color on the dark ground, or '' for none. */
  ringOf?: (color: string) => string;
  verses: (book: string) => BubbleVerseIndex;
  /** Each book's cloud, shown zoomed out; null hides them. */
  clouds: Map<string, Cloud> | null;
  glows: readonly BubbleGlow[];
  /** The book you were reading, ringed so it can be found zoomed out. */
  here?: string | null;
}

/** A book's lit verses, every lit word together: which words light each one. */
interface LitBook {
  verses: Int32Array;
  /** Per lit verse: a bit per glow. */
  masks: Uint8Array;
  /** Per glow: its verses in this book. */
  counts: number[];
}

const litCache = new WeakMap<readonly BubbleGlow[], Map<string, LitBook>>();

function litIndex(glows: readonly BubbleGlow[]): Map<string, LitBook> {
  let out = litCache.get(glows);
  if (out) return out;
  out = new Map();
  const books = new Set<string>();
  for (const g of glows) for (const b of g.perBook.keys()) books.add(b);
  for (const book of books) {
    const masks = new Map<number, number>();
    const counts = glows.map((g, gi) => {
      const hits = g.perBook.get(book);
      if (!hits) return 0;
      for (const v of hits) masks.set(v, (masks.get(v) ?? 0) | (1 << gi));
      return hits.length;
    });
    const verses = Int32Array.from(masks.keys()).sort();
    out.set(book, { verses, masks: Uint8Array.from(verses, (v) => masks.get(v)!), counts });
  }
  litCache.set(glows, out);
  return out;
}

/** The glow's dot color and halo color on this ground, for a dot in `book`'s color when it has none. */
function glowInks(g: BubbleGlow, bookColor: string, light: boolean): { core: string; halo: string; text: string } {
  const base = g.color ?? bookColor;
  if (light) {
    const deep = g.deep ?? mixHex(base, '#000000', 0.2);
    return { core: deep, halo: base, text: deep };
  }
  return g.color
    ? { core: base, halo: base, text: base }
    : { core: mixHex(base, '#ffffff', 0.6), halo: base, text: mixHex(base, '#ffffff', 0.55) };
}

// ─── Clouds inside the bubbles ─────────────────────────────────────────────

/** A bubble's cloud is packed in a circle in a box this wide, then scaled onto the bubble. */
export const BUBBLE_BOX = 200;
export const BUBBLE_CLOUD_WORDS = 40;

let bubbleMask: Mask | null = null;

/** A bubble's cloud shape: its circle with the top cut off, where the book's name sits. */
export function bubbleCloudMask(): Mask {
  return (bubbleMask ??= buildMask(BUBBLE_BOX, BUBBLE_BOX, 2, (c) => {
    const h = BUBBLE_BOX / 2;
    c.save();
    c.beginPath();
    c.rect(0, h * 0.26, BUBBLE_BOX, BUBBLE_BOX);
    c.clip();
    c.beginPath();
    c.arc(h, h, h * 0.96, 0, TAU);
    c.fill();
    c.restore();
  }));
}

/**
 * Pack each book's cloud into `into`, a few books per frame so nothing
 * stalls, calling `step` after each batch. Returns a call that stops it.
 */
export function queueBubbleClouds(
  books: readonly string[],
  wordsOf: (book: string) => readonly CloudWord[],
  font: { family: string; weight: number },
  into: Map<string, Cloud>,
  step: () => void,
): () => void {
  const queue = books.filter((b) => !into.has(b));
  let stopped = false;
  let timer = 0;
  if (!queue.length) return () => {};
  void document.fonts
    .load(`${font.weight} 16px ${font.family}`, 'The LORD')
    .catch(() => undefined)
    .then(() => {
      const run = () => {
        if (stopped) return;
        const t0 = performance.now();
        while (queue.length && performance.now() - t0 < 14) {
          const name = queue.shift()!;
          into.set(
            name,
            packCloud(wordsOf(name), bubbleCloudMask(), {
              family: font.family,
              weight: font.weight,
              maxWords: BUBBLE_CLOUD_WORDS,
              fill: 0.5,
              seed: hashSeed(name),
            }),
          );
        }
        step();
        if (queue.length) timer = window.setTimeout(run, 0);
      };
      run();
    });
  return () => {
    stopped = true;
    clearTimeout(timer);
  };
}

// ─── Drawing ───────────────────────────────────────────────────────────────

/**
 * Paint the map onto `c` (W × H device px). World units map to device px as
 * device = (world * k + t) * ratio.
 */
export function drawBubbles(
  c: CanvasRenderingContext2D,
  map: BubbleMap,
  look: BubbleLook,
  W: number,
  H: number,
  k: number,
  tx: number,
  ty: number,
  ratio: number,
): void {
  const { ground } = look;
  const K = k * ratio, X = tx * ratio, Y = ty * ratio;
  const lit = look.glows.length ? litIndex(look.glows) : null;
  const showClouds = !!look.clouds && !lit;
  c.setTransform(1, 0, 0, 1, 0, 0);
  c.globalAlpha = 1;
  c.globalCompositeOperation = 'source-over';
  c.fillStyle = ground.bg;
  c.fillRect(0, 0, W, H);
  for (const b of map.books) {
    const sx = X + b.x * K, sy = Y + b.y * K, sr = b.r * K;
    if (sx + sr < -12 * ratio || sx - sr > W + 12 * ratio || sy + sr < -12 * ratio || sy - sr > H + 12 * ratio) continue;
    const color = look.colorOf(b.book);
    const hits = lit?.get(b.book) ?? null;
    const dim = lit && !hits ? 0.25 : 1;
    const tc = chapterMix(b, k);

    c.beginPath();
    c.arc(sx, sy, sr, 0, TAU);
    c.globalAlpha = dim * (ground.light ? 0.18 : 0.14) * (1 - tc * 0.5);
    c.fillStyle = color;
    c.fill();
    c.globalAlpha = dim * 0.75;
    c.strokeStyle = color;
    c.lineWidth = Math.max(1, ratio * 1.2);
    c.stroke();

    if (look.here === b.book) drawHere(c, sx, sy, sr, ratio, ground);

    if (tc > 0.01) drawChapters(c, b, look, K, X, Y, W, H, ratio, dim * tc, color, !!lit);

    const cloud = showClouds ? look.clouds!.get(b.book) : undefined;
    const cloudAlpha = cloud ? dim * (1 - tc) : 0;
    if (cloud && cloudAlpha > 0.01) drawBubbleCloud(c, b, cloud, look, K, X, Y, cloudAlpha, color);

    if (hits) drawLitDots(c, b, look, hits, K, X, Y, W, H, ratio, color);

    drawBubbleName(c, b, look, sx, sy, sr, ratio, dim, showClouds && !!cloud ? 0 : 1 - tc, hits, color);
  }
  c.globalAlpha = 1;
  c.textAlign = 'left';
  c.textBaseline = 'alphabetic';
}

/** You are here: a soft ring just outside the book's circle. */
function drawHere(
  c: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  sr: number,
  ratio: number,
  ground: BubbleLook['ground'],
): void {
  const ink = ground.light ? '#000000' : '#ffffff';
  c.save();
  c.strokeStyle = ink;
  c.beginPath();
  c.arc(sx, sy, sr + 6 * ratio, 0, TAU);
  c.globalAlpha = 0.12;
  c.lineWidth = 9 * ratio;
  c.stroke();
  c.beginPath();
  c.arc(sx, sy, sr + 4 * ratio, 0, TAU);
  c.globalAlpha = 0.55;
  c.lineWidth = 1.5 * ratio;
  c.stroke();
  c.restore();
}

/** Text in a book's color, with its outline on the dark ground when it needs one. */
function bookText(c: CanvasRenderingContext2D, look: BubbleLook, color: string, text: string, x: number, y: number, fs: number): void {
  const ring = !look.ground.light && look.ringOf ? look.ringOf(color) : '';
  if (ring) {
    c.strokeStyle = ring;
    c.lineWidth = Math.max(0.8, fs * 0.05);
    c.lineJoin = 'round';
    c.strokeText(text, x, y);
  }
  c.fillStyle = color;
  c.fillText(text, x, y);
}

function drawChapters(
  c: CanvasRenderingContext2D,
  b: BookBubble,
  look: BubbleLook,
  K: number,
  X: number,
  Y: number,
  W: number,
  H: number,
  ratio: number,
  alpha: number,
  color: string,
  glowing: boolean,
): void {
  const { ground, family } = look;
  const ix = look.verses(b.book);
  c.textAlign = 'center';
  b.chapters.forEach((ch, ci) => {
    const cx = X + ch.x * K, cy = Y + ch.y * K, cr = ch.r * K;
    if (cx + cr < 0 || cx - cr > W || cy + cr < 0 || cy - cr > H) return;
    c.beginPath();
    c.arc(cx, cy, cr, 0, TAU);
    c.globalAlpha = alpha * 0.08;
    c.fillStyle = color;
    c.fill();
    c.globalAlpha = alpha * 0.55;
    c.strokeStyle = color;
    c.lineWidth = Math.max(0.75, ratio * 0.9);
    c.stroke();
    const share = verseShare(ch, ch.verses) * K;
    if (share / ratio >= BUBBLE_ZOOM.verseDots) {
      // Close enough to see the verses: numbers when there's room, dots when not.
      const numbers = share / ratio >= BUBBLE_ZOOM.verseNumbers;
      c.fillStyle = ground.neutral;
      c.globalAlpha = alpha * (glowing ? 0.3 : 0.5);
      c.textBaseline = 'middle';
      if (numbers) c.font = `${Math.min(share * 0.7, BUBBLE_ZOOM.verseNumberMax * ratio)}px ${family}`;
      const first = ix.chapters[ci]?.first ?? 0;
      for (let v = 0; v < ch.verses; v++) {
        const p = verseSpot(ch, v, ch.verses);
        const px = X + p.x * K, py = Y + p.y * K;
        if (px < -20 || px > W + 20 || py < -20 || py > H + 20) continue;
        if (numbers) c.fillText(String(ix.verseRef[first + v] % 1000), px, py);
        else c.fillRect(px - ratio, py - ratio, 2 * ratio, 2 * ratio);
      }
      // The chapter's name in the ring the verses leave free at the edge.
      const fs = Math.min(cr * 0.06, 14 * ratio);
      if (fs / ratio >= 7) {
        c.globalAlpha = alpha;
        c.font = `600 ${fs}px ${family}`;
        bookText(c, look, color, `${bookTitle(b.book)} ${ch.chapter}`, cx, cy - cr * 0.955, fs);
      }
      c.textBaseline = 'alphabetic';
    } else if (cr / ratio >= 9) {
      c.globalAlpha = alpha * (glowing ? 0.45 : 0.8);
      c.fillStyle = ground.neutral;
      c.font = `${Math.min(cr * 0.6, 26 * ratio)}px ${family}`;
      c.textBaseline = 'middle';
      c.fillText(String(ch.chapter), cx, cy);
      c.textBaseline = 'alphabetic';
    }
  });
  c.globalAlpha = 1;
}

function drawBubbleCloud(
  c: CanvasRenderingContext2D,
  b: BookBubble,
  cloud: Cloud,
  look: BubbleLook,
  K: number,
  X: number,
  Y: number,
  alpha: number,
  color: string,
): void {
  const s = (b.r / (BUBBLE_BOX / 2)) * K;
  const ox = X + (b.x - b.r) * K, oy = Y + (b.y - b.r) * K;
  const ink = look.ground.light ? mixHex(color, '#000000', 0.35) : mixHex(color, '#ffffff', 0.35);
  const n = cloud.placed.length;
  c.textAlign = 'left';
  c.textBaseline = 'alphabetic';
  c.fillStyle = ink;
  for (let i = 0; i < n; i++) {
    const p = cloud.placed[i];
    const fpx = p.f * s;
    if (fpx < 2.2) continue;
    c.globalAlpha = alpha * (1 - (0.4 * i) / Math.max(1, n - 1));
    c.font = `${look.weight} ${fpx.toFixed(1)}px ${look.family}`;
    c.fillText(p.text, ox + p.x * s, oy + p.y * s);
  }
  c.globalAlpha = 1;
}

/** A dot cut into one slice per lit word (a whole dot for one). */
function slices(c: CanvasRenderingContext2D, x: number, y: number, r: number, colors: string[]): void {
  const n = colors.length;
  if (n === 1) {
    c.fillStyle = colors[0];
    c.beginPath();
    c.arc(x, y, r, 0, TAU);
    c.fill();
    return;
  }
  for (let i = 0; i < n; i++) {
    const a0 = -Math.PI / 2 + (i * TAU) / n;
    c.fillStyle = colors[i];
    c.beginPath();
    c.moveTo(x, y);
    c.arc(x, y, r, a0, a0 + TAU / n);
    c.closePath();
    c.fill();
  }
}

function drawLitDots(
  c: CanvasRenderingContext2D,
  b: BookBubble,
  look: BubbleLook,
  lit: LitBook,
  K: number,
  X: number,
  Y: number,
  W: number,
  H: number,
  ratio: number,
  color: string,
): void {
  const ix = look.verses(b.book);
  const inks = look.glows.map((g) => glowInks(g, color, look.ground.light));
  c.save();
  if (!look.ground.light) c.globalCompositeOperation = 'lighter';
  const cores: string[] = [], halos: string[] = [];
  for (let h = 0; h < lit.verses.length; h++) {
    const v = lit.verses[h];
    const ch = b.chapters[ix.verseChapter[v]];
    if (!ch) continue;
    const p = verseSpot(ch, ix.verseInChapter[v], ch.verses);
    const px = X + p.x * K, py = Y + p.y * K;
    if (px < -24 || px > W + 24 || py < -24 || py > H + 24) continue;
    cores.length = halos.length = 0;
    const m = lit.masks[h];
    for (let g = 0; g < inks.length; g++) {
      if (m & (1 << g)) {
        cores.push(inks[g].core);
        halos.push(inks[g].halo);
      }
    }
    const share = verseShare(ch, ch.verses) * K;
    if (share / ratio >= BUBBLE_ZOOM.verseNumbers) {
      // Verse numbers are showing: ring the number rather than cover it.
      const rr = Math.min(share * 0.62, (BUBBLE_ZOOM.verseNumberMax + 3) * ratio);
      c.globalAlpha = 0.28;
      slices(c, px, py, rr, halos);
      c.globalAlpha = 1;
      c.lineWidth = 1.6 * ratio;
      const n = cores.length;
      for (let i = 0; i < n; i++) {
        const a0 = -Math.PI / 2 + (i * TAU) / n;
        c.strokeStyle = cores[i];
        c.beginPath();
        c.arc(px, py, rr, a0, a0 + TAU / n);
        c.stroke();
      }
      continue;
    }
    const rr = Math.min(7 * ratio, Math.max(1.3 * ratio, share * 0.5)) * (cores.length > 1 ? 1.25 : 1);
    c.globalAlpha = 0.35;
    slices(c, px, py, rr * 2.2, halos);
    c.globalAlpha = 1;
    slices(c, px, py, rr, cores);
  }
  c.restore();
}

/** A row of differently colored pieces, centered on x. */
function drawRow(
  c: CanvasRenderingContext2D,
  parts: Array<{ text: string; color: string }>,
  x: number,
  y: number,
  outline: { color: string; width: number } | null,
): void {
  const gap = c.measureText(' ').width;
  const widths = parts.map((p) => c.measureText(p.text).width);
  const total = widths.reduce((a, b) => a + b, 0) + gap * Math.max(0, parts.length - 1);
  let at = x - total / 2;
  c.textAlign = 'left';
  parts.forEach((p, i) => {
    if (outline) {
      c.lineJoin = 'round';
      c.lineWidth = outline.width;
      c.strokeStyle = outline.color;
      c.strokeText(p.text, at, y);
    }
    c.fillStyle = p.color;
    c.fillText(p.text, at, y);
    at += widths[i] + gap;
  });
  c.textAlign = 'center';
}

/**
 * The book's name: big in the middle of a plain bubble, or small in the band
 * at the top once a cloud or the chapters fill it. `center` blends the two.
 * Under it, one count per lit word in that word's color.
 */
function drawBubbleName(
  c: CanvasRenderingContext2D,
  b: BookBubble,
  look: BubbleLook,
  sx: number,
  sy: number,
  sr: number,
  ratio: number,
  dim: number,
  center: number,
  lit: LitBook | null,
  color: string,
): void {
  const { ground, family } = look;
  const name = shortBookName(b.book);
  const counts = lit
    ? lit.counts
        .map((n, g) => ({ n, g }))
        .filter((x) => x.n > 0)
        .map(({ n, g }) => ({ text: n.toLocaleString(), color: glowInks(look.glows[g], color, ground.light).text }))
    : [];
  c.textAlign = 'center';
  c.textBaseline = 'alphabetic';
  if (center > 0.01) {
    c.font = `600 100px ${family}`;
    const wd = c.measureText(name).width / 100;
    const fs = Math.min(sr * 0.36, (sr * 1.55) / Math.max(0.1, wd));
    if (fs / ratio >= 6) {
      c.globalAlpha = dim * center * 0.9;
      c.fillStyle = ground.neutral;
      c.font = `600 ${fs}px ${family}`;
      c.fillText(name, sx, counts.length ? sy - fs * 0.05 : sy + fs * 0.33);
      if (counts.length) {
        // Smaller when several have to share the line.
        let cf = fs * 0.8;
        c.font = `600 ${cf}px ${family}`;
        const width = counts.reduce((a, p) => a + c.measureText(p.text).width, 0) + c.measureText(' ').width * (counts.length - 1);
        if (width > sr * 1.6) {
          cf *= (sr * 1.6) / width;
          c.font = `600 ${cf}px ${family}`;
        }
        drawRow(c, counts, sx, sy + fs * 0.85, null);
      }
    }
  }
  const top = 1 - center;
  if (top > 0.01) {
    const fs = Math.min(sr * 0.15, 30 * ratio);
    if (fs / ratio >= 5.5) {
      const y = sy - sr * 0.78;
      c.font = `600 ${fs}px ${family}`;
      c.globalAlpha = dim * top;
      const parts = [{ text: name, color: ground.neutral }];
      if (counts.length) parts.push({ text: '·', color: ground.neutral }, ...counts);
      drawRow(c, parts, sx, y, { color: ground.bg, width: Math.max(2 * ratio, fs * 0.28) });
    }
  }
  c.globalAlpha = 1;
}

// ─── Taps ──────────────────────────────────────────────────────────────────

export type BubbleHit =
  /** A verse: a lit dot, or one picked out of a chapter showing its verses. */
  | { kind: 'verse'; book: string; v: number }
  /** A word in a bubble's cloud: `word` indexes the book's cloud words. */
  | { kind: 'cloud'; book: string; word: number }
  | { kind: 'chapter'; book: string; ci: number }
  | { kind: 'book'; book: string };

/**
 * What a tap at CSS (cx, cy) lands on: a lit dot first, then a cloud word,
 * then a verse, a chapter, and last a book. Null for empty space.
 */
export function hitBubbles(
  map: BubbleMap,
  look: BubbleLook,
  k: number,
  tx: number,
  ty: number,
  cx: number,
  cy: number,
): BubbleHit | null {
  const wx = (cx - tx) / k, wy = (cy - ty) / k;
  const lit = look.glows.length ? litIndex(look.glows) : null;
  if (lit) {
    let best: { book: string; v: number } | null = null;
    let bd = 14;
    for (const b of map.books) {
      const hits = lit.get(b.book);
      if (!hits || Math.hypot(wx - b.x, wy - b.y) > b.r + 14 / k) continue;
      const ix = look.verses(b.book);
      for (const v of hits.verses) {
        const ch = b.chapters[ix.verseChapter[v]];
        if (!ch) continue;
        const p = verseSpot(ch, ix.verseInChapter[v], ch.verses);
        const d = Math.hypot(p.x * k + tx - cx, p.y * k + ty - cy);
        if (d < bd) {
          bd = d;
          best = { book: b.book, v };
        }
      }
    }
    if (best) return { kind: 'verse', ...best };
  }
  const b = map.books.find((x) => (wx - x.x) ** 2 + (wy - x.y) ** 2 <= x.r * x.r);
  if (!b) return null;
  const tc = chapterMix(b, k);
  if (look.clouds && !lit && tc < 0.5) {
    const cloud = look.clouds.get(b.book);
    if (cloud) {
      const s = b.r / (BUBBLE_BOX / 2);
      const i = cloudWordAt(cloud, (wx - (b.x - b.r)) / s, (wy - (b.y - b.r)) / s, 6 / (k * s));
      if (i >= 0) return { kind: 'cloud', book: b.book, word: cloud.placed[i].word };
    }
  }
  if (tc >= 0.5) {
    const ci = b.chapters.findIndex((ch) => (wx - ch.x) ** 2 + (wy - ch.y) ** 2 <= ch.r * ch.r);
    if (ci >= 0) {
      const ch = b.chapters[ci];
      if (verseShare(ch, ch.verses) * k >= BUBBLE_ZOOM.verseDots) {
        let bv = 0, bd = Infinity;
        for (let v = 0; v < ch.verses; v++) {
          const p = verseSpot(ch, v, ch.verses);
          const d = (p.x - wx) ** 2 + (p.y - wy) ** 2;
          if (d < bd) {
            bd = d;
            bv = v;
          }
        }
        return { kind: 'verse', book: b.book, v: (look.verses(b.book).chapters[ci]?.first ?? 0) + bv };
      }
      return { kind: 'chapter', book: b.book, ci };
    }
  }
  return { kind: 'book', book: b.book };
}

/** The scale that shows a whole book split into its chapters, or filling the screen if that is bigger. */
export function bookZoomK(b: BookBubble, cssW: number, cssH: number): number {
  return Math.max((Math.min(cssW, cssH) * 0.45) / b.r, (BUBBLE_ZOOM.chaptersTo * 1.05) / b.r);
}

/** The scale that shows a chapter with its verse numbers. */
export function chapterZoomK(ch: BookBubble['chapters'][number], cssW: number, cssH: number): number {
  return Math.max((Math.min(cssW, cssH) * 0.42) / ch.r, (BUBBLE_ZOOM.verseNumbers * 1.15) / verseShare(ch, ch.verses));
}
