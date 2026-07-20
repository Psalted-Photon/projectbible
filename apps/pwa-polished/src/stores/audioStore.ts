import { writable } from 'svelte/store';

/** Whether the user wants audio to automatically advance to the next chapter. */
export const continuousPlay = writable<boolean>(false);

/** One-shot flag: set by AudioPlayer when a chapter ends in continuous mode.
 *  The next AudioPlayer that mounts will read this, clear it, and auto-play. */
export const autoplayNext = writable<boolean>(false);

/** Same one-shot handoff for the Read Aloud (TTS) player. Kept separate from
 *  autoplayNext because both players mount in the same chapter header and
 *  would otherwise race to consume the flag. */
export const ttsAutoplayNext = writable<boolean>(false);
