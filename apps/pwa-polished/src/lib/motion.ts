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
/** Things arriving slow into place. */
export const EASE_ENTER = 'cubic-bezier(0, 0, 0, 1)';
/** Things leaving speed up on the way out. */
export const EASE_EXIT = 'cubic-bezier(0.3, 0, 1, 1)';

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
      '--ease-enter': EASE_ENTER,
      '--ease-exit': EASE_EXIT,
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

// --- Dropdowns and popups --------------------------------------------------

const growing = new WeakMap<Element, Animation>();

/**
 * A dropdown or popup growing out of what opened it: from 96% and clear to its
 * full size, slowing into place. `from` is the opener's box; the growth starts
 * from its middle, on whichever edge of the dropdown faces it. Call it once
 * the dropdown is placed and about to show. On Reduced it is a plain fade; on
 * Off it just appears.
 *
 * Nothing is left on the element after: the transform and its origin are part
 * of the animation, not set as styles.
 */
export function growFrom(el: HTMLElement | null | undefined, from?: DOMRect | null): void {
  if (!el || typeof el.animate !== 'function') return;
  growing.get(el)?.cancel();
  const level = motionLevel();
  if (level === 'off') return;
  let anim: Animation;
  if (level === 'reduced') {
    anim = el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: MOTION.reducedFadeMs, easing: EASE_ENTER });
  } else {
    const origin = originFacing(el, from);
    anim = el.animate(
      [
        { opacity: 0, transform: `scale(${MOTION.dropdown.startScale})`, transformOrigin: origin },
        { opacity: 1, transform: 'scale(1)', transformOrigin: origin },
      ],
      { duration: MOTION.dropdown.openMs, easing: EASE_ENTER },
    );
  }
  growing.set(el, anim);
}

/** Svelte action form of growFrom, for a popup that is placed as it mounts. */
export function grow(el: HTMLElement, from?: DOMRect | null) {
  growFrom(el, from);
}

/** Where on `el` the opener's middle is, as a transform-origin. */
function originFacing(el: HTMLElement, from?: DOMRect | null): string {
  if (!from) return 'center top';
  const box = el.getBoundingClientRect();
  const x = Math.round(Math.min(Math.max(from.left + from.width / 2 - box.left, 0), box.width));
  const midY = from.top + from.height / 2;
  const y = midY <= box.top + box.height / 2 ? 'top' : 'bottom';
  return `${x}px ${y}`;
}

/**
 * out:fadeAway — a dropdown or popup leaving: a quick fade, about a third the
 * time it took to open. Svelte makes the leaving element ignore taps while it
 * fades, so a tap lands on what's under it. Reopened mid-fade, Svelte brings
 * the same element back rather than drawing a second one.
 */
export function fadeAway(_el: Element): { duration: number; easing: (t: number) => number; css: (t: number) => string } {
  const level = motionLevel();
  const duration =
    level === 'full' ? MOTION.dropdown.closeMs : level === 'reduced' ? Math.round(MOTION.reducedFadeMs * 0.6) : 0;
  // Speeds up on the way out, like EASE_EXIT. Svelte wants a function here.
  return { duration, easing: (t) => t * t * t, css: (t) => `opacity: ${t}` };
}

// Flipping the device's own switch takes effect at once on Match my device.
reduceQuery?.addEventListener?.('change', () => {
  if (setting === 'system') applyMotion(setting);
});
