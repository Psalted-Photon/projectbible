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
import { forgetRemotePlanStatuses, planUploadOp, queueProgressEntry } from '../../adapters/SyncedReadingAdapter';
import { readingProgressStore, type ReadingProgressEntry } from '../../stores/ReadingProgressStore';
import { repeatsStore } from '../../stores/repeatsStore';
import { pushAlarm } from '../alarm/alarmSync';
import { JournalLockedError, sealFields } from '../journalLock/entryCrypto';
import { getContentKey, scramblesWrites } from '../journalLock/lockState';
import { syncQueue, syncService } from '../sync';
import { flushSettingsPush } from '../sync/settingsSync';
import type { SyncOperation } from '../sync/types';
import {
  ACTIVE_PLANS_KEY, allRows, BACKUP_APP, BACKUP_FORMAT, BACKUP_KIND, CATCHUP_PREFIX, PLAN_HISTORY_KEY, readJson,
  type BackupData, type BackupFile,
} from './backupFile';

export type RestorePart = 'notes' | 'notebooks' | 'highlights' | 'journal' | 'readingPlans' | 'settings';

export interface PartResult {
  added: number;
  updated: number;
  /** New items left out because their spot was already taken. */
  skipped: number;
}

export interface RestoreSummary {
  results: Partial<Record<Exclude<RestorePart, 'settings' | 'readingPlans'>, PartResult>>;
  /** Plans added, and days whose progress changed. Null when plans weren't restored. */
  readingPlans: { added: number; progressDays: number } | null;
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
interface StoredPlan {
  id: string;
  plan: any;
}

interface HistoryEntry extends StoredPlan {
  createdAt?: string;
  completedAt: string | null;
}

function isPlan(entry: unknown): entry is StoredPlan {
  const e = entry as StoredPlan | null;
  return !!e && typeof e.id === 'string' && !!e.plan && typeof e.plan.config === 'object' && Array.isArray(e.plan.days);
}

function isHistoryEntry(entry: unknown): entry is HistoryEntry {
  if (!isPlan(entry)) return false;
  const completedAt = (entry as HistoryEntry).completedAt;
  return completedAt === null || typeof completedAt === 'string';
}

function goodPlans(data: BackupData): { active: StoredPlan[]; archived: HistoryEntry[]; history: HistoryEntry[] } {
  const plans = data.readingPlans;
  const active = list<unknown>(plans?.active).filter(isPlan);
  const history = list<unknown>(plans?.history).filter(isHistoryEntry);
  const activeIds = new Set(active.map((p) => p.id));
  // Finished or archived plans. In-progress history entries are shadows of active plans.
  const archived = history.filter((h) => h.completedAt !== null && !activeIds.has(h.id));
  return { active, archived, history };
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
    readingPlans: goodPlans(d).active.length + goodPlans(d).archived.length,
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

/**
 * Plans have no edit date, so a plan already on this device, active or in
 * history, is left as it is; only missing ones are added. Each added plan is
 * uploaded whole, so the next pull doesn't drop it from the active list.
 */
async function restorePlans(data: BackupData): Promise<string[]> {
  const active = readJson<StoredPlan[]>(ACTIVE_PLANS_KEY, []);
  const history = readJson<HistoryEntry[]>(PLAN_HISTORY_KEY, []);
  const onDevice = new Set([...active, ...history].map((p) => p?.id));
  const file = goodPlans(data);
  const shadows = new Map(file.history.map((h) => [h.id, h]));
  const added: string[] = [];

  for (const entry of file.active) {
    if (onDevice.has(entry.id)) continue;
    await syncQueue.enqueue(planUploadOp(entry.id, entry.plan));
    active.push({ id: entry.id, plan: entry.plan });
    // The plan screen keeps an in-progress history entry beside every active plan.
    history.unshift({
      id: entry.id,
      plan: entry.plan,
      createdAt: shadows.get(entry.id)?.createdAt ?? new Date().toISOString(),
      completedAt: null,
    });
    onDevice.add(entry.id);
    added.push(entry.id);
  }

  for (const entry of file.archived) {
    if (onDevice.has(entry.id)) continue;
    const archivedMs = new Date(entry.completedAt as string).getTime();
    await syncQueue.enqueue(planUploadOp(entry.id, entry.plan, Number.isFinite(archivedMs) ? archivedMs : Date.now()));
    history.push(entry);
    onDevice.add(entry.id);
    added.push(entry.id);
  }

  if (added.length === 0) return added;

  localStorage.setItem(ACTIVE_PLANS_KEY, JSON.stringify(active));
  localStorage.setItem(PLAN_HISTORY_KEY, JSON.stringify(history));
  forgetRemotePlanStatuses(added);

  // Their catch-up days and plan details come back too, unless already here.
  const addedIds = new Set(added);
  const catchUpDays = data.readingPlans?.catchUpDays;
  if (catchUpDays && typeof catchUpDays === 'object') {
    for (const [planId, days] of Object.entries(catchUpDays)) {
      const key = CATCHUP_PREFIX + planId;
      if (addedIds.has(planId) && days != null && localStorage.getItem(key) === null) {
        localStorage.setItem(key, JSON.stringify(days));
      }
    }
  }
  const localDetails = new Set((await allRows<{ planId: string }>('plan_metadata')).map((r) => r.planId));
  for (const row of list<Record<string, unknown>>(data.readingPlans?.metadata)) {
    if (!isRow(row, { planId: 'string' })) continue;
    const planId = row.planId as string;
    if (addedIds.has(planId) && !localDetails.has(planId)) {
      await writeTransaction('plan_metadata', (store) => store.put(row));
    }
  }

  return added;
}

function parseJsonField<T>(value: unknown, fallback: T): T {
  if (typeof value !== 'string') return (value ?? fallback) as T;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

const optionalNumber = (value: unknown) => (typeof value === 'number' ? value : undefined);

/** A progress row as the device stores it (JSON fields as strings) back into an entry. */
function progressEntryFrom(row: Record<string, unknown>): ReadingProgressEntry {
  return {
    id: row.id as string,
    planId: row.planId as string,
    dayNumber: row.dayNumber as number,
    completed: Boolean(row.completed),
    createdAt: optionalNumber(row.createdAt) ?? Date.now(),
    completedAt: optionalNumber(row.completedAt),
    startedReadingAt: optionalNumber(row.startedReadingAt),
    chaptersRead: parseJsonField(row.chaptersRead, []),
    catchUpAdjustment: row.catchUpAdjustment ? parseJsonField(row.catchUpAdjustment, undefined) : undefined,
    harmonySections: row.harmonySections ? parseJsonField(row.harmonySections, undefined) : undefined,
  };
}

function hasProgress(entry: ReadingProgressEntry): boolean {
  return entry.completed
    || (entry.chaptersRead ?? []).some((ch) => (ch.actions ?? []).length > 0)
    || (entry.harmonySections?.length ?? 0) > 0;
}

function progressFingerprint(entry: ReadingProgressEntry | undefined): string {
  return entry ? JSON.stringify([entry.completed, entry.chaptersRead ?? [], entry.harmonySections ?? []]) : '';
}

/**
 * Progress merges tick by tick, the same way sync does, so nothing is lost on
 * either side: the latest tick or untick on each chapter wins. Only days
 * belonging to a plan on this device are restored.
 */
async function restoreProgress(data: BackupData): Promise<number> {
  const planIds = new Set(
    [...readJson<StoredPlan[]>(ACTIVE_PLANS_KEY, []), ...readJson<HistoryEntry[]>(PLAN_HISTORY_KEY, [])].map((p) => p?.id),
  );
  let changedDays = 0;
  for (const row of list<Record<string, unknown>>(data.readingProgress)) {
    if (!isRow(row, { id: 'string', planId: 'string', dayNumber: 'number' })) continue;
    if (!planIds.has(row.planId as string)) continue;
    const incoming = progressEntryFrom(row);
    if (!hasProgress(incoming)) continue;

    const before = await readingProgressStore.getDayProgress(incoming.planId, incoming.dayNumber);
    await readingProgressStore.upsertEntries([incoming]);
    const after = await readingProgressStore.getDayProgress(incoming.planId, incoming.dayNumber);
    if (!after || progressFingerprint(before) === progressFingerprint(after)) continue;
    await queueProgressEntry(after);
    changedDays++;
  }
  return changedDays;
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

  const summary: RestoreSummary = { results: {}, readingPlans: null, settingsApplied: false, alarmProblem: null };
  if (parts.has('notebooks')) summary.results.notebooks = await restoreNotebooks(data);
  if (parts.has('notes')) summary.results.notes = await restoreNotes(data);
  if (parts.has('highlights')) summary.results.highlights = await restoreHighlights(data);
  if (parts.has('journal')) summary.results.journal = await restoreJournal(data);
  if (parts.has('readingPlans')) {
    const added = await restorePlans(data);
    summary.readingPlans = { added: added.length, progressDays: await restoreProgress(data) };
  }
  if (parts.has('settings')) {
    const s = await restoreSettings(data);
    summary.settingsApplied = s.applied;
    summary.alarmProblem = s.alarmProblem;
  }

  await syncService.forceSync();
  return summary;
}
