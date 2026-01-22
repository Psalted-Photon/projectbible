/**
 * Pack Loading Triggers
 * 
 * Automatically loads packs when user actions require them.
 * Prevents blocking UI while showing progress.
 */

import { writable } from 'svelte/store';
import type { DownloadProgress } from '../../../../packages/core/src/services/PackLoader';
import { loadPackOnDemand } from './progressive-init';
import { PACK_TRIGGERS } from '../config';

// Store for current download progress
export const currentDownload = writable<DownloadProgress | null>(null);
export const showProgressModal = writable(false);

// Track which packs are currently being loaded
const loadingPacks = new Set<string>();
const loadedPacks = new Set<string>();

/**
 * Trigger pack loading based on user action
 */
export async function triggerPackLoad(
  trigger: keyof typeof PACK_TRIGGERS
): Promise<void> {
  // Find packs that match this trigger
  const packsToLoad = Object.entries(PACK_TRIGGERS)
    .filter(([_, packTrigger]) => packTrigger === trigger)
    .map(([packId]) => packId);
  
  if (packsToLoad.length === 0) {
    console.log(`No packs configured for trigger: ${trigger}`);
    return;
  }
  
  // Load packs in parallel
  await Promise.all(
    packsToLoad.map(packId => loadPackIfNeeded(packId))
  );
}

/**
 * Load a pack if it's not already loaded or loading
 */
async function loadPackIfNeeded(packId: string): Promise<void> {
  // Skip if already loaded
  if (loadedPacks.has(packId)) {
    console.log(`Pack ${packId} already loaded`);
    return;
  }
  
  // Skip if currently loading
  if (loadingPacks.has(packId)) {
    console.log(`Pack ${packId} is already loading`);
    return;
  }
  
  loadingPacks.add(packId);
  
  try {
    console.log(`Triggering load for pack: ${packId}`);
    
    // Show progress modal
    showProgressModal.set(true);
    
    // Load pack with progress tracking
    await loadPackOnDemand(packId, (progress) => {
      currentDownload.set(progress);
    });
    
    // Auto-hide modal when complete
    setTimeout(() => {
      showProgressModal.set(false);
      currentDownload.set(null);
    }, 500);
    
    loadedPacks.add(packId);
    console.log(`Pack ${packId} loaded successfully`);
    
  } catch (error) {
    console.error(`Failed to load pack ${packId}:`, error);
    
    // Show error in modal
    currentDownload.set(null);
    showProgressModal.set(false);
    
    // Re-throw to let caller handle
    throw error;
    
  } finally {
    loadingPacks.delete(packId);
  }
}

/**
 * Preload packs in the background (optional)
 */
export async function preloadPacks(packIds: string[]): Promise<void> {
  console.log(`Preloading ${packIds.length} packs in background...`);
  
  for (const packId of packIds) {
    try {
      await loadPackIfNeeded(packId);
    } catch (error) {
      console.error(`Preload failed for ${packId}:`, error);
      // Continue with other packs
    }
  }
}

/**
 * Check if a pack is loaded
 */
export function isPackLoaded(packId: string): boolean {
  return loadedPacks.has(packId);
}

/**
 * Get list of loaded packs
 */
export function getLoadedPacks(): string[] {
  return Array.from(loadedPacks);
}

/**
 * Clear loaded packs cache (for testing)
 */
export function clearLoadedPacksCache(): void {
  loadedPacks.clear();
  loadingPacks.clear();
}
