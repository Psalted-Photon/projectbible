/**
 * Settings sync — the "follows you" subset of settings.
 *
 * SYNCED_KEYS travel across devices (themes, timezone, translations,
 * interlinear, red-letter, section headings). Display/ergonomic settings
 * (font size, line spacing, verse layout, word wrap, rotation, update
 * checks) stay per-device — a phone and a desktop rarely want the same
 * font size.
 *
 * Push: debounced 2s after any settings write (registered as the settings
 * change hook), flushed when the tab hides. Pull: on sign-in and forceSync,
 * applied only when the server row is newer than what this device last
 * synced — never a blind overwrite, and a fresh install never clobbers the
 * account's settings with an empty blob.
 */

import { supabase } from '../supabase/client';
import { upsertUserSettings, fetchUserSettings } from '../supabase/userSettings';
import {
  getSettings,
  updateSettings,
  applyTheme,
  registerSettingsChangeHook,
  type UserSettings,
} from '../../adapters/settings';

const SYNCED_KEYS: (keyof UserSettings)[] = [
  'theme',
  // The Custom theme's typeface and colour presets follow the account — the
  // font *id* travels, not the file, and every device ships every face. An id
  // an older deploy doesn't recognise falls back to the per-translation font.
  'customTheme',
  // The Notes and Journal writing themes travel the same way and for the same
  // reason. Whether their toolbars are slid away does NOT — that is ergonomic,
  // like font size, so notesBarHidden/journalBarHidden stay per-device.
  'notesTheme',
  'journalTheme',
  // Share-card looks saved by name. A photo is never part of a look, so
  // nothing personal or heavy rides along — just fonts, colours and layout.
  'cardLooks',
  // Names given to Highlights categories, like "Family" for green text.
  'highlightNames',
  'timezone',
  'dailyDriverEnglishOT', 'dailyDriverEnglishNT',
  'dailyDriverHebrewOT', 'dailyDriverHebrewNT',
  'dailyDriverGreekOT', 'dailyDriverGreekNT',
  'interlinear',
  'showRedLetter',
  'showSectionHeadings',
  'showArt',
  'themedTitles',
  // US or Metric for the ring's weights-and-measures pill. A preference about
  // the reader, not the device, so it follows the account.
  'measureUnits',
  // Which devotional the Verse of the Day opens, morning/evening, and the
  // reminder times — the reminders themselves live on the server per account.
  'devotionals',
];

const LAST_SYNCED_KEY = 'projectbible_settings_synced_at';
/**
 * When a setting was last changed on this device without reaching the server
 * yet. Set by the change hook, cleared by a successful push. Without it a
 * change made offline was simply dropped: the push bailed and nothing tried
 * again until the next change.
 */
const CHANGED_AT_KEY = 'projectbible_settings_changed_at';

function readKey(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return null; }
}

function writeKey(key: string, value: string | null): void {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch { /* storage unavailable — the next change tries again */ }
}
const PUSH_DEBOUNCE_MS = 2_000;

function pickSynced(settings: UserSettings): Record<string, any> {
  const out: Record<string, any> = {};
  for (const key of SYNCED_KEYS) {
    if (settings[key] !== undefined) out[key] = settings[key];
  }
  return out;
}

let pushTimer: ReturnType<typeof setTimeout> | null = null;

export function scheduleSettingsPush(): void {
  if (pushTimer) clearTimeout(pushTimer);
  pushTimer = setTimeout(() => {
    pushTimer = null;
    void pushSettingsNow();
  }, PUSH_DEBOUNCE_MS);
}

async function pushSettingsNow(): Promise<void> {
  try {
    if (typeof navigator !== 'undefined' && !navigator.onLine) return;
    const { data: { session } } = await supabase.auth.getSession();
    const userId = session?.user?.id;
    if (!userId) return;

    const synced = pickSynced(getSettings());
    // A device with nothing set has nothing to say — never overwrite the
    // account's settings with an empty first-run blob.
    if (Object.keys(synced).length === 0) return;

    const row = await upsertUserSettings(userId, synced);
    localStorage.setItem(LAST_SYNCED_KEY, row.updated_at);
    writeKey(CHANGED_AT_KEY, null);
    console.log('[SettingsSync] Pushed synced settings');
  } catch (err) {
    console.warn('[SettingsSync] Push failed (will retry on next change/sync):', err);
  }
}

/** Push a waiting settings change now instead of after the debounce, e.g. before a reload. */
export async function flushSettingsPush(): Promise<void> {
  if (pushTimer) {
    clearTimeout(pushTimer);
    pushTimer = null;
  }
  await pushSettingsNow();
}

/**
 * Pull the account's synced settings and apply them when newer than what
 * this device last saw. Called from SyncService on sign-in and forceSync.
 */
export async function pullSettings(): Promise<void> {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    const userId = session?.user?.id;
    if (!userId) return;

    const row = await fetchUserSettings(userId);
    if (!row?.settings) {
      // Account has no settings yet — seed it from this device.
      scheduleSettingsPush();
      return;
    }

    // A change made here that never reached the server (offline at the time)
    // and is newer than the account's row: this device has the latest word,
    // so send it rather than overwrite it.
    const changedAt = readKey(CHANGED_AT_KEY);
    if (changedAt && new Date(changedAt).getTime() > new Date(row.updated_at).getTime()) {
      await pushSettingsNow();
      return;
    }

    const lastSynced = localStorage.getItem(LAST_SYNCED_KEY);
    if (lastSynced && new Date(row.updated_at).getTime() <= new Date(lastSynced).getTime()) {
      return; // nothing newer than what we already applied/pushed
    }

    const incoming: Record<string, any> = {};
    for (const key of SYNCED_KEYS) {
      if (row.settings[key] !== undefined) incoming[key] = row.settings[key];
    }
    localStorage.setItem(LAST_SYNCED_KEY, row.updated_at);
    // Another device changed things after this one did; its row wins.
    writeKey(CHANGED_AT_KEY, null);
    if (Object.keys(incoming).length === 0) return;

    applyRemote(incoming);
    console.log('[SettingsSync] Applied newer remote settings:', Object.keys(incoming).join(', '));
  } catch (err) {
    console.warn('[SettingsSync] Pull failed:', err);
  }
}

let applyingRemote = false;

function applyRemote(incoming: Record<string, any>): void {
  // Suppress the change hook while applying — the remote row is already the
  // server state, echoing it straight back up is pointless.
  applyingRemote = true;
  try {
    updateSettings(incoming);
  } finally {
    applyingRemote = false;
  }
  applyTheme(getSettings().theme);
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('settingsUpdated'));
  }
}

// ── Startup wiring (module loads with SyncService) ──────────────────────────

registerSettingsChangeHook(() => {
  if (applyingRemote) return;
  writeKey(CHANGED_AT_KEY, new Date().toISOString());
  scheduleSettingsPush();
});

if (typeof window !== 'undefined') {
  // Back in signal with a change still waiting: send it.
  window.addEventListener('online', () => {
    if (readKey(CHANGED_AT_KEY)) scheduleSettingsPush();
  });
}

if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && pushTimer) {
      clearTimeout(pushTimer);
      pushTimer = null;
      void pushSettingsNow();
    }
  });
}
