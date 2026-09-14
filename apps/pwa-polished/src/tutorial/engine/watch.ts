/**
 * Knowing when to look again, and whether the app is free to be pointed at.
 */

import { derived, get } from 'svelte/store';
import { dailyGreetingOpen } from '../../stores/dailyGreetingStore';
import { wakeAlarmStartOpen } from '../../stores/wakeAlarmStore';
import { showProgressModal } from '../../lib/pack-triggers';
import { lookupStore } from '../../stores/lookupStore';
import { profileModalStore } from '../../stores/profileModalStore';
import { readingPlanModalStore } from '../../stores/readingPlanModalStore';
import { paneStore } from '../../stores/paneStore';

/**
 * Nothing is covering the app that the tutorial should wait behind: the Verse
 * of the Day, the wake-alarm screen, a pack download, the lookup card, the
 * profile or the reading plan. Panes are left out -- some steps happen inside
 * them -- and checked on their own with `anyPaneOpen`.
 */
export const appQuiet = derived(
  [
    dailyGreetingOpen,
    wakeAlarmStartOpen,
    showProgressModal,
    lookupStore,
    profileModalStore,
    readingPlanModalStore,
  ],
  ([greeting, alarm, progress, lookup, profile, plan]) =>
    !greeting && !alarm && !progress && lookup === null && !profile && !plan,
);

export function anyPaneOpen(): boolean {
  return get(paneStore).some((p) => p.isOpen);
}

export function paneOpen(type: string): boolean {
  return get(paneStore).some((p) => p.type === type && p.isOpen);
}

/**
 * Call `fn` at most once a frame whenever something on screen might have
 * changed: the page's markup or classes, a scroll anywhere, a resize, or a
 * store the caller names. A slow timer backs these up for movement nothing
 * announces, like a panel sliding in on a CSS transition.
 *
 * Only runs while a tour step is up, so the cost is a few seconds of work, not
 * a standing drain.
 */
export function watchScreen(
  fn: () => void,
  stores: Array<{ subscribe: (run: (value: unknown) => void) => () => void }> = [],
): () => void {
  let frame = 0;
  const schedule = () => {
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      fn();
    });
  };

  const observer = new MutationObserver(schedule);
  observer.observe(document.body, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ['class', 'aria-expanded', 'style', 'hidden'],
  });
  window.addEventListener('scroll', schedule, { capture: true, passive: true });
  window.addEventListener('resize', schedule, { passive: true });
  const timer = window.setInterval(schedule, 250);
  const unsubs = stores.map((s) => s.subscribe(schedule));

  schedule();

  return () => {
    observer.disconnect();
    window.removeEventListener('scroll', schedule, { capture: true });
    window.removeEventListener('resize', schedule);
    window.clearInterval(timer);
    if (frame) cancelAnimationFrame(frame);
    unsubs.forEach((u) => u());
  };
}
