/**
 * Decide what the wake alarm should read, at the moment it opens.
 *
 * Resolved on the device rather than baked into the push on purpose: a chapter
 * you finished at 11pm, or a plan day you completed last night, is reflected at
 * 6am instead of being frozen at whatever the server knew when it sent.
 */

import { planDayDateStr } from '@projectbible/core';
import { get } from 'svelte/store';
import { navigationStore } from '../../stores/navigationStore';
import { localDateStr } from '../../stores/clockStore';
import { getWakeAlarmSettings } from '../../adapters/settings';
import { BIBLE_BOOKS } from '../bibleData';

const STORAGE_ACTIVE_PLANS = 'projectbible_active_reading_plans';
const STORAGE_ACTIVE_PLAN = 'projectbible_active_reading_plan'; // legacy key

export interface AlarmPassage {
  book: string;
  chapter: number;
  /** 'Genesis 1' — for the start screen heading. */
  label: string;
  /** Why this passage, in the user's terms. */
  because: string;
}

/** Where the reader was last left. Restored from localStorage at boot. */
function currentPosition(): AlarmPassage {
  const nav = get(navigationStore);
  const book = nav.book || 'John';
  const chapter = nav.chapter || 1;
  return {
    book,
    chapter,
    label: `${book} ${chapter}`,
    because: 'where you left off',
  };
}

/**
 * The first chapter of today's reading in the most recently added plan.
 * Returns null when there is no plan, or today is not a reading day.
 */
function planPassage(): AlarmPassage | null {
  try {
    let data: { id: string; plan: any } | null = null;

    const storedNew = localStorage.getItem(STORAGE_ACTIVE_PLANS);
    if (storedNew) {
      const plans: Array<{ id: string; plan: any }> = JSON.parse(storedNew);
      if (plans.length > 0) data = plans[plans.length - 1];
    } else {
      const storedOld = localStorage.getItem(STORAGE_ACTIVE_PLAN);
      if (storedOld) data = JSON.parse(storedOld);
    }

    const days = data?.plan?.days;
    if (!Array.isArray(days)) return null;

    const today = localDateStr(new Date());
    const day = days.find((d: any) => planDayDateStr(d.date) === today);
    const first = day?.chapters?.[0];
    if (!first?.book || !first?.chapter) return null;

    return {
      book: first.book,
      chapter: first.chapter,
      label: `${first.book} ${first.chapter}`,
      because: "today's reading in your plan",
    };
  } catch {
    return null;
  }
}

/** Clamp a saved chapter that no longer exists (a shorter book, bad data). */
function clamp(passage: AlarmPassage): AlarmPassage {
  const info = BIBLE_BOOKS.find((b) => b.name === passage.book);
  if (!info) return passage;
  const chapter = Math.min(Math.max(1, passage.chapter), info.chapters);
  if (chapter === passage.chapter) return passage;
  return { ...passage, chapter, label: `${passage.book} ${chapter}` };
}

/**
 * What to read now. Always returns something — a broken plan or a missing
 * setting falls back to the current position rather than leaving the start
 * screen with nothing to offer.
 */
export function resolveAlarmPassage(): AlarmPassage {
  const alarm = getWakeAlarmSettings();

  if (alarm.source === 'chapter' && alarm.book) {
    return clamp({
      book: alarm.book,
      chapter: alarm.chapter ?? 1,
      label: `${alarm.book} ${alarm.chapter ?? 1}`,
      because: 'the chapter you chose',
    });
  }

  if (alarm.source === 'plan') {
    const fromPlan = planPassage();
    if (fromPlan) return clamp(fromPlan);
    // Plan finished, not started, or today is a rest day.
    return clamp({ ...currentPosition(), because: 'where you left off — no plan reading today' });
  }

  return clamp(currentPosition());
}
