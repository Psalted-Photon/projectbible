import { writable } from 'svelte/store';

/**
 * Increments whenever remote reading_progress data is applied from Supabase
 * (either via initial pull or Realtime event). ReadingPlanModal subscribes
 * to this so it reloads progress immediately without requiring a second click
 * or a full page refresh.
 */
export const readingProgressVersion = writable(0);

export function bumpReadingProgressVersion(): void {
  readingProgressVersion.update(v => v + 1);
}
