import { writable } from 'svelte/store';
import type { DBMorphology } from '../adapters/db';
import type { PersonLookupResult } from '../adapters/lexicon-lookup';

export interface LexicalModalState {
  isOpen: boolean;
  selectedText: string;
  strongsId: string | undefined;
  morphologyData: DBMorphology | null;
  lexicalEntries: any;
  /** Biblical character match for the clicked word (drives the "Character" tab). */
  characterData?: PersonLookupResult | null;
}

function createLexicalModalStore() {
  const { subscribe, set, update } = writable<LexicalModalState>({
    isOpen: false,
    selectedText: '',
    strongsId: undefined,
    morphologyData: null,
    lexicalEntries: null,
    characterData: null,
  });

  return {
    subscribe,
    open: (data: Omit<LexicalModalState, 'isOpen'>) => {
      set({
        characterData: null,
        ...data,
        isOpen: true,
      });
    },
    close: () => {
      set({
        isOpen: false,
        selectedText: '',
        strongsId: undefined,
        morphologyData: null,
        lexicalEntries: null,
        characterData: null,
      });
    },
  };
}

export const lexicalModalStore = createLexicalModalStore();
