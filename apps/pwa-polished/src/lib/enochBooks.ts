// The Book of Enoch (1 Enoch) — bundled reading text for the Commentary panel.
//
// Two public-domain translations are shipped as local JSON and surfaced ONLY
// through the Commentary author dropdown (see CommentaryNavigationBar.svelte).
// Enoch is deliberately NOT part of BIBLE_BOOKS, the commentary pack, or any
// other navigation — the author dropdown is the single entry point.

export interface EnochVerse {
  n: number;
  text: string;
}

export interface EnochChapter {
  chapter: number; // 1-based reading position (picker index)
  label: string; // printed chapter label, e.g. "Chapter 72" / "Chapter LXXII"
  headings: string[]; // section titles that begin at this chapter
  verses: EnochVerse[];
}

export interface EnochBook {
  id: string;
  title: string;
  translator: string;
  year: number;
  source: string;
  chapters: EnochChapter[];
}

// Sentinel author values used in window contentState.author.
export type EnochAuthor = 'enoch:charles' | 'enoch:laurence';

// Dropdown entries: translator full name + year + (Book of Enoch).
export const ENOCH_EDITIONS: { author: EnochAuthor; label: string }[] = [
  { author: 'enoch:charles', label: 'Robert Henry Charles, 1917 (Book of Enoch)' },
  { author: 'enoch:laurence', label: 'Richard Laurence, 1821 (Book of Enoch)' },
];

export function isEnochAuthor(author?: string | null): author is EnochAuthor {
  return author === 'enoch:charles' || author === 'enoch:laurence';
}

export function enochLabelFor(author?: string | null): string | undefined {
  return ENOCH_EDITIONS.find((e) => e.author === author)?.label;
}

const loaders: Record<EnochAuthor, () => Promise<EnochBook>> = {
  'enoch:charles': () =>
    import('../data/book-of-enoch-charles.json').then((m) => m.default as unknown as EnochBook),
  'enoch:laurence': () =>
    import('../data/book-of-enoch-laurence.json').then((m) => m.default as unknown as EnochBook),
};

const cache = new Map<EnochAuthor, EnochBook>();

// Lazily load (and cache) a translation. Returns null for non-Enoch authors.
export async function loadEnoch(author?: string | null): Promise<EnochBook | null> {
  if (!isEnochAuthor(author)) return null;
  const cached = cache.get(author);
  if (cached) return cached;
  const book = await loaders[author]();
  cache.set(author, book);
  return book;
}
