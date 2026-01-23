import { openDB, readTransaction, writeTransaction, batchWriteTransaction } from "../adapters/db";
import type { ReadingProgressRow } from "../lib/supabase/types";

export type ChapterActionType = "checked" | "unchecked";

export interface ChapterAction {
  type: ChapterActionType;
  timestamp: number;
}

export interface ChapterProgress {
  book: string;
  chapter: number;
  actions: ChapterAction[];
}

export interface CatchUpAdjustment {
  originalDayNumber: number;
  addedChapters: Array<{ book: string; chapter: number }>;
}

export interface ReadingProgressEntry {
  id: string; // "planId-dayNumber"
  planId: string;
  dayNumber: number;
  completed: boolean;
  createdAt: number;
  completedAt?: number;
  startedReadingAt?: number;
  chaptersRead: ChapterProgress[];
  catchUpAdjustment?: CatchUpAdjustment;
}

function buildEntryId(planId: string, dayNumber: number): string {
  return `${planId}-${dayNumber}`;
}

function getChapterKey(book: string, chapter: number): string {
  return `${book}::${chapter}`;
}

function isChapterChecked(chapterProgress: ChapterProgress | undefined): boolean {
  if (!chapterProgress || chapterProgress.actions.length === 0) return false;
  const latest = chapterProgress.actions[chapterProgress.actions.length - 1];
  return latest.type === "checked";
}

function recomputeCompletion(entry: ReadingProgressEntry): ReadingProgressEntry {
  const allChecked = entry.chaptersRead.every((chapterProgress) =>
    isChapterChecked(chapterProgress),
  );

  if (allChecked && entry.chaptersRead.length > 0) {
    if (!entry.completed) {
      entry.completed = true;
      entry.completedAt = Date.now();
    }
  } else {
    entry.completed = false;
    entry.completedAt = undefined;
  }

  return entry;
}

export class ReadingProgressStore {
  async getDayProgress(planId: string, dayNumber: number): Promise<ReadingProgressEntry | undefined> {
    const id = buildEntryId(planId, dayNumber);
    const record = await readTransaction("reading_progress", (store) => store.get(id));
    if (!record) return undefined;
    return this.deserialize(record);
  }

  async getProgressForPlan(planId: string): Promise<ReadingProgressEntry[]> {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction("reading_progress", "readonly");
      const store = tx.objectStore("reading_progress");
      const index = store.index("planId");
      const request = index.getAll(planId);

      request.onsuccess = () => {
        const results = (request.result || []).map((record) => this.deserialize(record));
        resolve(results);
      };
      request.onerror = () => reject(request.error);
    });
  }

  async upsertEntries(entries: ReadingProgressEntry[]): Promise<void> {
    await batchWriteTransaction("reading_progress", (store) => {
      entries.forEach((entry) => {
        store.put(this.serialize(entry));
      });
    });
  }

  async ensureDayProgress(
    planId: string,
    dayNumber: number,
    chapters: Array<{ book: string; chapter: number }>,
  ): Promise<ReadingProgressEntry> {
    const existing = await this.getDayProgress(planId, dayNumber);
    if (existing) return existing;

    const createdAt = Date.now();
    const entry: ReadingProgressEntry = {
      id: buildEntryId(planId, dayNumber),
      planId,
      dayNumber,
      completed: false,
      createdAt,
      chaptersRead: chapters.map((ch) => ({
        book: ch.book,
        chapter: ch.chapter,
        actions: [],
      })),
    };

    await writeTransaction("reading_progress", (store) => store.put(this.serialize(entry)));
    return entry;
  }

  async setStartedReadingAt(planId: string, dayNumber: number, timestamp: number): Promise<void> {
    const entry = await this.getDayProgress(planId, dayNumber);
    if (!entry || entry.startedReadingAt) return;
    entry.startedReadingAt = timestamp;
    await writeTransaction("reading_progress", (store) => store.put(this.serialize(entry)));
  }

  async setChapterAction(
    planId: string,
    dayNumber: number,
    chapters: Array<{ book: string; chapter: number }>,
    target: { book: string; chapter: number },
    actionType: ChapterActionType,
  ): Promise<ReadingProgressEntry> {
    const entry = await this.ensureDayProgress(planId, dayNumber, chapters);
    const key = getChapterKey(target.book, target.chapter);

    let chapterProgress = entry.chaptersRead.find(
      (ch) => getChapterKey(ch.book, ch.chapter) === key,
    );

    if (!chapterProgress) {
      chapterProgress = { book: target.book, chapter: target.chapter, actions: [] };
      entry.chaptersRead.push(chapterProgress);
    }

    chapterProgress.actions.push({
      type: actionType,
      timestamp: Date.now(),
    });

    const updated = recomputeCompletion(entry);
    await writeTransaction("reading_progress", (store) => store.put(this.serialize(updated)));
    return updated;
  }

  async markDayComplete(
    planId: string,
    dayNumber: number,
    chapters: Array<{ book: string; chapter: number }>,
  ): Promise<ReadingProgressEntry> {
    const entry = await this.ensureDayProgress(planId, dayNumber, chapters);
    const now = Date.now();

    entry.chaptersRead = chapters.map((ch) => {
      const existing = entry.chaptersRead.find(
        (item) => item.book === ch.book && item.chapter === ch.chapter,
      );
      const actions = existing?.actions ?? [];
      actions.push({ type: "checked", timestamp: now });
      return { book: ch.book, chapter: ch.chapter, actions };
    });

    entry.completed = true;
    entry.completedAt = now;

    await writeTransaction("reading_progress", (store) => store.put(this.serialize(entry)));
    return entry;
  }

  async setCatchUpAdjustment(entry: ReadingProgressEntry): Promise<void> {
    await writeTransaction("reading_progress", (store) => store.put(this.serialize(entry)));
  }

  async applyCloudRow(row: ReadingProgressRow): Promise<void> {
    const entry: ReadingProgressEntry = {
      id: `${row.plan_id}-${row.day_number}`,
      planId: row.plan_id,
      dayNumber: row.day_number,
      completed: Boolean(row.completed),
      createdAt: row.created_at ? new Date(row.created_at).getTime() : Date.now(),
      completedAt: row.completed_at ? new Date(row.completed_at).getTime() : undefined,
      startedReadingAt: row.started_reading_at
        ? new Date(row.started_reading_at).getTime()
        : undefined,
      chaptersRead: Array.isArray(row.chapters_read) ? row.chapters_read : [],
      catchUpAdjustment: row.catch_up_adjustment ?? undefined,
    };

    await writeTransaction("reading_progress", (store) => store.put(this.serialize(entry)));
  }

  private serialize(entry: ReadingProgressEntry) {
    return {
      id: entry.id,
      planId: entry.planId,
      dayNumber: entry.dayNumber,
      completed: entry.completed ? 1 : 0,
      createdAt: entry.createdAt,
      completedAt: entry.completedAt,
      startedReadingAt: entry.startedReadingAt,
      chaptersRead: JSON.stringify(entry.chaptersRead),
      catchUpAdjustment: entry.catchUpAdjustment ? JSON.stringify(entry.catchUpAdjustment) : undefined,
    };
  }

  private deserialize(record: any): ReadingProgressEntry {
    return {
      id: record.id,
      planId: record.planId,
      dayNumber: record.dayNumber,
      completed: Boolean(record.completed),
      createdAt: record.createdAt,
      completedAt: record.completedAt ?? undefined,
      startedReadingAt: record.startedReadingAt ?? undefined,
      chaptersRead: record.chaptersRead ? JSON.parse(record.chaptersRead) : [],
      catchUpAdjustment: record.catchUpAdjustment
        ? JSON.parse(record.catchUpAdjustment)
        : undefined,
    };
  }
}

export const readingProgressStore = new ReadingProgressStore();

export function getLatestChapterState(
  entry: ReadingProgressEntry | undefined,
  book: string,
  chapter: number,
): ChapterActionType | null {
  if (!entry) return null;
  const chapterProgress = entry.chaptersRead.find(
    (item) => item.book === book && item.chapter === chapter,
  );
  if (!chapterProgress || chapterProgress.actions.length === 0) return null;
  return chapterProgress.actions[chapterProgress.actions.length - 1].type;
}
