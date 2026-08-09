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

export interface Hsl {
  /** 0–360 */
  h: number;
  /** 0–1 */
  s: number;
  /** 0–1 */
  l: number;
}

/**
 * HSL rather than HSV because the colour picker's spectrum box runs white at
 * the top, through the pure hue, to black at the bottom — that vertical axis
 * *is* lightness. A point at (x, y) in the box is hsl(x * 360, s, 1 - y), and
 * hexToHsl is what puts the marker back in the right place when a preset or a
 * typed hex arrives from outside.
 */
export function hexToHsl(hex: string): Hsl {
  const rgb = hexToRgb(hex);
  if (!rgb) return { h: 0, s: 0, l: 0 };

  const r = rgb.r / 255;
  const g = rgb.g / 255;
  const b = rgb.b / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;

  if (d === 0) return { h: 0, s: 0, l }; // grey — hue is meaningless

  // Denominator flips above 50% lightness; both branches approach 0 as the
  // colour nears pure white or black, which is why d === 0 is handled first.
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);

  let h: number;
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) * 60;
  else if (max === g) h = ((b - r) / d + 2) * 60;
  else h = ((r - g) / d + 4) * 60;

  return { h, s, l };
}

export function hslToHex(h: number, s: number, l: number): string {
  // Wrap hue and clamp the rest so callers can hand over raw pointer maths.
  const hue = ((h % 360) + 360) % 360;
  const sat = Math.max(0, Math.min(1, s));
  const light = Math.max(0, Math.min(1, l));

  const c = (1 - Math.abs(2 * light - 1)) * sat;
  const x = c * (1 - Math.abs(((hue / 60) % 2) - 1));
  const m = light - c / 2;

  let rgb: [number, number, number];
  if (hue < 60) rgb = [c, x, 0];
  else if (hue < 120) rgb = [x, c, 0];
  else if (hue < 180) rgb = [0, c, x];
  else if (hue < 240) rgb = [0, x, c];
  else if (hue < 300) rgb = [x, 0, c];
  else rgb = [c, 0, x];

  return rgbToHex({
    r: (rgb[0] + m) * 255,
    g: (rgb[1] + m) * 255,
    b: (rgb[2] + m) * 255,
  });
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
