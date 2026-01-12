/**
 * Re-export adapters - now copied locally
 * Both versions share the same IndexedDB database
 */

export { IndexedDBTextStore } from '../adapters/TextStore.js';
export { IndexedDBPackManager } from '../adapters/PackManager.js';
export { openDB } from '../adapters/db.js';
