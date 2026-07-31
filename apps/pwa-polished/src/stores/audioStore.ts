import { writable } from 'svelte/store';

/** Whether the user wants audio to automatically advance to the next chapter. */
export const continuousPlay = writable<boolean>(false);

/** One-shot flag: set by AudioPlayer when a chapter ends in continuous mode.
 *  The next AudioPlayer that mounts will read this, clear it, and auto-play. */
export const autoplayNext = writable<boolean>(false);

/* Read Aloud has no equivalent one-shot flag. It used to, and that was the bug:
 * an anonymous "play the next one" note could only be read by a brand-new
 * player, so with continuous scrolling — where the next chapter is usually
 * already drawn — nobody ever read it and playback stopped. Read Aloud is now
 * driven by lib/tts/readingEngine, which owns the position outright. */

/** The verse Read Aloud is currently speaking, or null when not reading.
 *  Drives the verse highlight and the drifting glow. Playback progress is
 *  read straight off the shared audio element, so pause/seek/speed need no
 *  extra bookkeeping here. */
export const ttsCurrentVerse = writable<{
  book: string;
  chapter: number;
  verse: number;
} | null>(null);
