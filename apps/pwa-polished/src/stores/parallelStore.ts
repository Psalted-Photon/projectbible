/**
 * Parallel-accounts view state.
 *
 * A plain writable, deliberately **not persisted**. The window store writes
 * itself to localStorage on every change, and that is right for docked windows,
 * which the user arranged and expects back. A harmony view is the opposite: it
 * is entered from a tile, covers the screen, and is left by pressing ×. Bringing
 * it back on reload would restore four full readers over the top of the app
 * before the user had asked for anything, and the panes it refers to are
 * themselves transient (phase 6), so a restored view would point at windows that
 * no longer exist.
 *
 * Everything in here is view state the engine reads and writes on a scroll tick,
 * so the shape stays flat and the actions stay cheap — no derived stores, no
 * async, nothing that could make a set() during a tween cost more than a copy.
 */

import { writable, get } from 'svelte/store';

/** How the panes are arranged on screen. */
export type ParallelLayout = 'stacked' | 'columns' | 'corners';

/**
 * Why a pane is dimmed. Kept as a tagged reason rather than a prebuilt string so
 * the strip can phrase it ("No parallel in John") and the engine can compare
 * reasons without string matching.
 */
export type DimReason =
  /** The verse the master is on belongs to no parallel group at all. */
  | { kind: 'no-group' }
  /** There is a group, but it has no passage in this pane's book. */
  | { kind: 'no-passage'; book: string }
  /** The target chapter never finished loading in this pane. */
  | { kind: 'not-loaded'; book: string; chapter: number };

export interface ParallelPane {
  /** The windowId the reader is mounted with, and the DOM tag on its wrapper. */
  paneId: string;
  /** Which book this pane is showing the event in. */
  book: string;
  dim: boolean;
  dimReason: DimReason | null;
}

export interface ParallelState {
  active: boolean;
  layout: ParallelLayout;
  /** The paneId driving the others. Always one of `panes`. */
  masterId: string | null;
  /** Off means the followers are ordinary readers — see phase 7. */
  anchorOn: boolean;
  panes: ParallelPane[];
  /** The group the master is currently inside, for the strip. */
  currentGroupId: number | null;
  /**
   * The Robertson section the master is inside, which is a different question
   * from currentGroupId and cannot be derived from it.
   *
   * `bestParallel` prefers a titled section but legitimately returns a BSB
   * marker when no section covers the same ground, and in the Gospels the BSB
   * entries outnumber Robertson's roughly two to one — so the group is often
   * not a section at all. The strip's arrows step along Robertson's sequence
   * and need the section regardless, and the engine is the only place that
   * already has the master's position to work it out from without reading the
   * DOM again.
   */
  currentSectionId: number | null;
  /** What the strip calls this set, e.g. "Gospels". */
  setLabel: string | null;
}

const EMPTY: ParallelState = {
  active: false,
  layout: 'stacked',
  masterId: null,
  anchorOn: true,
  panes: [],
  currentGroupId: null,
  currentSectionId: null,
  setLabel: null,
};

function createParallelStore() {
  const { subscribe, set, update } = writable<ParallelState>({ ...EMPTY });

  return {
    subscribe,

    /**
     * Enter the view. The first pane in the list is the master, which is what
     * the picker builds — the set's own order is meaningful (Matthew, Mark,
     * Luke, John), and the reader at the top of the screen driving the ones
     * below it is what the layout already implies.
     */
    open: (
      panes: Array<{ paneId: string; book: string }>,
      opts: { layout?: ParallelLayout; setLabel?: string } = {},
    ) => {
      set({
        active: true,
        layout: opts.layout ?? 'stacked',
        masterId: panes[0]?.paneId ?? null,
        anchorOn: true,
        panes: panes.map((p) => ({ ...p, dim: false, dimReason: null })),
        currentGroupId: null,
        currentSectionId: null,
        setLabel: opts.setLabel ?? null,
      });
    },

    /** Leave the view. Phase 6 writes the master's position back first. */
    close: () => set({ ...EMPTY }),

    /**
     * Swap which pane drives. The old master keeps its position untouched —
     * nothing is realigned until the new master actually moves, so taking over
     * never yanks the pane you were reading.
     */
    setMaster: (paneId: string) =>
      update((s) => {
        if (!s.panes.some((p) => p.paneId === paneId)) return s;
        return {
          ...s,
          masterId: paneId,
          currentGroupId: null,
          currentSectionId: null,
          // Every dim is cleared, not just the new master's. A dim says "the
          // master is somewhere this pane does not go", and the master has just
          // changed, so every one of those statements is about a question
          // nobody asked any more. The next tick re-dims whatever still
          // deserves it, within one debounce — whereas a stale dim left up
          // would be a pane faded for a reason that no longer exists, which is
          // indistinguishable from a bug. The new master's own dim must go
          // regardless: the engine skips the master, so nothing would ever
          // clear it.
          panes: s.panes.map((p) =>
            p.dim ? { ...p, dim: false, dimReason: null } : p,
          ),
        };
      }),

    setAnchor: (on: boolean) => update((s) => ({ ...s, anchorOn: on })),

    setLayout: (layout: ParallelLayout) => update((s) => ({ ...s, layout })),

    /**
     * Dim or undim one pane.
     *
     * Bails when nothing actually changed. The engine calls this for every pane
     * on every tick, and a writable notifies all subscribers on every set even
     * when the value is identical — with four readers subscribed that is four
     * wasted re-renders per scroll tick, several times a second.
     */
    setDim: (paneId: string, dim: boolean, reason: DimReason | null = null) =>
      update((s) => {
        const pane = s.panes.find((p) => p.paneId === paneId);
        if (!pane) return s;
        if (pane.dim === dim && sameReason(pane.dimReason, reason)) return s;
        return {
          ...s,
          panes: s.panes.map((p) =>
            p.paneId === paneId ? { ...p, dim, dimReason: dim ? reason : null } : p,
          ),
        };
      }),

    /** Which book a pane is showing, after the user navigates it by hand. */
    setPaneBook: (paneId: string, book: string) =>
      update((s) => {
        const pane = s.panes.find((p) => p.paneId === paneId);
        if (!pane || pane.book === book) return s;
        return {
          ...s,
          panes: s.panes.map((p) => (p.paneId === paneId ? { ...p, book } : p)),
        };
      }),

    setCurrentGroup: (id: number | null) =>
      update((s) => (s.currentGroupId === id ? s : { ...s, currentGroupId: id })),

    /** Bails when unchanged, for the same reason setDim does. */
    setCurrentSection: (id: number | null) =>
      update((s) => (s.currentSectionId === id ? s : { ...s, currentSectionId: id })),

    /** Read without subscribing — what the engine does on every tick. */
    snapshot: (): ParallelState => get({ subscribe }),
  };
}

function sameReason(a: DimReason | null, b: DimReason | null): boolean {
  if (a === b) return true;
  if (!a || !b || a.kind !== b.kind) return false;
  if (a.kind === 'no-passage' && b.kind === 'no-passage') return a.book === b.book;
  if (a.kind === 'not-loaded' && b.kind === 'not-loaded') {
    return a.book === b.book && a.chapter === b.chapter;
  }
  return true;
}

export const parallelStore = createParallelStore();
