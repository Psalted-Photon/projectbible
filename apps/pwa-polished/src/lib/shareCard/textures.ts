/**
 * Grain and paper, laid over any background.
 *
 * Both are made once from random noise and tiled, never loaded as image
 * files, so they cost no download and no licence. Soft-light blending lets
 * the same tile work on a white card and a black one.
 */

let grainTile: HTMLCanvasElement | null = null;
let mottleTile: HTMLCanvasElement | null = null;

/** Fine single-pixel noise: film grain. */
function grain(): HTMLCanvasElement {
  if (grainTile) return grainTile;
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const ctx = c.getContext('2d')!;
  const img = ctx.createImageData(256, 256);
  for (let i = 0; i < img.data.length; i += 4) {
    const v = Math.random() * 255;
    img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
    img.data[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return (grainTile = c);
}

/** Large soft blotches: a coarse noise grid scaled up smoothly, like paper fibre clouds. */
function mottle(): HTMLCanvasElement {
  if (mottleTile) return mottleTile;
  const small = document.createElement('canvas');
  small.width = small.height = 24;
  const sctx = small.getContext('2d')!;
  const img = sctx.createImageData(24, 24);
  for (let i = 0; i < img.data.length; i += 4) {
    const v = 110 + Math.random() * 40;
    img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
    img.data[i + 3] = 255;
  }
  sctx.putImageData(img, 0, 0);
  const c = document.createElement('canvas');
  c.width = c.height = 1080;
  const ctx = c.getContext('2d')!;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(small, 0, 0, 1080, 1080);
  return (mottleTile = c);
}

function tile(ctx: CanvasRenderingContext2D, source: HTMLCanvasElement, W: number, H: number, alpha: number) {
  const pattern = ctx.createPattern(source, 'repeat');
  if (!pattern) return;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.globalCompositeOperation = 'soft-light';
  ctx.fillStyle = pattern;
  ctx.fillRect(0, 0, W, H);
  ctx.restore();
}

export function drawTexture(ctx: CanvasRenderingContext2D, kind: 'grain' | 'paper', W: number, H: number): void {
  if (kind === 'grain') {
    tile(ctx, grain(), W, H, 0.35);
    return;
  }
  // Paper: soft clouds, a little tooth, and edges that fall off like an old page.
  ctx.save();
  ctx.globalAlpha = 0.9;
  ctx.globalCompositeOperation = 'soft-light';
  ctx.drawImage(mottle(), 0, 0, W, H);
  ctx.restore();
  tile(ctx, grain(), W, H, 0.18);
  const r = Math.hypot(W, H) / 2;
  const v = ctx.createRadialGradient(W / 2, H / 2, r * 0.55, W / 2, H / 2, r);
  v.addColorStop(0, 'rgba(60, 40, 20, 0)');
  v.addColorStop(1, 'rgba(60, 40, 20, 0.28)');
  ctx.fillStyle = v;
  ctx.fillRect(0, 0, W, H);
}
