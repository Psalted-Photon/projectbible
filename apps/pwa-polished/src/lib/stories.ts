import { derived, writable, type Readable } from 'svelte/store';
import { normalizeBookName } from './bibleData';

/**
 * Story Mode: reading the Bible by complete stories instead of chapters.
 *
 * The data is public/stories.json, written by scripts/build-stories.mjs from
 * the hand-written sources in scripts/stories/. Each book is a list of bigger
 * stories, each holding smaller ones. A story is only its title and first
 * verse: it runs until the next one starts, so every verse is in exactly one.
 * `e` is the last chapter it touches, worked out by the build script, so the
 * chapters shown in brackets can't drift from the starts.
 *
 * Fetched once, on first use, and kept by the service worker like any other
 * file in public/. Until a book has stories, Story Mode shows its chapters.
 */

export interface StoryRange {
  t: string;
  c: number;
  v: number;
  e: number;
}

/** A passage a story points to: a book, its first verse, and how to print it. */
export interface StoryLink {
  b: string;
  c: number;
  v: number;
  /** As written in the source: "2 Samuel 11:1–12:25". */
  t: string;
  /** The label over the link row; "Written when" when absent. */
  n?: string;
}

export interface SmallerStory extends StoryRange {
  /** A muted second line under the row, e.g. a psalm's "David · Cry for help". */
  i?: string;
  /** Where the story points, e.g. the moment in David's life a psalm was written. */
  l?: StoryLink;
}

export interface BiggerStory extends StoryRange {
  /** A plain label shown above this story, e.g. "Book I" in Psalms. */
  d?: string;
  /** The last chapter the label covers, for its chapters. */
  de?: number;
  s: SmallerStory[];
}

export type StoryBooks = Record<string, BiggerStory[]>;

/** A book's collapsed card at the top of its stories. "- " lines are list rows. */
export interface StoryCard {
  t: string;
  p: string[];
}

/** The data, once fetched. Null until then, or if it couldn't be. */
export const storyBooks = writable<StoryBooks | null>(null);
/** Each book's card, for the books that have one. */
export const storyCards = writable<Record<string, StoryCard>>({});

let loading: Promise<StoryBooks | null> | null = null;

/**
 * The data is keyed by the build script's book names ("Psalms"); the app's
 * own are a few that differ ("Psalm"), so the keys are put into the app's.
 */
function appNames<T>(byBook: Record<string, T>): Record<string, T> {
  const out: Record<string, T> = {};
  for (const [book, value] of Object.entries(byBook)) out[normalizeBookName(book)] = value;
  return out;
}

/** Fetch the data if it isn't here yet. A failure isn't kept, so the next ask tries again. */
export function loadStories(): Promise<StoryBooks | null> {
  if (!loading) {
    loading = (async () => {
      try {
        const res = await fetch('/stories.json');
        if (res.ok) {
          const json = await res.json();
          const books = json?.books ? appNames(json.books as StoryBooks) : null;
          if (books) {
            for (const list of Object.values(books)) {
              for (const big of list) {
                for (const s of big.s) if (s.l) s.l = { ...s.l, b: normalizeBookName(s.l.b) };
              }
            }
          }
          storyCards.set(appNames((json?.cards ?? {}) as Record<string, StoryCard>));
          storyBooks.set(books);
          return books;
        }
      } catch {
        // Offline before it was ever cached: Story Mode shows chapters.
      }
      loading = null;
      return null;
    })();
  }
  return loading;
}

// --- The Canonical / Story Mode choice ------------------------------------

const MODE_KEY = 'projectbible_story_mode';

function readMode(): boolean {
  try {
    return localStorage.getItem(MODE_KEY) === 'story';
  } catch {
    return false;
  }
}

const chosen = writable<boolean>(readMode());

/** The choice on this device, Story Mode or not. Kept outside the synced settings. */
export const storyModeChosen = {
  subscribe: chosen.subscribe,
  set(on: boolean) {
    try {
      if (on) localStorage.setItem(MODE_KEY, 'story');
      else localStorage.removeItem(MODE_KEY);
    } catch {
      // Storage blocked: the choice lasts until the app closes.
    }
    chosen.set(on);
    if (on) void loadStories();
  },
};

/** Whether Story Mode is in force: the choice on this device. */
export const storyMode: Readable<boolean> = derived(chosen, (on) => on);

storyMode.subscribe((on) => {
  if (on) void loadStories();
});

// --- Finding and naming stories --------------------------------------------

/** The chapters a story covers, for its brackets: "37" or "37–50". */
export function chapterSpan(s: StoryRange): string {
  return s.c === s.e ? `${s.c}` : `${s.c}–${s.e}`;
}

const before = (a: StoryRange, chapter: number, verse: number) =>
  a.c < chapter || (a.c === chapter && a.v <= verse);

export interface StoryPlace {
  bigger: BiggerStory;
  smaller: SmallerStory;
  /** Index of the bigger story in its book, and of the smaller one in it. */
  bi: number;
  si: number;
}

/** The story a verse is in, or null for a book with no stories yet. */
export function storyAt(
  books: StoryBooks | null,
  book: string,
  chapter: number,
  verse: number,
): StoryPlace | null {
  const list = books?.[normalizeBookName(book)];
  if (!list?.length) return null;
  let bi = 0;
  for (let i = 0; i < list.length; i++) {
    if (before(list[i], chapter, verse)) bi = i;
    else break;
  }
  const bigger = list[bi];
  let si = 0;
  for (let i = 0; i < bigger.s.length; i++) {
    if (before(bigger.s[i], chapter, verse)) si = i;
    else break;
  }
  return { bigger, smaller: bigger.s[si], bi, si };
}
