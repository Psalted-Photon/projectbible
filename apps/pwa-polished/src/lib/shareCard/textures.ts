/**
 * Textures laid over any background.
 *
 * Every one is made here from noise and shapes, never loaded as an image file,
 * so they cost no download and no licence. Each is drawn once per card size
 * into its own layer and then reused: a drag redraws the card every frame, and
 * rebuilding a marble or a halftone that often would stutter.
 *
 * The randomness is seeded, so a texture looks the same on every card and does
 * not shimmer between redraws. Soft-light and screen blending let one layer
 * work on a white card and a black one alike.
 */

export type TextureId =
  | 'grain' | 'paper' | 'parchment' | 'linen' | 'watercolor'
  | 'marble' | 'film' | 'halftone' | 'lightleak' | 'bokeh';

/** Ids are saved in looks and synced, so never rename one. */
export const CARD_TEXTURES: { id: TextureId; label: string }[] = [
  { id: 'grain', label: 'Grain' },
  { id: 'paper', label: 'Paper' },
  { id: 'parchment', label: 'Parchment' },
  { id: 'linen', label: 'Linen' },
  { id: 'watercolor', label: 'Watercolor' },
  { id: 'marble', label: 'Marble' },
  { id: 'film', label: 'Old film' },
  { id: 'halftone', label: 'Halftone' },
  { id: 'lightleak', label: 'Light leak' },
  { id: 'bokeh', label: 'Bokeh' },
];

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Small seeded random number generator (mulberry32). */
function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  return [c, c.getContext('2d')!];
}

/** Grey noise, `size` square, values around 128 ± spread. */
function noiseTile(size: number, seed: number, spread = 128): HTMLCanvasElement {
  const [c, ctx] = canvas(size, size);
  const rnd = seeded(seed);
  const img = ctx.createImageData(size, size);
  for (let i = 0; i < img.data.length; i += 4) {
    const v = 128 + (rnd() * 2 - 1) * spread;
    img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
    img.data[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

/** Coarse noise scaled up smoothly: soft clouds across the whole card. */
function clouds(W: number, H: number, seed: number, cells: number, spread: number): HTMLCanvasElement {
  const small = noiseTile(cells, seed, spread);
  const [c, ctx] = canvas(W, H);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(small, 0, 0, W, H);
  return c;
}

function fillPattern(ctx: CanvasRenderingContext2D, tile: HTMLCanvasElement, W: number, H: number) {
  const pattern = ctx.createPattern(tile, 'repeat');
  if (!pattern) return;
  ctx.fillStyle = pattern;
  ctx.fillRect(0, 0, W, H);
}

function vignette(ctx: CanvasRenderingContext2D, W: number, H: number, colour: string, inner: number) {
  const r = Math.hypot(W, H) / 2;
  const g = ctx.createRadialGradient(W / 2, H / 2, r * inner, W / 2, H / 2, r);
  g.addColorStop(0, 'rgba(0,0,0,0)');
  g.addColorStop(1, colour);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
}

/** Soften a layer by drawing it small and scaling it back up. */
function soften(src: HTMLCanvasElement, factor: number): HTMLCanvasElement {
  const [s, sctx] = canvas(src.width / factor, src.height / factor);
  sctx.imageSmoothingQuality = 'high';
  sctx.drawImage(src, 0, 0, s.width, s.height);
  const [c, ctx] = canvas(src.width, src.height);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(s, 0, 0, c.width, c.height);
  return c;
}

// ── The layers ───────────────────────────────────────────────────────────────

interface Layer {
  source: HTMLCanvasElement;
  mode: GlobalCompositeOperation;
  alpha: number;
}

function build(kind: TextureId, W: number, H: number): Layer[] {
  const k = W / 1080;
  switch (kind) {
    case 'grain': {
      const [c, ctx] = canvas(W, H);
      fillPattern(ctx, noiseTile(256, 1), W, H);
      return [{ source: c, mode: 'soft-light', alpha: 0.35 }];
    }

    case 'paper': {
      const [c, ctx] = canvas(W, H);
      fillPattern(ctx, noiseTile(256, 2, 80), W, H);
      const [v, vctx] = canvas(W, H);
      vignette(vctx, W, H, 'rgba(60, 40, 20, 0.28)', 0.55);
      return [
        { source: clouds(W, H, 3, 24, 20), mode: 'soft-light', alpha: 0.9 },
        { source: c, mode: 'soft-light', alpha: 0.18 },
        { source: v, mode: 'source-over', alpha: 1 },
      ];
    }

    case 'parchment': {
      // Warm, blotchy and darkening hard at the edges, like an old scroll.
      const [tint, tctx] = canvas(W, H);
      tctx.fillStyle = '#c8a064';
      tctx.fillRect(0, 0, W, H);
      const [g, gctx] = canvas(W, H);
      fillPattern(gctx, noiseTile(256, 4, 90), W, H);
      const [v, vctx] = canvas(W, H);
      vignette(vctx, W, H, 'rgba(70, 38, 8, 0.55)', 0.45);
      return [
        { source: tint, mode: 'multiply', alpha: 0.28 },
        { source: clouds(W, H, 5, 14, 45), mode: 'soft-light', alpha: 1 },
        { source: clouds(W, H, 6, 48, 30), mode: 'soft-light', alpha: 0.7 },
        { source: g, mode: 'soft-light', alpha: 0.2 },
        { source: v, mode: 'source-over', alpha: 1 },
      ];
    }

    case 'linen': {
      // Threads: each row and each column a slightly different shade.
      const size = 96;
      const [t, tctx] = canvas(size, size);
      const rnd = seeded(7);
      const rows = Array.from({ length: size }, () => rnd() * 2 - 1);
      const cols = Array.from({ length: size }, () => rnd() * 2 - 1);
      const img = tctx.createImageData(size, size);
      for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
          const i = (y * size + x) * 4;
          const v = 128 + rows[y] * 38 + cols[x] * 38 + (rnd() * 2 - 1) * 14;
          img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
          img.data[i + 3] = 255;
        }
      }
      tctx.putImageData(img, 0, 0);
      const [c, ctx] = canvas(W, H);
      ctx.imageSmoothingEnabled = false;
      ctx.scale(2 * k, 2 * k);
      fillPattern(ctx, t, W / (2 * k), H / (2 * k));
      return [{ source: c, mode: 'soft-light', alpha: 0.55 }];
    }

    case 'watercolor': {
      // Soft pools of light and shade with darker rims where the paint dried.
      const [c, ctx] = canvas(W, H);
      ctx.fillStyle = '#808080';
      ctx.fillRect(0, 0, W, H);
      const rnd = seeded(8);
      for (let i = 0; i < 16; i++) {
        const x = rnd() * W;
        const y = rnd() * H;
        const r = (180 + rnd() * 420) * k;
        const light = rnd() > 0.5;
        const g = ctx.createRadialGradient(x, y, r * 0.2, x, y, r);
        const core = light ? 'rgba(255,255,255,0.45)' : 'rgba(0,0,0,0.35)';
        g.addColorStop(0, core);
        g.addColorStop(0.82, light ? 'rgba(255,255,255,0.25)' : 'rgba(0,0,0,0.2)');
        g.addColorStop(0.92, 'rgba(0,0,0,0.35)'); // the dried rim
        g.addColorStop(1, 'rgba(128,128,128,0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fill();
      }
      const [p, pctx] = canvas(W, H);
      fillPattern(pctx, noiseTile(256, 9, 70), W, H);
      return [
        { source: soften(c, 6), mode: 'soft-light', alpha: 0.9 },
        { source: p, mode: 'soft-light', alpha: 0.2 },
      ];
    }

    case 'marble': {
      // Wandering veins, a soft wide one under each fine one.
      const [c, ctx] = canvas(W, H);
      const rnd = seeded(10);
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      const veins: [number, number][][] = [];
      for (let v = 0; v < 7; v++) {
        let x = rnd() * W;
        let y = -50 * k;
        let angle = Math.PI / 2 + (rnd() - 0.5) * 1.2;
        const pts: [number, number][] = [[x, y]];
        while (y < H + 50 * k && x > -200 * k && x < W + 200 * k) {
          angle += (rnd() - 0.5) * 0.6;
          angle = Math.max(0.35, Math.min(Math.PI - 0.35, angle));
          x += Math.cos(angle) * 28 * k;
          y += Math.sin(angle) * 28 * k;
          pts.push([x, y]);
        }
        veins.push(pts);
      }
      const stroke = (pts: [number, number][], width: number, colour: string) => {
        ctx.strokeStyle = colour;
        ctx.lineWidth = width;
        ctx.beginPath();
        pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
        ctx.stroke();
      };
      veins.forEach((pts) => stroke(pts, 26 * k, 'rgba(255,255,255,0.35)'));
      const wide = soften(c, 10);
      const [fine, fctx] = canvas(W, H);
      fctx.lineCap = 'round';
      veins.forEach((pts, i) => {
        fctx.strokeStyle = i % 2 ? 'rgba(255,255,255,0.7)' : 'rgba(0,0,0,0.45)';
        fctx.lineWidth = (1.5 + (i % 3)) * k;
        fctx.beginPath();
        pts.forEach(([x, y], j) => (j ? fctx.lineTo(x + Math.sin(j) * 3 * k, y) : fctx.moveTo(x, y)));
        fctx.stroke();
      });
      return [
        { source: clouds(W, H, 11, 10, 40), mode: 'soft-light', alpha: 0.8 },
        { source: wide, mode: 'soft-light', alpha: 1 },
        { source: fine, mode: 'soft-light', alpha: 0.9 },
      ];
    }

    case 'film': {
      // Heavy grain, dust specks, a few vertical scratches and dark corners.
      const [c, ctx] = canvas(W, H);
      const rnd = seeded(12);
      for (let i = 0; i < 260; i++) {
        const light = rnd() > 0.4;
        ctx.fillStyle = light ? 'rgba(255,255,255,0.7)' : 'rgba(0,0,0,0.7)';
        const r = (0.8 + rnd() * 2.6) * k;
        ctx.beginPath();
        ctx.ellipse(rnd() * W, rnd() * H, r, r * (0.4 + rnd()), rnd() * Math.PI, 0, Math.PI * 2);
        ctx.fill();
      }
      for (let i = 0; i < 6; i++) {
        const x = rnd() * W;
        const y0 = rnd() * H * 0.5;
        ctx.strokeStyle = 'rgba(255,255,255,0.5)';
        ctx.lineWidth = (0.8 + rnd() * 1.2) * k;
        ctx.beginPath();
        ctx.moveTo(x, y0);
        ctx.lineTo(x + (rnd() - 0.5) * 20 * k, y0 + H * (0.3 + rnd() * 0.5));
        ctx.stroke();
      }
      const [g, gctx] = canvas(W, H);
      fillPattern(gctx, noiseTile(256, 13), W, H);
      const [v, vctx] = canvas(W, H);
      vignette(vctx, W, H, 'rgba(0,0,0,0.5)', 0.5);
      return [
        { source: g, mode: 'soft-light', alpha: 0.5 },
        { source: c, mode: 'source-over', alpha: 0.55 },
        { source: v, mode: 'source-over', alpha: 1 },
      ];
    }

    case 'halftone': {
      // Printer's dots, growing from nothing at the top-left to large at the bottom-right.
      const [c, ctx] = canvas(W, H);
      const step = 16 * k;
      ctx.fillStyle = 'rgba(0,0,0,1)';
      for (let y = step / 2; y < H; y += step) {
        for (let x = step / 2; x < W; x += step) {
          const t = (x / W + y / H) / 2;
          const r = step * 0.46 * t * t;
          if (r < 0.4) continue;
          ctx.beginPath();
          ctx.arc(x, y, r, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      return [{ source: c, mode: 'soft-light', alpha: 0.45 }];
    }

    case 'lightleak': {
      // Warm light bleeding in from the edges, like film fogged at the camera door.
      const [c, ctx] = canvas(W, H);
      const leaks: [number, number, number, string][] = [
        [W * 1.0, H * 0.15, W * 0.75, 'rgba(255,120,40,0.85)'],
        [W * 0.85, H * 0.0, W * 0.5, 'rgba(255,210,120,0.8)'],
        [W * 0.0, H * 0.9, W * 0.6, 'rgba(255,60,110,0.55)'],
      ];
      for (const [x, y, r, colour] of leaks) {
        const g = ctx.createRadialGradient(x, y, 0, x, y, r);
        g.addColorStop(0, colour);
        g.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, W, H);
      }
      return [{ source: c, mode: 'screen', alpha: 0.75 }];
    }

    case 'bokeh': {
      // Out-of-focus lights: soft discs, a few bright, most faint.
      const [c, ctx] = canvas(W, H);
      const rnd = seeded(14);
      for (let i = 0; i < 22; i++) {
        const x = rnd() * W;
        const y = rnd() * H;
        const r = (30 + rnd() * 110) * k;
        const a = 0.08 + rnd() * 0.22;
        const g = ctx.createRadialGradient(x, y, r * 0.6, x, y, r);
        g.addColorStop(0, `rgba(255,244,220,${a})`);
        g.addColorStop(0.9, `rgba(255,244,220,${a * 1.4})`);
        g.addColorStop(1, 'rgba(255,244,220,0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fill();
      }
      return [{ source: soften(c, 2), mode: 'screen', alpha: 1 }];
    }
  }
}

/**
 * Only the texture in use is kept. A Story-sized layer is about 8 MB, some
 * textures have five, and keeping every one a person tried would add up to
 * hundreds of megabytes on a phone. Rebuilding on a change takes a moment.
 */
let cache: { key: string; layers: Layer[] } | null = null;

export function drawTexture(ctx: CanvasRenderingContext2D, kind: TextureId, W: number, H: number): void {
  const key = `${kind}:${W}x${H}`;
  if (cache?.key !== key) cache = { key, layers: build(kind, W, H) };
  const { layers } = cache;
  ctx.save();
  for (const l of layers) {
    ctx.globalCompositeOperation = l.mode;
    ctx.globalAlpha = l.alpha;
    ctx.drawImage(l.source, 0, 0, W, H);
  }
  ctx.restore();
}
