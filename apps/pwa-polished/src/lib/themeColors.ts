/**
 * Colour maths for the Custom theme.
 *
 * The Custom theme lets the user pick any text and background colour, which
 * means several downstream colours can no longer be hardcoded: secondary
 * headings need to sit between the text and the background, and the red-letter
 * red has to stay legible whether the background is near-white or near-black.
 * Deriving them here keeps the rules in one readable place instead of scattered
 * across `color-mix()` calls in component CSS.
 */

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

/** Parse #rgb / #rrggbb. Returns null on anything else. */
export function hexToRgb(hex: string): Rgb | null {
  const h = (hex || '').trim().replace(/^#/, '');
  if (h.length === 3) {
    const r = parseInt(h[0] + h[0], 16);
    const g = parseInt(h[1] + h[1], 16);
    const b = parseInt(h[2] + h[2], 16);
    return Number.isNaN(r + g + b) ? null : { r, g, b };
  }
  if (h.length === 6) {
    const n = parseInt(h, 16);
    return Number.isNaN(n) ? null : { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
  }
  return null;
}

const clamp255 = (n: number) => Math.max(0, Math.min(255, Math.round(n)));

export function rgbToHex({ r, g, b }: Rgb): string {
  return '#' + [r, g, b].map((v) => clamp255(v).toString(16).padStart(2, '0')).join('');
}

/** True if the string is a colour we can actually work with. */
export function isValidHex(hex: string): boolean {
  return hexToRgb(hex) !== null;
}

/** WCAG relative luminance, 0 (black) to 1 (white). */
export function luminance(hex: string): number {
  const rgb = hexToRgb(hex);
  if (!rgb) return 0;
  const channel = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * channel(rgb.r) + 0.7152 * channel(rgb.g) + 0.0722 * channel(rgb.b);
}

/** WCAG contrast ratio, 1 (identical) to 21 (black on white). */
export function contrastRatio(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

/** Blend `amount` (0–1) of `b` into `a`. */
export function mix(a: string, b: string, amount: number): string {
  const ca = hexToRgb(a);
  const cb = hexToRgb(b);
  if (!ca || !cb) return a;
  const t = Math.max(0, Math.min(1, amount));
  return rgbToHex({
    r: ca.r + (cb.r - ca.r) * t,
    g: ca.g + (cb.g - ca.g) * t,
    b: ca.b + (cb.b - ca.b) * t,
  });
}

/**
 * Red-letter colour for a given background.
 *
 * The two values match what the dark and light themes already use, so red
 * letter looks the same in Custom as it does elsewhere. Picking by background
 * luminance rather than by text colour is deliberate: legibility is a function
 * of what the text sits *on*, and the red deliberately ignores the user's text
 * colour anyway.
 */
export function redLetterFor(bg: string): string {
  return luminance(bg) > 0.45 ? '#CC0000' : '#FF3F3F';
}

/**
 * Secondary and tertiary text, for headings that currently use fixed greys.
 * Dimming *towards the background* works on light and dark alike — nudging
 * towards black would vanish on a dark background and vice versa.
 */
export function dimTowardsBg(text: string, bg: string, amount: number): string {
  return mix(text, bg, amount);
}

/**
 * Whether a text/background pair is too close to read comfortably.
 * 3:1 is the WCAG AA floor for large text; body text wants 4.5:1, but the
 * reader runs at 18px+ and this is only ever a warning, never a block — it is
 * the user's Bible and their choice.
 */
export function isLowContrast(text: string, bg: string): boolean {
  return contrastRatio(text, bg) < 3;
}
