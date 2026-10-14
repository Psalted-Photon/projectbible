/**
 * The Connections picture as an image to save or share.
 *
 * The same draw the window makes, run again off screen at about 4,000 pixels
 * on the long side, so the arcs stay sharp printed or zoomed. It frames
 * exactly what the window shows — the same pan, zoom, lit passage and sets —
 * and adds a title band above and the irisBible mark and OpenBible's credit
 * below. Every saved image carries the credit; the licence asks for it.
 *
 * The colors are the palette's real ones (see palette.ts), never the inverting
 * filter, so a light-theme image comes out light.
 *
 * Arcs are drawn landed: a picture taken mid-flight would be a half-drawn one.
 */

import type { ConnectionsData } from './data';
import type { ConnectionsConfig, Viewport } from './layout';
import type { ConnectionsPalette } from './palette';
import type { Span } from './lights';
import type { SetLayer } from './sets';
import { draw, type Pan } from './render';
import { markDrawer } from '../shareCard';

/** The credit OpenBible's licence asks for, word for word. */
export const CREDIT = 'Cross references: OpenBible.info (CC BY)';

/** The long side of the saved image, in pixels. */
const LONG_SIDE = 4000;
/**
 * The most pixels a canvas may hold. Safari refuses a canvas past about 16.7
 * million and hands back a blank one, so a very wide window is scaled down.
 */
const MAX_PIXELS = 16_000_000;

/** The bands above and below the picture, in the window's CSS pixels. */
const HEAD = 34;
const LEGEND = 20;
const FOOT = 50;
const GUTTER = 14;

const TITLE_FONT = "'HexaplaMark', Georgia, serif";
const TEXT_FONT = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';

export interface ImageRequest {
  data: ConnectionsData;
  config: ConnectionsConfig;
  /** The window's picture area, in CSS pixels. */
  viewport: Viewport;
  view: Pan;
  palette: ConnectionsPalette;
  lit?: Span[];
  sets?: SetLayer | null;
  /** What the picture is of: "Isaiah 53", "Every cross reference in Scripture". */
  title: string;
  /** The sets showing, as the legend lists them. */
  legend: Array<{ name: string; color: string }>;
}

/** Draw the image and hand it back as a PNG, or null if the browser refused. */
export async function renderConnectionsImage(req: ImageRequest): Promise<Blob | null> {
  const mark = await markDrawer();
  const { width: W, height: H } = req.viewport;
  const head = HEAD + (req.legend.length ? LEGEND : 0);
  const totalW = W;
  const totalH = head + H + FOOT;

  let scale = LONG_SIDE / Math.max(totalW, totalH);
  const pixels = totalW * totalH * scale * scale;
  if (pixels > MAX_PIXELS) scale *= Math.sqrt(MAX_PIXELS / pixels);

  const canvas = document.createElement('canvas');
  canvas.width = Math.round(totalW * scale);
  canvas.height = Math.round(totalH * scale);
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  const { palette } = req;

  ctx.fillStyle = palette.bg;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // ── The picture, clipped to its own box so arcs running off the window's
  // edge don't spill into the bands, exactly as the window crops them.
  ctx.save();
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  ctx.beginPath();
  ctx.rect(0, head, W, H);
  ctx.clip();
  ctx.setTransform(scale, 0, 0, scale, 0, head * scale);
  draw(ctx, req.data, req.config, req.viewport, {
    palette,
    lit: req.lit,
    labels: true,
    view: req.view,
    sets: req.sets ?? null,
  });
  ctx.restore();

  // ── The bands, in the window's CSS pixels scaled up.
  ctx.save();
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  ctx.textBaseline = 'alphabetic';

  // Title, cut short with an ellipsis if the window is narrow.
  ctx.fillStyle = palette.text;
  ctx.textAlign = 'left';
  ctx.font = `20px ${TITLE_FONT}`;
  ctx.fillText(fit(ctx, req.title, W - GUTTER * 2), GUTTER, 25);

  // The legend: a dot and a name for each set showing, wrapping onto the
  // line's end with an ellipsis rather than a second row.
  if (req.legend.length) {
    ctx.font = `12px ${TEXT_FONT}`;
    let x = GUTTER;
    const y = HEAD + 10;
    for (const item of req.legend) {
      const label = item.name;
      const width = 14 + ctx.measureText(label).width;
      if (x + width > W - GUTTER) {
        ctx.fillStyle = palette.muted;
        ctx.fillText('…', x, y + 4);
        break;
      }
      ctx.fillStyle = item.color;
      ctx.beginPath();
      ctx.arc(x + 5, y, 4.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = palette.text;
      ctx.fillText(label, x + 14, y + 4);
      x += width + 14;
    }
  }

  // A hairline above and below the picture, so it reads as framed.
  ctx.strokeStyle = palette.rule;
  ctx.globalAlpha = 0.6;
  ctx.lineWidth = 1 / scale;
  ctx.beginPath();
  ctx.moveTo(0, head);
  ctx.lineTo(W, head);
  ctx.moveTo(0, head + H);
  ctx.lineTo(W, head + H);
  ctx.stroke();
  ctx.globalAlpha = 1;

  // The mark, then the credit under it, both centered.
  const footTop = head + H;
  mark(ctx, W / 2, footTop + 25, 18, palette.text);
  ctx.fillStyle = palette.muted;
  ctx.textAlign = 'center';
  ctx.font = `10.5px ${TEXT_FONT}`;
  ctx.fillText(fit(ctx, CREDIT, W - GUTTER * 2), W / 2, footTop + 42);
  ctx.restore();

  return new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
}

/** Text cut to a width, with an ellipsis where it was cut. */
function fit(ctx: CanvasRenderingContext2D, text: string, max: number): string {
  if (ctx.measureText(text).width <= max) return text;
  let t = text;
  while (t.length > 1 && ctx.measureText(`${t}…`).width > max) t = t.slice(0, -1);
  return `${t.trimEnd()}…`;
}
