import { writable } from 'svelte/store';

/**
 * Drives the family tree viewer.
 *
 * Same shape as personModalStore: a plain `{ isOpen, ... }` flag — `isOpen`,
 * not `open`, matching personModalStore.ts and avoiding a name clash with the
 * `open()` method below — with an `open()` that takes the details and an
 * unconditional `close()`. Not persisted, and deliberately so — the reason is
 * the one parallelStore.ts gives at its top: a reload must not reopen a
 * fullscreen overlay the user pressed × on, and doing so here would also
 * fight FamilyTreeViewer's own pushState/popstate handling, which assumes it
 * is the one that put its history entry there.
 */
export interface FamilyTreeState {
  isOpen: boolean;
  /** Whose line to trace and pin on open; null opens the whole tree. */
  focusId: string | null;
  /** The People card's own close, called when the user leaves for a verse
   *  from inside the bio sheet (Phase 2) so that card closes too. */
  onLeave: (() => void) | null;
}

const EMPTY: FamilyTreeState = { isOpen: false, focusId: null, onLeave: null };

function createFamilyTreeStore() {
  const { subscribe, set } = writable<FamilyTreeState>({ ...EMPTY });

  return {
    subscribe,
    open: (opts: { focusId?: string | null; onLeave?: (() => void) | null } = {}) => {
      set({ isOpen: true, focusId: opts.focusId ?? null, onLeave: opts.onLeave ?? null });
    },
    close: () => set({ ...EMPTY }),
  };
}

export const familyTreeStore = createFamilyTreeStore();
