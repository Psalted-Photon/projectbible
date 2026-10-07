import { writable, derived, get } from 'svelte/store';
import { getBookChapters, normalizeBookName, DEFAULT_TRANSLATION } from '../lib/bibleData';
import { translationForJump } from '../lib/testamentDefaults';
import { getDeviceOwner } from '../lib/sync/deviceOwner';

export interface NavigationState {
  translation: string;
  book: string;
  chapter: number;
  isChronologicalMode?: boolean;
  highlightedVerse?: number | null;
  scrollTargetVerse?: number | null;
  /**
   * Where the "start here" highlight belongs after a link navigation, in the
   * book category color of the target book.
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
  | 'map'
  | 'timeline'
  | 'art'
  /**
   * A tap through an Old Testament quotation mark. The only kind that routinely
   * lands in a different translation from the one it left — it goes to the
   * Septuagint, because that is the wording the card showed.
   */
  | 'otquote'
  /** A reference tapped in a devotional reading; the crumb reopens the reading where you were. */
  | 'devotional'
  | 'link'
  /**
   * A spot you left by the trail rather than by a link, where nothing recorded
   * a panel to bring back. Drawn without an icon.
   */
  | 'plain';

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

/**
 * The trail, kept the way a browser keeps Back and Forward: tapping a crumb
 * walks to it without throwing away the ones after it.
 */
interface Trail {
  /** The crumbs behind you, oldest first. back[0] is home. */
  back: TrailCrumb[];
  /** The crumbs ahead of you, nearest first — the order they sit in on the bar. */
  ahead: TrailCrumb[];
  /**
   * The crumb you tapped to get where you are, or null if you came some other
   * way. When you leave by the trail again, the spot you leave keeps this
   * crumb's icon and panel, as long as you are still in its chapter.
   */
  current: TrailCrumb | null;
}

function emptyTrail(): Trail {
  return { back: [], ahead: [], current: null };
}

/**
 * The spot you are leaving by the trail, as a crumb, saved where you are
 * standing. If that is still the chapter the crumb you came by brought you
 * to, it keeps that crumb's icon, verse and panel. Anywhere else nothing
 * recorded a panel, so it is a plain crumb that brings back the chapter and
 * the verse the last link marked, if that mark is in this chapter.
 */
function crumbForHere(state: NavigationState, current: TrailCrumb | null): TrailCrumb {
  const { book, chapter } = state;
  const stillThere = !!current && current.book === book && current.chapter === chapter;
  const mark = state.linkHighlight;
  const verse = stillThere
    ? current!.verse
    : mark && mark.book === book && mark.chapter === chapter
      ? mark.verse
      : null;
  return {
    nav: { ...state, highlightedVerse: null, scrollTargetVerse: verse },
    kind: stillThere ? current!.kind : 'plain',
    book,
    chapter,
    verse,
    origin: stillThere ? current!.origin : undefined,
  };
}

/**
 * The trail, saved so it is still there after the app is closed.
 *
 * Only for a signed-in account, and only on this device: the copy is stamped
 * with the account it was made under and any other account ignores it, and
 * sign-out removes it (ACCOUNT_KEYS in lib/sync/clearPersonalData.ts). There
 * is no server copy.
 */
const TRAIL_STORAGE_KEY = 'projectbible_trail';

/**
 * The most crumbs the saved copy keeps, behind and ahead together. The oldest
 * go first, then the farthest ahead. Only the saved copy is trimmed — the live
 * trail is not, because callers hold on to the depth pushHistory hands back,
 * and dropping a crumb from the front would shift every one of those.
 */
const TRAIL_SAVE_LIMIT = 20;

/**
 * A panel snapshot bigger than this saves as just the verse. Search crumbs
 * carry their whole result list, and twenty of those could fill storage.
 */
const ORIGIN_SAVE_LIMIT = 64 * 1024;

/**
 * Whether a value survives being saved and read back unchanged. A snapshot
 * holding a Set, a Map, a Date or a class instance would come back as
 * something else, so it is not saved at all.
 */
function isPlainData(value: unknown, depth = 0): boolean {
  if (depth > 32) return false;
  if (value === null || value === undefined) return true;
  switch (typeof value) {
    case 'string':
    case 'boolean':
      return true;
    case 'number':
      return Number.isFinite(value);
    case 'object': {
      // An undefined in an array saves as null, so it does not come back the same.
      if (Array.isArray(value)) return value.every((v) => v !== undefined && isPlainData(v, depth + 1));
      const proto = Object.getPrototypeOf(value);
      if (proto !== Object.prototype && proto !== null) return false;
      return Object.values(value).every((v) => isPlainData(v, depth + 1));
    }
    default:
      return false;
  }
}

/** The crumb's panel snapshot if it can be saved; otherwise the crumb brings back just the verse. */
function saveableOrigin(origin: unknown): unknown {
  if (origin === undefined || !isPlainData(origin)) return undefined;
  try {
    return JSON.stringify(origin).length <= ORIGIN_SAVE_LIMIT ? origin : undefined;
  } catch {
    return undefined;
  }
}

function isSavedCrumb(c: any): c is TrailCrumb {
  return (
    c != null &&
    typeof c === 'object' &&
    typeof c.kind === 'string' &&
    typeof c.book === 'string' &&
    typeof c.chapter === 'number' &&
    c.nav != null &&
    typeof c.nav.translation === 'string' &&
    typeof c.nav.book === 'string' &&
    typeof c.nav.chapter === 'number'
  );
}

function loadTrail(): Trail {
  try {
    const raw = localStorage.getItem(TRAIL_STORAGE_KEY);
    if (!raw) return emptyTrail();
    const saved = JSON.parse(raw);
    const owner = getDeviceOwner();
    if (!owner || saved?.owner !== owner) return emptyTrail();
    return {
      back: Array.isArray(saved.back) ? saved.back.filter(isSavedCrumb) : [],
      ahead: Array.isArray(saved.ahead) ? saved.ahead.filter(isSavedCrumb) : [],
      current: isSavedCrumb(saved.current) ? saved.current : null,
    };
  } catch {
    return emptyTrail();
  }
}

/** Drop the oldest crumbs first, then the farthest ahead, down to the save limit. */
function trimForSave(trail: Trail): Trail {
  let excess = trail.back.length + trail.ahead.length - TRAIL_SAVE_LIMIT;
  if (excess <= 0) return trail;
  const dropBack = Math.min(excess, trail.back.length);
  excess -= dropBack;
  return {
    back: trail.back.slice(dropBack),
    ahead: trail.ahead.slice(0, trail.ahead.length - excess),
    current: trail.current,
  };
}

function persistTrail(trail: Trail): void {
  const owner = getDeviceOwner();
  try {
    if (!owner || (trail.back.length === 0 && trail.ahead.length === 0)) {
      localStorage.removeItem(TRAIL_STORAGE_KEY);
      return;
    }
  } catch {
    return;
  }
  const kept = trimForSave(trail);
  const save = (strip: (c: TrailCrumb) => TrailCrumb) =>
    localStorage.setItem(
      TRAIL_STORAGE_KEY,
      JSON.stringify({
        owner,
        back: kept.back.map(strip),
        ahead: kept.ahead.map(strip),
        current: kept.current ? strip(kept.current) : null,
      }),
    );
  try {
    save((crumb) => ({ ...crumb, origin: saveableOrigin(crumb.origin) }));
  } catch {
    // Storage full: the panels are the bulk of it, so save just the places.
    try {
      save((crumb) => ({ ...crumb, origin: undefined }));
    } catch {
      // Blocked storage. The trail still works until the app is closed.
    }
  }
}

const trail = writable<Trail>(loadTrail());
trail.subscribe(persistTrail);

/**
 * The origin snapshot from the step just walked back to, waiting for whichever
 * surface recognizes it to put itself back.
 *
 * This is how a crumb reopens the panel you left from without the navigation
 * store needing to know what a commentary panel or a search tree is. Whoever
 * handles it clears it. It replaces a set of one-off return stores that each
 * knew about exactly one surface and could not be chained.
 */
export const pendingRestore = writable<unknown | null>(null);

function createNavigationStore() {
  const { subscribe, set, update } = writable<NavigationState>(loadPersistedState());

  /** Stand where a crumb remembers, with its panel waiting to be put back. */
  function arrive(target: TrailCrumb) {
    persistState(target.nav);
    set(target.nav);
    pendingRestore.set(target.origin ?? null);
  }

  /**
   * Walk back to a step in the trail — what tapping a crumb behind you does.
   * `depth` is 1-based, matching what pushHistory returns, so depth 1 is home.
   * The crumbs after it, and the spot you are leaving, move ahead of you —
   * unless `clearAfter`, the crumb menu's "Go here and clear after", which
   * drops them instead.
   */
  function goToDepth(depth: number, clearAfter = false): TrailCrumb | null {
    const here = get({ subscribe });
    let target: TrailCrumb | undefined;
    trail.update((t) => {
      if (depth < 1 || depth > t.back.length) return t;
      target = t.back[depth - 1];
      return {
        back: t.back.slice(0, depth - 1),
        ahead: clearAfter ? [] : [...t.back.slice(depth), crumbForHere(here, t.current), ...t.ahead],
        current: target,
      };
    });
    if (target) arrive(target);
    return target ?? null;
  }

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
    setChapter: (chapter: number) => {
      update(state => {
        const next = { ...state, chapter, highlightedVerse: null, linkHighlight: null };
        persistState(next);
        return next;
      });
    },
    // Both at once, for Read Aloud following the audio into a new book.
    // setBook + setChapter would do it in two writes, and setBook lands on
    // chapter 1 on the way past — a position that was never real. That wrong
    // middle state got persisted, and it made the reader's chapter-load block
    // fire twice for one hop; a cross-book hop is a cold fetch, so the two
    // loads raced and the page could end up staying on the old book.
    setBookAndChapter: (book: string, chapter: number) => {
      update(state => {
        const next = { ...state, book: normalizeBookName(book), chapter, highlightedVerse: null, linkHighlight: null };
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
     * the target book's category color. Only callers that paint their own
     * highlight — the reading plan, which keeps its green — pass false.
     *
     * A jump into the other testament lands in your default for it (see
     * lib/testamentDefaults). Only when the caller is carrying the current
     * translation along: one that names a different translation means it, and
     * `keepTranslation` is for the two callers that are putting you back
     * somewhere rather than sending you, where a switch would be wrong.
     */
    navigateTo: (
      translation: string,
      book: string,
      chapter: number,
      scrollTargetVerse: number | null = null,
      highlight = true,
      keepTranslation = false,
    ) => {
      update(state => {
        const normalized = normalizeBookName(book);
        const landIn =
          keepTranslation || translation !== state.translation
            ? translation
            : translationForJump(translation, state.book, normalized, get(availableTranslations));
        const next = {
          ...state,
          translation: landIn,
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
        // Same rule as navigateTo.
        const landIn =
          translation !== state.translation
            ? translation
            : translationForJump(translation, state.book, normalized, get(availableTranslations));
        const next = {
          ...state,
          translation: landIn,
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
     * Record where a link is, before it takes you somewhere else.
     *
     * `anchor` is where the link physically sits -- the verse its icon or
     * marker is printed on. Pass it. Without one the crumb falls back to
     * wherever the reader is standing, and that is not a place: the reader
     * rewrites it as you scroll, and again every time it loads another chapter
     * to fill the screen. Open a commentary in Genesis 2, scroll fifty chapters
     * and tap a link in it, and the crumb had you at chapter 52. The link never
     * moved, so the crumb should not either.
     *
     * Returns the new stack depth. Callers that want to come back to something
     * when this exact step is undone keep the depth as a token.
     *
     * A new step forks the trail, the way following a link empties a
     * browser's Forward list: the crumbs ahead of you go.
     */
    pushHistory: (
      state: NavigationState,
      kind: CrumbKind = 'link',
      origin?: unknown,
      anchor?: { book: string; chapter: number; verse?: number | null },
    ) => {
      let depth = 0;
      trail.update(({ back: history }) => {
        const book = anchor ? normalizeBookName(anchor.book) : state.book;
        const chapter = anchor ? anchor.chapter : state.chapter;
        const verse = anchor
          ? anchor.verse ?? null
          : state.linkHighlight?.verse ?? state.scrollTargetVerse ?? null;
        const crumb: TrailCrumb = {
          // The state to restore is the reader as it was, but standing where
          // the link was rather than wherever it had drifted to.
          nav: anchor
            ? { ...state, book, chapter, scrollTargetVerse: verse, linkHighlight: null }
            : state,
          kind,
          book,
          chapter,
          verse,
          origin,
        };
        const back = [...history, crumb];
        depth = back.length;
        return { back, ahead: [], current: null };
      });
      return depth;
    },
    /** Attach an origin snapshot to the step just pushed. */
    attachOrigin: (depth: number, origin: unknown) => {
      trail.update((t) => {
        if (depth < 1 || depth > t.back.length) return t;
        const back = [...t.back];
        back[depth - 1] = { ...back[depth - 1], origin };
        return { ...t, back };
      });
    },
    /** One step back. */
    goBack: () => goToDepth(get(trail).back.length),
    goToDepth,
    /**
     * Walk forward to a crumb ahead of you. `index` is 0-based from the one
     * nearest the location pill. The spot you are leaving, and the crumbs
     * between it and the target, move behind you. With `clearAfter`, the
     * crumbs beyond the target go.
     */
    goToAhead: (index: number, clearAfter = false) => {
      const here = get({ subscribe });
      let target: TrailCrumb | undefined;
      trail.update((t) => {
        if (index < 0 || index >= t.ahead.length) return t;
        target = t.ahead[index];
        return {
          back: [...t.back, crumbForHere(here, t.current), ...t.ahead.slice(0, index)],
          ahead: clearAfter ? [] : t.ahead.slice(index + 1),
          current: target,
        };
      });
      if (target) arrive(target);
      return target ?? null;
    },
    /**
     * Take one crumb out of the trail without going anywhere. `index` is
     * 0-based in its own list. Removing one behind you moves every crumb after
     * it down a depth.
     */
    removeCrumb: (side: 'back' | 'ahead', index: number) => {
      trail.update((t) => {
        if (index < 0 || index >= t[side].length) return t;
        return { ...t, [side]: t[side].filter((_, i) => i !== index) };
      });
    },
    /** Empty the trail, behind and ahead. Where you are becomes home. */
    clearHistory: () => {
      trail.set(emptyTrail());
    },
    reset: () => {
      persistState(initialState);
      set(initialState);
    }
  };
}

export const navigationStore = createNavigationStore();

export const canGoBack = derived(trail, (t) => t.back.length > 0);

/**
 * The trail of steps between home and here, oldest first — what the navbar
 * breadcrumbs render. Empty means you are home.
 */
export const navTrail = derived(trail, (t) => t.back);

/**
 * The crumbs ahead of you, nearest first — the faded ones after the location
 * pill, left there when you tapped back along the trail.
 */
export const navAhead = derived(trail, (t) => t.ahead);

/** How many steps are on the back stack — the token pushHistory hands back. */
export const historyDepth = derived(trail, (t) => t.back.length);

// Derived store for getting current chapter count
export const currentBookChapters = derived(
  navigationStore,
  $nav => getBookChapters($nav.book)
);
