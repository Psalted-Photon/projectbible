/**
 * App startup and pack loading.
 *
 * Launch waits on one thing only: that the starter text is on the device. A
 * device that has it mounts straight away; everything else, the pack list
 * included, loads after the app is on screen. Packs download on demand from
 * GitHub Releases.
 */

import { APP_VERSION, PACK_MANIFEST_URL, USE_BUNDLED_PACKS } from '../config';
import {
  importPackFromBytes,
  importArtImageShard,
  importAtlasGeometryShard,
  importAtlasPlaceIndex,
} from '../adapters/pack-import';
import { listInstalledPacks as listInstalledPacksFromDb } from '../adapters/db-manager';
import { PackLoader } from '../../../../packages/core/src/services/PackLoader';
import type { DownloadProgress } from '../../../../packages/core/src/services/PackLoader';
import { startInstallLog, logInstall, logInstallError, endInstallLog } from './install-log';

let packLoader: PackLoader | null = null;
let progressHandler: ((progress: DownloadProgress) => void) | null = null;

function getPackLoaderInstance(): PackLoader {
  if (!packLoader) {
    console.log("🔍 Manifest URL at runtime:", PACK_MANIFEST_URL);
    packLoader = new PackLoader({
      manifestUrl: PACK_MANIFEST_URL,
      appVersion: APP_VERSION,
      onProgress: (progress) => {
        progressHandler?.(progress);
      },
      // Core cannot import the app's logger, so hand it one.
      onStage: (stage, detail) => logInstall(stage, detail)
    });
  }
  return packLoader;
}

function setProgressHandler(handler?: (progress: DownloadProgress) => void): void {
  progressHandler = handler ?? null;
}

/**
 * The text Hexapla ships with, rather than asks for.
 *
 * Served from the app's own origin (staged into public/ by
 * scripts/ensure-starter-pack.mjs), so this is a plain fetch — no manifest, no
 * PackLoader, no release round-trip.
 */
const STARTER_PACK_URL = '/starter.sqlite';

/** The translation the starter carries, and the app's default. */
const STARTER_TRANSLATION = 'NET';

/**
 * Bump when starter.sqlite's content changes, so devices that already have it
 * fetch it again once. Pack versions stay at 1.0.0 before v1, so this is the
 * only signal a corrected starter has.
 *   2 — NET headings no longer carry raw USFM markers ("The \nd Lord\nd*’s").
 */
const STARTER_REVISION = 2;
const STARTER_REVISION_KEY = 'hexapla-starter-revision';

/**
 * Whether this device installed an older starter. A device with no record
 * installed it before revisions were tracked, so it counts as revision 1.
 * If storage cannot be read at all, say current — otherwise every launch
 * would fetch the starter again.
 */
function starterIsStale(): boolean {
  try {
    return Number(localStorage.getItem(STARTER_REVISION_KEY) ?? 1) < STARTER_REVISION;
  } catch {
    return false;
  }
}

function markStarterCurrent(): void {
  try {
    localStorage.setItem(STARTER_REVISION_KEY, String(STARTER_REVISION));
  } catch {
    // Nowhere to record it; the next launch finds the text and moves on.
  }
}

/**
 * Whether the starter pack's contents are already on this device.
 *
 * Deliberately asks TextStore rather than looking for a pack row: an import
 * writes its pack row *before* the verses and can be killed in between — a
 * tab reclaimed under memory pressure, a webview hitting its quota — and a
 * pack row with no verses behind it would read as "installed" forever.
 * getTranslations() only counts a translation that actually has verses.
 *
 * Headings are asked for separately because the starter carries both and this
 * is the only thing that ever re-fetches it. Asking about the verses alone
 * left an install that had lost its headings — to a text pack's wholesale
 * clear, or to a removal — with no way back: NET was present, so this said
 * yes, so the starter was never fetched again, and the standalone headings
 * pack is retired from the manifest. Headings simply never returned. Counting
 * them here makes that install heal itself on the next launch.
 */
export async function hasStarterText(): Promise<boolean> {
  try {
    const { IndexedDBTextStore } = await import('../adapters/TextStore');
    const installed = await new IndexedDBTextStore().getTranslations();
    if (!installed.some((t) => t.id.toUpperCase() === STARTER_TRANSLATION)) return false;
    if (starterIsStale()) return false;
    return await hasSectionHeadings();
  } catch (error) {
    // If the database cannot even be opened there is nothing to install into,
    // and saying "already have it" is the answer that still reaches the reader.
    console.warn('Could not check installed translations:', error);
    return true;
  }
}

/**
 * Whether any section headings are on the device.
 *
 * A count rather than a read: this runs on every launch, ahead of the app
 * being drawn, and the answer only turns on whether the store is empty.
 * An older database that predates the store has none, which is the truth.
 */
async function hasSectionHeadings(): Promise<boolean> {
  const { openDB } = await import('../adapters/db');
  const db = await openDB();
  if (!db.objectStoreNames.contains('section_headings')) return false;

  return await new Promise<boolean>((resolve, reject) => {
    const tx = db.transaction('section_headings', 'readonly');
    const request = tx.objectStore('section_headings').count();
    request.onsuccess = () => resolve(request.result > 0);
    request.onerror = () => reject(request.error);
  });
}

/**
 * Fetch and install the starter pack. Call only when hasStarterText() said no.
 *
 * Gated on NET specifically, not on "any translation at all". A phone whose
 * starter install failed and which then installed the English pack by hand
 * would pass an any-translation check while still missing the one translation
 * the app opens to by default.
 *
 * Never throws. An in-app browser that refuses IndexedDB, or runs out of quota
 * partway, must still reach the reader — which shows its own message when there
 * is nothing to read.
 */
export async function installStarterText(
  onProgress?: (message: string, percent: number) => void
): Promise<void> {
  try {
    onProgress?.('Getting the text...', 20);

    const response = await fetch(STARTER_PACK_URL);
    if (!response.ok) {
      throw new Error(`${response.status} ${response.statusText}`);
    }
    const bytes = new Uint8Array(await response.arrayBuffer());

    onProgress?.('Getting the text...', 60);
    await importPackFromBytes(bytes, 'starter.sqlite');
    markStarterCurrent();
    onProgress?.('Ready', 100);

    console.log('Starter pack installed');
  } catch (error) {
    console.error('Starter pack install failed:', error);
  }
}

/**
 * Fetch the pack list in the background, so the Packs screen has it ready.
 *
 * Deliberately not awaited by startup. It is a network round trip through the
 * proxy to GitHub Releases with no time limit, and on a weak signal waiting for
 * it held the app behind the loading screen. Anything that needs the list
 * fetches it for itself if this has not finished.
 */
export function warmPackManifest(): void {
  if (USE_BUNDLED_PACKS) return;
  getPackLoaderInstance()
    .fetchManifest()
    .catch((error) => console.warn('Manifest fetch failed:', error));
}

/**
 * Get the pack loader instance
 */
export function getPackLoader(): PackLoader {
  return getPackLoaderInstance();
}

/**
 * Load a pack on-demand
 */
export async function loadPackOnDemand(
  packId: string,
  onProgress?: (progress: DownloadProgress) => void
): Promise<void> {
  if (USE_BUNDLED_PACKS) {
    console.log('Using bundled packs - skipping on-demand download');
    return;
  }

  setProgressHandler(onProgress);
  startInstallLog(packId);

  try {
    const installed = await listInstalledPacksFromDb();
    const loader = getPackLoaderInstance();

    // Version-aware installed check: only skip if version matches manifest
    const installedPack = installed.find((pack) => pack.id === packId);
    if (installedPack) {
      try {
        const manifest = await loader.fetchManifest();
        const manifestPack = (manifest as any)?.packs?.find((p: any) => p.id === packId);
        // Compare content, not just version. Pack versions stay put across
        // rebuilds by design, so a version check alone reports a corrected
        // pack as "up to date" and it can never be installed. A pack that
        // predates contentHash has none recorded, so it re-installs once.
        const installedHash = (installedPack as any).contentHash;
        const sameContent = !!installedHash && installedHash === manifestPack?.sha256;
        // Matching hashes say the right bytes were downloaded, not that they
        // finished being imported. An install killed partway leaves stores empty
        // behind a registry row that looks perfect, so check the data too.
        const { packDataLooksComplete } = await import('../adapters/db-manager');
        const dataComplete = await packDataLooksComplete(packId, installedPack.type);
        if (!manifestPack || (installedPack.version === manifestPack.version && sameContent && dataComplete)) {
          console.log(`Pack ${packId} already installed and up-to-date (${installedPack.version})`);
          return;
        }
        console.log(
          `Pack ${packId} update available: ${installedPack.version} → ${manifestPack.version}`
          + (sameContent ? '' : ' (contents changed)')
          + (dataComplete ? '' : ' (last install did not finish)'),
        );
      } catch {
        console.log(`Pack ${packId} already installed`);
        return;
      }
    }

    try {
      let data: Uint8Array | null = await loader.downloadPack(packId);
      const byteLength = data.length;
      logInstall('download-returned', { bytes: byteLength });

      onProgress?.({
        packId,
        loaded: byteLength,
        total: byteLength,
        percentage: 100,
        stage: 'extracting'
      });

      // downloadPack already checked these bytes against the manifest, so the
      // manifest hash is the content hash -- no need to digest 87 MB again.
      const validatedHash = loader.getPackSha256(packId);

      // Start the import, then drop our reference before awaiting it. Holding
      // the array in a local across the await would pin the original for the
      // whole import; the importer releases its own binding once sql.js has
      // taken its copy.
      const importing = importPackFromBytes(data, `${packId}.sqlite`, validatedHash);
      data = null;
      await importing;
      logInstall('import-returned');

      onProgress?.({
        packId,
        loaded: byteLength,
        total: byteLength,
        percentage: 100,
        stage: 'complete'
      });
      logInstall('install-complete');
    } catch (error) {
      logInstallError('install-failed', error);
      console.error(`Pack download failed for ${packId}`, error);
      throw error; // Re-throw to allow caller to handle
    }
  } finally {
    setProgressHandler();
    // Stop shared helpers appending to this run's log once it is over.
    endInstallLog();
  }
}

/** Manifest ids of the art image shards, in install order. */
const ART_SHARD_PREFIX = 'biblical-art-images-';

/**
 * Download and import the art pack's image shards.
 *
 * art.sqlite carries only the scenes now; the images arrive as ~10 MB shards so
 * sql.js never holds the whole 83 MB at once. Each shard goes through
 * PackLoader, so it keeps the retry and SHA-256 validation every other download
 * gets, and its buffer is released before the next one starts.
 */
export async function installArtImageShards(
  onProgress?: (message: string) => void
): Promise<number> {
  const loader = getPackLoaderInstance();
  const manifest = (await loader.fetchManifest()) as any;
  const shards: Array<{ id: string }> = (manifest?.packs ?? [])
    .filter((p: any) => typeof p?.id === 'string' && p.id.startsWith(ART_SHARD_PREFIX))
    .sort((a: any, b: any) => a.id.localeCompare(b.id));

  if (shards.length === 0) {
    logInstall('art-shards-none');
    return 0;
  }

  logInstall('art-shards-begin', { count: shards.length });
  let total = 0;

  for (let i = 0; i < shards.length; i++) {
    const id = shards[i].id;
    onProgress?.(`Installing artwork ${i + 1} of ${shards.length}…`);

    let data: Uint8Array | null = await loader.downloadPack(id);
    // Hand the bytes over and drop our reference before awaiting, so the
    // shard is not pinned in two places while it imports.
    const importing = importArtImageShard(data, { clearFirst: i === 0, label: id });
    data = null;
    total += await importing;
  }

  logInstall('art-shards-done', { images: total });
  return total;
}

/** Manifest ids of the map's geometry shards, in install order. */
const ATLAS_SHARD_PREFIX = 'atlas-map-';
/** The place index is not a shard — it is its own file, installed last. */
const ATLAS_PLACES_ID = 'atlas-map-places';

/**
 * Download and import everything the Historical Map needs beyond its core.
 *
 * atlas-map.sqlite carries the eras, the layer catalogue and the places; the
 * drawn geometry arrives as ~10 MB shards and the place search index as one
 * more file, so sql.js never holds the whole 34 MB at once. Each goes through
 * PackLoader, so it keeps the retry and SHA-256 validation every other download
 * gets, and its buffer is released before the next one starts.
 */
export async function installAtlasParts(
  onProgress?: (message: string) => void
): Promise<{ layers: number; columns: number }> {
  const loader = getPackLoaderInstance();
  const manifest = (await loader.fetchManifest()) as any;
  const entries: Array<{ id: string }> = manifest?.packs ?? [];

  const shards = entries
    .filter(
      (p: any) =>
        typeof p?.id === 'string' &&
        p.id.startsWith(ATLAS_SHARD_PREFIX) &&
        /^atlas-map-\d+$/.test(p.id)
    )
    .sort((a: any, b: any) => a.id.localeCompare(b.id));

  if (shards.length === 0) {
    logInstall('atlas-shards-none');
    return { layers: 0, columns: 0 };
  }

  logInstall('atlas-shards-begin', { count: shards.length });
  let layers = 0;

  for (let i = 0; i < shards.length; i++) {
    const id = shards[i].id;
    onProgress?.(`Installing map layers ${i + 1} of ${shards.length}…`);

    let data: Uint8Array | null = await loader.downloadPack(id);
    // Hand the bytes over and drop our reference before awaiting, so the shard
    // is not pinned in two places while it imports.
    const importing = importAtlasGeometryShard(data, { clearFirst: i === 0, label: id });
    data = null;
    layers += await importing;
  }

  let columns = 0;
  if (entries.some((p: any) => p?.id === ATLAS_PLACES_ID)) {
    onProgress?.('Installing place search…');
    let data: Uint8Array | null = await loader.downloadPack(ATLAS_PLACES_ID);
    const importing = importAtlasPlaceIndex(data);
    data = null;
    columns = await importing;
  }

  logInstall('atlas-shards-done', { layers, columns });
  return { layers, columns };
}
