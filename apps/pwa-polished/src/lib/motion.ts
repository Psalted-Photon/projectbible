/**
 * motion.ts
 *
 * Motion: how much the app moves, set in Settings → Appearance → Motion. Per
 * device, like Bar size.
 *
 *   Match my device  follows the device's own switch (Remove animations on
 *                    Android, Reduce motion on iPhone and Mac, Show animations
 *                    on Windows). The default.
 *   Reduced          every turn and slide becomes a short fade.
 *   Off              nothing moves.
 *
 * The level this works out to goes onto :root as data-motion="full|reduced|off"
 * and into the `motion` store, for code that animates in script. Alongside it
 * go the CSS variables below. They are already adjusted for the level: on
 * Reduced a press or chevron gets a 0ms duration and a dropdown gets a plain
 * fade. So CSS can use them as they are and never needs to check the level.
 *
 * The timings come from motion-lab.html. Its Copy values prints the MOTION
 * block below; paste it over this one whenever they are retuned.
 */

import { writable, get } from 'svelte/store';
import { getSettings } from '../adapters/settings';

export type MotionSetting = 'system' | 'reduced' | 'off';
export type MotionLevel = 'full' | 'reduced' | 'off';

export const MOTION_SETTINGS: { value: MotionSetting; label: string }[] = [
  { value: 'system', label: 'Match my device' },
  { value: 'reduced', label: 'Reduced' },
  { value: 'off', label: 'Off' },
];

// Motion lab v1.0. Paste into src/lib/motion.ts.
export const MOTION = {
  flip: {
    style: 'turn', awayMs: 85, inMs: 80, tiltDeg: 14, fullMs: 450,
    perspective: 1450, shade: 0.6, behind: 0.8, reverse: false,
    awayEase: 'cubic-bezier(0.3, 0, 1, 1)', inEase: 'cubic-bezier(0, 0, 0, 1)', fullEase: 'cubic-bezier(0.2, 0, 0, 1)',
  },
  tabs: { underlineMs: 330, slidePx: 15, outMs: 90, inMs: 160 },
  dropdown: { openMs: 300, closeMs: 100, startScale: 0.96 },
  press: { scale: 0.97, ms: 80 },
  chevronMs: 150,
  reducedFadeMs: 120,
};

/** For movements with no direction of their own: a press, a chevron, an underline. */
export const EASE_STANDARD = 'cubic-bezier(0.2, 0, 0, 1)';

const reduceQuery =
  typeof window !== 'undefined' && window.matchMedia
    ? window.matchMedia('(prefers-reduced-motion: reduce)')
    : null;

let setting: MotionSetting = getSettings().motion ?? 'system';

function levelFor(s: MotionSetting): MotionLevel {
  if (s === 'system') return reduceQuery?.matches ? 'reduced' : 'full';
  return s;
}

/** The level in force right now. */
export const motion = writable<MotionLevel>(levelFor(setting));

export function motionLevel(): MotionLevel {
  return get(motion);
}

/** Put a setting on the page: the attribute, the variables and the store together. */
export function applyMotion(s: MotionSetting | undefined): void {
  setting = s ?? 'system';
  const level = levelFor(setting);
  if (typeof document !== 'undefined') {
    const root = document.documentElement;
    root.dataset.motion = level;
    const full = level === 'full';
    const fade = level === 'off' ? 0 : MOTION.reducedFadeMs;
    const vars: Record<string, string> = {
      '--ease-standard': EASE_STANDARD,
      '--ease-enter': MOTION.flip.inEase,
      '--ease-exit': MOTION.flip.awayEase,
      '--motion-fade-ms': `${fade}ms`,
      '--motion-press-ms': `${full ? MOTION.press.ms : 0}ms`,
      '--motion-press-scale': String(full ? MOTION.press.scale : 1),
      '--motion-chevron-ms': `${full ? MOTION.chevronMs : 0}ms`,
      '--motion-underline-ms': `${full ? MOTION.tabs.underlineMs : 0}ms`,
      '--motion-dropdown-open-ms': `${full ? MOTION.dropdown.openMs : fade}ms`,
      '--motion-dropdown-close-ms': `${full ? MOTION.dropdown.closeMs : Math.round(fade * 0.6)}ms`,
      '--motion-dropdown-start': String(full ? MOTION.dropdown.startScale : 1),
      '--motion-flip-perspective': `${MOTION.flip.perspective}px`,
      '--motion-flip-behind': String(MOTION.flip.behind),
    };
    for (const [name, value] of Object.entries(vars)) root.style.setProperty(name, value);
  }
  motion.set(level);
}

// Flipping the device's own switch takes effect at once on Match my device.
reduceQuery?.addEventListener?.('change', () => {
  if (setting === 'system') applyMotion(setting);
});
