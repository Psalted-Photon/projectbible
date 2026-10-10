/**
 * The launch splash: the irisBible wordmark, on the ground of whichever look
 * the clock picks (lib/wordmark.ts), covering the app while it starts.
 *
 * It stays up for at least a full second, even when the app is ready sooner,
 * so the logo is actually seen. Where the app takes longer, it simply stays
 * until the app is up. Two ways out never wait for the second: an error (the
 * message under the splash has to be readable) and a hard cap, so a launch
 * that never finishes cannot hide the page forever.
 *
 * This is the in-page splash. The one the phone draws before the page loads is
 * the manifest's icon on its background color, and is not ours to time.
 */

import { mount, unmount } from 'svelte';
import Wordmark from '../components/Wordmark.svelte';
import { WORDMARKS, wordmarkAt } from './wordmark';

/** The least time the splash stays, from the moment it is drawn. */
export const LAUNCH_SPLASH_MIN_MS = 1000;
/** The most it stays, whatever the app is doing. */
const LAUNCH_SPLASH_MAX_MS = 8000;
const FADE_MS = 250;

export interface LaunchSplash {
  /** Take the splash down once its full second is up. Safe to call twice. */
  dismiss(): void;
}

export function showLaunchSplash(): LaunchSplash {
  const look = WORDMARKS[wordmarkAt()];
  const shownAt = Date.now();

  const cover = document.createElement('div');
  cover.setAttribute('aria-hidden', 'true');
  cover.style.cssText = [
    'position:fixed',
    'inset:0',
    'z-index:20000',
    'display:flex',
    'align-items:center',
    'justify-content:center',
    `background:${look.ground}`,
    // The wordmark's shadows reach about a third of an em past the letters.
    'font-size:min(17vw,96px)',
    `transition:opacity ${FADE_MS}ms ease`,
    'opacity:1',
  ].join(';');
  document.body.appendChild(cover);

  const mark = mount(Wordmark, { target: cover, props: { code: wordmarkAt() } });

  let gone = false;
  function remove(): void {
    if (gone) return;
    gone = true;
    cover.style.opacity = '0';
    setTimeout(() => {
      void unmount(mark);
      cover.remove();
    }, FADE_MS);
  }

  function dismiss(): void {
    const left = LAUNCH_SPLASH_MIN_MS - (Date.now() - shownAt);
    if (left <= 0) remove();
    else setTimeout(remove, left);
  }

  // Never sit on top of an error message, and never stay forever.
  window.addEventListener('error', remove, { once: true });
  window.addEventListener('unhandledrejection', remove, { once: true });
  setTimeout(remove, LAUNCH_SPLASH_MAX_MS);

  return { dismiss };
}
