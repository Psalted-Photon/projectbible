/**
 * windowTypes.ts
 *
 * The eleven things a window can show, and how each one starts out.
 *
 * Three places offer this list: the tile grid in a brand-new window, the apps
 * button on the bar, and the swap button in a window's header. They used to be
 * one list inside WindowContentSelector; now all three read it from here, so a
 * type added or recoloured once shows the same everywhere.
 */

import { get } from 'svelte/store';
import { windowStore, MAX_WINDOWS, type WindowContentType } from './stores/windowStore';
import { dockEdge, DOCK_SIZE } from './dockEdge';
import { navigationStore, availableTranslations } from '../stores/navigationStore';
import { defaultTranslationFor, translationForJump } from './testamentDefaults';
import { libraryPrefsStore, resumeTarget } from '../stores/libraryPrefsStore';
import { parallelStore } from '../stores/parallelStore';
import { localDateStr } from '../stores/clockStore';
import { showNotice } from '../stores/noticeStore';
import { DEFAULT_TRANSLATION } from './bibleData';
import type { PanelIconName } from '../components/icons/PanelIcon.svelte';

/**
 * `harmony` is not a WindowContentType and never becomes one: it is the one
 * choice that does not fill a window. It opens the full-screen Harmonies view
 * instead, after asking which set.
 */
export type WindowChoice =
  | 'bible' | 'map' | 'timeline' | 'notes' | 'isbe' | 'person' | 'naves'
  | 'commentaries' | 'journal' | 'art' | 'harmony';

export interface WindowTypeInfo {
  type: WindowChoice;
  icon: PanelIconName;
  label: string;
  accent: string;
}

/**
 * Accents are borrowed from colors the app already uses — the book-category
 * ramp in bibleData.ts and the nav bar's badge palette — so the list reads as
 * part of the same app rather than a new color scheme.
 */
export const WINDOW_TYPES: WindowTypeInfo[] = [
  { type: 'bible',        icon: 'bible',        label: 'Bible',        accent: '#a67c52' },
  { type: 'map',          icon: 'map',          label: 'Map',          accent: '#61f1ff' },
  { type: 'timeline',     icon: 'timeline',     label: 'Timeline',     accent: '#f0c040' },
  { type: 'commentaries', icon: 'commentary',   label: 'Commentary',   accent: '#a3e635' },
  { type: 'notes',        icon: 'notes',        label: 'Notes',        accent: '#fde047' },
  { type: 'journal',      icon: 'journal',      label: 'Journal',      accent: '#f2893e' },
  { type: 'isbe',         icon: 'encyclopedia', label: 'Encyclopedia', accent: '#4a90e2' },
  { type: 'naves',        icon: 'topical',      label: 'Topical',      accent: '#a78bfa' },
  { type: 'person',       icon: 'people',       label: 'People',       accent: '#2dd4bf' },
  { type: 'art',          icon: 'art',          label: 'Art',          accent: '#fb7185' },
  { type: 'harmony',      icon: 'harmony',      label: 'Harmonies',    accent: '#4a9ec9' },
];

/** What a window of this type starts out showing. */
export function initialContentFor(type: Exclude<WindowChoice, 'harmony'>): Record<string, any> {
  if (type === 'bible') {
    // Genesis, so the Old Testament default when there is one.
    const translation =
      defaultTranslationFor('Genesis', get(availableTranslations)) ?? DEFAULT_TRANSLATION;
    return { translation, book: 'Genesis', chapter: 1 };
  }
  if (type === 'commentaries') {
    const nav = get(navigationStore);
    // The first commentary window takes the anchor and follows the reader, so
    // it opens with no pinned position. Any later one is a deliberate second
    // view, so it opens frozen where the reader is now.
    const isFirst = !get(windowStore).some((w) => w.contentType === 'commentaries');
    return isFirst
      ? { author: undefined, anchored: true }
      : { author: undefined, anchored: false, book: nav.book, chapter: nav.chapter };
  }
  if (type === 'map') {
    return { center: [31.7683, 35.2137], zoom: 8 }; // Jerusalem
  }
  if (type === 'journal') {
    return { date: localDateStr(new Date()) }; // Today
  }
  if (type === 'notes') {
    return { view: 'browse' };
  }
  if (type === 'isbe' || type === 'person' || type === 'naves') {
    // Land back on what you were reading only if you closed this shelf a few
    // minutes ago — enough to undo a misfired close, not enough to hand you
    // yesterday's lookup. Otherwise open on the contents. Either way the entry
    // stays in Recently Viewed and one flip away.
    const prefs = get(libraryPrefsStore);
    if (type === 'isbe') {
      const last = resumeTarget(prefs, 'isbe');
      return last
        ? { kind: 'entry', entryId: Number(last.id), placeId: null, primaryName: last.name }
        : {};
    }
    if (type === 'person') {
      const last = resumeTarget(prefs, 'people');
      return last ? { personId: String(last.id), primaryName: last.name } : {};
    }
    const last = resumeTarget(prefs, 'naves');
    return last ? { topicId: Number(last.id), primaryName: last.name } : {};
  }
  return {};
}

/** The notice the edge swipe also gives at the cap. */
export function showWindowLimitNotice() {
  showNotice(`Up to ${MAX_WINDOWS} windows. Close one to open another.`, 'info');
}

/**
 * Open a new window of this type where the phone expects one: under the text
 * in portrait, beside it in landscape. Harmonies isn't a window, so callers
 * send it to the set picker instead. Returns false at the window cap.
 */
export function openWindowOfType(type: Exclude<WindowChoice, 'harmony'>): boolean {
  // Worked out before the window exists: a commentary checks whether it is
  // the first one open, and the empty window doesn't count either way.
  const state = initialContentFor(type);
  const id = windowStore.createWindow(dockEdge(), DOCK_SIZE);
  if (!id) {
    showWindowLimitNotice();
    return false;
  }
  windowStore.setWindowContent(id, type, state);
  return true;
}

/**
 * Show something else in an open window. Its old settings are dropped rather
 * than merged in, so a map's centre or a Bible's chapter doesn't ride along
 * into the new type.
 */
export function swapWindowContent(windowId: string, type: Exclude<WindowChoice, 'harmony'>) {
  const win = get(windowStore).find((w) => w.id === windowId);
  if (!win || win.contentType === type) return;
  windowStore.replaceWindowContent(windowId, type as WindowContentType, initialContentFor(type));
}

export interface HarmonyChoice {
  panes: Array<{ book: string; chapter: number }>;
  label: string;
  sectionId?: number;
  translations?: string[];
}

/**
 * Open the Harmonies view for the set the picker chose.
 *
 * `fromWindowId` is the window that asked for it, when one did. That window
 * goes: the view is full-screen, and closing it later would otherwise reveal an
 * empty docked panel the user never asked for and does not remember opening.
 * From the apps button there is no such window, and nothing closes.
 *
 * The panes are made before the store is told, because parallelStore.open is
 * what mounts the view, and the view renders a pane per entry in that list —
 * telling it first would mount readers for windowIds that do not exist yet.
 */
export function openHarmonyView(choice: HarmonyChoice, fromWindowId?: string) {
  const { panes, label, sectionId, translations } = choice;
  if (panes.length === 0) return;

  // A translation comparison names one per pane; a harmony names none and
  // every pane takes the reader's own, which is what makes the four Gospels
  // read in the translation you were already in. Opening one in the other
  // testament is a jump like any other, so it lands in that testament's
  // default, the same as the reader would.
  const reader = get(navigationStore);
  const installed = get(availableTranslations);
  const perPane = panes.map((p, i) => ({
    ...p,
    translation:
      translations?.[i] ?? translationForJump(reader.translation, reader.book, p.book, installed),
  }));

  const ids = windowStore.createHarmonyPanes(perPane);

  if (fromWindowId) windowStore.closeWindow(fromWindowId);
  parallelStore.open(
    ids.map((paneId, i) => ({
      paneId,
      book: perPane[i].book,
      translation: perPane[i].translation,
    })),
    {
      mode: translations ? 'translations' : 'accounts',
      setLabel: label,
      sectionId,
    },
  );
}
