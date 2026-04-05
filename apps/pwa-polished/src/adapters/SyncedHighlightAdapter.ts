/**
 * SyncedHighlightAdapter
 *
 * Registers remote-pull apply functions for user_highlights and
 * user_word_highlights with the SyncService so that on sign-in the data
 * is fetched from Supabase and written into IndexedDB.
 */

import { syncService } from '../lib/sync';
import { writeTransaction } from './db';

// ---------------------------------------------------------------------------
// user_highlights
// ---------------------------------------------------------------------------

async function applyRemoteHighlights(rows: any[]): Promise<void> {
  if (!rows || rows.length === 0) return;
  for (const row of rows) {
    const record = {
      id: row.id,
      book: row.book,
      chapter: row.chapter,
      verse: row.verse,
      color: row.color ?? '#ffeb3b',
      // style may come as a parsed object from Supabase JSONB or a string
      style: row.style ? (typeof row.style === 'string' ? row.style : JSON.stringify(row.style)) : undefined,
      createdAt: row.created_at ? new Date(row.created_at).getTime() : Date.now(),
    };
    await writeTransaction('user_highlights', (store) => store.put(record));
  }
  console.log(`[SyncedHighlight] Applied ${rows.length} verse highlight(s)`);
}

// ---------------------------------------------------------------------------
// user_word_highlights
// ---------------------------------------------------------------------------

async function applyRemoteWordHighlights(rows: any[]): Promise<void> {
  if (!rows || rows.length === 0) return;
  for (const row of rows) {
    const record = {
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
    await writeTransaction('user_word_highlights', (store) => store.put(record));
  }
  console.log(`[SyncedHighlight] Applied ${rows.length} word highlight(s)`);
}

// ---------------------------------------------------------------------------
// Register with SyncService
// ---------------------------------------------------------------------------

syncService.registerApplyFn('user_highlights', applyRemoteHighlights);
syncService.registerApplyFn('user_word_highlights', applyRemoteWordHighlights);
