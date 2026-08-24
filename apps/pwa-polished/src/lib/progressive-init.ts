/**
 * Progressive App Initialization
 * 
 * New initialization strategy:
 * 1. Load bootstrap pack (instant, 208KB bundled)
 * 2. Mount app immediately with basic navigation
 * 3. Lazy load packs on-demand from GitHub Releases
 */

import { loadBootstrap } from './bootstrap-loader';
import { APP_VERSION, PACK_MANIFEST_URL, USE_BUNDLED_PACKS, FEATURES } from '../config';
import { importPackFromBytes } from '../adapters/pack-import';
import { listInstalledPacks as listInstalledPacksFromDb, removePack as removePackFromDb } from '../adapters/db-manager';
import { PackLoader } from '../../../../packages/core/src/services/PackLoader';
import type { DownloadProgress } from '../../../../packages/core/src/services/PackLoader';
import { startInstallLog, logInstall, logInstallError } from './install-log';

let bootstrapLoaded = false;
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
 * Initialize app with progressive loading
 */
export async function initializeApp(
  onProgress?: (message: string, percent: number) => void
): Promise<void> {
  try {
    // Step 1: Load bootstrap (instant)
    onProgress?.('Loading bootstrap...', 10);
    await loadBootstrap();
    bootstrapLoaded = true;
    onProgress?.('Bootstrap loaded', 20);
    
    // Step 2: In dev mode, we use bundled packs
    if (USE_BUNDLED_PACKS) {
      onProgress?.('Using bundled packs...', 50);
      onProgress?.('Ready', 100);
    } else {
      // Production mode: preload manifest (non-blocking)
      onProgress?.('Checking pack manifest...', 50);
      try {
        await getPackLoaderInstance().fetchManifest();
      } catch (error) {
        console.warn('Manifest fetch failed:', error);
      }
      onProgress?.('Ready', 100);
    }
    
  } catch (error) {
    console.error('Initialization failed:', error);
    throw error;
  }
}

/**
 * Get the pack loader instance (not implemented yet)
 */
export function getPackLoader(): PackLoader {
  return getPackLoaderInstance();
}

/**
 * Check if bootstrap is loaded
 */
export function isBootstrapLoaded(): boolean {
  return bootstrapLoaded;
}

/**
 * Load a pack on-demand (not implemented yet)
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
        if (!manifestPack || (installedPack.version === manifestPack.version && sameContent)) {
          console.log(`Pack ${packId} already installed and up-to-date (${installedPack.version})`);
          return;
        }
        console.log(
          `Pack ${packId} update available: ${installedPack.version} → ${manifestPack.version}`
          + (sameContent ? '' : ' (contents changed)'),
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
  }
}

/**
 * Get list of installed packs (not implemented yet)
 */
export async function getInstalledPacks(): Promise<string[]> {
  const installed = await listInstalledPacksFromDb();
  return installed.map((pack) => pack.id);
}

/**
 * Remove a cached pack (not implemented yet)
 */
export async function removePack(packId: string): Promise<void> {
  await removePackFromDb(packId);
}
