/**
 * The packs check-up: everything this device is still missing for the full
 * app, in one place -- packs never installed, newer versions of installed ones,
 * Read Aloud voices and Voice Control. It feeds the button in Settings → Storage & updates
 * and the dot that leads there from the gear.
 *
 * Counted a few seconds after launch, so it never competes with the reader
 * coming up, and again whenever a pack or a voice comes or goes. An update the
 * reader chose to ignore ("Ignore this update") never counts.
 *
 * Not now on the button's card remembers what was waiting at that moment. The
 * dot stays off until something joins the list that wasn't on it: a pack, a
 * newer version, a voice.
 *
 * Offline, or with the release out of reach, the update list means nothing,
 * so there is no dot at all until the manifest has been read.
 */

import { writable, derived, get } from 'svelte/store';
import type { TtsVoiceInfo } from '../adapters/tts';
import {
  PACK_CATALOG,
  packsStillToInstall,
  voicesStillToInstall,
  voiceDownloadsStillToGet,
  type CatalogPack,
} from './packInstaller';
import { unignoredUpdates, packCheckReached, watchPackUpdates } from './packUpdates';
import { VOICE_DOWNLOADS_EVENT, type VoiceWaiting } from './voice/voicePack';

export interface Checkup {
  /** Catalog packs never installed, in Install all order. */
  missing: CatalogPack[];
  /** Installed packs with a newer version on the release, not ignored. */
  updates: CatalogPack[];
  /** Read Aloud voices this device can run and doesn't have, natural ones first. */
  voices: TtsVoiceInfo[];
  /** Voice Control, when it isn't here or has a newer version. */
  voiceControl: VoiceWaiting[];
  /** One key per waiting item, a version's key carrying its hash. */
  keys: string[];
  /** Counted at least once this session. */
  counted: boolean;
}

/** Missing packs, voices and Voice Control, as last counted. Pack updates come live from packUpdates. */
const counts = writable<{ missing: CatalogPack[]; voices: TtsVoiceInfo[]; voiceControl: VoiceWaiting[]; counted: boolean }>({
  missing: [],
  voices: [],
  voiceControl: [],
  counted: false,
});

export const checkup = derived([counts, unignoredUpdates], ([$counts, $updates]): Checkup => {
  const updates = PACK_CATALOG.filter((p) => $updates[p.id] && !$counts.missing.includes(p));
  return {
    missing: $counts.missing,
    updates,
    voices: $counts.voices,
    voiceControl: $counts.voiceControl,
    keys: [
      ...$counts.missing.map((p) => `pack:${p.id}`),
      ...updates.map((p) => `update:${p.id}:${$updates[p.id]}`),
      ...$counts.voices.map((v) => `voice:${v.id}`),
      ...$counts.voiceControl.map((d) => (d.update ? `update:${d.id}:${d.key}` : `pack:${d.id}`)),
    ],
    counted: $counts.counted,
  };
});

// ── Not now ─────────────────────────────────────────────────────────────────

const NOT_NOW_KEY = 'projectbible_checkup_not_now';

function readNotNow(): Set<string> {
  try {
    const parsed = JSON.parse(localStorage.getItem(NOT_NOW_KEY) ?? '[]');
    return new Set(Array.isArray(parsed) ? parsed : []);
  } catch {
    return new Set();
  }
}

/** What was waiting when the reader last said Not now. */
const notNow = writable<Set<string>>(readNotNow());

/** Put off everything waiting now. Anything new brings the dot back. */
export function checkupNotNow(): void {
  const keys = get(checkup).keys;
  notNow.set(new Set(keys));
  try {
    localStorage.setItem(NOT_NOW_KEY, JSON.stringify(keys));
  } catch {
    // Private browsing: put off for this session at least.
  }
}

/** Whether the dot shows: something is waiting that wasn't put off. */
export const checkupDot = derived(
  [checkup, notNow, packCheckReached],
  ([$checkup, $notNow, $reached]) =>
    $checkup.counted && $reached && $checkup.keys.some((k) => !$notNow.has(k)),
);

// ── Counting ────────────────────────────────────────────────────────────────

let counting: Promise<void> | null = null;
let countAgain = false;

/** Count again. Calls that land mid-count fold into one more pass. */
export function refreshCheckup(): Promise<void> {
  if (counting) {
    countAgain = true;
    return counting;
  }
  counting = (async () => {
    try {
      do {
        countAgain = false;
        const [missing, voices, voiceControl] = await Promise.all([
          packsStillToInstall(),
          voicesStillToInstall(),
          voiceDownloadsStillToGet(),
        ]);
        counts.set({ missing, voices, voiceControl, counted: true });
      } while (countAgain);
    } catch (error) {
      console.warn('[Checkup] Could not count what is missing:', error);
    } finally {
      counting = null;
    }
  })();
  return counting;
}

/** How long after launch the first count waits, so the reader comes up first. */
const LAUNCH_DELAY_MS = 4000;
let started = false;

/** Start the check-up. Safe to call more than once. */
export function startCheckup(): void {
  if (started || typeof window === 'undefined') return;
  started = true;
  window.addEventListener('packsUpdated', () => void refreshCheckup());
  window.addEventListener('voicesUpdated', () => void refreshCheckup());
  window.addEventListener(VOICE_DOWNLOADS_EVENT, () => void refreshCheckup());
  setTimeout(() => {
    watchPackUpdates();
    void refreshCheckup();
  }, LAUNCH_DELAY_MS);
}
