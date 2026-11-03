import { writable } from 'svelte/store';

/** The By Heart lab is up. On its own so the app needn't load the lab to know. */
export const byHeartLabOpen = writable(false);
