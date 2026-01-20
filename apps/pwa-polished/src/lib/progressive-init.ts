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
    
    // Step 2: In dev mode, we use bundled packs
    if (USE_BUNDLED_PACKS) {
      onProgress?.('Using bundled packs...', 50);
      onProgress?.('Ready', 100);
    } else {
      // Production mode with CDN loading would go here
      // For now, just mark as ready
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
export function getPackLoader(): null {
  return null;
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
export async function loadPackOnDemand(packId: string): Promise<void> {
  console.warn('loadPackOnDemand not implemented yet - packs are bundled in dev mode');
}

/**
 * Get list of installed packs (not implemented yet)
 */
export async function getInstalledPacks(): Promise<string[]> {
  return [];
}

/**
 * Remove a cached pack (not implemented yet)
 */
export async function removePack(packId: string): Promise<void> {
  console.warn('removePack not implemented yet - packs are bundled in dev mode');
}
