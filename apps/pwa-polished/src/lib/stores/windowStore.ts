import { writable, get } from 'svelte/store';
import { libraryPrefsStore, type LibrarySource } from '../../stores/libraryPrefsStore';

export type WindowContentType = 'selector' | 'bible' | 'map' | 'notes' | 'wordstudy' | 'commentaries' | 'journal' | 'art' | 'isbe' | 'person' | 'naves';
/**
 * Which edge a window is docked to — plus `harmony`, which is not an edge at
 * all.
 *
 * A harmony pane is one of the readers inside the parallel-accounts view. It is
 * registered here so that everything the reader already keys off `windowId` —
 * its content state, its chapter, its translation chip — works with no change
 * at all. But it is not docked to anything, and the two places that draw docked
 * windows both filter by the four real edges (`App.svelte`'s inset maths and
 * `WindowContainer.svelte`'s four containers), so a harmony pane is invisible to
 * both: never rendered as a panel, never counted in the reader's insets.
 */
export type WindowEdge = 'top' | 'left' | 'right' | 'bottom' | 'harmony';

/** The edges that are real docking positions, for the code that draws them. */
export const DOCK_EDGES = ['top', 'left', 'right', 'bottom'] as const;

/**
 * An edge a window can actually be dragged out from and docked to.
 *
 * Distinct from WindowEdge, which also covers `harmony`. Code about the edge
 * gesture, the four panel containers or a panel's drag direction wants this
 * one — a harmony pane has no edge to be dragged from, so widening those to
 * WindowEdge would only mean handling a case that cannot arise.
 */
export type DockEdge = (typeof DOCK_EDGES)[number];

/** One pin handed to the map window. */
export interface MapMarker {
  name: string;
  latitude: number;
  longitude: number;
  modernName?: string | null;
  placeType?: string | null;
}

/**
 * A place (or a person's places) handed from the reader to the map window.
 *
 * `seq` is what makes a repeat handoff work: there is only ever one map window,
 * so sending it somewhere it has already been — or somewhere new while it is
 * already open — has to be distinguishable from the store writing back a pan.
 */
export interface MapTarget {
  seq: number;
  label: string;
  markers: MapMarker[];
}

export interface WindowState {
  id: string;
  contentType: WindowContentType;
  edge: WindowEdge; // which edge it's docked to
  size: number; // percentage of screen (0-100)
  isResizing: boolean;
  /**
   * Never written to localStorage. Set on harmony panes, which belong to a view
   * that is itself not restored: without this a reload brings back four windows
   * on an edge nothing renders and nothing can close, since the × that would
   * have closed them is drawn by the view that is no longer there. That is the
   * one way this feature could leave the app properly stuck, so the flag is on
   * the window rather than inferred from the edge — a window is transient
   * because it was created transient, not because of where it happens to sit.
   */
  transient?: boolean;
  contentState?: {
    // For Bible windows
    translation?: string;
    book?: string;
    chapter?: number;
    highlightedVerse?: number;
    showReferences?: boolean;
    selectedCommentaryAuthors?: string[];
    // For Commentary windows
    author?: string;
    /**
     * Follow the main reader instead of holding a position of its own. Only the
     * oldest open commentary window carries the toggle — see the "torch" in
     * CommentaryNavigationBar — and anchoring works by clearing this window's
     * own book/chapter so the bar's `?? $navigationStore` fallback takes over.
     */
    anchored?: boolean;
    // For Map windows
    center?: [number, number];
    zoom?: number;
    /** Where the reader last sent this map. See MapTarget. */
    target?: MapTarget;
    // For encyclopedia windows: which article, and where the reader was in it.
    // Persisted with the rest, so a pinned article survives a reload intact.
    kind?: 'place' | 'entry';
    entryId?: number | null;
    placeId?: string | null;
    primaryName?: string;
    tab?: string | null;
    expanded?: Record<string, boolean>;
    expandedBooks?: string[];
    visited?: string[];
    scrollTop?: number;
    /** Pages walked through to get here, for the back trail. One shape per
     *  work: articles carry entry/place ids, topics a topicId, bios a personId. */
    trail?: Array<
      | { entryId: number | null; placeId: string | null; name: string }
      | { topicId: number; name: string }
      | { personId: string; name: string }
    >;
    /** For person windows: whose bio is pinned. */
    personId?: string | null;
    /** For topical windows: which Nave's topic is pinned. */
    topicId?: number | null;
    // For other content types
    [key: string]: any;
  };
}

const MAX_WINDOWS = 6;
const STORAGE_KEY = 'projectbible-windows';

/** The three window types that are reference works, and which shelf each is. */
const LIBRARY_SOURCE_OF: Partial<Record<WindowContentType, LibrarySource>> = {
  isbe: 'isbe',
  naves: 'naves',
  person: 'people',
};

function createWindowStore() {
  const { subscribe, set, update } = writable<WindowState[]>([]);

  // Load from localStorage on init
  if (typeof window !== 'undefined') {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      try {
        const parsed = JSON.parse(stored);
        // Nothing can be mid-drag at page load, but the flag is saved with the
        // rest — so a reload during a resize brought it back stuck on. It only
        // tinted the grip blue until the map started using it to decide when to
        // hold still, at which point a stale one meant a map that never fitted
        // itself to its window again.
        set(parsed.map((w: WindowState) => ({ ...w, isResizing: false })));
      } catch (e) {
        console.error('Failed to load windows from localStorage:', e);
      }
    }
  }

  // Save to localStorage whenever state changes
  function persist(windows: WindowState[]) {
    if (typeof window !== 'undefined') {
      // Transient windows are dropped on the way out rather than filtered on the
      // way back in, so an older build's storage cannot resurrect them either.
      const keep = windows.filter((w) => !w.transient);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(keep));
    }
  }

  return {
    subscribe,
    
    createWindow: (fromEdge: WindowEdge, sizePercent?: number): string | null => {
      const windows = get({ subscribe });
      // Harmony panes do not count against the six. They are not docked windows
      // and the user did not open them one at a time — a harmony view up would
      // otherwise eat four of the budget and refuse the next real panel.
      const docked = windows.filter(w => !w.transient);

      if (docked.length >= MAX_WINDOWS) {
        console.warn('⚠️ Cannot create window: at limit (6)');
        return null; // At limit
      }

      const windowNumber = docked.length + 1;
      const id = `window-${windowNumber}-${Date.now()}`;

      // Use provided size or default to 50%
      const size = sizePercent ?? 50;

      const newWindow: WindowState = {
        id,
        contentType: 'selector',
        edge: fromEdge,
        size,
        isResizing: false,
        contentState: {},
      };

      console.log(`📌 WINDOW ${windowNumber} CREATED:`, {
        id,
        edge: fromEdge,
        size: `${size.toFixed(1)}%`,
        totalWindows: windowNumber
      });

      update(wins => {
        const updated = [...wins, newWindow];
        persist(updated);
        return updated;
      });

      return id;
    },

    /**
     * Create the readers for a harmony view, all at once.
     *
     * Separate from `createWindow` for three reasons, each of which would be a
     * bug if this went through it. That one takes a real edge and defaults to
     * 50% of the screen, neither of which means anything here — the view's grid
     * sizes the panes. It returns null at MAX_WINDOWS, and a harmony view must
     * not be refused because the user happens to have six panels open, nor eat
     * that budget while it is up. And it creates one window per call, which for
     * four panes would persist four times and, worse, hand back ids derived from
     * a length that changes under it.
     *
     * Made in one update so the readers mount together, which is what lets the
     * shared loads from phase 1 collapse: four panes asking for the translation
     * list in the same tick await one promise rather than four.
     */
    createHarmonyPanes: (specs: Array<{ book: string; chapter: number; translation?: string }>): string[] => {
      const stamp = Date.now();
      const made: WindowState[] = specs.map((spec, i) => ({
        // The index rather than the store's length: these ids have to be unique
        // among themselves, and four windows created in the same millisecond off
        // a length that has not been written yet would all be `window-N-<stamp>`.
        id: `harmony-${i + 1}-${stamp}`,
        contentType: 'bible',
        edge: 'harmony',
        size: 100,
        isResizing: false,
        transient: true,
        contentState: {
          book: spec.book,
          chapter: spec.chapter,
          ...(spec.translation ? { translation: spec.translation } : {}),
        },
      }));

      update(wins => {
        const updated = [...wins, ...made];
        persist(updated);
        return updated;
      });

      return made.map(w => w.id);
    },

    /**
     * Take down every harmony pane.
     *
     * Closes by edge rather than by a list of ids the caller kept, so it is also
     * the way out of a state where the view lost track of its own panes — a
     * failed mount, a reload mid-open. Nothing else is ever on this edge.
     */
    closeHarmonyPanes: () => {
      update(wins => {
        const updated = wins.filter(w => w.edge !== 'harmony');
        persist(updated);
        return updated;
      });
    },

    closeWindow: (id: string) => {
      const windows = get({ subscribe });
      const closing = windows.find(w => w.id === id);

      if (closing) {
        const windowNumber = id.split('-')[1];
        console.log(`🗑️ WINDOW ${windowNumber} CLOSED:`, {
          id,
          edge: closing.edge,
          size: `${closing.size.toFixed(1)}%`,
          contentType: closing.contentType
        });

        // Start the library resume countdown here rather than on open: what
        // matters is how long ago you left. Both ways out — the × and dragging
        // the panel into the close zone — arrive at this one function.
        const source = LIBRARY_SOURCE_OF[closing.contentType];
        if (source) libraryPrefsStore.markClosed(source);
      }

      update(wins => {
        const updated = wins.filter(w => w.id !== id);
        persist(updated);
        return updated;
      });
    },

    setWindowContent: (id: string, contentType: WindowContentType, contentState?: any) => {
      update(wins => {
        const updated = wins.map(w => 
          w.id === id 
            ? { ...w, contentType, contentState: { ...w.contentState, ...contentState } }
            : w
        );
        persist(updated);
        return updated;
      });
    },

    // Move a window to another edge, keeping its content and size. `size` is a
    // percentage of viewport width on left/right but of height on top/bottom, so
    // a half-width side panel becomes a half-height one — the same number means
    // "half the screen" either way, which is what the resize handle already does.
    setWindowEdge: (id: string, edge: WindowEdge) => {
      const windowNumber = id.split('-')[1];
      console.log(`🧭 WINDOW ${windowNumber} MOVED:`, { id, edge });

      update(wins => {
        const updated = wins.map(w =>
          w.id === id
            ? { ...w, edge }
            : w
        );
        persist(updated);
        return updated;
      });
    },

    updateWindowSize: (id: string, sizePercent: number) => {
      const clamped = Math.max(10, Math.min(90, sizePercent));
      const windowNumber = id.split('-')[1];
      
      console.log(`📏 WINDOW ${windowNumber} RESIZED:`, {
        id,
        requestedSize: `${sizePercent.toFixed(1)}%`,
        clampedSize: `${clamped.toFixed(1)}%`
      });

      update(wins => {
        const updated = wins.map(w =>
          w.id === id
            ? { ...w, size: clamped }
            : w
        );
        persist(updated);
        return updated;
      });
    },

    setResizing: (id: string, isResizing: boolean) => {
      update(wins => {
        const updated = wins.map(w =>
          w.id === id
            ? { ...w, isResizing }
            : w
        );
        persist(updated);
        return updated;
      });
    },

    updateContentState: (id: string, contentState: any) => {
      update(wins => {
        const updated = wins.map(w =>
          w.id === id
            ? { ...w, contentState: { ...w.contentState, ...contentState } }
            : w
        );
        persist(updated);
        return updated;
      });
    },

    getWindowsByEdge: (edge: WindowEdge): WindowState[] => {
      return get({ subscribe }).filter(w => w.edge === edge);
    },

    clearAll: () => {
      set([]);
      persist([]);
    },
  };
}

export const windowStore = createWindowStore();
