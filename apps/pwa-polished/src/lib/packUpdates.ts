/**
 * Which installed packs have a newer version on the release.
 *
 * Pack versions are held steady across rebuilds, so the manifest's sha256 is
 * what tells a corrected pack apart from the copy on the device: every
 * finished install records the hash it was installed from (contentHash), and a
 * pack whose recorded hash differs from the manifest's has an update.
 *
 * The manifest is fetched once a session, the first time anything asks; the
 * comparison is re-run after every install or update, so a pack drops off the
 * list the moment its new copy is in.
 *
 * Two ways to put an update off:
 *   - Not now: hidden for the rest of this session; it asks again next time.
 *   - Ignore this update: remembered for that version only, so a later one
 *     still shows.
 */

import { writable, derived, get } from 'svelte/store';
import { USE_BUNDLED_PACKS } from '../config';
import { installedPackHashes } from '../adapters/db-manager';
import { getPackLoader } from './progressive-init';

/** Pack id → the newer version's sha256, for installed packs that have one. */
export const packUpdates = writable<Record<string, string>>({});

const IGNORED_KEY = 'projectbible_ignored_pack_updates';

function readIgnored(): Record<string, string> {
  try {
    const raw = localStorage.getItem(IGNORED_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

/** Pack id → the version (sha256) the reader chose to ignore. */
const ignored = writable<Record<string, string>>(readIgnored());
/** Put off with Not now, this session only. */
const notNow = writable<Set<string>>(new Set());

/** Updates still waiting on an answer: not ignored, not put off. */
export const pendingUpdates = derived([packUpdates, ignored, notNow], ([$updates, $ignored, $notNow]) => {
  const out: Record<string, string> = {};
  for (const [id, sha] of Object.entries($updates)) {
    if ($ignored[id] === sha || $notNow.has(id)) continue;
    out[id] = sha;
  }
  return out;
});

/** Packs updated this session, for the "restart to use it" that follows. */
export const updatedThisSession = writable<Set<string>>(new Set());
/** Packs freshly installed this session, likewise. */
export const installedThisSession = writable<Set<string>>(new Set());

let manifestShas: Promise<Record<string, string>> | null = null;

function fetchShas(): Promise<Record<string, string>> {
  manifestShas ??= getPackLoader()
    .fetchManifest()
    .then((m: any) => {
      const out: Record<string, string> = {};
      for (const p of m?.packs ?? []) if (p?.id && p?.sha256) out[p.id] = p.sha256;
      return out;
    })
    .catch((error) => {
      // Offline, or the release unreachable: no updates to offer, and the next
      // check tries again.
      console.warn('Pack update check failed:', error);
      manifestShas = null;
      return {};
    });
  return manifestShas;
}

let checking: Promise<void> | null = null;

/** Compare what is installed with the manifest. Cheap after the first call. */
export function checkPackUpdates(): Promise<void> {
  if (USE_BUNDLED_PACKS) return Promise.resolve();
  checking ??= (async () => {
    try {
      const [shas, installed] = await Promise.all([fetchShas(), installedPackHashes()]);
      const next: Record<string, string> = {};
      for (const [id, hash] of Object.entries(installed)) {
        const latest = shas[id];
        if (latest && latest !== hash) next[id] = latest;
      }
      packUpdates.set(next);
    } catch (error) {
      console.warn('Pack update check failed:', error);
    } finally {
      checking = null;
    }
  })();
  return checking;
}

let listening = false;

/** Start watching: check now, and again whenever a pack is installed or updated. */
export function watchPackUpdates(): void {
  void checkPackUpdates();
  if (listening || typeof window === 'undefined') return;
  listening = true;
  window.addEventListener('packsUpdated', () => void checkPackUpdates());
}

export function notNowUpdate(packId: string): void {
  notNow.update((s) => new Set(s).add(packId));
}

export function ignoreUpdate(packId: string): void {
  const sha = get(packUpdates)[packId];
  if (!sha) return;
  ignored.update((m) => {
    const next = { ...m, [packId]: sha };
    try {
      localStorage.setItem(IGNORED_KEY, JSON.stringify(next));
    } catch {
      // Private browsing: it is ignored for this session at least.
    }
    return next;
  });
}

export function markUpdated(packId: string): void {
  updatedThisSession.update((s) => new Set(s).add(packId));
}

export function markInstalled(packId: string): void {
  installedThisSession.update((s) => new Set(s).add(packId));
}

/**
 * Which packs each kind of window reads, so the window can say when one has
 * a new version. `reloads` is for a pane that picks up the new data by itself
 * once it is in, so it needs no restart.
 */
export const WINDOW_PACKS: Record<string, { packs: string[]; reloads?: boolean }> = {
  map: { packs: ['atlas-map'] },
  timeline: { packs: ['timeline'], reloads: true },
  commentaries: { packs: ['commentaries'] },
  art: { packs: ['biblical-art'] },
  isbe: { packs: ['encyclotopical'] },
  naves: { packs: ['encyclotopical'] },
  person: { packs: ['people-biblical-v1'] },
  wordstudy: { packs: ['dictionary-en', 'lexical'] },
};
