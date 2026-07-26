/**
 * Biblical-art pack loader.
 *
 * Imports the bundled /art.sqlite pack (famous public-domain paintings tied to
 * Bible scenes) into IndexedDB. Idempotent and self-contained: opens the DB
 * itself and no-ops once the pack is installed at the current version, so it is
 * safe to call fire-and-forget at startup.
 */
import { openDB } from '../adapters/db';
import { importPackFromSQLite } from '../adapters/pack-import';

const ART_PACK_ID = 'biblical-art';
const ART_PACK_URL = '/art.sqlite';
const ART_PACK_VERSION = '1.0'; // bump alongside pack_version to force a re-import

export async function ensureArtPack(): Promise<void> {
  try {
    const db = await openDB();

    const installed = await new Promise<{ version?: string } | undefined>((resolve) => {
      try {
        const tx = db.transaction('packs', 'readonly');
        const req = tx.objectStore('packs').get(ART_PACK_ID);
        req.onsuccess = () => resolve(req.result as { version?: string } | undefined);
        req.onerror = () => resolve(undefined);
      } catch {
        resolve(undefined);
      }
    });

    if (installed && installed.version === ART_PACK_VERSION) return;

    const res = await fetch(ART_PACK_URL);
    if (!res.ok) {
      console.warn(`[art] ${ART_PACK_URL} unavailable (${res.status}) — skipping art pack`);
      return;
    }

    const blob = await res.blob();
    const file = new File([blob], 'art.sqlite', { type: 'application/x-sqlite3' });
    await importPackFromSQLite(file);
    console.log('[art] Biblical-art pack ready');
  } catch (err) {
    console.warn('[art] Failed to load art pack (non-fatal):', err);
  }
}
