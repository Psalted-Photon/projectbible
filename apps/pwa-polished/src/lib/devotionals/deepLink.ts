/**
 * Reading a devotional out of a URL.
 *
 *   ?devo=<workId>&d=MM-DD&s=<slot>   a shared reading (buildDevotionalUrl)
 *   ?devo=today&s=morning             a reminder: today's reading of the main work
 *
 * Anything missing falls back to today, the main work, and the slot that fits
 * the work and the time of day.
 */

import { getDevotionalSettings } from '../../adapters/settings';
import { ONE_A_DAY_WORKS, slotFor, todayMonthDay } from './slot';
import type { DevotionalTarget } from '../../stores/devotionalStore';
import type { DevotionalSlot } from './devotionalsData';

const KNOWN_WORKS = new Set(['spurgeon-me', 'faiths-checkbook', 'daily-light']);

export const DEVOTIONAL_PARAMS = ['devo', 'd', 's'] as const;

export function devotionalTargetFromParams(params: URLSearchParams): DevotionalTarget | null {
  const devo = params.get('devo');
  if (!devo) return null;
  const settings = getDevotionalSettings();
  const workId = devo === 'today' || !KNOWN_WORKS.has(devo) ? settings.mainWork : devo;

  let { month, day } = todayMonthDay();
  const d = /^(\d{1,2})-(\d{1,2})$/.exec(params.get('d') ?? '');
  if (d && +d[1] >= 1 && +d[1] <= 12 && +d[2] >= 1 && +d[2] <= 31) {
    month = +d[1];
    day = +d[2];
  }

  const s = params.get('s');
  let slot: DevotionalSlot;
  if (ONE_A_DAY_WORKS.has(workId)) slot = 'day';
  else if (s === 'morning' || s === 'evening') slot = s;
  else slot = slotFor({ hasSlots: true }, settings);

  return { workId, month, day, slot };
}

/** The same, from a whole URL (what the service worker hands over). */
export function devotionalTargetFromUrl(url: string): DevotionalTarget | null {
  try {
    return devotionalTargetFromParams(new URL(url, window.location.origin).searchParams);
  } catch {
    return null;
  }
}
