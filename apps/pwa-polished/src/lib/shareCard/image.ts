/**
 * Photos and paintings as card backgrounds.
 *
 * A photo never leaves the phone: it is decoded here, drawn onto the card, and
 * forgotten when the sheet closes. It is shrunk on the way in, because a phone
 * camera's 12-megapixel frame would otherwise be redrawn in full on every drag,
 * and the card itself is only 1080 pixels wide.
 */

import { hexToHsl, hslToHex, luminance, rgbToHex } from '../themeColors';
import type { CardImage } from './types';

/** Longest edge kept after decoding: enough for a Story card zoomed in 2×. */
const MAX_EDGE = 2160;

/**
 * Decode an image (a picked file or a painting's object URL) into a small canvas.
 * An <img> is used, not createImageBitmap, because every browser applies the
 * photo's EXIF rotation to an <img>, and a sideways photo is the classic bug here.
 */
export async function decodeImage(src: Blob | string): Promise<{ source: HTMLCanvasElement; width: number; height: number }> {
  const url = typeof src === 'string' ? src : URL.createObjectURL(src);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const scale = Math.min(1, MAX_EDGE / Math.max(img.naturalWidth, img.naturalHeight));
    const width = Math.max(1, Math.round(img.naturalWidth * scale));
    const height = Math.max(1, Math.round(img.naturalHeight * scale));
    const c = document.createElement('canvas');
    c.width = width;
    c.height = height;
    const ctx = c.getContext('2d')!;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, 0, 0, width, height);
    return { source: c, width, height };
  } finally {
    if (typeof src !== 'string') URL.revokeObjectURL(url);
  }
}

/**
 * Colours to start a photo card with, taken from the photo itself: a pale tint
 * of its main hue for the words and a brighter one for accents. The dark
 * overlay that comes with it is what makes pale text safe on any photo.
 */
export function suggestColours(source: CanvasImageSource): { text: string; accent: string; bg: string } {
  const c = document.createElement('canvas');
  c.width = c.height = 24;
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(source, 0, 0, 24, 24);
  const d = ctx.getImageData(0, 0, 24, 24).data;
  // Weight each pixel by how colourful it is, so a grey sky doesn't wash out the hue.
  let r = 0, g = 0, b = 0, w = 0, lr = 0, lg = 0, lb = 0;
  for (let i = 0; i < d.length; i += 4) {
    const max = Math.max(d[i], d[i + 1], d[i + 2]);
    const min = Math.min(d[i], d[i + 1], d[i + 2]);
    const sat = max - min + 8;
    r += d[i] * sat; g += d[i + 1] * sat; b += d[i + 2] * sat; w += sat;
    lr += d[i]; lg += d[i + 1]; lb += d[i + 2];
  }
  const n = d.length / 4;
  const main = rgbToHex({ r: r / w, g: g / w, b: b / w });
  const avg = rgbToHex({ r: lr / n, g: lg / n, b: lb / n });
  const { h, s } = hexToHsl(main);
  return {
    text: hslToHex(h, Math.min(s, 0.35), 0.94),
    accent: hslToHex(h, Math.max(0.6, s), 0.72),
    // Darkest sensible version of the photo's average, for a saved look to fall back to.
    bg: luminance(avg) > 0.08 ? hslToHex(hexToHsl(avg).h, Math.min(hexToHsl(avg).s, 0.4), 0.14) : avg,
  };
}

/** Largest pan that still leaves the card fully covered. */
export function clampPan(img: CardImage, W: number, H: number): CardImage {
  const { dw, dh } = coverSize(img, W, H);
  const maxX = Math.max(0, (dw - W) / 2);
  const maxY = Math.max(0, (dh - H) / 2);
  return {
    ...img,
    panX: Math.max(-maxX, Math.min(maxX, img.panX)),
    panY: Math.max(-maxY, Math.min(maxY, img.panY)),
  };
}

function coverSize(img: CardImage, W: number, H: number) {
  const cover = Math.max(W / img.width, H / img.height) * Math.max(1, img.zoom);
  return { dw: img.width * cover, dh: img.height * cover };
}

let blurCanvas: HTMLCanvasElement | null = null;

/**
 * Cover the card with the image, then soften and dim it.
 *
 * Blur is done by drawing small and scaling back up. ctx.filter would be
 * neater, but older iPhones ignore it on a canvas, and a blur slider that does
 * nothing on some phones is worse than one that is slightly less smooth.
 */
export function drawImageBackground(
  ctx: CanvasRenderingContext2D,
  img: CardImage,
  W: number,
  H: number,
  blur: number,
  darken: number,
): void {
  const { panX, panY } = clampPan(img, W, H);
  const { dw, dh } = coverSize(img, W, H);
  const x = (W - dw) / 2 + panX;
  const y = (H - dh) / 2 + panY;

  ctx.save();
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  if (blur > 0.01) {
    const f = 1 / (1 + blur * 30);
    const sw = Math.max(2, Math.round(W * f));
    const sh = Math.max(2, Math.round(H * f));
    blurCanvas ??= document.createElement('canvas');
    blurCanvas.width = sw;
    blurCanvas.height = sh;
    const bctx = blurCanvas.getContext('2d')!;
    bctx.imageSmoothingQuality = 'high';
    bctx.drawImage(img.source, x * f, y * f, dw * f, dh * f);
    // Overscan slightly so the soft edge doesn't show a light rim.
    const o = W * 0.02;
    ctx.drawImage(blurCanvas, -o, -o, W + o * 2, H + o * 2);
  } else {
    ctx.drawImage(img.source, x, y, dw, dh);
  }
  if (darken > 0.01) {
    ctx.fillStyle = `rgba(0, 0, 0, ${darken * 0.85})`;
    ctx.fillRect(0, 0, W, H);
  }
  ctx.restore();
}
