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
 *
 * The Android app's web view has no working Media Session and would be put to
 * sleep with the screen off, so there the same facts go to Android's own media
 * controls instead (lib/android/media.ts, ReadAloudService.java), which also
 * keep the app awake while a chapter is read.
 */

import { get } from 'svelte/store';
import {
  readingPosition,
  readingState,
  readingSource,
  verseCounter,
  chapterProgress,
  togglePlayPause,
  pauseReading,
  resumeReading,
  stopReading,
  skipChapter,
  skipParagraph,
} from './readingEngine';
import { getSharedTtsAudio } from '../../adapters/tts';
import { IS_ANDROID_APP } from '../platform';
import { appNowPlaying, onAppMediaAction, type AppMediaAction } from '../android/media';

function available(): boolean {
  if (IS_ANDROID_APP) return true;
  return typeof navigator !== 'undefined' && 'mediaSession' in navigator;
}

let handlersBound = false;

function bindHandlers(): void {
  if (handlersBound || !available()) return;
  handlersBound = true;

  if (IS_ANDROID_APP) {
    onAppMediaAction(onAppAction);
    return;
  }

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
  // Plain text has no chapters to skip, so the same buttons move a paragraph.
  set('nexttrack', () => (isText() ? skipParagraph(1) : skipChapter(1)));
  set('previoustrack', () => (isText() ? skipParagraph(-1) : skipChapter(-1)));
}

function isText(): boolean {
  return get(readingSource).kind === 'text';
}

/**
 * The app's controls. Play and pause each say which one they mean, unlike a
 * toggle, so a headphone unplug can never start a paused chapter.
 */
function onAppAction(action: AppMediaAction): void {
  if (action === 'play') resumeReading();
  else if (action === 'pause') pauseReading();
  else if (action === 'stop') stopReading();
  else {
    const step = action === 'next' ? 1 : -1;
    if (isText()) skipParagraph(step);
    else skipChapter(step);
  }
}

/** Title stays at chapter level so it never churns; the verse line carries detail. */
function currentTitle(): string {
  const source = get(readingSource);
  if (source.kind === 'text') return source.title;
  const position = get(readingPosition);
  return position ? `${position.book} ${position.chapter}` : '';
}

function currentSubtitle(): string {
  if (isText()) return 'irisBible';
  const counter = get(verseCounter);
  if (!counter || counter.total === 0) return 'irisBible';
  if (counter.index === 0) return 'irisBible';
  return `Verse ${counter.index} of ${counter.total}`;
}

let lastTitle = '';
let lastSubtitle = '';

/** Reflect what is being read onto the lock screen. */
export function updateMediaSession(): void {
  if (!available()) return;
  bindHandlers();

  if (IS_ANDROID_APP) {
    updateAppPlayer();
    return;
  }

  const session = navigator.mediaSession;
  const state = get(readingState);
  const position = get(readingPosition);
  // Plain text never has a Bible position; it is live whenever the engine is.
  const text = isText();

  if (state === 'idle' || (!position && !text)) {
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
      album: position ? position.translation.toUpperCase() : '',
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

/**
 * The app's half of the above: the same title, line and progress, for
 * Android's player. Starting counts as busy (speech is being made), so the
 * app is kept awake from the moment play is pressed.
 */
function updateAppPlayer(): void {
  const state = get(readingState);
  const position = get(readingPosition);
  if (state === 'idle' || (!position && !isText())) {
    appNowPlaying({ state: 'none' });
    return;
  }
  const progress = get(chapterProgress);
  appNowPlaying({
    state: state === 'playing' ? 'playing' : state === 'starting' ? 'buffering' : 'paused',
    title: currentTitle(),
    subtitle: currentSubtitle(),
    album: position ? position.translation.toUpperCase() : '',
    duration: progress?.duration ?? 0,
    position: progress ? Math.min(progress.position, progress.duration) : 0,
    // The chapter clock runs in audio time, so it moves at the Read Aloud speed.
    speed: getSharedTtsAudio().playbackRate || 1,
  });
}

/** Start mirroring engine state to the lock screen. Safe to call once at boot. */
export function initMediaSession(): void {
  if (!available()) return;
  readingState.subscribe(() => updateMediaSession());
  readingPosition.subscribe(() => updateMediaSession());
  readingSource.subscribe(() => updateMediaSession());
  verseCounter.subscribe(() => updateMediaSession());
  chapterProgress.subscribe(() => updateMediaSession());
}
