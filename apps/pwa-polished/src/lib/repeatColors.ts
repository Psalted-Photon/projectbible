/**
 * repeatColors.ts
 *
 * A soft, translucent palette used exclusively for the "Repeats" study overlay
 * (the temporary, global word-tracking highlights). Deliberately distinct from
 * the saved-highlight PALETTE in HighlightModal.svelte so repeat coloring reads
 * as a lightweight "scratch" layer rather than a permanent highlight.
 *
 * Both the navbar pills and the in-text repeat spans reference these by index,
 * so a given repeat group always looks the same in both places.
 *
 * There are exactly 7 entries — this is the hard cap on simultaneous repeat
 * groups.
 */

export interface RepeatColor {
  /** Human label (debugging / titles). */
  name: string;
  /** Solid pill background (the navbar pill). */
  pill: string;
  /** Readable text color on top of the pill background. */
  pillText: string;
  /** Translucent in-text highlight background. */
  bg: string;
  /** Subtle in-text highlight border. */
  border: string;
}

export const REPEAT_COLORS: RepeatColor[] = [
  { name: 'Amber',  pill: '#b8860b', pillText: '#fff8e1', bg: 'rgba(255, 193, 7, 0.30)',  border: 'rgba(255, 193, 7, 0.55)' },
  { name: 'Sky',    pill: '#2f6f8f', pillText: '#e3f4fb', bg: 'rgba(56, 178, 232, 0.28)', border: 'rgba(56, 178, 232, 0.55)' },
  { name: 'Mint',   pill: '#2f7d56', pillText: '#e3f7ec', bg: 'rgba(52, 199, 124, 0.28)', border: 'rgba(52, 199, 124, 0.55)' },
  { name: 'Rose',   pill: '#a64263', pillText: '#fbe6ee', bg: 'rgba(244, 114, 160, 0.28)', border: 'rgba(244, 114, 160, 0.55)' },
  { name: 'Violet', pill: '#6c4aa6', pillText: '#efe8fb', bg: 'rgba(167, 130, 240, 0.28)', border: 'rgba(167, 130, 240, 0.55)' },
  { name: 'Coral',  pill: '#b35a3a', pillText: '#fceae3', bg: 'rgba(255, 138, 101, 0.28)', border: 'rgba(255, 138, 101, 0.55)' },
  { name: 'Teal',   pill: '#2f7d78', pillText: '#e2f6f4', bg: 'rgba(45, 212, 191, 0.28)',  border: 'rgba(45, 212, 191, 0.55)' },
];

export const MAX_REPEAT_GROUPS = REPEAT_COLORS.length;

/** CSS class name applied to an in-text repeat span for a given color index. */
export function repeatHlClass(colorIndex: number): string {
  return `repeat-hl-${colorIndex}`;
}
