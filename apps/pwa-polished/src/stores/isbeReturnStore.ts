import { writable } from 'svelte/store';
import type { IsbeModalState } from './isbeModalStore';

export interface IsbeReturn {
  /** What to reopen — the same payload isbeModalStore.open() takes. */
  modal: Omit<IsbeModalState, 'isOpen'>;
  /** Books left expanded in the Verses tab, so you land back where you were reading. */
  expandedBooks: string[];
  /** Article sections left open, keyed the way IsbeModal keys them ("0", "0.2"). */
  expandedSections: Record<string, boolean>;
  /** Refs already tapped, so they stay dimmed across the round trip. */
  visited: string[];
  /** Scroll offset of the modal body, restored once the content is back. */
  scrollTop: number;
  /** Back-stack depth at the moment of the jump. The back arrow only restores
   *  the modal when it is undoing this exact step; if the user navigated on,
   *  the context is stale and reopening would be a surprise. */
  depth: number;
}

/** Set when a verse is tapped in the ISBE modal, consumed by the nav back arrow. */
export const isbeReturnStore = writable<IsbeReturn | null>(null);
