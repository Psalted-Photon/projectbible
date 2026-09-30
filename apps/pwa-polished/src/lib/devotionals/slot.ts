/**
 * Morning or evening, by the user's clock.
 *
 * "Clock" means the timezone setting, or the device's own zone when that is
 * unset — the same answer the wake alarm and todayStore use. Noon is the flip.
 */

import { readable } from 'svelte/store';
import { wallClockIn } from '../alarm/alarmSchedule';
import { getEffectiveTimezone, type DevotionalSettings } from '../../adapters/settings';
import { localDateStr } from '../../stores/clockStore';
import type { DevotionalSlot, DevotionalWork } from './devotionalsData';

export function currentSlot(now: Date = new Date()): 'morning' | 'evening' {
  return wallClockIn(getEffectiveTimezone(), now).hour < 12 ? 'morning' : 'evening';
}

/** The current slot, rechecked every minute so an open card flips at noon (and at midnight back). */
export const currentSlotStore = readable<'morning' | 'evening'>(currentSlot(), (set) => {
  const id = setInterval(() => set(currentSlot()), 60_000);
  return () => clearInterval(id);
});

/** Today's month and day in the user's timezone. */
export function todayMonthDay(now: Date = new Date()): { month: number; day: number } {
  const [, m, d] = localDateStr(now).split('-').map(Number);
  return { month: m, day: d };
}

/** Which of a work's readings to show now: a one-a-day work has 'day'; otherwise the setting, or the time of day. */
export function slotFor(
  work: Pick<DevotionalWork, 'hasSlots'> | null | undefined,
  settings: Pick<DevotionalSettings, 'slotMode'>,
  now: 'morning' | 'evening' = currentSlot(),
): DevotionalSlot {
  if (work && !work.hasSlots) return 'day';
  if (settings.slotMode === 'morning' || settings.slotMode === 'evening') return settings.slotMode;
  return now;
}

/** Works without slots, by id — so callers that have only an id (a deep link, a push) can pick the slot without a DB read. */
export const ONE_A_DAY_WORKS = new Set(['faiths-checkbook']);
