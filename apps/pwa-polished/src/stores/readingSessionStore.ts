import { writable } from 'svelte/store';

const STORAGE_KEY = 'projectbible_reading_session';

export interface ReadingSession {
  planId: string;
  planType: 'harmony' | 'standard';
  dayNumber: number;
  /** Current passage index (harmony plans only) */
  passageIndex?: number;
}

function createReadingSessionStore() {
  // Rehydrate from localStorage on init
  let initial: ReadingSession | null = null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) initial = JSON.parse(raw) as ReadingSession;
  } catch { /* ignore parse errors */ }

  let _current: ReadingSession | null = initial;
  const { subscribe, set } = writable<ReadingSession | null>(initial);

  // Keep _current in sync for synchronous reads
  subscribe(v => { _current = v; });

  function persist(session: ReadingSession | null) {
    try {
      if (session) {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
      } else {
        localStorage.removeItem(STORAGE_KEY);
      }
    } catch { /* ignore quota errors */ }
  }

  return {
    subscribe,

    /** Start a new reading session, replacing any existing one. */
    setSession(session: ReadingSession) {
      set(session);
      persist(session);
    },

    /** Advance the passage index (harmony plans only). */
    updatePassageIndex(index: number) {
      if (_current && _current.planType === 'harmony') {
        const next: ReadingSession = { ..._current, passageIndex: index };
        set(next);
        persist(next);
      }
    },

    /** End the current session and remove from localStorage. */
    clearSession() {
      set(null);
      persist(null);
    },
  };
}

export const readingSessionStore = createReadingSessionStore();
