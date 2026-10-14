/**
 * What the Connections picture is painted with.
 *
 * Two jobs. The arcs take the app's existing book-category colors, so Genesis
 * is the same brown here as in the book list and Revelation the same electric
 * cyan — one glance tells you an arc lands in the Law or in Revelation without
 * a legend. And the background and labels take real per-theme colors.
 *
 * That second part matters more than it sounds. The light and sepia themes are
 * `filter: invert(1)` over the dark one (see lib/fixedOrigin.ts), which is fine
 * for text and ruinous for a canvas: inverting a drawn picture turns the book
 * colors into their opposites, and a saved image would carry those wrong colors
 * out of the app with it. So the canvas asks for its colors by name instead,
 * the same way the share card does (lib/shareCard/defaults.ts), and whatever
 * draws it must sit outside the inverted subtree.
 */

import { BIBLE_BOOKS, CATEGORY_COLORS, type BookInfo } from '../bibleData';
import { getCustomThemeSettings, getSettings, resolveTheme } from '../../adapters/settings';
import { luminance, mix } from '../themeColors';

/** The ink and paper of each theme, as the canvas needs them: real colors. */
const THEME_COLORS: Record<'light' | 'dark' | 'sepia', { text: string; bg: string }> = {
  dark: { text: '#e0e0e0', bg: '#1a1a1a' },
  light: { text: '#1a1a1a', bg: '#fafafa' },
  sepia: { text: '#3b2f22', bg: '#f6f0e3' },
};

export interface ConnectionsPalette {
  /** The canvas background. */
  bg: string;
  /** Book names, chapter numbers, the credit line. */
  text: string;
  /** The same, quieter: tick marks and the chapter ruler. */
  muted: string;
  /** The baseline the arcs spring from. */
  rule: string;
  /** True on a pale background, which thinner arcs need to know about. */
  pale: boolean;
}

/** The reader's theme, as real colors rather than inverted ones. */
export function palette(): ConnectionsPalette {
  const theme = resolveTheme(getSettings().theme);
  let text: string;
  let bg: string;
  if (theme === 'custom') {
    const custom = getCustomThemeSettings();
    text = custom.textColor;
    bg = custom.bgColor;
  } else {
    ({ text, bg } = THEME_COLORS[theme]);
  }
  return {
    bg,
    text,
    muted: mix(text, bg, 0.45),
    rule: mix(text, bg, 0.7),
    pale: luminance(bg) > 0.45,
  };
}

/* --------------------------------------------------------------------------- *
 * Book colors
 * ------------------------------------------------------------------------- */

/**
 * Each book's color, in canonical order, so a book index is all the draw loop
 * needs. Built once: it is the same 66 colors every frame, and looking them up
 * per arc would mean 344,799 string lookups a frame.
 */
export const BOOK_COLORS: string[] = BIBLE_BOOKS.map((b) => CATEGORY_COLORS[b.category]);

/** Each book's color as r/g/b numbers, for blending an arc end to end. */
export const BOOK_RGB: Array<[number, number, number]> = BOOK_COLORS.map((hex) => {
  const h = hex.replace('#', '');
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ];
});

/** The category each book belongs to, for the group rows the grid will want. */
export const BOOK_CATEGORIES: BookInfo['category'][] = BIBLE_BOOKS.map((b) => b.category);

/**
 * Which book a position falls in, as an index into BOOK_COLORS.
 *
 * A binary search over the 66 book starts. The caller passes the starts rather
 * than a book list because the draw loop already holds them as an Int32Array.
 */
export function bookIndexAt(bookStarts: Int32Array, position: number): number {
  let lo = 0;
  let hi = bookStarts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (bookStarts[mid] <= position) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/** `rgba()` for a book's color at the given alpha. */
export function bookRgba(bookIndex: number, alpha: number): string {
  const [r, g, b] = BOOK_RGB[bookIndex] ?? [138, 143, 152];
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/** A color the canvas was given, as numbers. Takes #rgb, #rrggbb and rgb(). */
export function rgbOf(color: string): [number, number, number] {
  const m = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/i.exec(color);
  if (m) return [Number(m[1]), Number(m[2]), Number(m[3])];
  let h = color.replace('#', '').trim();
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  if (!/^[0-9a-f]{6}/i.test(h)) return [128, 128, 128];
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}
