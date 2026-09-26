/**
 * The card's QR code: a small plate in a corner that opens the verse.
 *
 * Always dark squares on a pale plate, whatever the card's colours. Many
 * phone cameras will not read a light-on-dark code, and a QR that looks
 * right but will not scan is worse than none. The generator is the one the
 * shared-notebook invite already uses (QrCode.svelte), loaded on demand.
 */

type Matrix = { count: number; dark: (r: number, c: number) => boolean };

let cache: { text: string; matrix: Matrix } | null = null;

/** Build (or reuse) the code for this text. Null if the generator can't load. */
export async function qrMatrix(text: string): Promise<Matrix | null> {
  if (cache?.text === text) return cache.matrix;
  try {
    const qrcode = (await import('qrcode-generator')).default;
    const qr = qrcode(0, 'M');
    qr.addData(text);
    qr.make();
    const matrix: Matrix = { count: qr.getModuleCount(), dark: (r, c) => qr.isDark(r, c) };
    cache = { text, matrix };
    return matrix;
  } catch (err) {
    console.warn('[shareCard] QR failed', err);
    return null;
  }
}

/** Draw the plate with its code, top-left at (x, y), `size` wide including the quiet zone. */
export function drawQr(ctx: CanvasRenderingContext2D, m: Matrix, x: number, y: number, size: number): void {
  const QUIET = 3; // a touch under the spec's 4: the plate's own edge adds contrast
  const span = m.count + QUIET * 2;
  const cell = size / span;
  ctx.save();
  ctx.globalAlpha = 0.92;
  ctx.fillStyle = '#ffffff';
  roundRect(ctx, x, y, size, size, cell * 2);
  ctx.fill();
  ctx.globalAlpha = 1;
  ctx.fillStyle = '#111111';
  for (let r = 0; r < m.count; r++) {
    for (let c = 0; c < m.count; c++) {
      // Overlap by a hair so no seams show between neighbouring squares.
      if (m.dark(r, c)) ctx.fillRect(x + (c + QUIET) * cell, y + (r + QUIET) * cell, cell + 0.5, cell + 0.5);
    }
  }
  ctx.restore();
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
