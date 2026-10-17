/*
 * Background Fetch: pack downloads that keep going without the app.
 *
 * Pulled into the generated service worker via importScripts, after
 * push-handler.js (see workbox.importScripts in vite.config.ts), whose
 * focusOrOpenApp it uses. Plain JS, no imports, no build step.
 *
 * The app starts the download (src/lib/backgroundFetch.ts) and, while it is
 * open, installs each pack straight from it. This file covers what happens
 * when the app is not there to do that: once the whole download is over it
 * saves every file not already on the device into the app's downloaded-pack
 * store, where the next install finds it instead of downloading again, and
 * changes Android's notification to say so.
 *
 * Nothing here is checked against its SHA-256 -- that would mean reading a
 * few hundred megabytes into the worker at once. Each file is saved marked
 * unchecked, and the app checks it the first time it uses it.
 */

/* eslint-disable no-undef */

/* What the app is running, written by backgroundFetch.ts. */
const PACK_RUNS_CACHE = 'irisbible-pack-runs';
const PACK_RUN_KEY = '/__pack-run/current';

/* PackLoader's store, in packages/core. Opened at the same version, with the same upgrade. */
const PACK_DB = 'projectbible-packs';

function openPackDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(PACK_DB, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains('pack_files')) {
        const store = db.createObjectStore('pack_files', { keyPath: 'id' });
        store.createIndex('version', 'version', { unique: false });
      }
      if (!db.objectStoreNames.contains('pack_metadata')) {
        db.createObjectStore('pack_metadata', { keyPath: 'id' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function getFile(db, id) {
  return new Promise((resolve, reject) => {
    const request = db.transaction('pack_files', 'readonly').objectStore('pack_files').get(id);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function putFile(db, entry) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction('pack_files', 'readwrite');
    tx.objectStore('pack_files').put(entry);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('pack file save aborted'));
  });
}

/* The run this download belongs to, or null if the app has moved on from it. */
async function readPackRun(fetchId) {
  const cache = await caches.open(PACK_RUNS_CACHE);
  const response = await cache.match(PACK_RUN_KEY);
  if (!response) return null;
  try {
    const run = await response.json();
    return run && run.fetchId === fetchId ? run : null;
  } catch {
    return null;
  }
}

/*
 * Save every file that arrived and isn't on the device yet. A file is on the
 * device when the store has it under the same checksum: either its bytes,
 * kept until it installs, or the marker a big file leaves once installed.
 */
async function putAwayDownloads(registration) {
  const run = await readPackRun(registration.id);
  if (!run || !Array.isArray(run.files)) return 0;

  const byUrl = new Map(run.files.map((file) => [new URL(file.url, self.location.origin).href, file]));
  const db = await openPackDb();
  let saved = 0;
  try {
    for (const record of await registration.matchAll()) {
      const file = byUrl.get(record.request.url);
      if (!file) continue;
      let response;
      try {
        response = await record.responseReady;
      } catch {
        continue; // This one failed; the app downloads it the usual way.
      }
      if (!response || !response.ok) continue;

      const here = await getFile(db, file.id);
      if (here && here.sha256 === file.sha256) continue;

      const blob = await response.blob();
      if (blob.size !== file.size) continue;
      await putFile(db, {
        id: file.id,
        version: file.version,
        sha256: file.sha256,
        data: blob,
        keep: file.keep,
        size: blob.size,
        verified: false,
        cachedAt: Date.now(),
      });
      saved++;
    }
  } finally {
    db.close();
  }
  return saved;
}

async function appOnScreen() {
  const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  return windows.some((client) => client.visibilityState === 'visible');
}

async function finishPackFetch(event, allArrived) {
  try {
    await putAwayDownloads(event.registration);
  } catch (error) {
    console.warn('[pack-fetch] Could not save downloaded packs:', error);
  }
  let title;
  if (await appOnScreen()) {
    title = allArrived ? 'Packs downloaded — installing now' : 'Some packs didn’t download — getting them now';
  } else {
    title = allArrived
      ? 'Packs downloaded — open irisBible to finish installing'
      : 'Some packs didn’t download — open irisBible to finish';
  }
  try {
    await event.updateUI({ title });
  } catch {
    // Not every browser lets the notification change.
  }
}

self.addEventListener('backgroundfetchsuccess', (event) => {
  event.waitUntil(finishPackFetch(event, true));
});

// Some files failed: keep the ones that arrived. The app downloads the rest
// the usual way when it carries on.
self.addEventListener('backgroundfetchfail', (event) => {
  event.waitUntil(finishPackFetch(event, false));
});

// Cancel on the notification: the run is over, so the app should not pick it
// back up on its next launch.
self.addEventListener('backgroundfetchabort', (event) => {
  event.waitUntil(
    (async () => {
      if (!(await readPackRun(event.registration.id))) return;
      const cache = await caches.open(PACK_RUNS_CACHE);
      await cache.delete(PACK_RUN_KEY);
    })()
  );
});

self.addEventListener('backgroundfetchclick', (event) => {
  event.waitUntil(focusOrOpenApp('/', { type: 'pack-fetch-opened' }));
});
