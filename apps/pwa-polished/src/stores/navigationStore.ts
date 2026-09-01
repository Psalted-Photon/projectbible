import { writable, derived, get } from 'svelte/store';
import { getBookChapters, normalizeBookName } from '../lib/bibleData';

export interface NavigationState {
  translation: string;
  book: string;
  chapter: number;
  isChronologicalMode?: boolean;
  highlightedVerse?: number | null;
  scrollTargetVerse?: number | null;
  /**
   * Where the "start here" highlight belongs after a link navigation, in the
   * book category colour of the target book.
   *
   * This carries its own book and chapter rather than a bare verse number.
   * The reader mounts several chapters at once, so a lone number cannot say
   * which chapter it meant — and it is not consumed on first use, so returning
   * to the chapter shows it again instead of losing it for good. That matches
   * how the reading plan target behaves; the two used to follow opposite rules.
   */
  linkHighlight?: { book: string; chapter: number; verse: number; at: number } | null;
  showReferences?: boolean;
  showCommentaries?: boolean;
  selectedCommentaryAuthors?: string[];
  readingPlanActiveTarget?: { book: string; chapter: number; verse: number | null; consecutiveDay: boolean; at: number } | null;
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
    // Stepping to another book or chapter by hand is a deliberate move away, so
    // the mark from the last link goes with it.
    setBook: (book: string) => {
      update(state => {
        const next = { ...state, book: normalizeBookName(book), chapter: 1, highlightedVerse: null, linkHighlight: null };
        persistState(next);
        return next;
      });
    },
    setChapter: (chapter: number) => {
      update(state => {
        const next = { ...state, chapter, highlightedVerse: null, linkHighlight: null };
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
    /**
     * Go somewhere, and by default mark the verse you land on.
     *
     * `highlight` defaults to true because that is the app-wide rule: any link
     * that takes you to a place in the Bible marks where to start reading, in
     * the target book's category colour. Only callers that paint their own
     * highlight — the reading plan, which keeps its green — pass false.
     */
    navigateTo: (
      translation: string,
      book: string,
      chapter: number,
      scrollTargetVerse: number | null = null,
      highlight = true,
    ) => {
      update(state => {
        const normalized = normalizeBookName(book);
        const next = {
          ...state,
          translation,
          book: normalized,
          chapter,
          highlightedVerse: null,
          scrollTargetVerse,
          linkHighlight:
            highlight && scrollTargetVerse != null
              ? { book: normalized, chapter, verse: scrollTargetVerse, at: Date.now() }
              : null,
        };
        persistState(next);
        return next;
      });
    },
    // Navigate to a specific verse and mark it in the target book's category color.
    navigateToVerse: (
      translation: string,
      book: string,
      chapter: number,
      verse: number,
    ) => {
      update(state => {
        const normalized = normalizeBookName(book);
        const next = {
          ...state,
          translation,
          book: normalized,
          chapter,
          highlightedVerse: null,
          scrollTargetVerse: verse,
          linkHighlight: { book: normalized, chapter, verse, at: Date.now() },
        };
        persistState(next);
        return next;
      });
    },
    clearScrollTarget: () => {
      update(state => ({ ...state, scrollTargetVerse: null }));
    },
    clearLinkHighlight: () => {
      update(state => ({ ...state, linkHighlight: null }));
    },
    /**
     * Mark a verse without scrolling to it — for links that land you at the top
     * of a chapter (the table of contents) where the first verse is already in
     * view and jumping to it would hide the chapter title.
     */
    setLinkHighlight: (book: string, chapter: number, verse: number) => {
      update(state => ({
        ...state,
        linkHighlight: { book: normalizeBookName(book), chapter, verse, at: Date.now() },
      }));
    },
    setReadingPlanActiveTarget: (book: string, chapter: number, verse: number | null, consecutiveDay: boolean) => {
      update(state => ({ ...state, readingPlanActiveTarget: { book: normalizeBookName(book), chapter, verse, consecutiveDay, at: Date.now() } }));
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
    // Lightweight nav update driven by BibleReader scroll — updates book/chapter in
    // the store (so navbar and commentary follow) without setting scrollTargetVerse
    // (which would cause BibleReader to auto-scroll, fighting the user).
    //
    // The check has to happen before `update` runs, not inside it. Returning the
    // same object from `update` does not suppress the notification: Svelte's
    // change test treats any object as changed, identical or not. This fires on
    // a scroll debounce, so left inside it woke every subscriber several times a
    // second the whole time the reader was moving — and wrote the same state
    // back to storage each time — even though nothing had changed.
    setScrollPosition: (book: string, chapter: number) => {
      const current = get({ subscribe });
      if (current.book === book && current.chapter === chapter) return;
      update(state => {
        const next = { ...state, book, chapter };
        persistState(next);
        return next;
      });
    },
    // Returns the new stack depth. Callers that want to come back to something
    // when this exact step is undone (the ISBE modal) keep the depth as a token
    // — comparing book/chapter instead would break as soon as the reader's
    // scroll handler nudges the store to a neighboring chapter.
    pushHistory: (state: NavigationState) => {
      let depth = 0;
      navigationHistory.update((history) => {
        const next = [...history, state];
        depth = next.length;
        return next;
      });
      return depth;
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

/** How many steps are on the back stack — the token pushHistory hands back. */
export const historyDepth = derived(navigationHistory, (history) => history.length);

// Derived store for getting current chapter count
export const currentBookChapters = derived(
  navigationStore,
  $nav => getBookChapters($nav.book)
);
