import { writable } from 'svelte/store';

export interface AnnotationReturn {
  book: string;
  chapter: number;
  verse: number;
  tab: 'references' | 'commentary';
}

/** Stores the location to return to after a "Go →" navigation from a commentary ref. */
export const annotationReturnStore = writable<AnnotationReturn | null>(null);
