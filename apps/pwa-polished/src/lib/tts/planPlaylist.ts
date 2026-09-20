/**
 * Today's reading, as a list of passages Read Aloud can play straight through.
 *
 * The plan screens each build this themselves out of their own state — a day,
 * its catch-up chapters, its harmony sections — and that is fine for drawing a
 * card. Playback needs it from anywhere, including the Profile card, which does
 * not load catch-up days at all. So it is worked out once here, from storage,
 * and both buttons ask the same question.
 */

import type { HarmonyPassage, HarmonySection } from '@projectbible/core';
import { planDayDateStr } from '@projectbible/core';
import { normalizeBookName } from '../bibleData';
import { readingProgressStore } from '../../stores/ReadingProgressStore';
import { localDateStr } from '../../stores/clockStore';
import type { Passage } from './readingEngine';

const STORAGE_ACTIVE_PLAN = 'projectbible_active_reading_plan'; // legacy key
const STORAGE_ACTIVE_PLANS = 'projectbible_active_reading_plans';
const CATCHUP_STORAGE_PREFIX = 'projectbible_catchup_days_';

/** Today's reading, ready to play, plus what has to be ticked off afterwards. */
export interface PlanPlaylist {
  planId: string;
  dayNumber: number;
  planType: 'standard' | 'harmony';
  passages: Passage[];
  /**
   * Which section and passage each entry came from, for a harmony day. Same
   * length and order as `passages`; empty for a standard day, whose entries are
   * ticked by book and chapter instead.
   */
  harmonyRefs: Array<{ sectionId: number | string; label: string }>;
  /** The harmony day's section template, so progress can be created on demand. */
  harmonySections: HarmonySection[];
  /** Every chapter of the day, for creating a standard day's progress row. */
  chapters: Array<{ book: string; chapter: number }>;
}

/** The plan the widgets show: the most recently added one. */
function loadActivePlan(): { id: string; plan: any } | null {
  try {
    const storedNew = localStorage.getItem(STORAGE_ACTIVE_PLANS) ?? sessionStorage.getItem(STORAGE_ACTIVE_PLANS);
    if (storedNew) {
      const arr: Array<{ id: string; plan: any }> = JSON.parse(storedNew);
      if (arr.length > 0) return arr[arr.length - 1];
      return null;
    }
    const storedOld = localStorage.getItem(STORAGE_ACTIVE_PLAN);
    if (storedOld) return JSON.parse(storedOld);
  } catch {
    // A corrupt plan is not worth a thrown error at the tap of a play button.
  }
  return null;
}

/** Catch-up days the plan screen has generated for this plan, if any. */
function loadCatchUpDays(planId: string): Array<{ dayNumber: number; chapters: Array<{ book: string; chapter: number }> }> {
  try {
    const raw = localStorage.getItem(`${CATCHUP_STORAGE_PREFIX}${planId}`);
    if (!raw) return [];
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

/**
 * The day both plan cards call "today".
 *
 * The first day that is due and not finished — which is what the Reading Plan
 * modal shows, and is catch-up aware. Once everything due is done it falls back
 * to today's own day, so a finished day still has something to play.
 */
function pickTodayDay(plan: any, progress: Map<number, boolean>, todayStr: string): any | null {
  const firstDue = plan.days.find(
    (day: any) => planDayDateStr(day.date) <= todayStr && !progress.get(day.dayNumber)
  );
  if (firstDue) return firstDue;
  return plan.days.find((day: any) => planDayDateStr(day.date) === todayStr) ?? null;
}

/**
 * Build today's playlist, or null when there is nothing to play.
 *
 * Book names in plan data are the plural form ("Psalms") where the reader's
 * canon is singular, so every name is normalised on the way out — the engine
 * looks chapters up by that name and speaks it aloud through the same
 * normalisation.
 */
export async function getTodayPlaylist(): Promise<PlanPlaylist | null> {
  const active = loadActivePlan();
  if (!active?.plan?.days?.length) return null;

  const entries = await readingProgressStore.getProgressForPlan(active.id);
  const completed = new Map<number, boolean>(entries.map((e) => [e.dayNumber, !!e.completed]));

  const todayStr = localDateStr(new Date());
  const day = pickTodayDay(active.plan, completed, todayStr);
  if (!day) return null;

  const sections: HarmonySection[] = day.harmonySections ?? [];
  if (sections.length > 0) {
    const passages: Passage[] = [];
    const harmonyRefs: PlanPlaylist['harmonyRefs'] = [];
    for (const section of sections) {
      for (const p of section.passages) {
        const parts = splitHarmonyPassage(p);
        passages.push(...parts);
        // One ref per emitted passage, so the two stay in step even when a
        // passage crosses a chapter boundary and becomes several.
        for (let i = 0; i < parts.length; i++) {
          harmonyRefs.push({ sectionId: section.section, label: p.label });
        }
      }
    }
    if (passages.length === 0) return null;

    const chapterRefs = sections.flatMap((s) => s.chapter_refs ?? []);
    const chapters = [...new Map(chapterRefs.map((r) => [r.book + r.chapter, r])).values()];
    return {
      planId: active.id,
      dayNumber: day.dayNumber,
      planType: 'harmony',
      passages,
      harmonyRefs,
      harmonySections: sections,
      chapters,
    };
  }

  // A standard day, with any catch-up chapters the plan screen has added — the
  // card lists those too, so playback has to include them.
  const catchUp = loadCatchUpDays(active.id).find((d) => d.dayNumber === day.dayNumber);
  const entry = entries.find((e) => e.dayNumber === day.dayNumber);
  const added = entry?.catchUpAdjustment?.addedChapters ?? catchUp?.chapters ?? [];
  const chapters = [...(day.chapters ?? []), ...added].map((c: any) => ({
    book: normalizeBookName(c.book),
    chapter: c.chapter,
  }));
  if (chapters.length === 0) return null;

  return {
    planId: active.id,
    dayNumber: day.dayNumber,
    planType: 'standard',
    passages: chapters.map((c) => ({ book: c.book, chapter: c.chapter })),
    harmonyRefs: [],
    harmonySections: [],
    chapters,
  };
}

/**
 * One harmony passage as one or more playable passages.
 *
 * Robertson's sections can run across a chapter break — Mark 6:30 to 7:23 is
 * one passage in the plan, but the engine reads one chapter at a time, so it
 * becomes three: the tail of 6, all of 7's start... and so on. They are ticked
 * off together, as the one passage the plan calls them.
 */
function splitHarmonyPassage(p: HarmonyPassage): Passage[] {
  const book = normalizeBookName(p.book);
  const endChapter = p.endChapter ?? p.startChapter;
  if (endChapter <= p.startChapter) {
    return [{ book, chapter: p.startChapter, startVerse: p.startVerse, endVerse: p.endVerse }];
  }

  const out: Passage[] = [];
  for (let ch = p.startChapter; ch <= endChapter; ch++) {
    out.push({
      book,
      chapter: ch,
      startVerse: ch === p.startChapter ? p.startVerse : 1,
      endVerse: ch === endChapter ? p.endVerse : null,
    });
  }
  return out;
}
