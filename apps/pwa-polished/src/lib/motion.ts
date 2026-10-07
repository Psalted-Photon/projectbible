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
import {
  fade as svelteFade,
  fly as svelteFly,
  scale as svelteScale,
  type FadeParams,
  type FlyParams,
  type ScaleParams,
  type TransitionConfig,
} from 'svelte/transition';
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

// --- Sections ---------------------------------------------------------------

/**
 * in:reveal — a section that has just been opened: it fades in, settling 4px
 * down into place, in step with its caret turning. Plays only when the section
 * is opened, never when the card it sits in first draws. On Reduced it is a
 * plain fade; on Off it just appears.
 */
export function reveal(_el: Element): { duration: number; easing?: (t: number) => number; css?: (t: number, u: number) => string } {
  const level = motionLevel();
  if (level === 'off') return { duration: 0 };
  if (level === 'reduced') return { duration: MOTION.reducedFadeMs, css: (t) => `opacity: ${t}` };
  return {
    duration: MOTION.chevronMs,
    // Slows into place, like EASE_ENTER. Svelte wants a function here.
    easing: (t) => 1 - Math.pow(1 - t, 3),
    css: (t, u) => `opacity: ${t}; transform: translateY(${-4 * u}px)`,
  };
}

// --- Windows ----------------------------------------------------------------

function arriveMs(): number {
  const level = motionLevel();
  return level === 'off' ? 0 : level === 'full' ? MOTION.tabs.inMs : MOTION.reducedFadeMs;
}

/**
 * in:arrive — a window opening: a short fade, as long as a work-tab page takes
 * to slide in. Plays when a window is opened or moved, not for the windows
 * already up when the app starts.
 */
export function arrive(_el: Element): { duration: number; easing: (t: number) => number; css: (t: number) => string } {
  return { duration: arriveMs(), easing: (t) => 1 - Math.pow(1 - t, 3), css: (t) => `opacity: ${t}` };
}

/** The same fade, played on an element that stays put while what's inside it
 *  changes: a window showing something else. */
export function fadeIn(el: HTMLElement | null | undefined): void {
  const ms = arriveMs();
  if (!el || !ms || typeof el.animate !== 'function') return;
  el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: ms, easing: EASE_ENTER });
}

// --- Svelte's transitions, following the setting ---------------------------
//
// Drop-ins for svelte/transition's fade, fly and scale: import them from here
// instead. Svelte's own play the same whatever the Motion setting says. These
// are exactly Svelte's on full motion; on Reduced every one becomes the same
// short fade, and on Off nothing plays.

function byLevel(node: Element, full: () => TransitionConfig): TransitionConfig {
  const level = motionLevel();
  if (level === 'off') return { duration: 0 };
  if (level === 'reduced') return svelteFade(node, { duration: MOTION.reducedFadeMs });
  return full();
}

export function fade(node: Element, params?: FadeParams): TransitionConfig {
  return byLevel(node, () => svelteFade(node, params));
}

export function fly(node: Element, params?: FlyParams): TransitionConfig {
  return byLevel(node, () => svelteFly(node, params));
}

export function scale(node: Element, params?: ScaleParams): TransitionConfig {
  return byLevel(node, () => svelteScale(node, params));
}

/**
 * in:dropIn — growFrom as a Svelte transition, for a dropdown that is drawn
 * where it belongs from the start. It grows from its own transform-origin.
 * Pair it with out:fadeAway.
 */
export function dropIn(node: Element): TransitionConfig {
  return byLevel(node, () =>
    svelteScale(node, {
      start: MOTION.dropdown.startScale,
      duration: MOTION.dropdown.openMs,
      // Slows into place, like EASE_ENTER.
      easing: (t) => 1 - Math.pow(1 - t, 3),
    }),
  );
}

// --- Presses ----------------------------------------------------------------

/**
 * Buttons press in slightly under your finger and spring back as it lifts.
 *
 * One listener for the whole app rather than a style on every button, and it
 * only presses the controls: anything wider or taller than PRESS_MAX is a row
 * or a card, which shows the press with its background as it always has. It
 * never presses inside the reading text or anywhere you type.
 *
 * It uses the `scale` property, not `transform`, so a button that is already
 * placed or turned with a transform keeps it.
 *
 * Buttons that open a dropdown don't press either. The dropdown is placed by
 * measuring its button, a pressed button measures a pixel or two small, and
 * the dropdown growing out of it is that button's answer to the tap anyway.
 */
const PRESS_MAX = { width: 160, height: 72 };
const NO_PRESS = [
  '.verses', // the reading text
  '[contenteditable]',
  '.no-press',
  // Dropdown openers.
  '[aria-haspopup]',
  '[aria-expanded]',
  '.nav-dropdown',
  '.pill-btn',
  '.nav-il-gear',
  '.repeat-pill',
].join(', ');
const pressing = new Map<HTMLElement, Animation>();

function pressable(target: EventTarget | null): HTMLElement | null {
  const el = (target as Element | null)?.closest?.('button, [role="button"]') as HTMLElement | null;
  if (!el || (el as HTMLButtonElement).disabled || el.getAttribute('aria-disabled') === 'true') return null;
  if (el.closest(NO_PRESS) || typeof el.animate !== 'function') return null;
  const box = el.getBoundingClientRect();
  if (!box.width || box.width > PRESS_MAX.width || box.height > PRESS_MAX.height) return null;
  return el;
}

function pressDown(e: PointerEvent) {
  if (e.button !== 0 || motionLevel() !== 'full') return;
  const el = pressable(e.target);
  if (!el) return;
  pressing.get(el)?.cancel();
  const anim = el.animate([{ scale: '1' }, { scale: String(MOTION.press.scale) }], {
    duration: MOTION.press.ms,
    easing: EASE_STANDARD,
    fill: 'both',
  });
  pressing.set(el, anim);
}

function pressUp() {
  for (const [el, anim] of pressing) {
    pressing.delete(el);
    // Back out from wherever the press had got to.
    anim.reverse();
    anim.finished.then(() => anim.cancel(), () => {});
  }
}

let pressInstalled = false;

/** Turn on the press. Once, at startup. */
export function installPress(): void {
  if (pressInstalled || typeof document === 'undefined') return;
  pressInstalled = true;
  document.addEventListener('pointerdown', pressDown, { capture: true, passive: true });
  window.addEventListener('pointerup', pressUp, { capture: true, passive: true });
  window.addEventListener('pointercancel', pressUp, { capture: true, passive: true });
}

// Flipping the device's own switch takes effect at once on Match my device.
reduceQuery?.addEventListener?.('change', () => {
  if (setting === 'system') applyMotion(setting);
});
