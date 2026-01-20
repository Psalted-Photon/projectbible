/**
 * Progressive App Initialization
 * 
 * New initialization strategy:
 * 1. Load bootstrap pack (instant, 208KB bundled)
 * 2. Mount app immediately with basic navigation
 * 3. Lazy load packs on-demand from GitHub Releases
 */

import { loadBootstrap } from './bootstrap-loader';
import { PackLoader } from '@projectbible/core';
import type { DownloadProgress } from '@projectbible/core';
import { APP_VERSION, PACK_MANIFEST_URL, USE_BUNDLED_PACKS, FEATURES } from '../config';

let packLoader: PackLoader | null = null;
let bootstrapLoaded = false;

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
    
    // Step 2: Initialize pack loader if using CDN
    if (FEATURES.lazyPackLoading && !USE_BUNDLED_PACKS) {
      onProgress?.('Initializing pack loader...', 30);
      
      packLoader = new PackLoader({
        manifestUrl: PACK_MANIFEST_URL,
        appVersion: APP_VERSION,
        onProgress: (progress: DownloadProgress) => {
          // Convert PackLoader progress to our format
          const percent = 30 + (progress.percentage * 0.7); // 30-100%
          onProgress?.(`${progress.stage}: ${progress.packId}`, Math.round(percent));
        }
      });
      
      // Fetch manifest
      await packLoader.fetchManifest();
      onProgress?.('Manifest loaded', 40);
      
      // Request persistent storage
      if (FEATURES.persistentStorage) {
        await packLoader.requestPersistentStorage();
      }
      
      onProgress?.('Ready', 100);
    } else {
      // Legacy initialization with bundled packs
      onProgress?.('Using bundled packs...', 50);
      
      // This would call the old initializePolishedApp
      // For now, we'll just mark as ready
      onProgress?.('Ready', 100);
    }
    
  } catch (error) {
    console.error('Initialization failed:', error);
    throw error;
  }
}

/**
 * Get the pack loader instance
 */
export function getPackLoader(): PackLoader | null {
  return packLoader;
}

/**
 * Check if bootstrap is loaded
 */
export function isBootstrapLoaded(): boolean {
  return bootstrapLoaded;
}

/**
 * Load a pack on-demand
 */
export async function loadPackOnDemand(
  packId: string,
  _onProgress?: (progress: DownloadProgress) => void
): Promise<void> {
  if (!packLoader) {
    console.warn('Pack loader not initialized, using bundled packs');
    return;
  }
  
  // Check if already installed
  const installed = await packLoader.getInstalledPacks();
  if (installed.includes(packId)) {
    console.log(`Pack ${packId} already installed`);
    return;
  }
  
  console.log(`Loading pack on-demand: ${packId}`);
  
  // Download and install
  await packLoader.installPack(packId);
  
  console.log(`Pack ${packId} installed successfully`);
}

/**
 * Get list of installed packs
 */
export async function getInstalledPacks(): Promise<string[]> {
  if (!packLoader) return [];
  return await packLoader.getInstalledPacks();
}

/**
 * Remove a cached pack
 */
export async function removePack(packId: string): Promise<void> {
  if (!packLoader) {
    throw new Error('Pack loader not initialized');
  }
  
  await packLoader.removeCachedPack(packId);
  console.log(`Pack ${packId} removed`);
}
