/**
 * repeatBulkStore.ts
 *
 * Bridge between the navbar repeat pills (NavigationBar) and BibleReader, which
 * owns the HighlightModal. When the user picks "Highlight All" + a scope on a
 * pill, NavigationBar sets a request here; BibleReader reacts by opening the
 * highlight modal in bulk mode and clears the request once handled.
 */

import { writable } from 'svelte/store';

export type RepeatHighlightScope = 'chapter' | 'book';

export interface RepeatHighlightAllRequest {
  /** Normalized matching key. */
  word: string;
  /** Original-casing label (for modal subtitle). */
  label: string;
  scope: RepeatHighlightScope;
  /** Color index of the originating pill (so we can drop the right group after). */
  colorIndex: number;
}

export const repeatHighlightAllRequest = writable<RepeatHighlightAllRequest | null>(null);
