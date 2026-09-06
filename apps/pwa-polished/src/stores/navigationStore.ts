import { writable, derived, get } from 'svelte/store';
import { getBookChapters, normalizeBookName, DEFAULT_TRANSLATION } from '../lib/bibleData';

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
}

// Available translations. Seeded with the one the app ships with, and replaced
// by the real list once BibleReader has asked the database what is installed.
// It used to seed WEB and KJV, neither of which a new device had — which is why
// the picker listed two translations that were not there.
export const availableTranslations = writable<string[]>([DEFAULT_TRANSLATION]);

const NAV_STORAGE_KEY = 'projectbible_nav';

// Default used only on first ever launch per device
const initialState: NavigationState = {
  translation: DEFAULT_TRANSLATION,
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
    const { translation, book, chapter, isChronologicalMode, showReferences, showCommentaries, selectedCommentaryAuthors } = state;
    localStorage.setItem(NAV_STORAGE_KEY, JSON.stringify({ translation, book, chapter, isChronologicalMode, showReferences, showCommentaries, selectedCommentaryAuthors }));
  } catch {
    // ignore quota/private-browsing errors
  }
}

/**
 * What kind of place you were in when you followed a link. Drives the crumb's
 * icon, and later which surface knows how to put itself back.
 */
export type CrumbKind =
  | 'commentary'
  | 'crossref'
  | 'search'
  | 'library'
  | 'notes'
  | 'history'
  | 'plan'
  | 'link';

/**
 * One step on the way out from home.
 *
 * `nav` is the reader state to restore. `origin` is an opaque snapshot the
 * surface that owned the link hands over — what card was open, what was
 * expanded, where it was scrolled — so tapping the crumb can put it back. It is
 * deliberately untyped here: the store should not need to know what an ISBE
 * article or a search result tree looks like.
 */
export interface TrailCrumb {
  nav: NavigationState;
  kind: CrumbKind;
  /** Where the reader was standing, for the crumb's label. */
  book: string;
  chapter: number;
  verse: number | null;
  origin?: unknown;
}

const navigationHistory = writable<TrailCrumb[]>([]);

/**
 * The origin snapshot from the step just walked back to, waiting for whichever
 * surface recognises it to put itself back.
 *
 * This is how a crumb reopens the panel you left from without the navigation
 * store needing to know what a commentary panel or a search tree is. Whoever
 * handles it clears it. It replaces a set of one-off return stores that each
 * knew about exactly one surface and could not be chained.
 */
export const pendingRestore = writable<unknown | null>(null);

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
    /**
     * Record where you are before a link takes you somewhere else.
     *
     * Returns the new stack depth. Callers that want to come back to something
     * when this exact step is undone keep the depth as a token — comparing
     * book/chapter instead would break as soon as the reader's scroll handler
     * nudges the store to a neighboring chapter.
     */
    pushHistory: (state: NavigationState, kind: CrumbKind = 'link', origin?: unknown) => {
      let depth = 0;
      navigationHistory.update((history) => {
        const crumb: TrailCrumb = {
          nav: state,
          kind,
          book: state.book,
          chapter: state.chapter,
          verse: state.linkHighlight?.verse ?? state.scrollTargetVerse ?? null,
          origin,
        };
        const next = [...history, crumb];
        depth = next.length;
        return next;
      });
      return depth;
    },
    /** Attach an origin snapshot to the step just pushed. */
    attachOrigin: (depth: number, origin: unknown) => {
      navigationHistory.update((history) => {
        if (depth < 1 || depth > history.length) return history;
        const next = [...history];
        next[depth - 1] = { ...next[depth - 1], origin };
        return next;
      });
    },
    goBack: () => {
      let previous: TrailCrumb | undefined;
      navigationHistory.update((history) => {
        previous = history[history.length - 1];
        return history.slice(0, -1);
      });
      if (previous) {
        persistState(previous.nav);
        set(previous.nav);
        pendingRestore.set(previous.origin ?? null);
      }
      return previous ?? null;
    },
    /**
     * Walk back to a specific step and drop everything after it — what tapping
     * a breadcrumb does. `depth` is 1-based, matching what pushHistory returns,
     * so depth 1 is the first hop away from home.
     */
    goToDepth: (depth: number) => {
      let target: TrailCrumb | undefined;
      navigationHistory.update((history) => {
        if (depth < 1 || depth > history.length) return history;
        target = history[depth - 1];
        return history.slice(0, depth - 1);
      });
      if (target) {
        persistState(target.nav);
        set(target.nav);
        pendingRestore.set(target.origin ?? null);
      }
      return target ?? null;
    },
    clearHistory: () => {
      navigationHistory.set([]);
    },
    reset: () => {
      persistState(initialState);
      set(initialState);
    }
  };
}

export const navigationStore = createNavigationStore();

export const canGoBack = derived(navigationHistory, (history) => history.length > 0);

/**
 * The trail of steps between home and here, oldest first — what the navbar
 * breadcrumbs render. Empty means you are home.
 */
export const navTrail = derived(navigationHistory, (history) => history);

/** How many steps are on the back stack — the token pushHistory hands back. */
export const historyDepth = derived(navigationHistory, (history) => history.length);

// Derived store for getting current chapter count
export const currentBookChapters = derived(
  navigationStore,
  $nav => getBookChapters($nav.book)
);
