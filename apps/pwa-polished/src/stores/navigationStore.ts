import { writable, derived } from 'svelte/store';
import { getBookChapters } from '../lib/bibleData';

export interface NavigationState {
  translation: string;
  book: string;
  chapter: number;
  isChronologicalMode?: boolean;
  highlightedVerse?: number | null;
  scrollTargetVerse?: number | null;
  showReferences?: boolean;
  showCommentaries?: boolean;
  selectedCommentaryAuthors?: string[];
  readingPlanActiveTarget?: { book: string; chapter: number; verse: number | null; consecutiveDay: boolean } | null;
  commentaryAnchored?: boolean;
}

// Available translations (will be populated from packs later)
export const availableTranslations = writable<string[]>(['WEB', 'KJV']);

const NAV_STORAGE_KEY = 'projectbible_nav';

// Default used only on first ever launch per device
const initialState: NavigationState = {
  translation: 'WEB',
  book: 'John',
  chapter: 1,
  highlightedVerse: null,
  showReferences: false,
  showCommentaries: false,
  selectedCommentaryAuthors: [],
};

function loadPersistedState(): NavigationState {
  try {
    const raw = localStorage.getItem(NAV_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return { ...initialState, ...parsed, highlightedVerse: null };
    }
  } catch {
    // ignore parse errors; fall through to default
  }
  return initialState;
}

function persistState(state: NavigationState): void {
  try {
    const { translation, book, chapter, isChronologicalMode, showReferences, showCommentaries, selectedCommentaryAuthors, commentaryAnchored } = state;
    localStorage.setItem(NAV_STORAGE_KEY, JSON.stringify({ translation, book, chapter, isChronologicalMode, showReferences, showCommentaries, selectedCommentaryAuthors, commentaryAnchored }));
  } catch {
    // ignore quota/private-browsing errors
  }
}

const navigationHistory = writable<NavigationState[]>([]);

function createNavigationStore() {
  const { subscribe, set, update } = writable<NavigationState>(loadPersistedState());

  return {
    subscribe,
    setTranslation: (translation: string) => {
      update(state => {
        const next = { ...state, translation, highlightedVerse: null };
        persistState(next);
        return next;
      });
    },
    setBook: (book: string) => {
      update(state => {
        const next = { ...state, book, chapter: 1, highlightedVerse: null };
        persistState(next);
        return next;
      });
    },
    setChapter: (chapter: number) => {
      update(state => {
        const next = { ...state, chapter, highlightedVerse: null };
        persistState(next);
        return next;
      });
    },
    setChronologicalMode: (isChronologicalMode: boolean) => {
      update(state => {
        const next = { ...state, isChronologicalMode };
        persistState(next);
        return next;
      });
    },
    setShowReferences: (showReferences: boolean) => {
      update(state => {
        const next = { ...state, showReferences };
        persistState(next);
        return next;
      });
    },
    setShowCommentaries: (showCommentaries: boolean) => {
      update(state => {
        const next = { ...state, showCommentaries };
        persistState(next);
        return next;
      });
    },
    setSelectedCommentaryAuthors: (selectedCommentaryAuthors: string[]) => {
      update(state => {
        const next = { ...state, selectedCommentaryAuthors, showCommentaries: selectedCommentaryAuthors.length > 0 };
        persistState(next);
        return next;
      });
    },
    navigateTo: (
      translation: string,
      book: string,
      chapter: number,
      scrollTargetVerse: number | null = null,
    ) => {
      update(state => {
        const next = { ...state, translation, book, chapter, highlightedVerse: null, scrollTargetVerse };
        persistState(next);
        return next;
      });
    },
    clearScrollTarget: () => {
      update(state => ({ ...state, scrollTargetVerse: null }));
    },
    setReadingPlanActiveTarget: (book: string, chapter: number, verse: number | null, consecutiveDay: boolean) => {
      update(state => ({ ...state, readingPlanActiveTarget: { book, chapter, verse, consecutiveDay } }));
    },
    clearReadingPlanActiveTarget: () => {
      update(state => ({ ...state, readingPlanActiveTarget: null }));
    },
    setCommentaryAnchored: (commentaryAnchored: boolean) => {
      update(state => {
        const next = { ...state, commentaryAnchored };
        persistState(next);
        return next;
      });
    },
    pushHistory: (state: NavigationState) => {
      navigationHistory.update((history) => [...history, state]);
    },
    goBack: () => {
      let previous: NavigationState | undefined;
      navigationHistory.update((history) => {
        previous = history[history.length - 1];
        return history.slice(0, -1);
      });
      if (previous) {
        persistState(previous);
        set(previous);
      }
    },
    reset: () => {
      persistState(initialState);
      set(initialState);
    }
  };
}

export const navigationStore = createNavigationStore();

export const canGoBack = derived(navigationHistory, (history) => history.length > 0);

// Derived store for getting current chapter count
export const currentBookChapters = derived(
  navigationStore,
  $nav => getBookChapters($nav.book)
);
