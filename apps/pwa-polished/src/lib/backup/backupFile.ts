/**
 * The backup file: everything personal on this device, in one JSON file.
 *
 * Rows are copied exactly as the device stores them, so a restore can put
 * them straight back with their original ids and dates. The one exception is
 * the journal, which is opened first: a scrambled entry only opens under the
 * lock key it was scrambled with, so readable text is the only copy that
 * survives the lock being turned off and on again.
 *
 * Left out on purpose: the journal lock's keys, downloaded packs, window
 * layout, and anything else that only makes sense on this one device.
 */

import type {
  DBJournalEntry, DBNotebook, DBNotebookPage, DBUserBookmark, DBUserHighlight, DBUserNote, DBUserWordHighlight,
} from '../../adapters/db';
import { openDB } from '../../adapters/db';
import { getSettings, type UserSettings } from '../../adapters/settings';
import { syncedJournalStore } from '../../adapters/SyncedJournalStore';
import type { RepeatGroup } from '../../stores/repeatsStore';
import { localDateStr } from '../../stores/clockStore';
import { syncService } from '../sync';

export const BACKUP_APP = 'hexapla';
export const BACKUP_KIND = 'backup';
/** Bump when the shape of `data` changes in a way older restores can't read. */
export const BACKUP_FORMAT = 1;

const REPEATS_KEY = 'projectbible_repeats';
const ACTIVE_PLANS_KEY = 'projectbible_active_reading_plans';
const PLAN_HISTORY_KEY = 'projectbible_reading_plan_history';
const CATCHUP_PREFIX = 'projectbible_catchup_days_';

export interface BackupData {
  notes: DBUserNote[];
  highlights: DBUserHighlight[];
  wordHighlights: DBUserWordHighlight[];
  repeats: RepeatGroup[];
  bookmarks: DBUserBookmark[];
  notebooks: DBNotebook[];
  notebookPages: DBNotebookPage[];
  journal: DBJournalEntry[];
  readingPlans: {
    active: unknown[];
    history: unknown[];
    /** Catch-up days, by plan id. */
    catchUpDays: Record<string, unknown>;
    /** Plan detail rows as stored. */
    metadata: Record<string, unknown>[];
  };
  /** Reading progress rows as stored, one per plan day. */
  readingProgress: Record<string, unknown>[];
  settings: UserSettings;
}

export interface BackupFile {
  app: typeof BACKUP_APP;
  kind: typeof BACKUP_KIND;
  format: number;
  exportedAt: string;
  data: BackupData;
}

export interface PreparedBackup {
  file: File;
  counts: {
    notes: number;
    notebookPages: number;
    highlights: number;
    journal: number;
    readingPlans: number;
  };
  /** Journal entries left out: still locked, or the key couldn't open them. */
  journalLeftOut: number;
}

/** Every row in one of the device's stores, exactly as stored. */
export async function allRows<T>(storeName: string): Promise<T[]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const request = db.transaction(storeName, 'readonly').objectStore(storeName).getAll();
    request.onsuccess = () => resolve((request.result as T[]) ?? []);
    request.onerror = () => reject(request.error);
  });
}

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function readCatchUpDays(): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (!key?.startsWith(CATCHUP_PREFIX)) continue;
    out[key.slice(CATCHUP_PREFIX.length)] = readJson(key, null);
  }
  return out;
}

/**
 * Journal entries as readable rows. Pass `includeJournal: false` to skip the
 * journal entirely, for when it's locked and can't be opened.
 */
async function readJournal(includeJournal: boolean): Promise<{ rows: DBJournalEntry[]; leftOut: number }> {
  if (!includeJournal) return { rows: [], leftOut: 0 };
  const entries = await syncedJournalStore.getEntries();
  const rows: DBJournalEntry[] = [];
  let leftOut = 0;
  for (const entry of entries) {
    if (entry.locked || entry.unreadable) {
      leftOut++;
      continue;
    }
    rows.push({
      id: entry.id,
      date: entry.date,
      title: entry.title,
      text: entry.text,
      createdAt: entry.createdAt.getTime(),
      updatedAt: entry.updatedAt.getTime(),
    });
  }
  return { rows, leftOut };
}

/**
 * Sync first, so the file holds the latest from every device, then gather
 * everything into a ready-to-save file. Building it ahead of the save tap
 * matters on phones: the share sheet only opens straight after a tap.
 */
export async function prepareBackup(options: { includeJournal: boolean }): Promise<PreparedBackup> {
  await syncService.forceSync();

  const [notes, highlights, wordHighlights, bookmarks, notebooks, notebookPages, metadata, readingProgress, journal] =
    await Promise.all([
      allRows<DBUserNote>('user_notes'),
      allRows<DBUserHighlight>('user_highlights'),
      allRows<DBUserWordHighlight>('user_word_highlights'),
      allRows<DBUserBookmark>('user_bookmarks'),
      allRows<DBNotebook>('notebooks'),
      allRows<DBNotebookPage>('notebook_pages'),
      allRows<Record<string, unknown>>('plan_metadata'),
      allRows<Record<string, unknown>>('reading_progress'),
      readJournal(options.includeJournal),
    ]);

  const active = readJson<unknown[]>(ACTIVE_PLANS_KEY, []);
  const history = readJson<unknown[]>(PLAN_HISTORY_KEY, []);

  const backup: BackupFile = {
    app: BACKUP_APP,
    kind: BACKUP_KIND,
    format: BACKUP_FORMAT,
    exportedAt: new Date().toISOString(),
    data: {
      notes,
      highlights,
      wordHighlights,
      repeats: readJson<RepeatGroup[]>(REPEATS_KEY, []),
      bookmarks,
      notebooks,
      notebookPages,
      journal: journal.rows,
      readingPlans: { active, history, catchUpDays: readCatchUpDays(), metadata },
      readingProgress,
      settings: getSettings(),
    },
  };

  const name = `hexapla-backup-${localDateStr(new Date())}.json`;
  const file = new File([JSON.stringify(backup, null, 2)], name, { type: 'application/json' });

  // A plan that was finished or archived sits in both lists; count it once.
  const planIds = new Set(
    [...active, ...history].map((p) => (p as { id?: string } | null)?.id).filter(Boolean),
  );

  return {
    file,
    counts: {
      notes: notes.length,
      notebookPages: notebookPages.length,
      highlights: highlights.length + wordHighlights.length,
      journal: journal.rows.length,
      readingPlans: planIds.size,
    },
    journalLeftOut: journal.leftOut,
  };
}
