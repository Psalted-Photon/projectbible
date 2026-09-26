/**
 * Where a card's look comes from.
 *
 * The very first card wears the reader's own theme: someone who has dressed
 * their reader in green on cream should see a green on cream card without
 * touching anything. After that the sheet reopens on the last look used, on
 * this device only. Looks saved by name live in settings and sync.
 *
 * Every stored look goes through sanitizeStyle on the way in. It may have come
 * from localStorage written by an older build, or synced from another device
 * on a newer one, and a card must still draw either way.
 */

import { getCustomThemeSettings, getSettings, resolveTheme } from '../../adapters/settings';
import { isValidHex, luminance } from '../themeColors';
import { CARD_GRADIENTS } from './gradients';
import { CARD_SIZES, type CardBackground, type CardStyle, type CardTexture } from './types';

const THEME_COLOURS: Record<'light' | 'dark' | 'sepia', { text: string; bg: string }> = {
  dark: { text: '#e0e0e0', bg: '#1a1a1a' },
  light: { text: '#1a1a1a', bg: '#fafafa' },
  sepia: { text: '#3b2f22', bg: '#f6f0e3' },
};

/** Gold on dark, a deep rust on light: both read as "this word matters". */
function accentFor(bg: string): string {
  return luminance(bg) > 0.45 ? '#9a3412' : '#f2b84b';
}

export function defaultCardStyle(): CardStyle {
  const theme = resolveTheme(getSettings().theme);
  let textColor: string;
  let bgColor: string;
  let fontId = '';
  if (theme === 'custom') {
    const custom = getCustomThemeSettings();
    textColor = custom.textColor;
    bgColor = custom.bgColor;
    fontId = custom.fontId;
  } else {
    ({ text: textColor, bg: bgColor } = THEME_COLOURS[theme]);
  }
  return {
    size: 'square',
    fontId,
    textColor,
    accentColor: accentFor(bgColor),
    bgColor,
    align: 'center',
    position: 'middle',
    sizeNudge: 1,
    background: 'solid',
    gradientId: CARD_GRADIENTS[0].id,
    texture: 'none',
    blur: 0,
    darken: 0.35,
    qr: false,
  };
}

const oneOf = <T extends string>(v: unknown, options: readonly T[], fallback: T): T =>
  options.includes(v as T) ? (v as T) : fallback;
const hex = (v: unknown, fallback: string) => (typeof v === 'string' && isValidHex(v) ? v : fallback);
const num = (v: unknown, lo: number, hi: number, fallback: number) =>
  typeof v === 'number' && Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : fallback;

/** Any stored value → a complete, drawable style. Unknown fields fall back to the defaults. */
export function sanitizeStyle(raw: unknown, base: CardStyle = defaultCardStyle()): CardStyle {
  const s = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  return {
    size: oneOf(s.size, Object.keys(CARD_SIZES) as CardStyle['size'][], base.size),
    fontId: typeof s.fontId === 'string' ? s.fontId : base.fontId,
    textColor: hex(s.textColor, base.textColor),
    accentColor: hex(s.accentColor, base.accentColor),
    bgColor: hex(s.bgColor, base.bgColor),
    align: oneOf(s.align, ['left', 'center'] as const, base.align),
    position: oneOf(s.position, ['top', 'middle', 'bottom'] as const, base.position),
    sizeNudge: num(s.sizeNudge, 0.6, 1.4, base.sizeNudge),
    background: oneOf<CardBackground>(s.background, ['solid', 'gradient', 'photo', 'painting'], base.background),
    gradientId: oneOf(s.gradientId, CARD_GRADIENTS.map((g) => g.id), base.gradientId),
    texture: oneOf<CardTexture>(s.texture, ['none', 'grain', 'paper'], base.texture),
    blur: num(s.blur, 0, 1, base.blur),
    darken: num(s.darken, 0, 1, base.darken),
    qr: typeof s.qr === 'boolean' ? s.qr : base.qr,
  };
}

/**
 * A look applied to this card. A photo or painting belongs to the card it was
 * picked for, not to the look, so a look that used one falls back to its
 * colour unless this card already has an image to put there.
 */
export function applyLook(look: CardStyle, hasImage: boolean): CardStyle {
  const style = sanitizeStyle(look);
  const wantsImage = style.background === 'photo' || style.background === 'painting';
  return wantsImage && !hasImage ? { ...style, background: 'solid' } : style;
}

// ── Last look, this device only ──────────────────────────────────────────────

const LAST_KEY = 'share-card-last-style';

export function restoreLastStyle(): CardStyle {
  try {
    const raw = localStorage.getItem(LAST_KEY);
    if (raw) return applyLook(JSON.parse(raw), false);
  } catch {
    /* no storage, or an unreadable value: start from the theme */
  }
  return defaultCardStyle();
}

export function rememberLastStyle(style: CardStyle): void {
  try {
    localStorage.setItem(LAST_KEY, JSON.stringify(style));
  } catch {
    /* no storage: the next card starts from the theme again */
  }
}
