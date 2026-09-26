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
 *
 * Works word by word rather than on whole strings, because a word tapped for
 * bold is wider than the same word plain, and the drawing needs to know where
 * each word landed so a tap can find it again.
 */

export interface FittedText {
  /** Each line is a list of word indices. */
  lines: number[][];
  fontSize: number;
  lineHeight: number;
  /** Width of every word at fontSize, by index. */
  widths: number[];
  /** Width of a space at fontSize. */
  space: number;
}

export interface FitOptions {
  /** Canvas font string for a word at a size, e.g. (s, i) => `${s}px Bitter`. */
  font: (size: number, index: number) => string;
  maxWidth: number;
  maxHeight: number;
  maxSize: number;
  minSize: number;
  /** Line height as a multiple of the font size. */
  leading: number;
}

export function lineWidth(line: number[], widths: number[], space: number): number {
  let w = 0;
  for (const i of line) w += widths[i];
  return w + space * Math.max(0, line.length - 1);
}

/** Greedy wrap: as many words per line as fit. A word wider than the line gets its own. */
function wrap(n: number, widths: number[], space: number, width: number): number[][] {
  const lines: number[][] = [];
  let line: number[] = [];
  let w = 0;
  for (let i = 0; i < n; i++) {
    const next = line.length ? w + space + widths[i] : widths[i];
    if (line.length && next > width) {
      lines.push(line);
      line = [i];
      w = widths[i];
    } else {
      line.push(i);
      w = next;
    }
  }
  if (line.length) lines.push(line);
  return lines;
}

/** Balanced, orphan-free lines. */
export function balancedLines(widths: number[], space: number, maxWidth: number): number[][] {
  const n = widths.length;
  if (n === 0) return [];
  const greedy = wrap(n, widths, space, maxWidth);
  if (greedy.length === 1) return greedy;

  // Narrowest width that still gives the same number of lines.
  let lo = Math.max(...widths); // no line can be narrower than its longest word
  let hi = maxWidth;
  for (let i = 0; i < 14 && hi - lo > 1; i++) {
    const mid = (lo + hi) / 2;
    if (wrap(n, widths, space, mid).length <= greedy.length) hi = mid;
    else lo = mid;
  }
  let lines = wrap(n, widths, space, hi);

  // Orphan: pull a word down from the line above if that line can spare it.
  const last = lines.length - 1;
  if (last > 0 && lines[last].length === 1 && lines[last - 1].length > 2) {
    const above = lines[last - 1].slice(0, -1);
    const moved = [lines[last - 1][lines[last - 1].length - 1], ...lines[last]];
    if (lineWidth(moved, widths, space) <= maxWidth) {
      lines = [...lines.slice(0, last - 1), above, moved];
    }
  }
  return lines;
}

/**
 * Largest size (≤ maxSize) at which the passage fits the box. Below minSize it
 * keeps going down to a hard floor rather than cutting the passage.
 */
export function fitText(ctx: CanvasRenderingContext2D, words: string[], o: FitOptions): FittedText {
  const HARD_FLOOR = 14;
  let size = Math.round(o.maxSize);
  for (;;) {
    const widths = words.map((w, i) => {
      ctx.font = o.font(size, i);
      return ctx.measureText(w).width;
    });
    ctx.font = o.font(size, -1);
    const space = ctx.measureText(' ').width;
    const lines = balancedLines(widths, space, o.maxWidth);
    const lineHeight = size * o.leading;
    const widest = Math.max(0, ...lines.map((l) => lineWidth(l, widths, space)));
    const fits = lines.length * lineHeight <= o.maxHeight && widest <= o.maxWidth;
    if (fits || size <= HARD_FLOOR) return { lines, fontSize: size, lineHeight, widths, space };
    // Coarse steps while large, fine steps near the bottom.
    size -= size > o.minSize ? Math.max(2, Math.round(size * 0.05)) : 1;
  }
}

