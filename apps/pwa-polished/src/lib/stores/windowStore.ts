import { writable, get } from 'svelte/store';
import { libraryPrefsStore, type LibrarySource } from '../../stores/libraryPrefsStore';

export type WindowContentType = 'selector' | 'bible' | 'map' | 'notes' | 'wordstudy' | 'commentaries' | 'journal' | 'art' | 'isbe' | 'person' | 'naves';
export type WindowEdge = 'top' | 'left' | 'right' | 'bottom';

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
        set(parsed);
      } catch (e) {
        console.error('Failed to load windows from localStorage:', e);
      }
    }
  }

  // Save to localStorage whenever state changes
  function persist(windows: WindowState[]) {
    if (typeof window !== 'undefined') {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(windows));
    }
  }

  return {
    subscribe,
    
    createWindow: (fromEdge: WindowEdge, sizePercent?: number): string | null => {
      const windows = get({ subscribe });
      
      if (windows.length >= MAX_WINDOWS) {
        console.warn('⚠️ Cannot create window: at limit (6)');
        return null; // At limit
      }

      const windowNumber = windows.length + 1;
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
