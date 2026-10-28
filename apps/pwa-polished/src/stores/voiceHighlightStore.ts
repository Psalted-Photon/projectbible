/**
 * voiceHighlightStore.ts
 *
 * Bridge between Voice Control (lib/voice/actions.ts) and the main reader,
 * which owns the highlighter. "Highlight verse 16 in yellow" sets a request
 * with a style, and the reader saves it the way the highlighter's own Save
 * does; with no color said, the style is null and the reader opens the
 * highlighter on those verses instead. The reader clears the request once
 * handled.
 */

import { writable } from 'svelte/store';
import type { HighlightStyle } from '@projectbible/core';

export interface VoiceHighlightRequest {
  book: string;
  chapter: number;
  verses: number[];
  style: HighlightStyle | null;
}

export const voiceHighlightRequest = writable<VoiceHighlightRequest | null>(null);
