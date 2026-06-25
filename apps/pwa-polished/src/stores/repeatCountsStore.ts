/**
 * repeatCountsStore.ts
 *
 * Holds the occurrence count of each tracked repeat word within the CURRENT
 * book. BibleReader computes this (it knows the current book/translation and
 * has the text store) and publishes here; NavigationBar reads it to render the
 * "(n)" on each pill. Keyed by normalized word.
 */

import { writable } from 'svelte/store';

export const repeatCountsStore = writable<Map<string, number>>(new Map());
