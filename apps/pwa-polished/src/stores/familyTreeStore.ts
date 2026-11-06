import { writable } from 'svelte/store';

/**
 * A bio in the tree's sheet as a crumb saved it: PersonContent's own
 * viewSnapshot, with the offset taken on the sheet, which is what scrolls.
 */
export interface TreeSheetPerson {
  personId: string | null;
  primaryName: string;
  trail: { personId: string; name: string }[];
  scrollTop: number;
  visited: string[];
  showVerses: boolean;
  expandedBooks: string[];
}

/** A tribe's card in the sheet: the open verse lists and the offset. */
export interface TreeSheetTribe {
  expanded: string[];
  scrollTop: number;
}

/**
 * The tree as a link inside it left it, carried on that link's crumb so
 * walking back reopens the tree rather than the People card.
 *
 * Plain data only — the trail is saved to storage, and anything that does not
 * come back from JSON unchanged is dropped from it.
 */
export interface TreeRestore {
  /** Whose line was traced and pulsing; null with nobody picked. */
  pinnedId: string | null;
  /** The tribe lit whole, from a stone. */
  tribe: string | null;
  /**
   * Where the camera was: the tree point at the middle of the screen and the
   * zoom as a multiple of the whole-tree fit, so a different screen size still
   * frames the same place. Null when it was showing the whole tree.
   */
  view: { x: number; y: number; ratio: number } | null;
  /** What the sheet was showing; null with the sheet down. */
  sheet: {
    personId: string | null;
    tribe: string | null;
    /** The tree's own name for them, for the header while the bio loads. */
    label: string;
    person?: TreeSheetPerson;
    tribeCard?: TreeSheetTribe;
  } | null;
}

/**
 * Drives the family tree viewer.
 *
 * Same shape as personModalStore: a plain `{ isOpen, ... }` flag — `isOpen`,
 * not `open`, matching personModalStore.ts and avoiding a name clash with the
 * `open()` method below — with an `open()` that takes the details and an
 * unconditional `close()`. Not persisted, and deliberately so — the reason is
 * the one parallelStore.ts gives at its top: a reload must not reopen a
 * fullscreen overlay the user pressed × on.
 */
export interface FamilyTreeState {
  isOpen: boolean;
  /** Whose line to trace and pin on open; null opens the whole tree. */
  focusId: string | null;
  /** Open lit on one tribe (a tap on a bio's breastplate stone), with that
   *  tribe's card over it. focusId then names whose line from God to frame. */
  tribe: string | null;
  /** The People card's own close, called when the user leaves for a verse
   *  from inside the bio sheet (Phase 2) so that card closes too. */
  onLeave: (() => void) | null;
  /**
   * What the People card under the tree is showing, as a crumb origin, asked
   * for as a link in the tree leaves. The crumb puts that card back under the
   * tree, so closing the tree after coming back lands where it did before.
   * Null when nothing under it closes on the way out (a docked bio).
   */
  under: (() => unknown) | null;
  /** Reopen exactly as a crumb saved it, with no entrance played. */
  restore: TreeRestore | null;
}

const EMPTY: FamilyTreeState = { isOpen: false, focusId: null, tribe: null, onLeave: null, under: null, restore: null };

function createFamilyTreeStore() {
  const { subscribe, set } = writable<FamilyTreeState>({ ...EMPTY });

  return {
    subscribe,
    open: (
      opts: {
        focusId?: string | null;
        tribe?: string | null;
        onLeave?: (() => void) | null;
        under?: (() => unknown) | null;
        restore?: TreeRestore | null;
      } = {},
    ) => {
      set({
        isOpen: true,
        focusId: opts.focusId ?? null,
        tribe: opts.tribe ?? null,
        onLeave: opts.onLeave ?? null,
        under: opts.under ?? null,
        restore: opts.restore ?? null,
      });
    },
    close: () => set({ ...EMPTY }),
  };
}

export const familyTreeStore = createFamilyTreeStore();
