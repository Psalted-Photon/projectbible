import { writable, derived, get } from 'svelte/store';
import { getBookChapters } from '../lib/bibleData';

export interface NavigationState {
  translation: string;
  book: string;
  chapter: number;
  isChronologicalMode?: boolean;
}

// Available translations (will be populated from packs later)
export const availableTranslations = writable<string[]>(['WEB', 'KJV']);

// Current navigation state
const initialState: NavigationState = {
  translation: 'WEB',
  book: 'John',
  chapter: 1
};

function createNavigationStore() {
  const { subscribe, set, update } = writable<NavigationState>(initialState);

  return {
    subscribe,
    setTranslation: (translation: string) => {
      update(state => ({ ...state, translation }));
    },
    setBook: (book: string) => {
      update(state => ({ ...state, book, chapter: 1 }));
    },
    setChapter: (chapter: number) => {
      update(state => ({ ...state, chapter }));
    },
    setChronologicalMode: (isChronologicalMode: boolean) => {
      update(state => ({ ...state, isChronologicalMode }));
    },
    navigateTo: (translation: string, book: string, chapter: number) => {
      set({ translation, book, chapter });
    },
    reset: () => set(initialState)
  };
}

export const navigationStore = createNavigationStore();

// Derived store for getting current chapter count
export const currentBookChapters = derived(
  navigationStore,
  $nav => getBookChapters($nav.book)
);
