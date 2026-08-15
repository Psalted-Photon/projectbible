import { writable } from 'svelte/store';
import { lookupStore } from './lookupStore';
import { personModalStore } from './personModalStore';
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
    // One card holds all four works; lookupStore says which is on top.
    //
    // A tapped word that resolved to a person opens on the bio. That used to
    // mean this card hosting the bio itself, with a "back to the definition"
    // link — now People is simply the tab in front, and the word study stays
    // one tab away. Callers keep passing characterData; it is handed to the
    // People store so the bio has a single home rather than two.
    open: (data: Omit<LexicalModalState, 'isOpen'>) => {
      set({
        characterData: null,
        ...data,
        isOpen: true,
      });
      if (data.characterData) {
        personModalStore.open({
          lookup: data.characterData,
          primaryName:
            data.characterData.person.displayTitle || data.characterData.person.name,
          clickedWord: data.selectedText,
        });
        return;
      }
      lookupStore.show('dictionary');
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
      lookupStore.close();
    },
  };
}

export const lexicalModalStore = createLexicalModalStore();
