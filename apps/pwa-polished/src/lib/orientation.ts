/**
 * orientation.ts
 *
 * Which way the screen may turn. Settings → "Allow screen rotation" decides it:
 * off (the default) keeps the phone upright, on lets it follow the phone. App
 * applies it at launch, on returning to the app and whenever settings are
 * saved, which includes settings arriving from the cloud.
 *
 * Connections can take a hold to lift the lock while it wants the phone
 * sideways. While any hold is on, those re-locks leave the screen alone.
 * Letting go of the last one puts the setting back, which with rotation off
 * snaps the phone upright.
 */

import { getSettings } from '../adapters/settings';

let holds = 0;

/** Lock or free the screen as the setting says, unless a hold has it. */
export async function applyOrientationLock(): Promise<void> {
  if (holds > 0) return;
  if (typeof screen === 'undefined' || !screen.orientation) return;
  const { allowRotation } = getSettings();
  try {
    if (allowRotation) {
      screen.orientation.unlock();
    } else {
      try {
        await (screen.orientation as any).lock('portrait-primary');
      } catch {
        await (screen.orientation as any).lock('portrait');
      }
    }
  } catch {
    // Desktop/tablet browsers may not support orientation lock — ignore
  }
}

/**
 * Let the screen turn whatever the setting says, until the returned function
 * is called. Calling it twice lets go once.
 */
export function holdOrientation(): () => void {
  holds++;
  try {
    screen.orientation?.unlock();
  } catch {
    // No orientation lock here, so nothing to lift.
  }
  let held = true;
  return () => {
    if (!held) return;
    held = false;
    holds--;
    if (holds === 0) void applyOrientationLock();
  };
}
