/**
 * Restoring a backup file into this device and the account.
 *
 * Restore only adds and updates; it never deletes. An item on both sides
 * keeps whichever copy was edited last. A new item is left out if its spot is
 * already taken by a different one: a verse that already has a note or a
 * highlight, or a day that already has a journal entry. The reader and the
 * journal assume one per spot.
 *
 * Every restored row is saved on the device and queued for upload as a whole
 * row with its original dates. Saving on the device alone isn't enough: the
 * next sync deletes anything the cloud doesn't have unless it's waiting to
 * upload.
 */

import type {
  DBJournalEntry, DBNotebook, DBNotebookPage, DBUserBookmark, DBUserHighlight, DBUserNote, DBUserWordHighlight,
} from '../../adapters/db';
import { writeTransaction } from '../../adapters/db';
import { applyTheme, getSettings, updateSettings, type UserSettings } from '../../adapters/settings';
import { repeatsStore } from '../../stores/repeatsStore';
import { pushAlarm } from '../alarm/alarmSync';
import { JournalLockedError, sealFields } from '../journalLock/entryCrypto';
import { getContentKey, scramblesWrites } from '../journalLock/lockState';
import { syncQueue, syncService } from '../sync';
import { flushSettingsPush } from '../sync/settingsSync';
import type { SyncOperation } from '../sync/types';
import { allRows, BACKUP_APP, BACKUP_FORMAT, BACKUP_KIND, type BackupData, type BackupFile } from './backupFile';

export type RestorePart = 'notes' | 'notebooks' | 'highlights' | 'journal' | 'settings';

export interface PartResult {
  added: number;
  updated: number;
  /** New items left out because their spot was already taken. */
  skipped: number;
}

export interface RestoreSummary {
  results: Partial<Record<Exclude<RestorePart, 'settings'>, PartResult>>;
  settingsApplied: boolean;
  /** Set when the restored wake alarm couldn't be armed. */
  alarmProblem: string | null;
}

// ── Reading and checking the file ───────────────────────────────────────────

export async function readBackupFile(file: File): Promise<BackupFile> {
  let parsed: any;
  try {
    parsed = JSON.parse(await file.text());
  } catch {
    throw new Error("This isn't a Hexapla backup file.");
  }
  if (!parsed || parsed.app !== BACKUP_APP || parsed.kind !== BACKUP_KIND || typeof parsed.data !== 'object' || !parsed.data) {
    throw new Error("This isn't a Hexapla backup file.");
  }
  if (typeof parsed.format !== 'number' || parsed.format > BACKUP_FORMAT) {
    throw new Error('This backup was made by a newer version of the app. Update the app, then try again.');
  }
  return parsed as BackupFile;
}

function list<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

type FieldType = 'string' | 'number';

/** A hand-edited or damaged row is left out rather than written half-formed. */
function isRow(row: unknown, fields: Record<string, FieldType>): boolean {
  if (!row || typeof row !== 'object') return false;
  const r = row as Record<string, unknown>;
  return Object.entries(fields).every(([key, type]) => typeof r[key] === type);
}

const VERSE_FIELDS: Record<string, FieldType> = { id: 'string', book: 'string', chapter: 'number', verse: 'number' };

function goodNotes(data: BackupData): DBUserNote[] {
  return list<DBUserNote>(data.notes).filter((r) =>
    isRow(r, { ...VERSE_FIELDS, text: 'string', createdAt: 'number', updatedAt: 'number' }));
}
function goodHighlights(data: BackupData): DBUserHighlight[] {
  return list<DBUserHighlight>(data.highlights).filter((r) =>
    isRow(r, { ...VERSE_FIELDS, color: 'string', createdAt: 'number' }));
}
function goodWordHighlights(data: BackupData): DBUserWordHighlight[] {
  return list<DBUserWordHighlight>(data.wordHighlights).filter((r) =>
    isRow(r, { ...VERSE_FIELDS, translation: 'string', wordStart: 'number', wordLength: 'number', style: 'string', createdAt: 'number' }));
}
function goodBookmarks(data: BackupData): DBUserBookmark[] {
  return list<DBUserBookmark>(data.bookmarks).filter((r) => isRow(r, { ...VERSE_FIELDS, createdAt: 'number' }));
}
function goodNotebooks(data: BackupData): DBNotebook[] {
  return list<DBNotebook>(data.notebooks).filter((r) =>
    isRow(r, { id: 'string', name: 'string', createdAt: 'number', updatedAt: 'number' }));
}
function goodPages(data: BackupData): DBNotebookPage[] {
  return list<DBNotebookPage>(data.notebookPages).filter((r) =>
    isRow(r, { id: 'string', notebookId: 'string', text: 'string', sortOrder: 'number', createdAt: 'number', updatedAt: 'number' }));
}
function goodJournal(data: BackupData): DBJournalEntry[] {
  return list<DBJournalEntry>(data.journal).filter((r) =>
    isRow(r, { id: 'string', date: 'string', text: 'string', createdAt: 'number', updatedAt: 'number' }));
}
function goodSettings(data: BackupData): Record<string, unknown> | null {
  const s = data.settings;
  return s && typeof s === 'object' && !Array.isArray(s) && Object.keys(s).length > 0 ? (s as Record<string, unknown>) : null;
}

/** What the file holds, for the preview. Bookmarks have no screen of their own, so they aren't counted. */
export function backupContents(backup: BackupFile): Record<RestorePart, number> {
  const d = backup.data;
  return {
    notes: goodNotes(d).length,
    notebooks: goodPages(d).length,
    highlights: goodHighlights(d).length + goodWordHighlights(d).length,
    journal: goodJournal(d).length,
    settings: goodSettings(d) ? 1 : 0,
  };
}

// ── Writing ─────────────────────────────────────────────────────────────────

const iso = (ms: number) => new Date(ms).toISOString();
const verseKey = (r: { book: string; chapter: number; verse: number }) => `${r.book}|${r.chapter}|${r.verse}`;

function styleForUpload(style: string | undefined): unknown {
  if (!style) return null;
  try {
    return JSON.parse(style);
  } catch {
    return style;
  }
}

async function putAndQueue(storeName: string, row: object, op: SyncOperation): Promise<void> {
  await writeTransaction(storeName, (store) => store.put(row));
  await syncQueue.enqueue(op);
}

function newResult(): PartResult {
  return { added: 0, updated: 0, skipped: 0 };
}

/** Keep whichever copy was edited last; an equal copy is already here. */
function isNewer(incoming: { updatedAt: number }, existing: { updatedAt: number } | undefined): boolean {
  return !existing || incoming.updatedAt > existing.updatedAt;
}

async function restoreNotes(data: BackupData): Promise<PartResult> {
  const result = newResult();
  const local = await allRows<DBUserNote>('user_notes');
  const byId = new Map(local.map((r) => [r.id, r]));
  const verseTaken = new Set(local.map(verseKey));

  for (const note of goodNotes(data)) {
    const existing = byId.get(note.id);
    if (!existing && verseTaken.has(verseKey(note))) {
      result.skipped++;
      continue;
    }
    if (!isNewer(note, existing)) continue;
    const row: DBUserNote = {
      id: note.id, book: note.book, chapter: note.chapter, verse: note.verse,
      text: note.text, createdAt: note.createdAt, updatedAt: note.updatedAt,
    };
    await putAndQueue('user_notes', row, {
      type: 'INSERT', table: 'user_notes', id: row.id,
      data: {
        id: row.id, book: row.book, chapter: row.chapter, verse: row.verse, text: row.text,
        created_at: iso(row.createdAt), updated_at: iso(row.updatedAt),
      },
    });
    verseTaken.add(verseKey(row));
    if (existing) result.updated++;
    else result.added++;
  }
  return result;
}

async function restoreNotebooks(data: BackupData): Promise<PartResult> {
  const result = newResult();
  const localBooks = await allRows<DBNotebook>('notebooks');
  const localPages = await allRows<DBNotebookPage>('notebook_pages');
  const booksById = new Map(localBooks.map((r) => [r.id, r]));
  const pagesById = new Map(localPages.map((r) => [r.id, r]));
  const notebookIds = new Set(localBooks.map((r) => r.id));

  // Notebooks are counted through their pages, which is what people write.
  for (const book of goodNotebooks(data)) {
    const existing = booksById.get(book.id);
    if (!isNewer(book, existing)) continue;
    const row: DBNotebook = { id: book.id, name: book.name, createdAt: book.createdAt, updatedAt: book.updatedAt };
    await putAndQueue('notebooks', row, {
      type: 'INSERT', table: 'notebooks', id: row.id,
      data: { id: row.id, name: row.name, created_at: iso(row.createdAt), updated_at: iso(row.updatedAt) },
    });
    notebookIds.add(row.id);
  }

  for (const page of goodPages(data)) {
    if (!notebookIds.has(page.notebookId)) {
      result.skipped++;
      continue;
    }
    const existing = pagesById.get(page.id);
    if (!isNewer(page, existing)) continue;
    const row: DBNotebookPage = {
      id: page.id, notebookId: page.notebookId, title: typeof page.title === 'string' ? page.title : undefined,
      text: page.text, sortOrder: page.sortOrder, createdAt: page.createdAt, updatedAt: page.updatedAt,
    };
    await putAndQueue('notebook_pages', row, {
      type: 'INSERT', table: 'notebook_pages', id: row.id,
      data: {
        id: row.id, notebook_id: row.notebookId, title: row.title ?? null, text: row.text,
        sort_order: row.sortOrder, created_at: iso(row.createdAt), updated_at: iso(row.updatedAt),
      },
    });
    if (existing) result.updated++;
    else result.added++;
  }
  return result;
}

/** Highlights never change once made, so a restore only adds the missing ones. */
async function restoreHighlights(data: BackupData): Promise<PartResult> {
  const result = newResult();

  const localVerse = await allRows<DBUserHighlight>('user_highlights');
  const verseIds = new Set(localVerse.map((r) => r.id));
  const versesTaken = new Set(localVerse.map(verseKey));
  for (const hl of goodHighlights(data)) {
    if (verseIds.has(hl.id)) continue;
    if (versesTaken.has(verseKey(hl))) {
      result.skipped++;
      continue;
    }
    const row: DBUserHighlight = {
      id: hl.id, book: hl.book, chapter: hl.chapter, verse: hl.verse, color: hl.color,
      style: typeof hl.style === 'string' ? hl.style : undefined, createdAt: hl.createdAt,
    };
    await putAndQueue('user_highlights', row, {
      type: 'INSERT', table: 'user_highlights', id: row.id,
      data: {
        id: row.id, book: row.book, chapter: row.chapter, verse: row.verse, color: row.color,
        style: styleForUpload(row.style), created_at: iso(row.createdAt),
      },
    });
    versesTaken.add(verseKey(row));
    result.added++;
  }

  const wordKey = (r: DBUserWordHighlight) => `${verseKey(r)}|${r.translation}|${r.wordStart}|${r.wordLength}`;
  const localWords = await allRows<DBUserWordHighlight>('user_word_highlights');
  const wordIds = new Set(localWords.map((r) => r.id));
  const wordsTaken = new Set(localWords.map(wordKey));
  for (const hl of goodWordHighlights(data)) {
    if (wordIds.has(hl.id)) continue;
    if (wordsTaken.has(wordKey(hl))) {
      result.skipped++;
      continue;
    }
    const row: DBUserWordHighlight = {
      id: hl.id, book: hl.book, chapter: hl.chapter, verse: hl.verse, translation: hl.translation,
      wordStart: hl.wordStart, wordLength: hl.wordLength, style: hl.style, createdAt: hl.createdAt,
    };
    await putAndQueue('user_word_highlights', row, {
      type: 'INSERT', table: 'user_word_highlights', id: row.id,
      data: {
        id: row.id, book: row.book, chapter: row.chapter, verse: row.verse, translation: row.translation,
        word_start: row.wordStart, word_length: row.wordLength, style: styleForUpload(row.style),
        created_at: iso(row.createdAt),
      },
    });
    wordsTaken.add(wordKey(row));
    result.added++;
  }

  // Bookmarks and repeat-word groups ride along quietly.
  const localMarks = await allRows<DBUserBookmark>('user_bookmarks');
  const markIds = new Set(localMarks.map((r) => r.id));
  const marksTaken = new Set(localMarks.map(verseKey));
  for (const mark of goodBookmarks(data)) {
    if (markIds.has(mark.id) || marksTaken.has(verseKey(mark))) continue;
    const row: DBUserBookmark = {
      id: mark.id, book: mark.book, chapter: mark.chapter, verse: mark.verse,
      label: typeof mark.label === 'string' ? mark.label : undefined, createdAt: mark.createdAt,
    };
    await putAndQueue('user_bookmarks', row, {
      type: 'INSERT', table: 'user_bookmarks', id: row.id,
      data: {
        id: row.id, book: row.book, chapter: row.chapter, verse: row.verse,
        label: row.label ?? null, created_at: iso(row.createdAt),
      },
    });
    marksTaken.add(verseKey(row));
  }
  for (const group of list<{ label?: unknown }>(data.repeats)) {
    if (typeof group?.label === 'string') repeatsStore.add(group.label);
  }

  return result;
}

async function restoreJournal(data: BackupData): Promise<PartResult> {
  const result = newResult();
  const scramble = scramblesWrites();
  if (scramble && !getContentKey()) throw new JournalLockedError();

  const local = await allRows<DBJournalEntry>('journal_entries');
  const byId = new Map(local.map((r) => [r.id, r]));
  // The device allows one entry per day.
  const dayOwner = new Map(local.map((r) => [r.date, r.id]));

  for (const entry of goodJournal(data)) {
    const owner = dayOwner.get(entry.date);
    if (owner && owner !== entry.id) {
      result.skipped++;
      continue;
    }
    const existing = byId.get(entry.id);
    if (!isNewer(entry, existing)) continue;

    const title = typeof entry.title === 'string' && entry.title ? entry.title : undefined;
    const stored = scramble ? await sealFields(entry.id, entry.date, title, entry.text) : { title, text: entry.text };
    const row: DBJournalEntry = {
      id: entry.id, date: entry.date, title: stored.title, text: stored.text,
      createdAt: entry.createdAt, updatedAt: entry.updatedAt,
    };
    await putAndQueue('journal_entries', row, {
      type: 'INSERT', table: 'journal_entries', id: row.id,
      data: {
        id: row.id, date: row.date, title: row.title ?? null, text: row.text,
        created_at: iso(row.createdAt), updated_at: iso(row.updatedAt),
      },
    });
    dayOwner.set(row.date, row.id);
    if (existing) result.updated++;
    else result.added++;
  }
  return result;
}

async function restoreSettings(data: BackupData): Promise<{ applied: boolean; alarmProblem: string | null }> {
  const settings = goodSettings(data);
  if (!settings) return { applied: false, alarmProblem: null };

  updateSettings(settings as Partial<UserSettings>);
  applyTheme(getSettings().theme);
  window.dispatchEvent(new CustomEvent('settingsUpdated'));
  await flushSettingsPush();

  if (!settings.wakeAlarm) return { applied: true, alarmProblem: null };
  const armed = await pushAlarm();
  return { applied: true, alarmProblem: armed.ok ? null : armed.message };
}

/**
 * Sync first so the merge compares against the latest copies, restore the
 * chosen parts, then sync again to send everything up.
 */
export async function restoreBackup(backup: BackupFile, parts: Set<RestorePart>): Promise<RestoreSummary> {
  const data = backup.data;
  // Checked before anything is written, so a locked journal can't leave a half-done restore.
  if (parts.has('journal') && goodJournal(data).length > 0 && scramblesWrites() && !getContentKey()) {
    throw new JournalLockedError();
  }

  await syncService.forceSync();

  const summary: RestoreSummary = { results: {}, settingsApplied: false, alarmProblem: null };
  if (parts.has('notebooks')) summary.results.notebooks = await restoreNotebooks(data);
  if (parts.has('notes')) summary.results.notes = await restoreNotes(data);
  if (parts.has('highlights')) summary.results.highlights = await restoreHighlights(data);
  if (parts.has('journal')) summary.results.journal = await restoreJournal(data);
  if (parts.has('settings')) {
    const s = await restoreSettings(data);
    summary.settingsApplied = s.applied;
    summary.alarmProblem = s.alarmProblem;
  }

  await syncService.forceSync();
  return summary;
}
