/**
 * Fitting a passage into a box.
 *
 * Three rules, in order of importance:
 *   1. The whole passage is always drawn. A card that drops words misquotes
 *      scripture, so the text shrinks as far as it has to — Esther 8:9 on a
 *      square card is small, but it is all there.
 *   2. Lines are balanced. Greedy wrapping leaves a long line over a stub;
 *      narrowing the wrap width until the line count would grow evens them out,
 *      which is what a typesetter does by hand.
 *   3. No word sits alone on the last line when it can be helped.
 */

export interface FittedText {
  lines: string[];
  fontSize: number;
  lineHeight: number;
}

export interface FitOptions {
  /** Canvas font string for a size, e.g. (s) => `${s}px Bitter`. */
  font: (size: number) => string;
  maxWidth: number;
  maxHeight: number;
  maxSize: number;
  minSize: number;
  /** Line height as a multiple of the font size. */
  leading: number;
}

/** Greedy wrap: as many words per line as fit. A word wider than the line gets its own. */
function wrap(ctx: CanvasRenderingContext2D, words: string[], width: number): string[] {
  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (line && ctx.measureText(next).width > width) {
      lines.push(line);
      line = word;
    } else {
      line = next;
    }
  }
  if (line) lines.push(line);
  return lines;
}

function widest(ctx: CanvasRenderingContext2D, lines: string[]): number {
  return Math.max(0, ...lines.map((l) => ctx.measureText(l).width));
}

/** Balanced, orphan-free lines for the font already set on ctx. */
export function balancedLines(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  const greedy = wrap(ctx, words, maxWidth);
  if (greedy.length === 1) return greedy;

  // Narrowest width that still gives the same number of lines.
  let lo = widest(ctx, words); // no line can be narrower than its longest word
  let hi = maxWidth;
  for (let i = 0; i < 14 && hi - lo > 1; i++) {
    const mid = (lo + hi) / 2;
    if (wrap(ctx, words, mid).length <= greedy.length) hi = mid;
    else lo = mid;
  }
  let lines = wrap(ctx, words, hi);

  // Orphan: pull a word down from the line above if that line can spare it.
  const last = lines.length - 1;
  if (last > 0 && !lines[last].includes(' ')) {
    const above = lines[last - 1].split(' ');
    if (above.length > 2) {
      const moved = above.pop()!;
      const candidate = [...lines.slice(0, last - 1), above.join(' '), `${moved} ${lines[last]}`];
      if (widest(ctx, candidate) <= maxWidth) lines = candidate;
    }
  }
  return lines;
}

/**
 * Largest size (≤ maxSize) at which the passage fits the box. Below minSize it
 * keeps going down to a hard floor rather than cutting the passage.
 */
export function fitText(ctx: CanvasRenderingContext2D, text: string, o: FitOptions): FittedText {
  const HARD_FLOOR = 14;
  let size = Math.round(o.maxSize);
  for (;;) {
    ctx.font = o.font(size);
    const lines = balancedLines(ctx, text, o.maxWidth);
    const lineHeight = size * o.leading;
    const fits = lines.length * lineHeight <= o.maxHeight && widest(ctx, lines) <= o.maxWidth;
    if (fits || size <= HARD_FLOOR) return { lines, fontSize: size, lineHeight };
    // Coarse steps while large, fine steps near the bottom.
    size -= size > o.minSize ? Math.max(2, Math.round(size * 0.05)) : 1;
  }
}
