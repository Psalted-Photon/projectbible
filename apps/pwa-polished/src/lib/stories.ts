import { derived, writable, type Readable } from 'svelte/store';
import { devOptionsUnlocked } from './devOptions';

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

export interface SmallerStory {
  t: string;
  c: number;
  v: number;
  e: number;
}

export interface BiggerStory extends SmallerStory {
  s: SmallerStory[];
}

export type StoryBooks = Record<string, BiggerStory[]>;

/** The data, once fetched. Null until then, or if it couldn't be. */
export const storyBooks = writable<StoryBooks | null>(null);

let loading: Promise<StoryBooks | null> | null = null;

/** Fetch the data if it isn't here yet. A failure isn't kept, so the next ask tries again. */
export function loadStories(): Promise<StoryBooks | null> {
  if (!loading) {
    loading = (async () => {
      try {
        const res = await fetch('/stories.json');
        if (res.ok) {
          const json = await res.json();
          const books = (json?.books ?? null) as StoryBooks | null;
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

/**
 * Whether Story Mode is in force. Dev Options only until every book has its
 * stories: hiding Dev Options puts the app back to Canonical without losing
 * the choice.
 */
export const storyMode: Readable<boolean> = derived(
  [chosen, devOptionsUnlocked],
  ([on, unlocked]) => on && unlocked,
);

storyMode.subscribe((on) => {
  if (on) void loadStories();
});

// --- Finding and naming stories --------------------------------------------

/** The chapters a story covers, for its brackets: "37" or "37–50". */
export function chapterSpan(s: SmallerStory): string {
  return s.c === s.e ? `${s.c}` : `${s.c}–${s.e}`;
}

const before = (a: SmallerStory, chapter: number, verse: number) =>
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
  const list = books?.[book];
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
