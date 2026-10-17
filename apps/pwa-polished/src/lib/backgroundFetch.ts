/**
 * Background Fetch: one download for every file a run of installs needs,
 * handed to the browser so it keeps going with the screen locked, another app
 * open, or irisBible swiped away. Android shows its own notification with a
 * true percent. Chrome and Samsung Internet on Android, and desktop Chrome,
 * have it; iPhone and Firefox don't, and keep the one-file-at-a-time path.
 *
 * While the app is open, each pack installs as soon as its own file is in,
 * taken straight from the download (PackLoader's fetchFile, wired up in
 * progressive-init). When the download ends, the service worker saves
 * whatever the app hasn't taken into the downloaded-pack store
 * (public/pack-fetch-handler.js), and the next launch finishes the run
 * (resumePackRun in packInstaller).
 *
 * What the run is, and which files it asked for, is written to a cache both
 * sides can read. It stays there until the run ends in the app, so a run cut
 * short is picked up again on the next launch.
 */

import { USE_BUNDLED_PACKS } from '../config';
import { PackLoader, MAX_CACHED_PACK_BYTES } from '../../../../packages/core/src/services/PackLoader';
import type { PackEntry } from '../../../../packages/core/src/schemas/PackManifest';

/** What started the run, so a later launch can carry on with the same thing. */
export type PackRun = { kind: 'all' } | { kind: 'install' | 'update'; packId: string };

interface RunFile {
  id: string;
  version: string;
  sha256: string;
  size: number;
  /** Stays in the downloaded-pack store for good once installed (small files). */
  keep: boolean;
  url: string;
}

interface StoredRun {
  fetchId: string;
  run: PackRun;
  files: RunFile[];
  /** Launches that have picked this run back up. */
  resumes: number;
}

// The parts of the Background Fetch API used here; TypeScript's DOM types
// don't carry it yet.
interface BgFetchRecord {
  request: Request;
  responseReady: Promise<Response>;
}
interface BgFetchRegistration extends EventTarget {
  id: string;
  downloaded: number;
  downloadTotal: number;
  result: '' | 'success' | 'failure';
  failureReason: string;
  match(request: RequestInfo): Promise<BgFetchRecord | undefined>;
  abort(): Promise<boolean>;
}
interface BgFetchManager {
  fetch(
    id: string,
    requests: string[],
    options: { title: string; icons: Array<{ src: string; sizes: string; type: string }>; downloadTotal: number },
  ): Promise<BgFetchRegistration>;
  get(id: string): Promise<BgFetchRegistration | undefined>;
}

/** The pack a run's progress is reported under while it waits on the whole download. */
export const BACKGROUND_PROGRESS_ID = '(background download)';

/** A run the person cancelled from the notification. Stops the run; nothing is downloaded around it. */
export class InstallCancelled extends Error {
  constructor() {
    super('Download cancelled');
    this.name = 'InstallCancelled';
  }
}

const RUNS_CACHE = 'irisbible-pack-runs';
const RUN_KEY = '/__pack-run/current';
/** A run that keeps failing stops being picked back up after this many launches. */
const MAX_RESUMES = 3;

let active: { reg: BgFetchRegistration; files: Map<string, RunFile> } | null = null;

export function backgroundFetchSupported(): boolean {
  return (
    !USE_BUNDLED_PACKS &&
    typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'BackgroundFetchManager' in window
  );
}

async function backgroundFetchManager(): Promise<BgFetchManager | null> {
  const registration = await navigator.serviceWorker.ready;
  return ((registration as any).backgroundFetch as BgFetchManager | undefined) ?? null;
}

// ── The run record ──────────────────────────────────────────────────────────

async function writeRun(run: StoredRun): Promise<void> {
  const cache = await caches.open(RUNS_CACHE);
  await cache.put(RUN_KEY, new Response(JSON.stringify(run), { headers: { 'Content-Type': 'application/json' } }));
}

async function readRun(): Promise<StoredRun | null> {
  try {
    const cache = await caches.open(RUNS_CACHE);
    const response = await cache.match(RUN_KEY);
    return response ? ((await response.json()) as StoredRun) : null;
  } catch {
    return null;
  }
}

async function clearRun(): Promise<void> {
  try {
    const cache = await caches.open(RUNS_CACHE);
    await cache.delete(RUN_KEY);
  } catch {
    // Nothing to clear, or no cache to clear it from.
  }
}

// ── Starting one ────────────────────────────────────────────────────────────

/** Every file in the manifest a catalog pack's install downloads, shards included. */
function filesForPack(packId: string, entries: PackEntry[]): PackEntry[] {
  return entries.filter(
    (entry) =>
      entry.id === packId ||
      (packId === 'biblical-art' && entry.id.startsWith('biblical-art-images-')) ||
      (packId === 'atlas-map' && (/^atlas-map-\d+$/.test(entry.id) || entry.id === 'atlas-map-places')),
  );
}

/**
 * Whether there is room. Downloads finish faster than installs, so for a
 * while a file can be in three places at once: the browser's download, the
 * saved copy waiting to install, and the installed data. Without that much
 * free, the run goes one file at a time instead.
 */
async function roomFor(bytes: number): Promise<boolean> {
  try {
    const { quota, usage } = await navigator.storage.estimate();
    if (!quota) return true;
    return quota - (usage ?? 0) >= bytes * 3;
  } catch {
    return true;
  }
}

/**
 * Hand every file these packs still need to one background download. Files
 * already saved on the device are left out. False when it didn't start -- no
 * Background Fetch here, nothing to download, not enough room, or the browser
 * refused -- and the run downloads the usual way.
 */
export async function startBackgroundDownload(
  packIds: string[],
  run: PackRun,
  title: string,
): Promise<boolean> {
  if (!backgroundFetchSupported() || packIds.length === 0) return false;
  try {
    const manager = await backgroundFetchManager();
    if (!manager) return false;

    const { getPackLoader } = await import('./progressive-init');
    const loader = getPackLoader();
    const manifest = await loader.fetchManifest();
    const kept = await loader.keptFiles();

    const files: RunFile[] = [];
    for (const packId of packIds) {
      for (const entry of filesForPack(packId, manifest.packs)) {
        if (kept.get(entry.id) === entry.sha256.toLowerCase()) continue;
        if (files.some((f) => f.id === entry.id)) continue;
        files.push({
          id: entry.id,
          version: entry.version,
          sha256: entry.sha256,
          size: entry.size,
          keep: entry.size <= MAX_CACHED_PACK_BYTES,
          url: PackLoader.downloadUrlFor(entry),
        });
      }
    }
    if (files.length === 0) return false;

    const total = files.reduce((sum, f) => sum + f.size, 0);
    if (!(await roomFor(total))) {
      console.log('[BackgroundFetch] Not enough free space for one download; going one file at a time');
      return false;
    }

    const fetchId = `irisbible-packs-${Date.now()}`;
    // Written first: the service worker reads it when the download ends,
    // which for a small one can be before fetch() below has even returned.
    await writeRun({ fetchId, run, files, resumes: 0 });
    const reg = await manager.fetch(
      fetchId,
      files.map((f) => f.url),
      {
        title,
        icons: [{ src: '/pwa-192x192.png', sizes: '192x192', type: 'image/png' }],
        downloadTotal: total,
      },
    );
    active = { reg, files: new Map(files.map((f) => [f.id, f])) };
    console.log(`[BackgroundFetch] Started ${fetchId}: ${files.length} files, ${total} bytes`);
    return true;
  } catch (error) {
    console.warn('[BackgroundFetch] Could not start; downloading the usual way:', error);
    await clearRun();
    return false;
  }
}

// ── Taking files from it ────────────────────────────────────────────────────

/** Resolves once the download is over, one way or the other. */
function settled(reg: BgFetchRegistration): { done: Promise<void>; stop: () => void } {
  let check = () => {};
  const done = new Promise<void>((resolve) => {
    check = () => {
      if (reg.result) resolve();
    };
    reg.addEventListener('progress', check);
    check();
  });
  return { done, stop: () => reg.removeEventListener('progress', check) };
}

/**
 * This pack's file from the background download, once it has arrived. Null
 * when there is none to give -- no download running, the file isn't in it,
 * it failed, or the download is over and the service worker has put it away
 * (PackLoader then finds it saved). Throws InstallCancelled when the person
 * pressed Cancel on the notification.
 *
 * `onWaiting` hears the whole download's progress while this waits.
 */
export async function backgroundResponse(
  packId: string,
  url: string,
  onWaiting: (downloaded: number, total: number) => void,
): Promise<Response | null> {
  if (!active) return null;
  const file = active.files.get(packId);
  if (!file) return null;
  const { reg } = active;
  if (reg.failureReason === 'aborted') throw new InstallCancelled();

  let record: BgFetchRecord | undefined;
  try {
    record = await reg.match(url);
  } catch {
    return null; // The download is over and its files are no longer offered.
  }
  if (!record) return null;

  const report = () => onWaiting(reg.downloaded, reg.downloadTotal);
  report();
  reg.addEventListener('progress', report);
  const over = settled(reg);
  try {
    const response = await Promise.race([
      record.responseReady,
      // Once the whole download is over, a file that still hasn't come is
      // not coming.
      over.done
        .then(() => new Promise((resolve) => setTimeout(resolve, 5000)))
        .then(() => null),
    ]);
    if (reg.failureReason === 'aborted') throw new InstallCancelled();
    return response;
  } catch (error) {
    if (error instanceof InstallCancelled || reg.failureReason === 'aborted') throw new InstallCancelled();
    return null;
  } finally {
    reg.removeEventListener('progress', report);
    over.stop();
  }
}

// ── Ending and resuming ─────────────────────────────────────────────────────

/**
 * The run is over in the app. A download still going is stopped -- nothing
 * would install what it brings -- and the run is not picked up again.
 */
export async function endBackgroundRun(): Promise<void> {
  const current = active;
  active = null;
  if (current && !current.reg.result) {
    await current.reg.abort().catch(() => false);
  }
  await clearRun();
}

/**
 * A run cut short last time -- the app was closed or killed -- with its
 * download attached again if the browser is still running it. Counts as one
 * more try; after a few the run is dropped, so one that can never finish
 * doesn't come back on every launch.
 */
export async function takeUnfinishedRun(): Promise<PackRun | null> {
  if (!backgroundFetchSupported()) return null;
  const stored = await readRun();
  if (!stored) return null;
  if (stored.resumes >= MAX_RESUMES) {
    console.warn('[BackgroundFetch] Dropping a pack run that never finished:', stored.run);
    await clearRun();
    return null;
  }
  try {
    await writeRun({ ...stored, resumes: stored.resumes + 1 });
    const manager = await backgroundFetchManager();
    const reg = await manager?.get(stored.fetchId);
    if (reg) active = { reg, files: new Map(stored.files.map((f) => [f.id, f])) };
  } catch (error) {
    console.warn('[BackgroundFetch] Could not reattach the download:', error);
  }
  return stored.run;
}
