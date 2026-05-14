import { writable } from 'svelte/store';

/** Whether the user wants audio to automatically advance to the next chapter. */
export const continuousPlay = writable<boolean>(false);

/** One-shot flag: set by AudioPlayer when a chapter ends in continuous mode.
 *  The next AudioPlayer that mounts will read this, clear it, and auto-play. */
export const autoplayNext = writable<boolean>(false);
