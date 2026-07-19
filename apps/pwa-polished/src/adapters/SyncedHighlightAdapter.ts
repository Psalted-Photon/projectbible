/**
 * SyncedHighlightAdapter
 *
 * Sole owner of user_word_highlights sync (pull apply + realtime), and home
 * of the highlight remote-change emitter that BibleReader subscribes to for
 * re-rendering. Verse highlights (user_highlights) are owned exclusively by
 * SyncedUserDataStore — it bridges into notifyHighlightChange below so the
 * reader still repaints when a remote verse highlight arrives.
 */

import { syncService } from '../lib/sync';
import { realtimeService } from '../lib/sync/RealtimeService';
import { shouldApplyRemoteChange } from '../lib/sync/conflictResolver';
import { reconcileDeletedRows } from '../lib/sync/reconcileDeletes';
import { openDB, writeTransaction } from './db';

// ---------------------------------------------------------------------------
// Remote-change event emitter
// Components subscribe to be notified when a remote highlight arrives.
// ---------------------------------------------------------------------------

type HighlightChangeListener = () => void;
const highlightChangeListeners = new Set<HighlightChangeListener>();

export function subscribeToHighlightRemoteChanges(fn: HighlightChangeListener): () => void {
  highlightChangeListeners.add(fn);
  return () => highlightChangeListeners.delete(fn);
}

export function notifyHighlightChange(): void {
  highlightChangeListeners.forEach((fn) => fn());
}

// ---------------------------------------------------------------------------
// Word highlights
// ---------------------------------------------------------------------------

function buildWordHighlightRecord(row: any) {
  return {
    id: row.id,
    book: row.book,
    chapter: row.chapter,
    verse: row.verse,
    translation: row.translation,
    wordStart: row.word_start,
    wordLength: row.word_length,
    style: row.style ? (typeof row.style === 'string' ? row.style : JSON.stringify(row.style)) : '{}',
    createdAt: row.created_at ? new Date(row.created_at).getTime() : Date.now(),
  };
}

export async function applyRemoteWordHighlights(
  rows: any[],
  opts: { fullPull?: boolean } = {},
): Promise<void> {
  if (opts.fullPull) {
    await reconcileDeletedRows('user_word_highlights', rows);
  }
  if (!rows || rows.length === 0) return;

  const db = await openDB();
  let applied = 0;
  for (const row of rows) {
    const local = await new Promise<any>((resolve) => {
      const tx = db.transaction('user_word_highlights', 'readonly');
      const req = tx.objectStore('user_word_highlights').get(row.id);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(undefined);
    });
    if (!local || shouldApplyRemoteChange(local.createdAt, row.created_at)) {
      await writeTransaction('user_word_highlights', (store) => store.put(buildWordHighlightRecord(row)));
      applied++;
    }
  }
  if (applied > 0) console.log(`[SyncedHighlight] Applied ${applied} word highlight(s)`);
}

// ---------------------------------------------------------------------------
// SyncStore — receives lifecycle calls from SyncService.onSignIn/onSignOut
// so Realtime handlers are set up after the channel is connected.
// ---------------------------------------------------------------------------

let unsubscribes: (() => void)[] = [];
let initialized = false;

const highlightSyncStore = {
  async initialize(): Promise<void> {
    if (initialized) return;
    initialized = true;

    unsubscribes.push(
      realtimeService.onTableChange('user_word_highlights', async (change) => {
        if (change.eventType === 'DELETE' && change.old?.id) {
          await writeTransaction('user_word_highlights', (store) => store.delete(change.old!.id));
        } else if (change.new) {
          await applyRemoteWordHighlights([change.new]);
        }
        notifyHighlightChange();
      })
    );
  },

  dispose(): void {
    unsubscribes.forEach((fn) => fn());
    unsubscribes = [];
    initialized = false;
  },
};

// ---------------------------------------------------------------------------
// Register with SyncService — user_word_highlights ONLY. user_highlights is
// registered by SyncedUserDataStore; double-registering here made the pull
// winner depend on import order and applied every realtime event twice.
// ---------------------------------------------------------------------------

syncService.registerSyncStore(highlightSyncStore);
syncService.registerApplyFn('user_word_highlights', (rows) =>
  applyRemoteWordHighlights(rows, { fullPull: true }));
