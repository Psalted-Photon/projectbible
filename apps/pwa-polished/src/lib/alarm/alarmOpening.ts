/**
 * Keeps the next alarm's opening saved, so Start reading speaks at once
 * (makeOpening in lib/tts/readingEngine.ts).
 *
 * Made when the alarm is saved, and again whenever you leave the app if what
 * the next ring would read has changed: a new chapter for "where you left
 * off", another translation, voice or reading setting. Nothing is made when
 * the saved one still fits, so leaving the app normally costs one quick check.
 *
 * The voice can't run while the app is closed, so this happens only while
 * irisBible is open. If the phone stops it partway, the alarm screen makes one
 * live instead.
 */

import { get } from 'svelte/store';
import { navigationStore } from '../../stores/navigationStore';
import { getWakeAlarmSettings, getEffectiveTimezone } from '../../adapters/settings';
import { isTtsSupported } from '../../adapters/tts';
import { makeOpening } from '../tts/readingEngine';
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

/** Refresh on leaving the app (screen off, switching away, closing). Returns the cleanup. */
export function watchAlarmOpening(): () => void {
  const onHidden = () => {
    if (document.visibilityState === 'hidden') void refreshAlarmOpening();
  };
  document.addEventListener('visibilitychange', onHidden);
  window.addEventListener('pagehide', onHidden);
  return () => {
    document.removeEventListener('visibilitychange', onHidden);
    window.removeEventListener('pagehide', onHidden);
  };
}
