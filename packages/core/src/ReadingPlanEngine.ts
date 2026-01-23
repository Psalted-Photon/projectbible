export type DayStatus = "unread" | "current" | "completed" | "ahead" | "overdue";

export interface ReadingPlanDay {
  dayNumber: number;
  date: Date | string | number;
  chapters: Array<{ book: string; chapter: number }>;
}

export interface ReadingPlan {
  id?: string;
  days: ReadingPlanDay[];
}

export interface ChapterAction {
  type: "checked" | "unchecked";
  timestamp: number;
}

export interface ChapterProgress {
  book: string;
  chapter: number;
  actions: ChapterAction[];
}

export interface ReadingProgressEntry {
  planId: string;
  dayNumber: number;
  completed: boolean;
  completedAt?: number;
  chaptersRead: ChapterProgress[];
}

export interface VerseCountResult {
  total: number;
  read: number;
  remaining: number;
  perDay: Array<{ dayNumber: number; totalVerses: number; readVerses: number }>;
}

export interface CatchUpSuggestion {
  dayNumber: number;
  addedChapters: Array<{ book: string; chapter: number }>;
}

export function computeDayStatus(
  day: ReadingPlanDay,
  progress: ReadingProgressEntry | undefined,
  today: Date = new Date(),
): DayStatus {
  const dayDate = normalizeDate(day.date);
  const todayDate = normalizeDate(today);

  if (progress?.completed) {
    if (dayDate.getTime() > todayDate.getTime()) {
      return "ahead";
    }
    return "completed";
  }

  if (dayDate.getTime() < todayDate.getTime()) {
    return "overdue";
  }

  if (dayDate.getTime() === todayDate.getTime()) {
    return "current";
  }

  return "unread";
}

export function getDaysAheadBehind(
  plan: ReadingPlan,
  progressEntries: ReadingProgressEntry[],
  today: Date = new Date(),
): number {
  const todayDate = normalizeDate(today);
  const scheduledCount = plan.days.filter((day) => normalizeDate(day.date) <= todayDate).length;
  const completedCount = progressEntries.filter((entry) => entry.completed).length;
  return completedCount - scheduledCount;
}

export function calculateStreak(progressEntries: ReadingProgressEntry[]): number {
  if (progressEntries.length === 0) return 0;

  const completionDates = progressEntries
    .filter((entry) => entry.completedAt)
    .map((entry) => normalizeDate(entry.completedAt!))
    .map((date) => date.getTime());

  const uniqueDates = Array.from(new Set(completionDates)).sort((a, b) => b - a);
  if (uniqueDates.length === 0) return 0;

  let streak = 1;
  for (let i = 1; i < uniqueDates.length; i += 1) {
    const prev = uniqueDates[i - 1];
    const current = uniqueDates[i];
    const diffDays = (prev - current) / (1000 * 60 * 60 * 24);
    if (diffDays === 1) {
      streak += 1;
    } else {
      break;
    }
  }

  return streak;
}

export function suggestCatchUp(
  plan: ReadingPlan,
  progressEntries: ReadingProgressEntry[],
  maxPerDay: number,
  today: Date = new Date(),
): CatchUpSuggestion[] {
  const todayDate = normalizeDate(today);
  const overdueDays = plan.days.filter((day) => {
    const dayDate = normalizeDate(day.date);
    const progress = progressEntries.find((entry) => entry.dayNumber === day.dayNumber);
    return dayDate < todayDate && !progress?.completed;
  });

  const overdueChapters = overdueDays.flatMap((day) => day.chapters);
  if (overdueChapters.length === 0) return [];

  const upcomingDays = plan.days.filter((day) => normalizeDate(day.date) >= todayDate);
  if (upcomingDays.length === 0) return [];

  const suggestions: CatchUpSuggestion[] = [];
  let chapterIndex = 0;

  for (const day of upcomingDays) {
    if (chapterIndex >= overdueChapters.length) break;
    const slice = overdueChapters.slice(chapterIndex, chapterIndex + maxPerDay);
    if (slice.length > 0) {
      suggestions.push({
        dayNumber: day.dayNumber,
        addedChapters: slice,
      });
    }
    chapterIndex += maxPerDay;
  }

  return suggestions;
}

export function calculateVerseCounts(
  plan: ReadingPlan,
  progressEntries: ReadingProgressEntry[],
  verseCounts: { [book: string]: number[] },
): VerseCountResult {
  let total = 0;
  let read = 0;
  const perDay: Array<{ dayNumber: number; totalVerses: number; readVerses: number }> = [];

  for (const day of plan.days) {
    let dayTotal = 0;
    let dayRead = 0;
    const progress = progressEntries.find((entry) => entry.dayNumber === day.dayNumber);

    for (const chapter of day.chapters) {
      const count = verseCounts[chapter.book]?.[chapter.chapter - 1] ?? 0;
      dayTotal += count;

      const chapterProgress = progress?.chaptersRead.find(
        (item) => item.book === chapter.book && item.chapter === chapter.chapter,
      );
      const latest = chapterProgress?.actions?.[chapterProgress.actions.length - 1];
      if (latest?.type === "checked") {
        dayRead += count;
      }
    }

    total += dayTotal;
    read += dayRead;
    perDay.push({ dayNumber: day.dayNumber, totalVerses: dayTotal, readVerses: dayRead });
  }

  return { total, read, remaining: Math.max(0, total - read), perDay };
}

export function mergeProgress(
  local: ReadingProgressEntry[],
  cloud: ReadingProgressEntry[],
): { merged: ReadingProgressEntry[]; conflicts: Array<any> } {
  const mergedMap = new Map<string, ReadingProgressEntry>();
  const conflicts: Array<any> = [];

  const allEntries = [...local, ...cloud];
  for (const entry of allEntries) {
    const key = `${entry.planId}-${entry.dayNumber}`;
    const existing = mergedMap.get(key);

    if (!existing) {
      mergedMap.set(key, entry);
      continue;
    }

    const localCompletedAt = existing.completedAt ?? 0;
    const incomingCompletedAt = entry.completedAt ?? 0;

    if (localCompletedAt === incomingCompletedAt) {
      mergedMap.set(key, mergeChapterActions(existing, entry));
    } else {
      const winner = incomingCompletedAt > localCompletedAt ? entry : existing;
      const merged = mergeChapterActions(existing, entry);
      merged.completed = winner.completed;
      merged.completedAt = winner.completedAt;
      mergedMap.set(key, merged);

      conflicts.push({
        planId: entry.planId,
        dayNumber: entry.dayNumber,
        localCompletedAt,
        incomingCompletedAt,
      });
    }
  }

  return { merged: Array.from(mergedMap.values()), conflicts };
}

function mergeChapterActions(
  a: ReadingProgressEntry,
  b: ReadingProgressEntry,
): ReadingProgressEntry {
  const map = new Map<string, ChapterProgress>();
  const mergeInto = (entry: ReadingProgressEntry) => {
    entry.chaptersRead.forEach((chapterProgress) => {
      const key = `${chapterProgress.book}-${chapterProgress.chapter}`;
      const existing = map.get(key);
      if (!existing) {
        map.set(key, {
          book: chapterProgress.book,
          chapter: chapterProgress.chapter,
          actions: [...chapterProgress.actions],
        });
      } else {
        existing.actions = [...existing.actions, ...chapterProgress.actions].sort(
          (left, right) => left.timestamp - right.timestamp,
        );
      }
    });
  };

  mergeInto(a);
  mergeInto(b);

  return {
    ...a,
    chaptersRead: Array.from(map.values()),
  };
}

function normalizeDate(value: Date | string | number): Date {
  const date = value instanceof Date ? new Date(value) : new Date(value);
  date.setHours(0, 0, 0, 0);
  return date;
}
