import { writable, get } from 'svelte/store';

export type WindowContentType = 'selector' | 'bible' | 'map' | 'notes' | 'wordstudy' | 'commentaries';
export type WindowEdge = 'top' | 'left' | 'right' | 'bottom';

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
    // For Commentary windows
    author?: string;
    // For Map windows
    center?: [number, number];
    zoom?: number;
    // For other content types
    [key: string]: any;
  };
}

const MAX_WINDOWS = 6;
const STORAGE_KEY = 'projectbible-windows';

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
