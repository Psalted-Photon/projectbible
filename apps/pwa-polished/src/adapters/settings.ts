/**
 * User Settings Management
 * 
 * Stores user preferences in localStorage
 */

import { getReaderFont } from '../lib/readerFonts';
import { dimTowardsBg, redLetterFor } from '../lib/themeColors';

const SETTINGS_KEY = 'projectbible_settings';

export type InterlinearPreset = 'minimal' | 'study' | 'scholar' | 'custom';

/**
 * Interlinear display preferences for original-language (Greek/Hebrew) reading.
 * The original word is always shown; each other layer is independently toggleable.
 */
export interface InterlinearSettings {
  enabled: boolean;       // master on/off (only applies when a Greek/Hebrew translation is open)
  preset: InterlinearPreset;
  showGloss: boolean;     // English equivalent under each word
  showTranslit: boolean;  // transliteration / pronunciation
  showLemma: boolean;     // dictionary (lexical) form
  showStrongs: boolean;   // Strong's number
  showParsing: boolean;   // morphology / part-of-speech parsing
}

/**
 * Read Aloud (on-device TTS) preferences.
 * Voice files are downloaded once and stored on-device; see src/adapters/tts.ts.
 */
export interface TtsSettings {
  voiceId: string;      // installed Piper voice id (default en_US-lessac-medium)
  rate: number;         // playback speed multiplier (0.8–1.5, default 1.0)
  readHeadings: boolean; // speak section headings before their verse (default false)
  // The two follow-along effects are independent: either, both, or neither.
  highlightVerse: boolean; // tint the verse being read (default true)
  glowFollow: boolean;     // soft glow drifting along the words (default false)
}

/**
 * Wake alarm — a push notification at a set time that offers to read a
 * passage aloud. The schedule is mirrored to Supabase because the server is
 * what actually fires it; see src/lib/alarm/.
 */
export interface WakeAlarmSettings {
  enabled: boolean;
  time: string;      // 'HH:MM', 24-hour, in the user's timezone
  days: number[];    // 0=Sunday … 6=Saturday; empty means every day
  /** What to read: pick up where you left off, a fixed chapter, or the plan's next reading. */
  source: 'continue' | 'chapter' | 'plan';
  book?: string;     // only when source === 'chapter'
  chapter?: number;  // only when source === 'chapter'
}

/**
 * Custom theme — free choice of reader typeface, text colour and background.
 *
 * Only the Bible reader's text area is affected; app chrome, buttons, book
 * category colours and highlight colours are deliberately untouched. Red
 * letter still overrides the text colour when it is switched on.
 *
 * Both preset lists are capped at 10 by the UI. They are separate lists on
 * purpose — the colours that make good text are rarely the ones that make
 * good backgrounds.
 */
export interface CustomThemeSettings {
  /** Font id from lib/readerFonts.ts. '' means keep the per-translation font. */
  fontId: string;
  textColor: string;      // hex
  bgColor: string;        // hex
  textPresets: string[];  // saved swatches, max 10
  bgPresets: string[];    // saved swatches, max 10
}

/** Matches the dark theme, so switching to Custom changes nothing until edited. */
export const DEFAULT_CUSTOM_THEME: CustomThemeSettings = {
  fontId: '',
  textColor: '#e0e0e0',
  bgColor: '#1a1a1a',
  textPresets: [],
  bgPresets: [],
};

/** How many swatches each preset row holds. */
export const MAX_COLOR_PRESETS = 10;

/**
 * Notes / Journal writing-surface theme.
 *
 * Separate from the reader's CustomThemeSettings on purpose: these are two
 * more independent themes, so Notes can be blue-on-green while the Journal is
 * red-on-yellow and the reader is something else again.
 *
 * 'default' keeps the surface exactly as it shipped — the editor's CSS already
 * has a fallback for every variable, so the default mode sets nothing at all
 * rather than re-stating the same values and risking a drift.
 *
 * Colour swatches are deliberately NOT stored here. Both surfaces share the
 * reader's textPresets/bgPresets lists, so a colour saved in one place is
 * available in all three.
 */
export interface EditorThemeSettings {
  mode: 'default' | 'custom';
  /** Font id from lib/readerFonts.ts. '' means the surface's default face. */
  fontId: string;
  textColor: string; // hex
  bgColor: string;   // hex
}

/** Matches the editor's built-in look, so switching to Custom changes nothing until edited. */
export const DEFAULT_EDITOR_THEME: EditorThemeSettings = {
  mode: 'default',
  fontId: '',
  textColor: '#222222',
  bgColor: '#ffffff',
};

/** Which writing surface a theme belongs to. Sticky notes ride on 'notes'. */
export type EditorSurface = 'notes' | 'journal';

/**
 * Biblical-art gallery prefs.
 *
 * Per-device on purpose (not in SYNCED_KEYS): how big the previews are is an
 * ergonomic choice like font size, and a phone and a desktop rarely want the
 * same answer.
 */
export interface ArtSettings {
  /**
   * Edge length of a browse preview, in CSS pixels.
   * At the minimum the gallery stays a compact row list; larger values grow the
   * thumbnail and then switch to a tile grid. See ArtPane.
   */
  previewSize: number;
}

/** Smallest preview the gallery offers -- the layout it had before the slider. */
export const ART_PREVIEW_MIN = 52;
/** Largest preview; beyond this a tile stops being a preview. */
export const ART_PREVIEW_MAX = 240;
/** At or above this edge the row list becomes a tile grid. */
export const ART_GRID_THRESHOLD = 96;

export interface UserSettings {
  // Daily Driver defaults by testament + language family
  dailyDriverEnglishOT?: string; // e.g., 'kjv' or 'web'
  dailyDriverEnglishNT?: string; // e.g., 'kjv' or 'web'
  dailyDriverHebrewOT?: string;  // e.g., 'wlc'
  dailyDriverHebrewNT?: string;  // (rare) Hebrew NT packs if installed
  dailyDriverGreekOT?: string;   // e.g., 'lxx'
  dailyDriverGreekNT?: string;   // e.g., 'opengnt' / 'byz' / 'tr'

  // Back-compat (older settings)
  dailyDriverEnglish?: string;
  dailyDriverHebrew?: string;
  dailyDriverGreek?: string;
  
  // Display settings
  theme?: 'light' | 'dark' | 'auto' | 'sepia' | 'custom';
  customTheme?: CustomThemeSettings; // Reader font + colours, only used when theme === 'custom'
  notesTheme?: EditorThemeSettings;   // Notes writing surface (sticky notes follow it)
  journalTheme?: EditorThemeSettings; // Journal writing surface
  // Whether each surface's formatting toolbar is slid up out of the way.
  // Per-device on purpose (not in SYNCED_KEYS) — an ergonomic choice like font
  // size, and a phone and a desktop rarely want the same answer.
  notesBarHidden?: boolean;   // shared by the Notes pane and verse sticky notes
  journalBarHidden?: boolean;
  fontSize?: number; // Base font size in pixels (default 15)
  lineSpacing?: number; // Line height multiplier (default 1.5)
  verseLayout?: 'one-per-line' | 'paragraph' | 'paragraph-no-verse-numbers'; // Verse layout mode
  wordWrap?: boolean; // Enable/disable word wrapping (default true)
  showSectionHeadings?: boolean; // Show pericope/section headings between verses (default true)
  showArt?: boolean; // Show in-text art icons on scenes that have paintings (default true)
  showRedLetter?: boolean; // Show Jesus' words in red (default true)
  showPlaceMarkers?: boolean; // Dotted underline under multi-word place names (default false; needs ISBE pack)
  // Which menu a tapped word opens. 'radial' is a ring around the word, so the
  // word itself stays readable; 'classic' is the older popup above or below it.
  selectionMenu?: 'classic' | 'radial'; // default 'radial'
  themedTitles?: boolean; // Theme-colored 3D shadow on reader titles/headings (default true)
  interlinear?: InterlinearSettings; // Interlinear view prefs for Greek/Hebrew (default: disabled, gloss-only)
  tts?: TtsSettings; // Read Aloud (on-device TTS) prefs
  art?: ArtSettings; // Biblical-art gallery prefs (preview size)
  wakeAlarm?: WakeAlarmSettings; // Wake alarm push schedule (needs internet at the set time)
  allowRotation?: boolean; // Allow screen to rotate to landscape (default false = portrait locked)
  autoCheckUpdates?: boolean; // Automatically check for updates on app open (default true)

  // Clock / timezone
  // IANA timezone name (e.g. 'America/Chicago'). Defaults to browser-detected
  // timezone. Used by clockStore.localDateStr() for all date comparisons.
  timezone?: string;
}

function normalizeSettings(raw: UserSettings): UserSettings {
  // Migrate older 3-field settings into the new OT/NT model.
  const out: UserSettings = { ...raw };

  if (!out.dailyDriverEnglishOT && out.dailyDriverEnglish) out.dailyDriverEnglishOT = out.dailyDriverEnglish;
  if (!out.dailyDriverEnglishNT && out.dailyDriverEnglish) out.dailyDriverEnglishNT = out.dailyDriverEnglish;

  if (!out.dailyDriverHebrewOT && out.dailyDriverHebrew) out.dailyDriverHebrewOT = out.dailyDriverHebrew;
  if (!out.dailyDriverGreekNT && out.dailyDriverGreek) out.dailyDriverGreekNT = out.dailyDriverGreek;

  // Reasonable defaults if nothing is set (kept minimal)
  return out;
}

/**
 * Get all user settings
 */
export function getSettings(): UserSettings {
  const stored = localStorage.getItem(SETTINGS_KEY);
  if (stored) {
    try {
      return normalizeSettings(JSON.parse(stored));
    } catch {
      return {};
    }
  }
  return {};
}

/**
 * Hook invoked after every settings write so the sync layer can push the
 * synced subset to Supabase. Registered by lib/sync/settingsSync at startup.
 */
type SettingsChangeHook = () => void;
let settingsChangeHook: SettingsChangeHook | null = null;
export function registerSettingsChangeHook(fn: SettingsChangeHook): void {
  settingsChangeHook = fn;
}

/**
 * Update user settings (merges with existing)
 */
export function updateSettings(updates: Partial<UserSettings>): void {
  const current = getSettings();
  const updated = { ...current, ...updates };
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(updated));
  try {
    settingsChangeHook?.();
  } catch (err) {
    console.error('[Settings] change hook error:', err);
  }
}

export function resolveTheme(theme: UserSettings['theme']): 'light' | 'dark' | 'sepia' | 'custom' {
  if (theme === 'auto') {
    if (typeof window !== 'undefined' && window.matchMedia) {
      return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    }
    return 'dark';
  }
  return theme || 'dark';
}

/**
 * Resolve custom theme settings with defaults applied.
 * Safe to call when nothing has been saved yet.
 */
export function getCustomThemeSettings(): CustomThemeSettings {
  const s = getSettings().customTheme;
  return {
    fontId: s?.fontId ?? DEFAULT_CUSTOM_THEME.fontId,
    textColor: s?.textColor || DEFAULT_CUSTOM_THEME.textColor,
    bgColor: s?.bgColor || DEFAULT_CUSTOM_THEME.bgColor,
    textPresets: s?.textPresets ?? [],
    bgPresets: s?.bgPresets ?? [],
  };
}

/** Persist custom theme settings (merges with existing settings object). */
export function updateCustomThemeSettings(updates: Partial<CustomThemeSettings>): void {
  const current = getCustomThemeSettings();
  updateSettings({ customTheme: { ...current, ...updates } });
}

/** Which settings key holds each surface's theme. */
const EDITOR_THEME_KEY: Record<EditorSurface, 'notesTheme' | 'journalTheme'> = {
  notes: 'notesTheme',
  journal: 'journalTheme',
};

/**
 * Resolve a writing surface's theme with defaults applied.
 * Safe to call when nothing has been saved yet.
 */
export function getEditorTheme(surface: EditorSurface): EditorThemeSettings {
  const s = getSettings()[EDITOR_THEME_KEY[surface]];
  return {
    mode: s?.mode === 'custom' ? 'custom' : 'default',
    fontId: s?.fontId ?? DEFAULT_EDITOR_THEME.fontId,
    textColor: s?.textColor || DEFAULT_EDITOR_THEME.textColor,
    bgColor: s?.bgColor || DEFAULT_EDITOR_THEME.bgColor,
  };
}

/** Persist a writing surface's theme (merges with what is already stored). */
export function updateEditorTheme(surface: EditorSurface, updates: Partial<EditorThemeSettings>): void {
  const current = getEditorTheme(surface);
  updateSettings({ [EDITOR_THEME_KEY[surface]]: { ...current, ...updates } });
}

/** Which settings key holds each surface's toolbar-hidden flag. */
const EDITOR_BAR_KEY: Record<EditorSurface, 'notesBarHidden' | 'journalBarHidden'> = {
  notes: 'notesBarHidden',
  journal: 'journalBarHidden',
};

/** Is this surface's formatting toolbar currently slid away? Defaults to showing. */
export function getEditorBarHidden(surface: EditorSurface): boolean {
  return getSettings()[EDITOR_BAR_KEY[surface]] ?? false;
}

/** Remember whether this surface's toolbar is slid away. */
export function setEditorBarHidden(surface: EditorSurface, hidden: boolean): void {
  updateSettings({ [EDITOR_BAR_KEY[surface]]: hidden });
}

/**
 * Push the custom theme onto :root as CSS variables, or clear them.
 *
 * Exported so the settings pane can live-preview without saving first. Every
 * variable is read with a fallback in the reader's CSS, so clearing them
 * returns the reader to its original hardcoded values exactly — that is what
 * keeps Dark, Light and Sepia byte-identical to how they looked before this
 * feature existed.
 */
export function applyCustomThemeVars(custom: CustomThemeSettings | null): void {
  const root = document.documentElement.style;
  const VARS = [
    '--reader-font', '--reader-font-scale', '--reader-lead-scale',
    '--reader-bg', '--reader-text', '--reader-text-dim', '--reader-text-dimmer',
    '--reader-rule', '--reader-red',
  ];

  if (!custom) {
    for (const v of VARS) root.removeProperty(v);
    document.body.classList.remove('custom-font');
    return;
  }

  const font = getReaderFont(custom.fontId);
  // body.custom-font gates the typeface rules in BibleReader. It is only set
  // when a face is actually chosen — "match translation" (and an unknown id
  // arriving from a newer deploy) must leave the per-translation fonts alone,
  // and those rules would otherwise win on specificity and flatten them.
  document.body.classList.toggle('custom-font', !!font);
  if (font) {
    root.setProperty('--reader-font', font.stack);
    root.setProperty('--reader-font-scale', String(font.scale));
    root.setProperty('--reader-lead-scale', String(font.lead));
  } else {
    root.removeProperty('--reader-font');
    root.setProperty('--reader-font-scale', '1');
    root.setProperty('--reader-lead-scale', '1');
  }

  const { textColor: text, bgColor: bg } = custom;
  root.setProperty('--reader-bg', bg);
  root.setProperty('--reader-text', text);
  root.setProperty('--reader-text-dim', dimTowardsBg(text, bg, 0.18));
  root.setProperty('--reader-text-dimmer', dimTowardsBg(text, bg, 0.38));
  // Divider rules under chapter titles and section headings. Hardcoded #444 is
  // near-invisible on the dark theme but reads as a heavy black line on a pale
  // custom background, so it has to be derived too — mostly background, with
  // just enough text mixed in to register.
  root.setProperty('--reader-rule', dimTowardsBg(text, bg, 0.72));
  root.setProperty('--reader-red', redLetterFor(bg));
}

export function applyTheme(theme: UserSettings['theme']): void {
  const resolved = resolveTheme(theme);
  document.body.classList.remove('dark-theme', 'light-theme', 'sepia-theme', 'custom-theme');
  if (resolved === 'dark') {
    document.body.classList.add('dark-theme');
  } else if (resolved === 'sepia') {
    document.body.classList.add('sepia-theme');
  } else if (resolved === 'custom') {
    document.body.classList.add('custom-theme');
  } else {
    document.body.classList.add('light-theme');
  }
  applyCustomThemeVars(resolved === 'custom' ? getCustomThemeSettings() : null);
}

/**
 * Get daily driver translation for a specific language/testament
 * Returns the best translation for cross-references based on book
 */
export function getDailyDriverFor(book: string): string | undefined {
  const settings = getSettings();
  
  // Determine testament/language
  const otBooks = [
    'Genesis', 'Exodus', 'Leviticus', 'Numbers', 'Deuteronomy', 'Joshua', 'Judges', 'Ruth',
    '1 Samuel', '2 Samuel', '1 Kings', '2 Kings', '1 Chronicles', '2 Chronicles',
    'Ezra', 'Nehemiah', 'Esther', 'Job', 'Psalms', 'Proverbs', 'Ecclesiastes', 'Song of Solomon',
    'Isaiah', 'Jeremiah', 'Lamentations', 'Ezekiel', 'Daniel',
    'Hosea', 'Joel', 'Amos', 'Obadiah', 'Jonah', 'Micah', 'Nahum', 'Habakkuk', 'Zephaniah',
    'Haggai', 'Zechariah', 'Malachi'
  ];
  
  if (otBooks.includes(book)) {
    // OT - prefer Hebrew OT, then Greek OT (LXX), then English OT
    return settings.dailyDriverHebrewOT || settings.dailyDriverGreekOT || settings.dailyDriverEnglishOT || settings.dailyDriverEnglish || 'kjv';
  } else {
    // NT - prefer Greek NT, then Hebrew NT (if any), then English NT
    return settings.dailyDriverGreekNT || settings.dailyDriverHebrewNT || settings.dailyDriverEnglishNT || settings.dailyDriverEnglish || 'kjv';
  }
}

/**
 * Get the primary daily driver (English if set, otherwise first available)
 */
export function getPrimaryDailyDriver(): string | undefined {
  const settings = getSettings();
  // Prefer an OT-capable English daily driver since the UI initializes at Genesis.
  return (
    settings.dailyDriverEnglishOT ||
    settings.dailyDriverEnglishNT ||
    settings.dailyDriverGreekOT ||
    settings.dailyDriverGreekNT ||
    settings.dailyDriverHebrewOT ||
    settings.dailyDriverHebrewNT ||
    settings.dailyDriverEnglish ||
    settings.dailyDriverGreek ||
    settings.dailyDriverHebrew
  );
}

/** Layer combinations for each named interlinear preset (the gloss is always on). */
export const INTERLINEAR_PRESETS: Record<
  Exclude<InterlinearPreset, 'custom'>,
  Pick<InterlinearSettings, 'showGloss' | 'showTranslit' | 'showLemma' | 'showStrongs' | 'showParsing'>
> = {
  minimal: { showGloss: true, showTranslit: false, showLemma: false, showStrongs: false, showParsing: false },
  study:   { showGloss: true, showTranslit: false, showLemma: false, showStrongs: true,  showParsing: false },
  scholar: { showGloss: true, showTranslit: true,  showLemma: true,  showStrongs: true,  showParsing: true },
};

/**
 * Resolve interlinear settings with defaults applied (disabled, gloss-only).
 * Safe to call when nothing has been saved yet.
 */
export function getInterlinearSettings(): InterlinearSettings {
  const s = getSettings().interlinear;
  return {
    enabled: s?.enabled ?? false,
    preset: s?.preset ?? 'minimal',
    showGloss: s?.showGloss ?? true,
    showTranslit: s?.showTranslit ?? false,
    showLemma: s?.showLemma ?? false,
    showStrongs: s?.showStrongs ?? false,
    showParsing: s?.showParsing ?? false,
  };
}

/** Persist interlinear settings (merges with existing settings object). */
export function updateInterlinearSettings(updates: Partial<InterlinearSettings>): void {
  const current = getInterlinearSettings();
  updateSettings({ interlinear: { ...current, ...updates } });
}

/**
 * Resolve Read Aloud settings with defaults applied.
 * Safe to call when nothing has been saved yet.
 */
export function getTtsSettings(): TtsSettings {
  const s = getSettings().tts;
  return {
    voiceId: s?.voiceId ?? 'en_US-lessac-medium',
    rate: s?.rate ?? 1.0,
    readHeadings: s?.readHeadings ?? false,
    highlightVerse: s?.highlightVerse ?? true,
    glowFollow: s?.glowFollow ?? false,
  };
}

/** Persist Read Aloud settings (merges with existing settings object). */
export function updateTtsSettings(updates: Partial<TtsSettings>): void {
  const current = getTtsSettings();
  updateSettings({ tts: { ...current, ...updates } });
}

/**
 * Resolve art gallery settings with defaults applied.
 * Defaults to the smallest preview, which is the layout the pane had before
 * the slider existed -- so upgrading changes nothing until it is touched.
 */
export function getArtSettings(): ArtSettings {
  const s = getSettings().art;
  const size = s?.previewSize ?? ART_PREVIEW_MIN;
  return {
    previewSize: Math.min(ART_PREVIEW_MAX, Math.max(ART_PREVIEW_MIN, size)),
  };
}

/** Persist art gallery settings (merges with existing settings object). */
export function updateArtSettings(updates: Partial<ArtSettings>): void {
  const current = getArtSettings();
  updateSettings({ art: { ...current, ...updates } });
}

/**
 * Resolve wake alarm settings with defaults applied (off, 6:00 AM every day,
 * continuing from wherever you last read).
 */
export function getWakeAlarmSettings(): WakeAlarmSettings {
  const s = getSettings().wakeAlarm;
  return {
    enabled: s?.enabled ?? false,
    time: s?.time ?? '06:00',
    days: s?.days ?? [],
    source: s?.source ?? 'continue',
    book: s?.book,
    chapter: s?.chapter,
  };
}

/** Persist wake alarm settings (merges with existing settings object). */
export function updateWakeAlarmSettings(updates: Partial<WakeAlarmSettings>): void {
  const current = getWakeAlarmSettings();
  updateSettings({ wakeAlarm: { ...current, ...updates } });
}

/**
 * The timezone the alarm should fire in — the explicit setting when the user
 * picked one, otherwise whatever this device reports.
 */
export function getEffectiveTimezone(): string {
  return getSettings().timezone || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
}

/**
 * Clear all settings
 */
export function clearSettings(): void {
  localStorage.removeItem(SETTINGS_KEY);
}
