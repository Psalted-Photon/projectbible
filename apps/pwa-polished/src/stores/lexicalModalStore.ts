import { writable } from 'svelte/store';
import type { DBMorphology } from '../adapters/db';

export interface LexicalModalState {
  isOpen: boolean;
  selectedText: string;
  strongsId: string | undefined;
  morphologyData: DBMorphology | null;
  lexicalEntries: any;
}

function createLexicalModalStore() {
  const { subscribe, set, update } = writable<LexicalModalState>({
    isOpen: false,
    selectedText: '',
    strongsId: undefined,
    morphologyData: null,
    lexicalEntries: null,
  });

  return {
    subscribe,
    open: (data: Omit<LexicalModalState, 'isOpen'>) => {
      set({
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
      });
    },
  };
}

export const lexicalModalStore = createLexicalModalStore();
