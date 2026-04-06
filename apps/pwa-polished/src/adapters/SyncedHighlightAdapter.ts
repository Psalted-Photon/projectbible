/**
 * SyncedHighlightAdapter
 *
 * Registers remote-pull apply functions for user_highlights and
 * user_word_highlights with the SyncService so that on sign-in the data
 * is fetched from Supabase and written into IndexedDB.
 *
 * Also registers a SyncStore so that Realtime events for both tables are
 * handled in real-time, giving instant cross-device highlight sync.
 */

import { syncService } from '../lib/sync';
import { realtimeService } from '../lib/sync/RealtimeService';
import { writeTransaction } from './db';

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

function notifyHighlightChange(): void {
  highlightChangeListeners.forEach((fn) => fn());
}

// ---------------------------------------------------------------------------
// Shared record builders
// ---------------------------------------------------------------------------

function buildHighlightRecord(row: any) {
  return {
    id: row.id,
    book: row.book,
    chapter: row.chapter,
    verse: row.verse,
    color: row.color ?? '#ffeb3b',
    // style may come as a parsed object from Supabase JSONB or a string
    style: row.style ? (typeof row.style === 'string' ? row.style : JSON.stringify(row.style)) : undefined,
    createdAt: row.created_at ? new Date(row.created_at).getTime() : Date.now(),
  };
}

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

// ---------------------------------------------------------------------------
// Bulk-pull helpers (called by SyncService.pullTable on sign-in)
// ---------------------------------------------------------------------------

async function applyRemoteHighlights(rows: any[]): Promise<void> {
  if (!rows || rows.length === 0) return;
  for (const row of rows) {
    await writeTransaction('user_highlights', (store) => store.put(buildHighlightRecord(row)));
  }
  console.log(`[SyncedHighlight] Applied ${rows.length} verse highlight(s)`);
}

async function applyRemoteWordHighlights(rows: any[]): Promise<void> {
  if (!rows || rows.length === 0) return;
  for (const row of rows) {
    await writeTransaction('user_word_highlights', (store) => store.put(buildWordHighlightRecord(row)));
  }
  console.log(`[SyncedHighlight] Applied ${rows.length} word highlight(s)`);
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
      realtimeService.onTableChange('user_highlights', async (change) => {
        if (change.eventType === 'DELETE' && change.old?.id) {
          await writeTransaction('user_highlights', (store) => store.delete(change.old!.id));
        } else if (change.new) {
          await writeTransaction('user_highlights', (store) => store.put(buildHighlightRecord(change.new)));
        }
        notifyHighlightChange();
      })
    );

    unsubscribes.push(
      realtimeService.onTableChange('user_word_highlights', async (change) => {
        if (change.eventType === 'DELETE' && change.old?.id) {
          await writeTransaction('user_word_highlights', (store) => store.delete(change.old!.id));
        } else if (change.new) {
          await writeTransaction('user_word_highlights', (store) => store.put(buildWordHighlightRecord(change.new)));
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
// Register with SyncService
// ---------------------------------------------------------------------------

syncService.registerSyncStore(highlightSyncStore);
syncService.registerApplyFn('user_highlights', applyRemoteHighlights);
syncService.registerApplyFn('user_word_highlights', applyRemoteWordHighlights);
