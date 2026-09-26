/**
 * The look a card starts with: the reader's own theme.
 *
 * Someone who has dressed their reader in green on cream should see a green
 * on cream card without touching anything. The fixed themes map to the
 * colours they already paint the reader with.
 */

import { getCustomThemeSettings, getSettings, resolveTheme } from '../../adapters/settings';
import type { CardStyle } from './types';

const THEME_COLOURS: Record<'light' | 'dark' | 'sepia', { text: string; bg: string }> = {
  dark: { text: '#e0e0e0', bg: '#1a1a1a' },
  light: { text: '#1a1a1a', bg: '#fafafa' },
  sepia: { text: '#3b2f22', bg: '#f6f0e3' },
};

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
    bgColor,
    align: 'center',
    position: 'middle',
    sizeNudge: 1,
  };
}
