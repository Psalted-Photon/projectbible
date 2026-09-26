/**
 * Gradient backgrounds.
 *
 * Each is two colours on a diagonal with a soft glow of a third laid over one
 * corner. That glow is what makes it read as a modern "mesh" gradient rather
 * than a 2000s web button. Every preset carries the text colour it was chosen
 * with, so picking one gives a readable card straight away.
 */

export interface CardGradient {
  id: string;
  label: string;
  from: string;
  to: string;
  glow: string;
  /** Text colour it reads well with. */
  text: string;
  /** Accent colour that sits well on it. */
  accent: string;
}

/**
 * Twenty, in three runs: soft and pastel, then earthy and neutral, then deep
 * and dark. Ids are saved in looks and synced, so never rename one.
 */
export const CARD_GRADIENTS: CardGradient[] = [
  // Soft
  { id: 'blush', label: 'Blush', from: '#fbd3e9', to: '#f7a6c1', glow: '#fff0f6', text: '#4a1d33', accent: '#be185d' },
  { id: 'rose', label: 'Rose', from: '#ffecd2', to: '#f4a79d', glow: '#ffffff', text: '#4a2320', accent: '#9f1239' },
  { id: 'peach', label: 'Peach', from: '#ffe1c4', to: '#ffb199', glow: '#fff5ea', text: '#4a2517', accent: '#c2410c' },
  { id: 'coral', label: 'Coral', from: '#ffb4a2', to: '#ff7b8f', glow: '#ffe3d8', text: '#3d0f1a', accent: '#7a0c2e' },
  { id: 'lavender', label: 'Lavender', from: '#e0c3fc', to: '#b8a9f3', glow: '#f5ecff', text: '#2e1f4f', accent: '#6d28d9' },
  { id: 'lilac', label: 'Lilac', from: '#e6c6e6', to: '#a8dde4', glow: '#ffffff', text: '#2f2340', accent: '#9d174d' },
  { id: 'dawn', label: 'Dawn', from: '#f6d365', to: '#fda085', glow: '#fff4d6', text: '#3a1f0f', accent: '#9a3412' },
  { id: 'sky', label: 'Sky', from: '#a1c4fd', to: '#c2e9fb', glow: '#ffffff', text: '#1b2a41', accent: '#1d4ed8' },
  // Earthy
  { id: 'sand', label: 'Sand', from: '#f3e7d3', to: '#d8b98a', glow: '#fffaf0', text: '#3b2f22', accent: '#8a4b12' },
  { id: 'mauve', label: 'Mauve', from: '#5e3a5b', to: '#b0728f', glow: '#e6b3c9', text: '#fff1f6', accent: '#ffd1dc' },
  { id: 'olive', label: 'Olive', from: '#3a4a26', to: '#8a9a5b', glow: '#c9d49a', text: '#f5f1e0', accent: '#f2d27a' },
  { id: 'leather', label: 'Leather', from: '#3e2415', to: '#8b5a2b', glow: '#c68a4e', text: '#fbeede', accent: '#f4c27a' },
  // Deep
  { id: 'dusk', label: 'Dusk', from: '#2b1055', to: '#d53369', glow: '#ff9a8b', text: '#fff4e8', accent: '#ffd27a' },
  { id: 'ember', label: 'Ember', from: '#1a0f0a', to: '#7a2e12', glow: '#d9772b', text: '#ffe8c7', accent: '#ffb347' },
  { id: 'forest', label: 'Forest', from: '#0b2e22', to: '#1f5f3f', glow: '#6fa36b', text: '#f0f5e8', accent: '#e9c46a' },
  { id: 'sea', label: 'Sea', from: '#0f2027', to: '#2c5364', glow: '#4f8a9c', text: '#e8f4f8', accent: '#7fd6e8' },
  { id: 'slate', label: 'Slate', from: '#1e2b3a', to: '#4b6584', glow: '#8fa8c4', text: '#f1f5f9', accent: '#fbbf24' },
  { id: 'storm', label: 'Storm', from: '#1f2a36', to: '#5a6978', glow: '#a3b1bf', text: '#f4f6f8', accent: '#f59e0b' },
  { id: 'steel', label: 'Steel', from: '#1c1d20', to: '#434649', glow: '#7b8794', text: '#eef2f5', accent: '#e8b04a' },
  { id: 'night', label: 'Night', from: '#0b0b1e', to: '#1d2b64', glow: '#5b6fd6', text: '#e6e9ff', accent: '#f2c14e' },
];

export function getGradient(id: string): CardGradient {
  return CARD_GRADIENTS.find((g) => g.id === id) ?? CARD_GRADIENTS[0];
}

export function drawGradient(ctx: CanvasRenderingContext2D, g: CardGradient, W: number, H: number): void {
  const lin = ctx.createLinearGradient(0, 0, W, H);
  lin.addColorStop(0, g.from);
  lin.addColorStop(1, g.to);
  ctx.fillStyle = lin;
  ctx.fillRect(0, 0, W, H);

  // The glow: a wide soft light from the top-right corner.
  const r = Math.max(W, H) * 0.85;
  const glow = ctx.createRadialGradient(W * 0.85, H * 0.1, 0, W * 0.85, H * 0.1, r);
  glow.addColorStop(0, hexA(g.glow, 0.55));
  glow.addColorStop(1, hexA(g.glow, 0));
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, W, H);

  // And a faint echo of the far colour from the bottom-left, so the corners differ.
  const echo = ctx.createRadialGradient(W * 0.1, H * 0.95, 0, W * 0.1, H * 0.95, r * 0.7);
  echo.addColorStop(0, hexA(g.to, 0.45));
  echo.addColorStop(1, hexA(g.to, 0));
  ctx.fillStyle = echo;
  ctx.fillRect(0, 0, W, H);
}

/** "#rrggbb" + alpha → "rgba(...)". */
export function hexA(hex: string, a: number): string {
  const n = parseInt(hex.replace('#', ''), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

/** CSS for a picker swatch that looks like the gradient. */
export function gradientCss(g: CardGradient): string {
  return `radial-gradient(circle at 85% 10%, ${hexA(g.glow, 0.55)}, transparent 70%), linear-gradient(135deg, ${g.from}, ${g.to})`;
}
