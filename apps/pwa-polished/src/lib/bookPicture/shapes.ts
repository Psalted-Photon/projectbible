/**
 * Symbols for the book pictures (book-picture-lab.html): a book's whole text
 * set inside one outline. Each symbol paints itself as a solid silhouette in
 * its own design units; layout.ts turns that into the spans each line of text
 * runs along, and the lab paints it again to cut the whole-page look.
 *
 * The first six are the group symbols that already existed as shapes: five
 * Phosphor icons (the same set the app's icons come from, MIT) and Alpha and
 * Omega set in Gentium Plus. Phosphor's plain variants are used where they
 * have one (CrownSimple, FireSimple), because the inner cutouts of the full
 * icons turn into holes the text has to jump. The anchor is the bold weight:
 * Phosphor's anchor is a line drawing, and the regular stroke is too thin to
 * hold more than a letter or two per line.
 *
 * The circle is the plain shape: no edges or gaps to work around, so it shows
 * the size of a book best when the size follows the book's length.
 */

import type { BookInfo } from '../bibleData';

export interface BookShape {
  id: string;
  label: string;
  /** Size of the canvas the shape is measured on, in design units. */
  box: [number, number];
  /**
   * Fill the silhouette with the current fillStyle. `thicken` fattens every
   * edge outward by that many design units (a round-joined stroke), which is
   * how thin parts get room for text.
   */
  paint(ctx: CanvasRenderingContext2D, thicken: number): void;
  /** Font the shape needs loaded before it paints, if any. */
  font?: string;
}

function iconShape(id: string, label: string, d: string): BookShape {
  let path: Path2D | null = null;
  return {
    id,
    label,
    box: [256, 256],
    paint(ctx, thicken) {
      path ??= new Path2D(d);
      ctx.fill(path);
      if (thicken > 0) {
        ctx.save();
        ctx.lineJoin = 'round';
        ctx.lineCap = 'round';
        ctx.lineWidth = thicken * 2;
        ctx.strokeStyle = ctx.fillStyle;
        ctx.stroke(path);
        ctx.restore();
      }
    },
  };
}

const GREEK_FONT = '700 200px "Gentium Plus", serif';

function lettersShape(id: string, label: string, stacked: boolean): BookShape {
  return {
    id,
    label,
    box: stacked ? [320, 480] : [480, 280],
    font: GREEK_FONT,
    paint(ctx, thicken) {
      ctx.save();
      ctx.font = GREEK_FONT;
      ctx.textBaseline = 'alphabetic';
      const draw = (ch: string, x: number, y: number) => {
        ctx.fillText(ch, x, y);
        if (thicken > 0) {
          ctx.lineJoin = 'round';
          ctx.lineWidth = thicken * 2;
          ctx.strokeStyle = ctx.fillStyle;
          ctx.strokeText(ch, x, y);
        }
      };
      if (stacked) {
        ctx.textAlign = 'center';
        draw('Α', 160, 210);
        draw('Ω', 160, 440);
      } else {
        ctx.textAlign = 'left';
        const a = ctx.measureText('Α').width;
        draw('Α', 30, 230);
        draw('Ω', 30 + a + 30, 230);
      }
      ctx.restore();
    },
  };
}

function circleShape(): BookShape {
  return {
    id: 'circle',
    label: 'Circle',
    box: [256, 256],
    paint(ctx, thicken) {
      ctx.beginPath();
      ctx.arc(128, 128, 128 + thicken, 0, Math.PI * 2);
      ctx.fill();
    },
  };
}

// Paths copied from phosphor-svelte (fill weight unless noted).
export const SHAPES: BookShape[] = [
  iconShape(
    'cross',
    'Cross',
    'M216,92v24a16,16,0,0,1-16,16H156v92a16,16,0,0,1-16,16H116a16,16,0,0,1-16-16V132H56a16,16,0,0,1-16-16V92A16,16,0,0,1,56,76h44V32a16,16,0,0,1,16-16h24a16,16,0,0,1,16,16V76h44A16,16,0,0,1,216,92Z',
  ),
  iconShape(
    'crown',
    'Crown',
    'M239.75,90.81c0,.11,0,.21-.07.32L217,195a16,16,0,0,1-15.72,13H54.71A16,16,0,0,1,39,195L16.32,91.13c0-.11-.05-.21-.07-.32A16,16,0,0,1,44,77.39l33.67,36.29,35.8-80.29a1,1,0,0,0,0-.1,16,16,0,0,1,29.06,0,1,1,0,0,0,0,.1l35.8,80.29L212,77.39a16,16,0,0,1,27.71,13.42Z',
  ),
  iconShape(
    'flame',
    'Flame',
    'M143.38,17.85a8,8,0,0,0-12.63,3.41l-22,60.41L84.59,58.26a8,8,0,0,0-11.93.89C51,87.53,40,116.08,40,144a88,88,0,0,0,176,0C216,84.55,165.21,36,143.38,17.85Z',
  ),
  // Bold weight, see the note at the top.
  iconShape(
    'anchor',
    'Anchor',
    'M216,132a12,12,0,0,0-12,12c0,21.86-11.41,25.95-35.16,32.42-9.12,2.49-19.61,5.36-28.84,10.69V132h28a12,12,0,0,0,0-24H140V89.94a36,36,0,1,0-24,0V108H88a12,12,0,0,0,0,24h28v55.11c-9.23-5.33-19.72-8.2-28.84-10.69C63.41,170,52,165.86,52,144a12,12,0,0,0-24,0c0,41.17,30.54,49.5,52.84,55.58C104.59,206.05,116,210.14,116,232a12,12,0,0,0,24,0c0-21.86,11.41-25.95,35.16-32.42C197.46,193.5,228,185.17,228,144A12,12,0,0,0,216,132ZM128,44a12,12,0,1,1-12,12A12,12,0,0,1,128,44Z',
  ),
  // Phosphor's Feather: the quill.
  iconShape(
    'quill',
    'Quill',
    'M211.84,134.81l-59.79,60.47,0,0a15.75,15.75,0,0,1-11.2,4.68H75.32L45.66,229.66a8,8,0,0,1-11.32-11.32l22.59-22.58h0L124.7,128H209A4,4,0,0,1,211.84,134.81ZM216.7,30.57a64,64,0,0,0-85.9,4.14l-9.6,9.48A4,4,0,0,0,120,47v63l55-55a8,8,0,0,1,11.31,11.31L140.71,112h88.38a4,4,0,0,0,3.56-2.16A64.08,64.08,0,0,0,216.7,30.57ZM62.83,167.23,104,126.06V70.76a4,4,0,0,0-6.81-2.84L60.69,104A15.9,15.9,0,0,0,56,115.31V164.4A4,4,0,0,0,62.83,167.23Z',
  ),
  lettersShape('alpha-omega', 'Α Ω', false),
  lettersShape('alpha-omega-stacked', 'Α Ω stacked', true),
  circleShape(),
];

export function shapeById(id: string): BookShape {
  return SHAPES.find((s) => s.id === id) ?? SHAPES[0];
}

/** Version 1: one symbol per book-color group. `id` is null where it isn't drawn yet. */
export const GROUP_SYMBOLS: Record<BookInfo['category'], { name: string; id: string | null }> = {
  pentateuch: { name: 'Two stone tablets', id: null },
  historical: { name: 'Crown', id: 'crown' },
  wisdom: { name: 'Lyre', id: null },
  'major-prophets': { name: 'Shofar', id: null },
  'minor-prophets': { name: 'Plumb line', id: null },
  gospels: { name: 'Cross', id: 'cross' },
  acts: { name: 'Flame', id: 'flame' },
  pauline: { name: 'Quill', id: 'quill' },
  general: { name: 'Anchor', id: 'anchor' },
  revelation: { name: 'Α Ω', id: 'alpha-omega' },
};

/** Where a shape sits on the page: design units → page units. */
export interface ShapeFit {
  scale: number;
  /** Page position of design point (0, 0). */
  x: number;
  y: number;
}

/**
 * Fit the shape's painted silhouette (not its design box) into the page
 * inside `margin`, centred. The silhouette's bounds are found by painting it
 * once, so thickening and font metrics are taken into account.
 */
export function fitShape(
  shape: BookShape,
  thicken: number,
  pageW: number,
  pageH: number,
  margin: number,
): ShapeFit {
  const [bw, bh] = shape.box;
  const pad = Math.ceil(thicken) + 4;
  const c = document.createElement('canvas');
  c.width = bw + pad * 2;
  c.height = bh + pad * 2;
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.translate(pad, pad);
  ctx.fillStyle = '#000';
  shape.paint(ctx, thicken);
  const data = ctx.getImageData(0, 0, c.width, c.height).data;
  let x0 = c.width, y0 = c.height, x1 = -1, y1 = -1;
  for (let y = 0; y < c.height; y++) {
    for (let x = 0; x < c.width; x++) {
      if (data[(y * c.width + x) * 4 + 3] > 96) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  if (x1 < 0) return { scale: 1, x: margin, y: margin };
  const left = x0 - pad, top = y0 - pad;
  const w = x1 - x0 + 1, h = y1 - y0 + 1;
  const scale = Math.min((pageW - margin * 2) / w, (pageH - margin * 2) / h);
  return {
    scale,
    x: (pageW - w * scale) / 2 - left * scale,
    y: (pageH - h * scale) / 2 - top * scale,
  };
}

/**
 * Shrink a fitted shape by `s` about the middle of the page, so it stays
 * centred. Used when the shape's size follows the book's length.
 */
export function shrinkFit(fit: ShapeFit, s: number, pageW: number, pageH: number): ShapeFit {
  if (s === 1) return fit;
  const cx = pageW / 2, cy = pageH / 2;
  return { scale: fit.scale * s, x: cx - (cx - fit.x) * s, y: cy - (cy - fit.y) * s };
}

/** Paint the fitted shape on a context already set to page units. */
export function paintFitted(
  ctx: CanvasRenderingContext2D,
  shape: BookShape,
  fit: ShapeFit,
  thicken: number,
): void {
  ctx.save();
  ctx.transform(fit.scale, 0, 0, fit.scale, fit.x, fit.y);
  shape.paint(ctx, thicken);
  ctx.restore();
}
