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

/**
 * Formats a Date (or epoch-ms) as a YYYY-MM-DD calendar string.
 * The app injects a timezone-aware implementation (clockStore.localDateStr,
 * which honors the user's timezone setting); this default uses device time.
 */
export type DateStrFn = (d: Date | number) => string;

const deviceDateStr: DateStrFn = (d) => {
  const date = typeof d === "number" ? new Date(d) : d;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
};

const CALENDAR_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Calendar-date label of a plan day. Plain YYYY-MM-DD strings pass through
 * untouched; Date/instant values are decoded with device-local time because
 * plan generation anchors day dates to device-local midnight — this recovers
 * the calendar day the generator intended, immune to timezone re-rendering.
 */
export function planDayDateStr(value: Date | string | number): string {
  if (typeof value === "string") {
    if (CALENDAR_DATE_RE.test(value)) return value;
    return deviceDateStr(new Date(value));
  }
  return deviceDateStr(value);
}

export function computeDayStatus(
  day: ReadingPlanDay,
  progress: ReadingProgressEntry | undefined,
  todayStr: string = deviceDateStr(new Date()),
): DayStatus {
  const dayStr = planDayDateStr(day.date);

  if (progress?.completed) {
    return dayStr > todayStr ? "ahead" : "completed";
  }
  if (dayStr < todayStr) return "overdue";
  if (dayStr === todayStr) return "current";
  return "unread";
}

export function getDaysAheadBehind(
  plan: ReadingPlan,
  progressEntries: ReadingProgressEntry[],
  todayStr: string = deviceDateStr(new Date()),
): number {
  const scheduledCount = plan.days.filter((day) => planDayDateStr(day.date) <= todayStr).length;
  const completedCount = progressEntries.filter((entry) => entry.completed).length;
  return completedCount - scheduledCount;
}

/**
 * Plan-aware strict streak.
 *
 * Walks the plan's SCHEDULED days backwards from today — days the plan never
 * scheduled (rest days) cannot break the streak. A scheduled day counts only
 * when it was completed on or before its own calendar date (reading ahead is
 * fine; completing late fills the reading but resets the streak). Today's
 * scheduled reading being not-yet-done doesn't break the streak — the day
 * isn't over. Pure calendar-string comparisons: no DST/midnight-math bugs.
 *
 * eventDateStr converts completedAt instants to the calendar day they
 * happened on — pass the user-timezone-aware formatter from the app.
 */
export function calculateStreak(
  plan: ReadingPlan,
  progressEntries: ReadingProgressEntry[],
  todayStr: string = deviceDateStr(new Date()),
  eventDateStr: DateStrFn = deviceDateStr,
): number {
  const byDay = new Map<number, ReadingProgressEntry>();
  for (const entry of progressEntries) byDay.set(entry.dayNumber, entry);

  const scheduled = plan.days
    .map((day) => ({ day, dayStr: planDayDateStr(day.date) }))
    .filter(({ dayStr }) => dayStr <= todayStr)
    .sort((a, b) =>
      a.dayStr < b.dayStr ? 1 : a.dayStr > b.dayStr ? -1 : b.day.dayNumber - a.day.dayNumber,
    );

  let streak = 0;
  for (const { day, dayStr } of scheduled) {
    const entry = byDay.get(day.dayNumber);
    const onTime =
      !!entry?.completed &&
      (entry.completedAt == null || eventDateStr(entry.completedAt) <= dayStr);
    if (onTime) {
      streak += 1;
      continue;
    }
    // Any of today's scheduled days may still be finished before midnight —
    // skip without breaking. Anything older that's missing/late ends the run.
    if (dayStr === todayStr) continue;
    break;
  }
  return streak;
}

export function suggestCatchUp(
  plan: ReadingPlan,
  progressEntries: ReadingProgressEntry[],
  maxPerDay: number,
  todayStr: string = deviceDateStr(new Date()),
): CatchUpSuggestion[] {
  const overdueDays = plan.days.filter((day) => {
    const progress = progressEntries.find((entry) => entry.dayNumber === day.dayNumber);
    return planDayDateStr(day.date) < todayStr && !progress?.completed;
  });

  const overdueChapters = overdueDays.flatMap((day) => day.chapters);
  if (overdueChapters.length === 0) return [];

  const upcomingDays = plan.days.filter((day) => planDayDateStr(day.date) >= todayStr);
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

