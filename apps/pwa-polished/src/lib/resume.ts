/**
 * Picking up where you were after the app is started again from scratch.
 *
 * On a folding phone the cover screen and the inner screen are separate home
 * screens, so opening the phone does not resize the app — it relaunches it.
 * The same happens when Android reclaims a backgrounded app for memory. Either
 * way the page is new, and anything held only in memory is gone. This keeps
 * what is needed to put the reader back on the exact line it was showing.
 *
 * One entry per reader: `main`, or a Bible window's id.
 */
import type { ReaderPosition } from '../stores/navigationStore';

const KEY = 'projectbible_resume';

/** Where lib/sessionRestore writes down what was open as the app is left. */
export const SESSION_KEY = 'projectbible_session';

/**
 * How soon a relaunch has to follow the app being left to count as picking up
 * where you were. A fold hands over in a second or two; this leaves room for a
 * slow phone without bringing back yesterday's panels.
 */
export const QUICK_RETURN_MS = 2 * 60 * 1000;

/** This launch follows the app being left moments ago — a fold, most likely. */
export function isQuickReturn(): boolean {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    const savedAt = raw ? JSON.parse(raw)?.savedAt : null;
    return typeof savedAt === 'number' && Date.now() - savedAt < QUICK_RETURN_MS;
  } catch {
    return false;
  }
}

export interface ResumeEntry {
  /**
   * What the reader's own saved state named when this was taken. A resume
   * only applies while it still does — once the reader has been sent
   * somewhere else, the line it was on belongs to a place it has left.
   */
  translation: string;
  book: string;
  chapter: number;
  /** The verse at the top of the screen and how far it sat above the edge. */
  pos: ReaderPosition;
  /** The "start here" mark that was up, if any. */
  mark?: { book: string; chapter: number; verse: number } | null;
}

function readAll(): Record<string, ResumeEntry> {
  try {
    const raw = localStorage.getItem(KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

/** The saved entry for one reader, if there is one. */
export function readResume(readerId: string): ResumeEntry | null {
  const e = readAll()[readerId];
  if (!e || !e.pos || !(e.pos.verse > 0) || !(e.pos.chapter > 0) || !e.pos.book) return null;
  return e;
}

/**
 * Save one reader's entry. `live` names the readers that still exist, so an
 * entry left by a window that has since been closed is dropped on the way.
 */
export function saveResume(readerId: string, entry: ResumeEntry, live?: (id: string) => boolean): void {
  try {
    const all = readAll();
    all[readerId] = entry;
    if (live) {
      for (const id of Object.keys(all)) {
        if (id !== readerId && !live(id)) delete all[id];
      }
    }
    localStorage.setItem(KEY, JSON.stringify(all));
  } catch {
    // Blocked or full storage: the reader opens at the top of its chapter.
  }
}
