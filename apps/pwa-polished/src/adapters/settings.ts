/**
 * User Settings Management
 * 
 * Stores user preferences in localStorage
 */

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
  theme?: 'light' | 'dark' | 'auto' | 'sepia';
  fontSize?: number; // Base font size in pixels (default 15)
  lineSpacing?: number; // Line height multiplier (default 1.5)
  verseLayout?: 'one-per-line' | 'paragraph' | 'paragraph-no-verse-numbers'; // Verse layout mode
  wordWrap?: boolean; // Enable/disable word wrapping (default true)
  showSectionHeadings?: boolean; // Show pericope/section headings between verses (default true)
  showArt?: boolean; // Show in-text art icons on scenes that have paintings (default true)
  showRedLetter?: boolean; // Show Jesus' words in red (default true)
  showPlaceMarkers?: boolean; // Dotted underline under multi-word place names (default false; needs ISBE pack)
  themedTitles?: boolean; // Theme-colored 3D shadow on reader titles/headings (default true)
  interlinear?: InterlinearSettings; // Interlinear view prefs for Greek/Hebrew (default: disabled, gloss-only)
  tts?: TtsSettings; // Read Aloud (on-device TTS) prefs
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

export function resolveTheme(theme: UserSettings['theme']): 'light' | 'dark' | 'sepia' {
  if (theme === 'auto') {
    if (typeof window !== 'undefined' && window.matchMedia) {
      return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    }
    return 'dark';
  }
  return theme || 'dark';
}

export function applyTheme(theme: UserSettings['theme']): void {
  const resolved = resolveTheme(theme);
  document.body.classList.remove('dark-theme', 'light-theme', 'sepia-theme');
  if (resolved === 'dark') {
    document.body.classList.add('dark-theme');
  } else if (resolved === 'sepia') {
    document.body.classList.add('sepia-theme');
  } else {
    document.body.classList.add('light-theme');
  }
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
 * Clear all settings
 */
export function clearSettings(): void {
  localStorage.removeItem(SETTINGS_KEY);
}
