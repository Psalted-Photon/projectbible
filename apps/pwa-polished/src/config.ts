/// <reference types="vite/client" />

/**
 * App Configuration
 * 
 * Central configuration for the ProjectBible app.
 */

export const APP_VERSION = '1.0.0';

// Pack manifest URL (GitHub Releases)
// Update this URL when you publish a new pack release
export const PACK_MANIFEST_URL = 
  import.meta.env.PROD
    ? "/api/packs/manifest.json"          // Production → Proxy → GitHub Releases
    : "/packs/consolidated/manifest.json"; // Dev fallback → public/

// Whether to use bundled packs (local development) or download from CDN
export const USE_BUNDLED_PACKS = import.meta.env.DEV || import.meta.env.VITE_USE_BUNDLED_PACKS === 'true';

// Bootstrap pack location (always bundled with app)
export const BOOTSTRAP_PACK_URL = '/bootstrap.sqlite';

// Feature flags
export const FEATURES = {
  lazyPackLoading: !USE_BUNDLED_PACKS,
  persistentStorage: true,
  progressiveStartup: !USE_BUNDLED_PACKS,
  packUpdates: !USE_BUNDLED_PACKS
};

// Pack loading priority (packs loaded in this order when needed)
export const PACK_PRIORITY = {
  essential: ['bootstrap'],
  high: ['translations'],
  medium: ['study-tools', 'lexical'],
  low: ['ancient-languages', 'bsb-audio-pt1', 'bsb-audio-pt2']
};

// Pack loading triggers (when to load each pack)
export const PACK_TRIGGERS = {
  'translations': 'reader-open', // Load when user opens reader
  'ancient-languages': 'hebrew-greek-toggle', // Load when user switches to Hebrew/Greek
  'lexical': 'word-study-open', // Load when user opens word study panel
  'study-tools': 'maps-open', // Load when user opens maps/chronology
  'bsb-audio-pt1': 'audio-play', // Load when user clicks play (OT)
  'bsb-audio-pt2': 'audio-play' // Load when user clicks play (NT)
};

// UI Configuration
export const UI = {
  showProgressDuringDownload: true,
  allowPackRemoval: true,
  showStorageUsage: true,
  promptForPersistentStorage: true
};
