/**
 * By Heart's score: a percent, shown in a color that runs green, yellow,
 * orange, red from 100 down to 0. It is called a score, never a grade.
 */

const STOPS: { at: number; rgb: [number, number, number] }[] = [
  { at: 0, rgb: [239, 68, 68] },
  { at: 33, rgb: [249, 115, 22] },
  { at: 66, rgb: [234, 179, 8] },
  { at: 100, rgb: [34, 197, 94] },
];

/** The color of a score, blended between the two stops it falls between. */
export function scoreColor(score: number): string {
  const s = Math.max(0, Math.min(100, score));
  const upper = STOPS.findIndex((stop) => s <= stop.at);
  if (upper <= 0) return `rgb(${STOPS[0].rgb.join(', ')})`;
  const a = STOPS[upper - 1];
  const b = STOPS[upper];
  const t = (s - a.at) / (b.at - a.at);
  const mixed = a.rgb.map((c, i) => Math.round(c + (b.rgb[i] - c) * t));
  return `rgb(${mixed.join(', ')})`;
}
