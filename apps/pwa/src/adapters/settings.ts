/**
 * User Settings Management
 * 
 * Stores user preferences in localStorage
 */

const SETTINGS_KEY = 'projectbible_settings';

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
  theme?: 'light' | 'dark';
  fontSize?: number;
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
 * Update user settings (merges with existing)
 */
export function updateSettings(updates: Partial<UserSettings>): void {
  const current = getSettings();
  const updated = { ...current, ...updates };
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(updated));
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

/**
 * Clear all settings
 */
export function clearSettings(): void {
  localStorage.removeItem(SETTINGS_KEY);
}
