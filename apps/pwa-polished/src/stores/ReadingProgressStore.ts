import { openDB, readTransaction, writeTransaction, batchWriteTransaction } from "../adapters/db";

export type ChapterActionType = "checked" | "unchecked";

// ---------------------------------------------------------------------------
// Harmony progress types
// ---------------------------------------------------------------------------

export interface HarmonyPassageProgress {
  label: string;
  book: string;
  startChapter: number;
  startVerse: number;
  endChapter: number;
  endVerse: number | null;
  completed: boolean;
  completedAt?: number;
}

export interface HarmonySectionProgress {
  sectionId: number | string;
  title: string;
  passages: HarmonyPassageProgress[];
  completed: boolean;
  completedAt?: number;
}

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
  /** Harmony plans: verse-range + section level progress */
  harmonySections?: HarmonySectionProgress[];
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
  // Harmony plans: complete when all passages in all sections are done
  if (entry.harmonySections && entry.harmonySections.length > 0) {
    const allDone = entry.harmonySections.every(sec => sec.completed);
    if (allDone) {
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

  // Standard plans: complete when all chapters checked
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

  /**
   * Initialize a harmony-plan day entry with section/passage structure.
   * Call this before the first passage is started on a harmony day.
   */
  async ensureHarmonyDayProgress(
    planId: string,
    dayNumber: number,
    sections: HarmonySectionProgress[],
    chapterRefs: Array<{ book: string; chapter: number }>,
  ): Promise<ReadingProgressEntry> {
    const existing = await this.getDayProgress(planId, dayNumber);
    if (existing) return existing;

    const entry: ReadingProgressEntry = {
      id: buildEntryId(planId, dayNumber),
      planId,
      dayNumber,
      completed: false,
      createdAt: Date.now(),
      chaptersRead: chapterRefs.map(ch => ({ book: ch.book, chapter: ch.chapter, actions: [] })),
      harmonySections: sections,
    };

    await writeTransaction("reading_progress", (store) => store.put(this.serialize(entry)));
    return entry;
  }

  /**
   * Mark a single harmony passage complete and persist.
   */
  async markPassageComplete(
    planId: string,
    dayNumber: number,
    sectionId: number | string,
    passageLabel: string,
  ): Promise<ReadingProgressEntry | undefined> {
    const entry = await this.getDayProgress(planId, dayNumber);
    if (!entry || !entry.harmonySections) return entry;

    const now = Date.now();
    const section = entry.harmonySections.find(s => s.sectionId === sectionId);
    if (!section) return entry;

    const passage = section.passages.find(p => p.label === passageLabel);
    if (passage && !passage.completed) {
      passage.completed = true;
      passage.completedAt = now;
    }

    // Section done when all its passages are complete
    if (section.passages.every(p => p.completed) && !section.completed) {
      section.completed = true;
      section.completedAt = now;
    }

    const updated = recomputeCompletion(entry);
    await writeTransaction("reading_progress", (store) => store.put(this.serialize(updated)));
    return updated;
  }

  /**
   * Toggle a single harmony passage complete/incomplete and persist.
   */
  async togglePassageComplete(
    planId: string,
    dayNumber: number,
    sectionId: number | string,
    passageLabel: string,
  ): Promise<ReadingProgressEntry | undefined> {
    const entry = await this.getDayProgress(planId, dayNumber);
    if (!entry || !entry.harmonySections) return entry;

    const now = Date.now();
    const section = entry.harmonySections.find(s => s.sectionId === sectionId);
    if (!section) return entry;

    const passage = section.passages.find(p => p.label === passageLabel);
    if (passage) {
      passage.completed = !passage.completed;
      passage.completedAt = passage.completed ? now : undefined;
    }

    // Recompute section completion
    const sectionDone = section.passages.every(p => p.completed) && section.passages.length > 0;
    section.completed = sectionDone;
    section.completedAt = sectionDone ? (section.completedAt ?? now) : undefined;

    const updated = recomputeCompletion(entry);
    await writeTransaction("reading_progress", (store) => store.put(this.serialize(updated)));
    return updated;
  }

  /**
   * Mark all passages and sections complete for a harmony day at once.
   */
  async markHarmonyDayComplete(
    planId: string,
    dayNumber: number,
  ): Promise<ReadingProgressEntry | undefined> {
    const entry = await this.getDayProgress(planId, dayNumber);
    if (!entry) return undefined;

    const now = Date.now();

    if (entry.harmonySections) {
      for (const section of entry.harmonySections) {
        for (const passage of section.passages) {
          if (!passage.completed) {
            passage.completed = true;
            passage.completedAt = now;
          }
        }
        if (!section.completed) {
          section.completed = true;
          section.completedAt = now;
        }
      }
    }

    entry.completed = true;
    entry.completedAt = now;

    await writeTransaction("reading_progress", (store) => store.put(this.serialize(entry)));
    return entry;
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
      harmonySections: entry.harmonySections ? JSON.stringify(entry.harmonySections) : undefined,
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
      harmonySections: record.harmonySections
        ? JSON.parse(record.harmonySections)
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
