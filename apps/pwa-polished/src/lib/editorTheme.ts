/**
 * Writing-surface theming for the Notes and Journal editors.
 *
 * LexicalEditor's CSS already reads everything it needs from CSS variables
 * (--background-color, --text-color, --font-family, and the toolbar chrome),
 * each with a hardcoded fallback. This module turns a saved EditorThemeSettings
 * into exactly those variables, so a custom theme is a handful of declarations
 * on one element and 'default' is the empty string — literally nothing set,
 * which is the only way to guarantee Default stays pixel-identical to how the
 * editors shipped.
 *
 * The variables go on the editor's own root element rather than on :root
 * because Notes and the Journal can be open side by side in the window system
 * and must be able to hold different themes at the same time.
 */

import { getReaderFont } from './readerFonts';
import { luminance, mix } from './themeColors';
import type { EditorThemeSettings } from '../adapters/settings';

/** The editor's own defaults, which the font multipliers are applied against. */
const BASE_PX = 16;
const BASE_LEAD = 1.6;

/**
 * The toolbar has to sit on whatever background the user picked. Deriving its
 * chrome from the chosen pair keeps it coherent: pick a near-black background
 * and you get a dark toolbar with pale buttons, rather than the shipped white
 * buttons stranded on it.
 *
 * Everything is a mix towards the *text* colour, which is by definition the
 * colour that reads against this background — nudging towards white or black
 * would disappear at one end of the range or the other.
 */
function chrome(text: string, bg: string) {
  return {
    /** Toolbar strip: a shade off the page so the two read as separate bands. */
    toolbarBg: mix(bg, text, 0.09),
    /** Buttons sit on the toolbar, so they step back towards the page colour. */
    buttonBg: mix(bg, text, 0.03),
    buttonHoverBg: mix(bg, text, 0.16),
    /** Visible but quiet — the same weight the shipped #ddd has on white. */
    borderColor: mix(bg, text, 0.22),
    /** Placeholder text: present, clearly not real content. */
    placeholderColor: mix(bg, text, 0.5),
  };
}

/**
 * Accent (active format buttons, the unsaved dot).
 *
 * The shipped #007aff is a mid blue that vanishes against a dark navy page and
 * shouts against a pale one, so it is nudged towards white or black to keep it
 * legible either way rather than being recoloured to something arbitrary — it
 * should still read as "the accent blue".
 */
function accentFor(bg: string): string {
  const base = '#007aff';
  const l = luminance(bg);
  if (l < 0.18) return mix(base, '#ffffff', 0.35); // dark page: lift it
  if (l > 0.75) return mix(base, '#000000', 0.12); // pale page: settle it
  return base;
}

/**
 * Inline `style` string of CSS variables for a themed writing surface.
 * Returns '' for the default theme so the editor's own fallbacks apply.
 */
export function editorThemeVars(theme: EditorThemeSettings): string {
  if (theme.mode !== 'custom') return '';

  const { textColor: text, bgColor: bg } = theme;
  const c = chrome(text, bg);
  const font = getReaderFont(theme.fontId);

  const decls = [
    `--background-color: ${bg}`,
    `--text-color: ${text}`,
    `--toolbar-bg: ${c.toolbarBg}`,
    `--button-bg: ${c.buttonBg}`,
    `--button-hover-bg: ${c.buttonHoverBg}`,
    `--border-color: ${c.borderColor}`,
    `--placeholder-color: ${c.placeholderColor}`,
    `--accent-color: ${accentFor(bg)}`,
  ];

  // No face chosen means "keep the surface's own default" — leave the type
  // variables unset so the editor's Milonga fallback stays in charge.
  if (font) {
    decls.push(`--font-family: ${font.stack}`);
    // The same x-height normalisation the reader does. Without it Tangerine
    // lands at about half the size of Bitter at the identical pixel value and
    // Rock Salt overshoots — the multipliers in readerFonts.ts exist to make
    // the faces comparable, and they are just as necessary here.
    decls.push(`--font-size: calc(${BASE_PX}px * ${font.scale})`);
    decls.push(`--editor-lead: calc(${BASE_LEAD} * ${font.lead})`);
  }

  return decls.join('; ');
}

/**
 * Preview colours for the theme panel's sample line, matching what the reader's
 * preview does — inline styles rather than the variables, so the sample tracks
 * a colour drag that has not been committed yet.
 */
export function editorPreviewStyle(theme: EditorThemeSettings): string {
  const font = getReaderFont(theme.fontId);
  const face = font ? font.stack : "'Milonga', cursive";
  // Same multipliers as the real thing, so the sample is not a flattering lie.
  const size = BASE_PX * (font ? font.scale : 1);
  const lead = BASE_LEAD * (font ? font.lead : 1);
  return [
    `background: ${theme.bgColor}`,
    `color: ${theme.textColor}`,
    `font-family: ${face}`,
    `font-size: ${size}px`,
    `line-height: ${lead}`,
  ].join('; ');
}
