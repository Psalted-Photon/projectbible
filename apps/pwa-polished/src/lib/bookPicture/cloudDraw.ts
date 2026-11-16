/**
 * A book's word cloud as the app shows it: the small round one under a
 * book's chapter 1 title, the wide one at the top of its Introduction, and
 * the full-screen one (MiniWordCloud.svelte, WordCloudView.svelte).
 *
 * The words and their counts come from the NET (bubbleData.ts); packing is
 * cloud.ts, on a circle or a rectangle mask. Drawn on the Light or Dark
 * ground (ground.ts): the words in the ground's plain ink, the few most used
 * in the book's color, fading a little down the list, the way the book
 * picture lab's Cream white look draws them.
 */

import { packCloud, type Cloud, type CloudWord } from './cloud';
import { buildMask, type Mask } from './layout';
import { hashSeed, mixHex } from './bubbleScene';
import type { GroundColors } from './ground';

export const CLOUD_FONT = { family: '"Gentium Plus", Georgia, serif', weight: 400 };

/** How many of the most used words carry the book's color. */
const COLORED = 5;

let fontsLoaded: Promise<void> | null = null;

/** Clouds are measured in their own font, so it has to be in first. */
export function cloudFontReady(): Promise<void> {
  fontsLoaded ??= document.fonts
    .load(`${CLOUD_FONT.weight} 16px ${CLOUD_FONT.family}`, 'The LORD')
    .then(() => undefined)
    .catch(() => undefined);
  return fontsLoaded;
}

const masks = new Map<string, Mask>();

/** A circle filling a square `box` units wide. */
export function circleMask(box: number): Mask {
  const key = `c${box}`;
  let m = masks.get(key);
  if (!m) {
    m = buildMask(box, box, 2, (c) => {
      c.beginPath();
      c.arc(box / 2, box / 2, (box / 2) * 0.94, 0, Math.PI * 2);
      c.fill();
    });
    masks.set(key, m);
  }
  return m;
}

/** A rectangle `w` × `h` units, a little in from its edges. */
export function rectMask(w: number, h: number): Mask {
  const key = `r${w}x${h}`;
  let m = masks.get(key);
  if (!m) {
    const pad = Math.min(w, h) * 0.04;
    m = buildMask(w, h, 1, (c) => c.fillRect(pad, pad, w - pad * 2, h - pad * 2));
    masks.set(key, m);
    // Full-screen clouds come in as many shapes as there are screens.
    if (masks.size > 24) masks.delete(masks.keys().next().value!);
  }
  return m;
}

export function packBookCloud(book: string, words: readonly CloudWord[], mask: Mask, maxWords: number): Cloud {
  return packCloud(words, mask, {
    family: CLOUD_FONT.family,
    weight: CLOUD_FONT.weight,
    maxWords,
    fill: 0.5,
    seed: hashSeed(book),
  });
}

export interface CloudInk {
  ground: GroundColors;
  /** The book's color. */
  color: string;
  /** Its outline on the dark ground, '' for none (bibleData outlineColorFor). */
  ring: string;
}

/** The book's color as cloud words wear it: darker on cream, where the bright ones would fade. */
export function cloudAccent(ink: CloudInk): string {
  return ink.ground.light ? mixHex(ink.color, '#000000', 0.25) : ink.color;
}

/**
 * Draw a packed cloud onto `c`: page units map to device px as
 * device = unit * scale + (x0, y0). `picked` (a placed word's index) is drawn
 * in the book's color with a soft box behind it.
 */
export function drawWordCloud(
  c: CanvasRenderingContext2D,
  cloud: Cloud,
  x0: number,
  y0: number,
  scale: number,
  ink: CloudInk,
  ratio: number,
  picked = -1,
  bounds?: { w: number; h: number },
): void {
  const accent = cloudAccent(ink);
  const ring = ink.ground.light ? '' : ink.ring;
  const n = cloud.placed.length;
  c.setTransform(1, 0, 0, 1, 0, 0);
  c.textAlign = 'left';
  c.textBaseline = 'alphabetic';
  c.lineJoin = 'round';
  for (let i = 0; i < n; i++) {
    const p = cloud.placed[i];
    const dx = x0 + p.x * scale, dy = y0 + p.y * scale, fpx = p.f * scale;
    if (bounds && (dx > bounds.w || dx + p.w * scale < 0 || dy - fpx > bounds.h || dy + fpx * 0.4 < 0)) continue;
    const colored = p.word < COLORED || i === picked;
    if (i === picked) {
      c.globalAlpha = 0.22;
      c.fillStyle = accent;
      const padX = fpx * 0.18, padY = fpx * 0.1;
      c.fillRect(dx - padX, y0 + p.top * scale - padY, p.w * scale + padX * 2, (p.bottom - p.top) * scale + padY * 2);
    }
    c.globalAlpha = i === picked ? 1 : 1 - 0.35 * (i / Math.max(1, n - 1));
    c.fillStyle = colored ? accent : ink.ground.neutral;
    if (fpx < 2) {
      c.fillRect(dx, dy - 0.46 * fpx, p.w * scale, Math.max(0.5 * ratio, 0.46 * fpx));
      continue;
    }
    c.font = `${CLOUD_FONT.weight} ${fpx.toFixed(1)}px ${CLOUD_FONT.family}`;
    if (colored && ring && fpx >= 6 * ratio) {
      c.strokeStyle = ring;
      c.lineWidth = Math.max(0.8 * ratio, fpx * 0.035);
      c.strokeText(p.text, dx, dy);
    }
    c.fillText(p.text, dx, dy);
  }
  c.globalAlpha = 1;
}
