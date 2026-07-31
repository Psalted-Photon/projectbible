/**
 * Lock-screen media controls for Read Aloud.
 *
 * Two reasons this matters, and the second is the important one:
 *
 * 1. The lock screen shows what is being read, with working play/pause.
 * 2. It tells the operating system this page is a media player rather than an
 *    idle web page. A phone is far less willing to throttle or discard a tab
 *    that is registered as playing media — which is what makes listening with
 *    the phone in a pocket viable at all.
 *
 * Absent on browsers without the API; every call is a no-op there.
 */

import { get } from 'svelte/store';
import {
  readingPosition,
  readingState,
  togglePlayPause,
  stopReading,
  startReading,
} from './readingEngine';
import { nextChapterOf } from '../bibleData';

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
      // Not every action is supported on every platform; ignore the rest.
    }
  };

  set('play', () => togglePlayPause());
  set('pause', () => togglePlayPause());
  set('stop', () => stopReading());

  // Track skip = chapter skip. Reading a book, the chapter is the track.
  set('nexttrack', () => {
    const position = get(readingPosition);
    if (!position) return;
    const next = nextChapterOf(position.book, position.chapter);
    if (next) void startReading(position.translation, next.book, next.chapter);
  });
  set('previoustrack', () => {
    const position = get(readingPosition);
    if (!position) return;
    // Restart the current chapter rather than reversing through the whole
    // Bible — the same behaviour as a music player's back button.
    void startReading(position.translation, position.book, position.chapter);
  });
}

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
    return;
  }

  session.playbackState = state === 'playing' ? 'playing' : 'paused';

  const title = `${position.book} ${position.chapter}`;
  // Rebuilding metadata on every verse makes some platforms flicker, so only
  // touch it when the chapter actually changes.
  if (session.metadata?.title !== title) {
    session.metadata = new MediaMetadata({
      title,
      artist: 'ProjectBible',
      album: position.translation.toUpperCase(),
      artwork: [
        { src: '/pwa-192x192.png', sizes: '192x192', type: 'image/png' },
        { src: '/pwa-512x512.png', sizes: '512x512', type: 'image/png' },
      ],
    });
  }
}

/** Start mirroring engine state to the lock screen. Safe to call once at boot. */
export function initMediaSession(): void {
  if (!available()) return;
  readingState.subscribe(() => updateMediaSession());
  readingPosition.subscribe(() => updateMediaSession());
}
