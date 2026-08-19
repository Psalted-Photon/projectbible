/**
 * Lock-screen media controls for Read Aloud.
 *
 * Two reasons this matters, and the second is the important one:
 *
 * 1. The lock screen shows what is being read, with working controls.
 * 2. It tells the operating system this page is a media player rather than an
 *    idle web page. A phone is far less willing to throttle a tab registered as
 *    playing media — which is what makes listening with the phone pocketed
 *    viable at all.
 *
 * Absent on browsers without the API; every call is a no-op there.
 */

import { get } from 'svelte/store';
import {
  readingPosition,
  readingState,
  verseCounter,
  chapterProgress,
  togglePlayPause,
  stopReading,
  skipChapter,
} from './readingEngine';

function available(): boolean {
  return typeof navigator !== 'undefined' && 'mediaSession' in navigator;
}

let handlersBound = false;

function bindHandlers(): void {
  if (handlersBound || !available()) return;
  handlersBound = true;

  const session = navigator.mediaSession;
  const set = (action: MediaSessionAction, handler: (() => void) | null) => {
    try {
      session.setActionHandler(action, handler);
    } catch {
      // Not every action exists on every platform; ignore the rest.
    }
  };

  set('play', () => togglePlayPause());
  set('pause', () => togglePlayPause());
  set('stop', () => stopReading());

  // Chapter skip. These seek inside audio that is already buffered rather than
  // restarting — the restart path reloads from the database and regenerates,
  // which is exactly the work that stalls when the screen is off, and was why
  // "next chapter" used to do nothing until the phone was unlocked.
  set('nexttrack', () => skipChapter(1));
  set('previoustrack', () => skipChapter(-1));
}

/** Title stays at chapter level so it never churns; the verse line carries detail. */
function currentTitle(): string {
  const position = get(readingPosition);
  return position ? `${position.book} ${position.chapter}` : '';
}

function currentSubtitle(): string {
  const counter = get(verseCounter);
  if (!counter || counter.total === 0) return 'Hexapla';
  if (counter.index === 0) return 'Hexapla';
  return `Verse ${counter.index} of ${counter.total}`;
}

let lastTitle = '';
let lastSubtitle = '';

/** Reflect what is being read onto the lock screen. */
export function updateMediaSession(): void {
  if (!available()) return;
  bindHandlers();

  const session = navigator.mediaSession;
  const state = get(readingState);
  const position = get(readingPosition);

  if (state === 'idle' || !position) {
    session.playbackState = 'none';
    session.metadata = null;
    lastTitle = '';
    lastSubtitle = '';
    try {
      session.setPositionState?.();
    } catch {
      // Some platforms object to clearing; harmless.
    }
    return;
  }

  session.playbackState = state === 'playing' ? 'playing' : 'paused';

  // Rebuild metadata only when something visible actually changed. Churning it
  // is itself a cause of the controls flickering.
  const title = currentTitle();
  const subtitle = currentSubtitle();
  if (title !== lastTitle || subtitle !== lastSubtitle) {
    lastTitle = title;
    lastSubtitle = subtitle;
    session.metadata = new MediaMetadata({
      title,
      artist: subtitle,
      album: position.translation.toUpperCase(),
      artwork: [
        { src: '/pwa-192x192.png', sizes: '192x192', type: 'image/png' },
        { src: '/pwa-512x512.png', sizes: '512x512', type: 'image/png' },
      ],
    });
  }

  // Progress across the whole chapter, not the verse. Position is exact; the
  // total is an estimate that sharpens as real audio is measured.
  const progress = get(chapterProgress);
  if (progress && progress.duration > 0) {
    try {
      session.setPositionState({
        duration: progress.duration,
        position: Math.min(progress.position, progress.duration),
        playbackRate: state === 'playing' ? 1 : 0,
      });
    } catch {
      // Thrown if the numbers are ever inconsistent; not worth failing over.
    }
  }
}

/** Start mirroring engine state to the lock screen. Safe to call once at boot. */
export function initMediaSession(): void {
  if (!available()) return;
  readingState.subscribe(() => updateMediaSession());
  readingPosition.subscribe(() => updateMediaSession());
  verseCounter.subscribe(() => updateMediaSession());
  chapterProgress.subscribe(() => updateMediaSession());
}
