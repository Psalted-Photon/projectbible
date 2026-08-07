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
import { importPackFromSQLite } from '../adapters/pack-import';
import { listInstalledPacks as listInstalledPacksFromDb, removePack as removePackFromDb } from '../adapters/db-manager';
import { PackLoader } from '../../../../packages/core/src/services/PackLoader';
import type { DownloadProgress } from '../../../../packages/core/src/services/PackLoader';

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
      }
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
      const data = await loader.downloadPack(packId);

      onProgress?.({
        packId,
        loaded: data.length,
        total: data.length,
        percentage: 100,
        stage: 'extracting'
      });

      const file = new File([data.slice()], `${packId}.sqlite`, {
        type: 'application/x-sqlite3'
      });

      await importPackFromSQLite(file);

      onProgress?.({
        packId,
        loaded: data.length,
        total: data.length,
        percentage: 100,
        stage: 'complete'
      });
    } catch (error) {
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
