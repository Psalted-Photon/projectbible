/**
 * libraryPrefsStore.ts
 *
 * The small personal layer over the study library: which entries you starred,
 * which you read lately, and where you left off in each source. Survives
 * restarts via localStorage — modeled on repeatsStore/navigationStore.
 *
 * Keyed by source ("isbe" today; "naves" and "people" join it later) so the
 * three lists keep their own stars and history rather than sharing one pile.
 */

import { writable } from 'svelte/store';

export type LibrarySource = 'isbe' | 'naves' | 'people';

/** A starred or recently-read entry, holding just enough to draw its row. */
export interface LibraryMark {
  id: number | string;
  name: string;
  sortKey: string;
}

export interface LibrarySourcePrefs {
  starred: LibraryMark[];
  recent: LibraryMark[];
  /** The entry to reopen on, so the window resumes rather than starting blank. */
  lastRead: LibraryMark | null;
  /** Letter the contents list was left on. */
  lastLetter: string | null;
  /**
   * When the window was last closed, in epoch ms. Reopening within
   * RESUME_WINDOW_MS returns you to `lastRead`; after that you get the index.
   * Stamped on closing rather than on opening: the point is how long ago you
   * *left*, so a long read followed by a misfired close still resumes.
   */
  closedAt: number | null;
}

/** How long a closed window stays resumable. */
export const RESUME_WINDOW_MS = 30 * 60 * 1000;

export type LibraryPrefs = Record<LibrarySource, LibrarySourcePrefs>;

const STORAGE_KEY = 'projectbible_library';
/** Enough history to get back to what you were just in, not a reading log. */
const MAX_RECENT = 10;

const emptySource = (): LibrarySourcePrefs => ({
  starred: [],
  recent: [],
  lastRead: null,
  lastLetter: null,
  closedAt: null,
});

const empty = (): LibraryPrefs => ({
  isbe: emptySource(),
  naves: emptySource(),
  people: emptySource(),
});

function isMark(m: any): m is LibraryMark {
  return (
    m &&
    (typeof m.id === 'number' || typeof m.id === 'string') &&
    typeof m.name === 'string' &&
    typeof m.sortKey === 'string'
  );
}

function loadPersisted(): LibraryPrefs {
  const prefs = empty();
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return prefs;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return prefs;

    for (const source of Object.keys(prefs) as LibrarySource[]) {
      const saved = parsed[source];
      if (!saved) continue;
      prefs[source] = {
        starred: Array.isArray(saved.starred) ? saved.starred.filter(isMark) : [],
        recent: Array.isArray(saved.recent) ? saved.recent.filter(isMark).slice(0, MAX_RECENT) : [],
        lastRead: isMark(saved.lastRead) ? saved.lastRead : null,
        lastLetter: typeof saved.lastLetter === 'string' ? saved.lastLetter : null,
        closedAt: typeof saved.closedAt === 'number' ? saved.closedAt : null,
      };
    }
  } catch (error) {
    console.error('Failed to load library prefs:', error);
  }
  return prefs;
}

function persist(prefs: LibraryPrefs) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
  } catch (error) {
    console.error('Failed to save library prefs:', error);
  }
}

function createLibraryPrefsStore() {
  const { subscribe, update } = writable<LibraryPrefs>(loadPersisted());

  /** Apply a change to one source, then write the whole lot back. */
  const edit = (source: LibrarySource, fn: (s: LibrarySourcePrefs) => LibrarySourcePrefs) =>
    update((prefs) => {
      const next = { ...prefs, [source]: fn(prefs[source]) };
      persist(next);
      return next;
    });

  const sameEntry = (a: LibraryMark, b: LibraryMark) => String(a.id) === String(b.id);

  return {
    subscribe,

    toggleStar: (source: LibrarySource, mark: LibraryMark) =>
      edit(source, (s) => {
        const has = s.starred.some((m) => sameEntry(m, mark));
        return {
          ...s,
          starred: has
            ? s.starred.filter((m) => !sameEntry(m, mark))
            : // Newest first, so a star just added is where you look for it.
              [mark, ...s.starred],
        };
      }),

    /** Called when an entry is actually opened — feeds both recents and resume. */
    markRead: (source: LibrarySource, mark: LibraryMark) =>
      edit(source, (s) => ({
        ...s,
        lastRead: mark,
        recent: [mark, ...s.recent.filter((m) => !sameEntry(m, mark))].slice(0, MAX_RECENT),
      })),

    setLastLetter: (source: LibrarySource, letter: string) =>
      edit(source, (s) => ({ ...s, lastLetter: letter })),

    /** Called when the window is closed — starts the resume countdown. */
    markClosed: (source: LibrarySource) => edit(source, (s) => ({ ...s, closedAt: Date.now() })),

    clearRecent: (source: LibrarySource) => edit(source, (s) => ({ ...s, recent: [] })),
  };
}

export const libraryPrefsStore = createLibraryPrefsStore();

/**
 * The entry a freshly opened window should land on, or null for the index.
 *
 * Resumes only if the window was closed recently — long enough to undo a
 * misfired close, short enough that coming back tomorrow starts clean. What
 * you were reading is still in `recent` and behind the flip either way.
 */
export function resumeTarget(prefs: LibraryPrefs, source: LibrarySource): LibraryMark | null {
  const { lastRead, closedAt } = prefs[source];
  if (!lastRead || closedAt == null) return null;
  return Date.now() - closedAt < RESUME_WINDOW_MS ? lastRead : null;
}

/** Is this entry starred? Cheap enough to call per row while rendering. */
export function isStarred(prefs: LibraryPrefs, source: LibrarySource, id: number | string): boolean {
  return prefs[source].starred.some((m) => String(m.id) === String(id));
}
