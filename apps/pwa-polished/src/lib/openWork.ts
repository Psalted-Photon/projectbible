import { windowStore, type WindowContentType } from './stores/windowStore';
import { isbeModalStore } from '../stores/isbeModalStore';
import { navesModalStore } from '../stores/navesModalStore';
import { personModalStore } from '../stores/personModalStore';
import { lexicalModalStore } from '../stores/lexicalModalStore';
import type { WorksResolution } from '../adapters/lexicon-lookup';

/**
 * Switching between the four reference works.
 *
 * This is one path on purpose. The work tabs used to call the old "jump to the
 * encyclopedia" buttons, which were built to *replace* the card you were on and
 * only ever knew how to open a centred card — so inside a docked window they
 * threw a card over the whole app instead of changing the window. Tabs and
 * jump-links wanting different things from the same code is what caused that,
 * so the jump-links are gone and everything comes through here.
 */
export type WorkKey = 'dictionary' | 'topical' | 'encyclopedia' | 'people';

/** Which docked-window content each work renders as. */
const WINDOW_TYPE: Record<WorkKey, WindowContentType> = {
  dictionary: 'wordstudy',
  topical: 'naves',
  encyclopedia: 'isbe',
  people: 'person',
};

/**
 * Can this work be shown inside a docked window?
 *
 * All four can, now that the dictionary's contents are separable from its card.
 * Kept as a function because a tab that can't do something should grey out
 * rather than quietly opening a card over the top, and this is where that would
 * be said.
 */
export function worksInWindow(_work: WorkKey): boolean {
  return true;
}

/**
 * Every field any of the four works keeps in a window, blanked.
 *
 * A window's saved details are *merged* rather than replaced, so switching from
 * an article to a topic would otherwise leave the article's id, its open
 * section and its back-trail behind — and the topic would try to restore a
 * section it doesn't have and walk a trail of the wrong shape. Anything not
 * owned by the incoming work has to be cleared on the way in.
 */
const BLANK = {
  kind: null,
  entryId: null,
  placeId: null,
  topicId: null,
  personId: null,
  selectedText: '',
  primaryName: '',
  tab: null,
  expanded: {},
  expandedBooks: [],
  visited: [],
  scrollTop: 0,
  trail: [],
};

/** The window state for a work, given a resolved subject. Null when that work
 *  has nothing for this subject. */
function subjectState(work: WorkKey, works: WorksResolution | null): Record<string, unknown> | null {
  if (!works) return null;
  switch (work) {
    case 'encyclopedia': {
      const entry = works.entry;
      if (!entry) return null;
      return {
        ...BLANK,
        kind: entry.kind,
        entryId: entry.entryId,
        placeId: entry.placeId ?? null,
        primaryName: entry.primaryName,
      };
    }
    case 'topical': {
      const topic = works.topic;
      if (!topic) return null;
      return { ...BLANK, topicId: topic.id, primaryName: topic.name };
    }
    case 'people': {
      const found = works.person;
      if (!found) return null;
      return {
        ...BLANK,
        personId: found.person.id,
        primaryName: found.person.displayTitle || found.person.name,
      };
    }
    case 'dictionary': {
      if (!works.dict || !works.term) return null;
      return { ...BLANK, selectedText: works.term };
    }
  }
}

/**
 * Show `work` for the subject currently resolved in `works`.
 *
 * Returns false when there was nothing to open, so the caller can leave the
 * current view alone rather than closing it onto nothing.
 */
export function openWorkSubject(
  work: WorkKey,
  works: WorksResolution | null,
  clickedWord: string,
  windowId: string | null,
): boolean {
  const state = subjectState(work, works);
  if (!state) return false;

  if (windowId) {
    if (!worksInWindow(work)) return false;
    windowStore.setWindowContent(windowId, WINDOW_TYPE[work], state);
    return true;
  }

  switch (work) {
    case 'encyclopedia': {
      const entry = works!.entry!;
      isbeModalStore.open({
        kind: entry.kind,
        entryId: entry.entryId,
        placeId: entry.placeId ?? null,
        primaryName: entry.primaryName,
      });
      return true;
    }
    case 'topical': {
      const topic = works!.topic!;
      navesModalStore.open({ topicId: topic.id, primaryName: topic.name });
      return true;
    }
    case 'people': {
      const found = works!.person!;
      personModalStore.open({
        lookup: found,
        primaryName: found.person.displayTitle || found.person.name,
        clickedWord,
      });
      return true;
    }
    case 'dictionary': {
      lexicalModalStore.open({
        selectedText: works!.term,
        strongsId: undefined,
        morphologyData: null,
        lexicalEntries: null,
      });
      return true;
    }
  }
}

/**
 * Show `work`'s A–Z contents rather than a subject — what the tabs do while you
 * are already browsing an index, where there is no subject to carry across.
 */
export function openWorkIndex(work: WorkKey, windowId: string | null): boolean {
  if (windowId) {
    if (!worksInWindow(work)) return false;
    windowStore.setWindowContent(windowId, WINDOW_TYPE[work], { ...BLANK });
    return true;
  }

  switch (work) {
    case 'encyclopedia':
      isbeModalStore.open({ kind: 'entry', entryId: null, placeId: null, primaryName: '' });
      return true;
    case 'topical':
      navesModalStore.open({ topicId: null, primaryName: '' });
      return true;
    case 'people':
      personModalStore.open({});
      return true;
    // The dictionary has no contents list to open onto.
    case 'dictionary':
      return false;
  }
}
