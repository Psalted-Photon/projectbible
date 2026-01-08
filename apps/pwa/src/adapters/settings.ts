/**
 * User Settings Management
 * 
 * Stores user preferences in localStorage
 */

const SETTINGS_KEY = 'projectbible_settings';

export interface UserSettings {
  dailyDriverEnglish?: string; // e.g., 'kjv' or 'web'
  dailyDriverHebrew?: string;  // e.g., 'wlc'
  dailyDriverGreek?: string;   // e.g., 'lxx' or 'byz'
  theme?: 'light' | 'dark';
  fontSize?: number;
}

/**
 * Get all user settings
 */
export function getSettings(): UserSettings {
  const stored = localStorage.getItem(SETTINGS_KEY);
  if (stored) {
    try {
      return JSON.parse(stored);
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
    // OT - prefer Hebrew daily driver, fall back to English
    return settings.dailyDriverHebrew || settings.dailyDriverEnglish || 'kjv';
  } else {
    // NT - prefer Greek daily driver, fall back to English
    return settings.dailyDriverGreek || settings.dailyDriverEnglish || 'kjv';
  }
}

/**
 * Get the primary daily driver (English if set, otherwise first available)
 */
export function getPrimaryDailyDriver(): string | undefined {
  const settings = getSettings();
  return settings.dailyDriverEnglish || settings.dailyDriverGreek || settings.dailyDriverHebrew;
}

/**
 * Clear all settings
 */
export function clearSettings(): void {
  localStorage.removeItem(SETTINGS_KEY);
}
