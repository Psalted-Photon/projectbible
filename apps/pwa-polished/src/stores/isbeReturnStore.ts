import { writable } from 'svelte/store';
import type { IsbeModalState } from './isbeModalStore';

export interface IsbeReturn {
  /** What to reopen — the same payload isbeModalStore.open() takes. */
  modal: Omit<IsbeModalState, 'isOpen'>;
  /** Books left expanded in the Verses tab, so you land back where you were reading. */
  expandedBooks: string[];
  /** The verse we jumped to. The back arrow only restores the modal if the
   *  reader is still sitting here; otherwise the user navigated on and the
   *  context is stale. */
  at: { book: string; chapter: number; verse: number };
}

/** Set when a verse is tapped in the ISBE modal, consumed by the nav back arrow. */
export const isbeReturnStore = writable<IsbeReturn | null>(null);
