/**
 * highlightCategories.ts
 *
 * The colour code behind Saved Verses → Categories. A highlight's look picks
 * its group: a marker by its colour (named, fixed), a solid/boxed/wavy line
 * by its style whatever the colour (named, fixed), text colour by its colour
 * and a dashed line by its style (both unnamed until the user names them).
 *
 * Pure lookup — nothing here reads or writes a highlight.
 */

import type { HighlightStyle } from '@projectbible/core';

/** The saved-highlight palette, in the order HighlightModal shows it. */
export const HIGHLIGHT_PALETTE = [
  { value: '#ffff32', label: 'Yellow' },
  { value: '#3aff32', label: 'Green' },
  { value: '#ff9c32', label: 'Orange' },
  { value: '#ff3232', label: 'Red' },
  { value: '#ff48ec', label: 'Pink' },
  { value: '#ba32ff', label: 'Purple' },
  { value: '#3273ff', label: 'Blue' },
] as const;

/** Marker meanings, index-matched to HIGHLIGHT_PALETTE. */
const MARKER_NAMES = [
  'Trinity, God, Jesus, Holy Spirit, Savior, Messiah, Lord',
  'Wisdom, Lessons, Becoming Christ-like, Following the Way, Faithful Living',
  'Warnings, Sinful Living, The Enemy, Unbelief, Convictions',
  'Salvation, The Blood, The Cross, Sacrifice, Atonement, Redemption, Grace',
  'Praise, Encouragement, Worship, Truth, Hope, Prayers',
  "Promises, Covenants, The Kingdom, The King's Return, Heaven",
  'Context, Prophecy, History, Genealogy, Person, Place, Time, Number',
];

export interface HighlightCategory {
  /** Stable key, also the key a user-given name is stored under. */
  key: string;
  /** Default label shown when the user hasn't named it. */
  label: string;
  /** Swatch colour for the header (the palette colour, or null for line groups). */
  color: string | null;
  /** How the header's sample is drawn. */
  kind: 'marker' | 'text' | 'line';
  underlineStyle?: 'solid' | 'dashed' | 'wavy' | 'boxed';
  /** True when the user may rename it (text colours and dashed). */
  nameable: boolean;
}

const LINE_GROUPS: HighlightCategory[] = [
  { key: 'line-solid',  label: 'Verses to Meditate On, Verses that Stand Out', color: null, kind: 'line', underlineStyle: 'solid',  nameable: false },
  { key: 'line-boxed',  label: 'Word to Define or Study', color: null, kind: 'line', underlineStyle: 'boxed',  nameable: false },
  { key: 'line-wavy',   label: 'Repetition', color: null, kind: 'line', underlineStyle: 'wavy',   nameable: false },
  { key: 'line-dashed', label: 'Dashed underline', color: null, kind: 'line', underlineStyle: 'dashed', nameable: true },
];

/** Every group, in the order Categories lists them. */
export const HIGHLIGHT_CATEGORIES: HighlightCategory[] = [
  ...HIGHLIGHT_PALETTE.map((p, i) => ({
    key: `marker-${i}`, label: MARKER_NAMES[i], color: p.value, kind: 'marker' as const, nameable: false,
  })),
  ...HIGHLIGHT_PALETTE.map((p, i) => ({
    key: `text-${i}`, label: `${p.label} text`, color: p.value, kind: 'text' as const, nameable: true,
  })),
  ...LINE_GROUPS,
];

function rgb(hex: string): [number, number, number] | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/**
 * The palette slot a colour belongs to. Older highlights can carry colours
 * from before the current palette (the legacy default was #ffeb3b), so an
 * unknown colour goes to its nearest slot rather than falling out of every
 * group.
 */
function paletteIndex(color: string): number {
  const exact = HIGHLIGHT_PALETTE.findIndex((p) => p.value.toLowerCase() === color.toLowerCase());
  if (exact >= 0) return exact;
  const c = rgb(color);
  if (!c) return 0;
  let best = 0;
  let bestDist = Infinity;
  HIGHLIGHT_PALETTE.forEach((p, i) => {
    const q = rgb(p.value)!;
    const d = (c[0] - q[0]) ** 2 + (c[1] - q[1]) ** 2 + (c[2] - q[2]) ** 2;
    if (d < bestDist) { bestDist = d; best = i; }
  });
  return best;
}

/** The group key for one highlight's look. */
export function categoryKeyFor(style: HighlightStyle): string {
  if (style.type === 'underline') return `line-${style.underlineStyle ?? 'solid'}`;
  if (style.type === 'text-color') return `text-${paletteIndex(style.color)}`;
  return `marker-${paletteIndex(style.color)}`;
}
