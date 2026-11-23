/**
 * Keeps the next alarm's opening saved, so Start reading speaks at once
 * (makeOpening in lib/tts/readingEngine.ts).
 *
 * Made when the alarm is saved, and again while the app is open and settled
 * if what the next ring would read has changed: a new chapter for "where you
 * left off" (once you stop on it), another translation, or Read Aloud ending.
 * Nothing is made when the saved one still fits, so a check costs little.
 *
 * Never on leaving the app: the phone freezes a page that has just gone to
 * the background, and freezing the voice partway through a line left it stuck
 * when the alarm opened the app, so Start reading never spoke. Leaving the app
 * now stops one being made, after the line in hand.
 */

import { get } from 'svelte/store';
import { navigationStore } from '../../stores/navigationStore';
import { wakeAlarmStartOpen } from '../../stores/wakeAlarmStore';
import { getWakeAlarmSettings, getEffectiveTimezone } from '../../adapters/settings';
import { isTtsSupported } from '../../adapters/tts';
import { makeOpening, cancelOpening, isReadingActive } from '../tts/readingEngine';
import { minutesUntilAlarm } from './alarmSchedule';
import { resolveAlarmPassage } from './resolvePassage';

/** Make or refresh the saved opening for the next ring, when the alarm is on. */
export async function refreshAlarmOpening(): Promise<void> {
  try {
    const alarm = getWakeAlarmSettings();
    if (!alarm.enabled || !isTtsSupported()) return;
    const minutes = minutesUntilAlarm(alarm.time, alarm.days, getEffectiveTimezone());
    if (minutes === null) return;
    const ring = new Date(Date.now() + minutes * 60_000);
    const passage = resolveAlarmPassage(ring);
    await makeOpening(get(navigationStore).translation, passage.book, passage.chapter);
  } catch (err) {
    console.warn('[Opening] refresh failed:', err);
  }
}

/** How long the app has to sit still (same chapter, no Read Aloud) before a check. */
const SETTLE_MS = 20_000;

/** Refresh while the app is open and settled; stop on leaving it. Returns the cleanup. */
export function watchAlarmOpening(): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const later = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      // The alarm screen makes its own when it needs one.
      if (document.visibilityState !== 'visible' || get(isReadingActive) || get(wakeAlarmStartOpen)) return;
      void refreshAlarmOpening();
    }, SETTLE_MS);
  };

  const onVisibility = () => {
    if (document.visibilityState === 'hidden') {
      if (timer) clearTimeout(timer);
      timer = null;
      cancelOpening();
    } else {
      later();
    }
  };
  document.addEventListener('visibilitychange', onVisibility);
  window.addEventListener('pagehide', onVisibility);

  let place = '';
  const stopNav = navigationStore.subscribe((nav) => {
    const next = `${nav.translation}|${nav.book}|${nav.chapter}`;
    if (next === place) return;
    place = next;
    later();
  });
  const stopReading = isReadingActive.subscribe((active) => {
    if (!active) later();
  });

  return () => {
    if (timer) clearTimeout(timer);
    document.removeEventListener('visibilitychange', onVisibility);
    window.removeEventListener('pagehide', onVisibility);
    stopNav();
    stopReading();
  };
}
