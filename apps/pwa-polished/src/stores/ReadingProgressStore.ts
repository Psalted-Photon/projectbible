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

/**
 * Hook invoked after every local progress mutation so the sync layer can
 * push the updated entry to Supabase. Registered by SyncedReadingAdapter.
 * Intentionally NOT fired by upsertEntries (the remote-apply path) so
 * pulled data is never echoed straight back to the server.
 */
export type ProgressSyncHook = (entry: ReadingProgressEntry) => void;
let progressSyncHook: ProgressSyncHook | null = null;
export function registerProgressSyncHook(fn: ProgressSyncHook): void {
  progressSyncHook = fn;
}
function notifySync(entry: ReadingProgressEntry): void {
  try {
    progressSyncHook?.(entry);
  } catch (err) {
    console.error('[ReadingProgress] sync hook error:', err);
  }
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

/**
 * Union-merge chaptersRead from two entries.
 * All unique chapter actions from both sides are preserved; actions are
 * deduplicated by (timestamp, type) and sorted chronologically.
 */
function mergeChaptersRead(a: ChapterProgress[], b: ChapterProgress[]): ChapterProgress[] {
  const merged = new Map<string, ChapterProgress>();
  for (const ch of a) {
    merged.set(getChapterKey(ch.book, ch.chapter), { ...ch, actions: [...ch.actions] });
  }
  for (const ch of b) {
    const key = getChapterKey(ch.book, ch.chapter);
    if (merged.has(key)) {
      const existing = merged.get(key)!;
      const combined = [...existing.actions, ...ch.actions];
      const seen = new Set<string>();
      const deduped = combined.filter((a) => {
        const k = `${a.timestamp}:${a.type}`;
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      });
      deduped.sort((x, y) => x.timestamp - y.timestamp);
      existing.actions = deduped;
    } else {
      merged.set(key, { ...ch, actions: [...ch.actions] });
    }
  }
  return Array.from(merged.values());
}

/**
 * Union-merge harmonySections from two entries.
 * A passage marked complete on either device stays complete.
 */
function mergeHarmonySections(a: HarmonySectionProgress[], b: HarmonySectionProgress[]): HarmonySectionProgress[] {
  const merged: HarmonySectionProgress[] = a.map(s => ({
    ...s,
    passages: s.passages.map(p => ({ ...p })),
  }));
  for (const inSec of b) {
    const exSec = merged.find(s => s.sectionId === inSec.sectionId);
    if (exSec) {
      for (const inPass of inSec.passages) {
        const exPass = exSec.passages.find(p => p.label === inPass.label);
        if (exPass) {
          if (inPass.completed && !exPass.completed) {
            exPass.completed = true;
            exPass.completedAt = inPass.completedAt;
          }
        } else {
          exSec.passages.push({ ...inPass });
        }
      }
      if (inSec.completed && !exSec.completed) {
        exSec.completed = true;
        exSec.completedAt = inSec.completedAt;
      }
    } else {
      merged.push({ ...inSec, passages: inSec.passages.map(p => ({ ...p })) });
    }
  }
  return merged;
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
    const db = await openDB();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction("reading_progress", "readwrite");
      const store = tx.objectStore("reading_progress");
      let pending = entries.length;
      if (pending === 0) { resolve(); return; }

      entries.forEach((incoming) => {
        const key = incoming.id;
        const getReq = store.get(key);
        getReq.onsuccess = () => {
          const existing: ReadingProgressEntry | undefined = getReq.result
            ? this.deserialize(getReq.result)
            : undefined;
          // Conflict resolution: union-merge both entries so no progress from
          // any device is ever discarded.
          let winner = incoming;
          if (existing) {
            const mergedChapters = mergeChaptersRead(
              existing.chaptersRead ?? [],
              incoming.chaptersRead ?? [],
            );
            const mergedSections =
              existing.harmonySections || incoming.harmonySections
                ? mergeHarmonySections(
                    existing.harmonySections ?? [],
                    incoming.harmonySections ?? [],
                  )
                : undefined;
            // completed is true if either device marked it complete
            const completed = existing.completed || incoming.completed;
            // completedAt: most recent non-null value
            const completedAt =
              existing.completedAt && incoming.completedAt
                ? Math.max(existing.completedAt, incoming.completedAt)
                : existing.completedAt ?? incoming.completedAt;
            // startedReadingAt: earliest non-null value
            const startedReadingAt =
              existing.startedReadingAt && incoming.startedReadingAt
                ? Math.min(existing.startedReadingAt, incoming.startedReadingAt)
                : existing.startedReadingAt ?? incoming.startedReadingAt;
            // createdAt: earliest
            const createdAt = Math.min(
              existing.createdAt ?? Infinity,
              incoming.createdAt ?? Infinity,
            );
            winner = {
              ...incoming,
              chaptersRead: mergedChapters,
              harmonySections: mergedSections,
              completed,
              completedAt,
              startedReadingAt,
              createdAt,
            };
            // Re-derive completed flag from merged chapter state
            winner = recomputeCompletion(winner);
          }
          store.put(this.serialize(winner));
          pending--;
          if (pending === 0) resolve();
        };
        getReq.onerror = () => {
          // On read error, just write the incoming entry
          store.put(this.serialize(incoming));
          pending--;
          if (pending === 0) resolve();
        };
      });

      tx.onerror = () => reject(tx.error);
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
    notifySync(entry);
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
    notifySync(updated);
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
      // Only append when the chapter isn't already checked — repeated "Mark Day
      // Complete" taps must not grow the action log with redundant entries.
      if (!isChapterChecked({ book: ch.book, chapter: ch.chapter, actions })) {
        actions.push({ type: "checked", timestamp: now });
      }
      return { book: ch.book, chapter: ch.chapter, actions };
    });

    entry.completed = true;
    entry.completedAt = now;

    await writeTransaction("reading_progress", (store) => store.put(this.serialize(entry)));
    notifySync(entry);
    return entry;
  }

  async setCatchUpAdjustment(entry: ReadingProgressEntry): Promise<void> {
    await writeTransaction("reading_progress", (store) => store.put(this.serialize(entry)));
    notifySync(entry);
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
    notifySync(updated);
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
    notifySync(updated);
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
    notifySync(entry);
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
