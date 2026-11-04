/**
 * By Heart's Today: everything due, one verse after another, on the game screen.
 * With no mic to use here, or Silent study chosen on this device, it runs as
 * silent study, so nobody is stuck without one.
 */

import { get } from 'svelte/store';
import { getSettings } from '../../adapters/settings';
import { syncedByHeartStore } from '../../adapters/SyncedByHeartStore';
import { showNotice } from '../../stores/noticeStore';
import { voiceReady } from '../voice/holdToTalk';
import { byHeartGame } from './game';
import { todaySteps } from './schedule';

/** Whether this device runs silently: chosen in a game, or no mic to be had. */
export function silentHere(): boolean {
  const ready = get(voiceReady);
  return getSettings().byHeartSilent === true || ready.mic === false || ready.permission === 'denied';
}

export async function startToday(): Promise<void> {
  const steps = todaySteps(await syncedByHeartStore.list(), silentHere());
  if (!steps.length) {
    showNotice('Nothing is due today.');
    return;
  }
  byHeartGame.set({ id: Date.now(), steps, at: 0, today: true });
}
