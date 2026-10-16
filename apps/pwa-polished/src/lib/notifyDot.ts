/**
 * notifyDot.ts
 *
 * The notification dot's size and color, set in Settings → Appearance. Per
 * device, like Bar size: the settings sync only passes along the keys it
 * lists, and these aren't among them.
 *
 * Both go onto :root as `--notify-dot-size` and `--notify-dot-color`, which
 * NotifyDot.svelte reads, so every dot changes at once.
 *
 * Accent is the app's indigo, the color of the Settings icons. The themes only
 * color the reader's text, so there is no per-theme accent to follow.
 */

export type DotSize = 'small' | 'normal' | 'large';
export type DotColor = 'accent' | 'red' | 'orange' | 'gold' | 'green' | 'white';

export const DOT_SIZES: { value: DotSize; label: string }[] = [
  { value: 'small', label: 'Small' },
  { value: 'normal', label: 'Normal' },
  { value: 'large', label: 'Large' },
];

export const DOT_COLORS: { value: DotColor; label: string; color: string }[] = [
  { value: 'accent', label: 'Accent', color: '#667eea' },
  { value: 'red', label: 'Red', color: '#e5484d' },
  { value: 'orange', label: 'Orange', color: '#f76b15' },
  { value: 'gold', label: 'Gold', color: '#e6b84a' },
  { value: 'green', label: 'Green', color: '#30a46c' },
  { value: 'white', label: 'White', color: '#f0f0f0' },
];

const PX: Record<DotSize, number> = { small: 6, normal: 8, large: 11 };

/** Put the dot's size and color on the page. */
export function applyNotifyDot(size: DotSize | undefined, color: DotColor | undefined): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement.style;
  root.setProperty('--notify-dot-size', `${PX[size ?? 'normal'] ?? PX.normal}px`);
  root.setProperty(
    '--notify-dot-color',
    (DOT_COLORS.find((c) => c.value === color) ?? DOT_COLORS[0]).color,
  );
}
