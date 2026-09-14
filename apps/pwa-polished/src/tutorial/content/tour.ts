/**
 * The guided tour's first half: everything that works before any packs.
 *
 * Packs come first because most of the app does nothing without them. The book
 * picker comes next, and teaches the book colours, because they carry through
 * the whole app. The half that needs packs -- the tap-a-word ring, commentary,
 * cross-references, Read Aloud -- runs once they are installed.
 */

import { get } from 'svelte/store';
import type { TourStep, StepContext, EdgeLane } from './types';
import { find, inMainReader } from '../engine/targets';
import { paneOpen, anyPaneOpen } from '../engine/watch';
import { windowStore, type WindowEdge } from '../../lib/stores/windowStore';
import { dockEdge } from '../../lib/dockEdge';
import { navigationStore } from '../../stores/navigationStore';
import { BIBLE_BOOKS, CATEGORY_LABELS, normalizeBookName } from '../../lib/bibleData';
import {
  installAllState,
  packsStillToInstall,
  voicesStillToInstall,
} from '../../lib/packInstaller';

/** The app's edge-swipe lane is 40px deep (EdgeGestureDetector). */
const LANE_DEPTH = 40;

const MAX_WINDOWS = 6;

function edgeLane(edge: WindowEdge): EdgeLane {
  const w = window.innerWidth;
  const h = window.innerHeight;
  switch (edge) {
    case 'right':
      return { edge, box: { left: w - LANE_DEPTH, top: h * 0.3, width: LANE_DEPTH, height: h * 0.4 } };
    case 'left':
      return { edge, box: { left: 0, top: h * 0.3, width: LANE_DEPTH, height: h * 0.4 } };
    case 'top':
      return { edge, box: { left: w * 0.3, top: 0, width: w * 0.4, height: LANE_DEPTH } };
    case 'bottom':
    default:
      // Left of the middle: the centre of the bottom edge is kept free for the
      // phone's own home gesture and never opens a window.
      return { edge: 'bottom', box: { left: w * 0.12, top: h - LANE_DEPTH, width: w * 0.26, height: LANE_DEPTH } };
  }
}

/**
 * The edge a new window should come from: the app's own choice (under the text
 * in portrait, beside it in landscape), unless a window already sits there --
 * an open window covers its own edge's lane.
 */
function freeEdge(): WindowEdge | null {
  const taken = new Set(get(windowStore).map((w) => w.edge));
  const order: WindowEdge[] = [dockEdge(), 'right', 'left', 'bottom', 'top'];
  return order.find((e) => !taken.has(e)) ?? null;
}

/** The on-screen element of a docked window, found from its id. */
function windowElement(id: string | undefined): HTMLElement | null {
  if (!id) return null;
  const windows = get(windowStore);
  const win = windows.find((w) => w.id === id);
  if (!win) return null;
  const sameEdge = windows.filter((w) => w.edge === win.edge);
  const index = sameEdge.findIndex((w) => w.id === id);
  const panels = document.querySelectorAll<HTMLElement>(`.panel-container-${win.edge} > .panel`);
  return panels[index] ?? null;
}

function dirWord(edge: WindowEdge): string {
  return { right: 'left', left: 'right', bottom: 'up', top: 'down' }[edge];
}

function currentBookFamily(): { book: string; family: string } {
  const book = normalizeBookName(get(navigationStore).book);
  const info = BIBLE_BOOKS.find((b) => b.name === book);
  return { book, family: info ? CATEGORY_LABELS[info.category] : '' };
}

function referenceDropdown(): HTMLElement | null {
  return inMainReader('.reference-dropdown.positioned');
}

async function remainingInstalls(ctx: StepContext): Promise<number> {
  if (ctx.tour.remaining === undefined) {
    const [packs, voices] = await Promise.all([packsStillToInstall(), voicesStillToInstall()]);
    ctx.tour.remaining = packs.length + voices.length;
  }
  return ctx.tour.remaining;
}

export const PART_ONE: TourStep[] = [
  {
    id: 'welcome-turn-off',
    target: () => inMainReader('.pill-settings'),
    reveal: true,
    passThrough: false,
    title: 'Tutorial Mode is on',
    body:
      'Lime dots will mark things worth trying as you go. You can turn Tutorial Mode off any time in Settings → General.',
    nextLabel: 'Got it',
  },

  // ── Packs ────────────────────────────────────────────────────────────────
  {
    id: 'packs-ready',
    // Decides for every pack step below: nothing to walk through when it is
    // all installed already, or already on its way.
    skipIf: async (ctx) => {
      ctx.tour.skipPacks = get(installAllState).running || (await remainingInstalls(ctx)) === 0;
      return !ctx.tour.skipPacks;
    },
    title: 'Your library is ready',
    body: () =>
      get(installAllState).running
        ? 'Your packs are already installing in the background.'
        : 'Every pack and voice is already installed on this device.',
  },
  {
    id: 'packs-intro',
    skipIf: (ctx) => ctx.tour.skipPacks,
    title: 'First, your library',
    body:
      'Most of Hexapla comes in packs: more translations, dictionaries, commentaries, the encyclopedia, maps, art and the reading voices. Let’s install them.',
    nextLabel: 'Show me',
    alt: {
      label: 'Not now',
      run: (ctx) => {
        ctx.tour.packsDeclined = true;
        ctx.goTo('book-picker');
      },
    },
  },
  {
    id: 'open-settings',
    target: () => inMainReader('.pill-settings'),
    reveal: true,
    allowPanes: true,
    skipIf: (ctx) => ctx.tour.skipPacks || paneOpen('settings') || paneOpen('packs'),
    doneWhen: () => paneOpen('settings'),
    title: 'Open Settings',
    body: 'Tap the gear.',
  },
  {
    id: 'open-storage',
    target: () => find('.pane-settings .sec-head', 'Storage'),
    reveal: true,
    allowPanes: true,
    skipIf: (ctx) =>
      ctx.tour.skipPacks ||
      paneOpen('packs') ||
      find('.pane-settings .sec-head', 'Storage')?.getAttribute('aria-expanded') === 'true',
    doneWhen: () =>
      paneOpen('packs') ||
      find('.pane-settings .sec-head', 'Storage')?.getAttribute('aria-expanded') === 'true',
    title: 'Storage & Updates',
    body: 'Tap to open this section.',
  },
  {
    id: 'open-packs',
    target: () => find('.pane-settings .packs-button:not(.alarm-button)'),
    reveal: true,
    allowPanes: true,
    skipIf: (ctx) => ctx.tour.skipPacks || paneOpen('packs'),
    doneWhen: () => paneOpen('packs'),
    title: 'Manage Packs',
    body: 'Tap here to see every pack.',
  },
  {
    id: 'install-all',
    target: () => find('.pane-packs .install-all-btn'),
    reveal: true,
    allowPanes: true,
    skipIf: (ctx) => ctx.tour.skipPacks,
    doneWhen: () => get(installAllState).running,
    title: 'Install all',
    body:
      'One tap installs everything, one pack at a time. It’s a big download, so Wi-Fi is best. The size is shown just below.',
  },
  {
    id: 'install-running',
    target: () => find('.pane-packs .install-all'),
    allowPanes: true,
    passThrough: false,
    skipIf: () => !get(installAllState).running,
    title: 'Installing',
    body:
      'It keeps going in the background, even with this closed. Let’s look around while it works.',
  },
  {
    id: 'close-panes',
    target: () =>
      paneOpen('packs') ? find('.pane-packs .close-btn') : find('.pane-settings .close-btn'),
    allowPanes: true,
    skipIf: () => !anyPaneOpen(),
    doneWhen: () => !anyPaneOpen(),
    title: 'Close the panes',
    body: () => (paneOpen('packs') ? 'Tap × to close Packs, then Settings.' : 'Tap × to close Settings.'),
  },

  // ── Books and their colours ──────────────────────────────────────────────
  {
    id: 'book-picker',
    target: () => inMainReader('.pill-btn-reference'),
    reveal: true,
    doneWhen: () => !!referenceDropdown(),
    title: 'Books and chapters',
    body: 'Tap here to pick a book and chapter.',
  },
  {
    id: 'book-colors',
    target: () => referenceDropdown(),
    pad: 2,
    skipIf: () => !referenceDropdown(),
    doneWhen: () => !referenceDropdown(),
    extra: 'colors',
    title: 'Every book has a color',
    body:
      'The books come in ten families, and each family keeps its color everywhere in Hexapla: chapter titles, verse numbers, verse lists, the map, reading plans and search.',
  },
  {
    id: 'pick-chapter',
    target: () => referenceDropdown(),
    pad: 2,
    skipIf: () => !referenceDropdown(),
    doneWhen: () => !referenceDropdown(),
    title: 'Pick one',
    body: 'Tap a book to open it, then tap a chapter.',
  },
  {
    id: 'same-color',
    target: () => {
      const { book, chapter } = get(navigationStore);
      const section = document.querySelector<HTMLElement>(
        `.main-content .chapter-section[data-book="${CSS.escape(normalizeBookName(book))}"][data-chapter="${chapter}"]`,
      );
      const header = section?.querySelector('.chapter-header h1');
      if (!header) return null;
      const numbers = Array.from(section!.querySelectorAll('.verse-number')).slice(0, 2);
      return [header, ...numbers];
    },
    pad: 10,
    passThrough: false,
    title: () => {
      const { family } = currentBookFamily();
      return family ? `${family} color` : 'Same color, everywhere';
    },
    body: () => {
      const { book, family } = currentBookFamily();
      return family
        ? `${book} belongs to the ${family} family, so its title and verse numbers wear that color. You’ll see it on ${book} all through the app.`
        : 'The title and verse numbers wear the book’s family color, and it follows the book all through the app.';
    },
  },
  {
    id: 'scrolling',
    title: 'Just keep reading',
    body: 'Chapters flow straight into the next one as you scroll. No page turns.',
  },

  // ── Windows ──────────────────────────────────────────────────────────────
  {
    id: 'edge-window',
    skipIf: () => get(windowStore).length >= MAX_WINDOWS || !freeEdge(),
    onEnter: (ctx) => {
      ctx.tour.windowEdge = freeEdge();
      ctx.tour.windowIdsBefore = get(windowStore).map((w) => w.id);
    },
    lane: (ctx) => (ctx.tour.windowEdge ? edgeLane(ctx.tour.windowEdge) : null),
    doneWhen: (ctx) => {
      const added = get(windowStore).find((w) => !ctx.tour.windowIdsBefore.includes(w.id));
      if (added) ctx.tour.windowId = added.id;
      return !!added;
    },
    title: 'Slide out a window',
    body: (ctx) =>
      `Put your finger on the glowing edge and drag ${dirWord(ctx.tour.windowEdge ?? 'right')}. A window slides out: a second Bible, notes, a map, commentary and more.`,
  },
  {
    id: 'window-tiles',
    target: (ctx) => windowElement(ctx.tour.windowId),
    skipIf: (ctx) => !windowElement(ctx.tour.windowId),
    doneWhen: (ctx) => {
      const win = get(windowStore).find((w) => w.id === ctx.tour.windowId);
      return !win || win.contentType !== 'selector';
    },
    pad: 0,
    title: 'Choose what goes in it',
    body: 'Tap any tile.',
  },
  {
    id: 'window-header',
    target: (ctx) => windowElement(ctx.tour.windowId)?.querySelector('.panel-header') ?? null,
    skipIf: (ctx) => !windowElement(ctx.tour.windowId),
    passThrough: false,
    title: 'Resize, move, close',
    body: 'Drag this bar to resize the window. The arrows dock it to another edge, and × closes it.',
  },

  // ── Tools ────────────────────────────────────────────────────────────────
  {
    id: 'tool-search',
    target: () => inMainReader('.pill-search-icon-btn'),
    reveal: true,
    passThrough: false,
    title: 'Search',
    body: 'Search the Bible, your notes and journal, people, the encyclopedia and the commentaries, all at once.',
  },
  {
    id: 'tool-plans',
    target: () => inMainReader('.pill-readingplan'),
    reveal: true,
    passThrough: false,
    title: 'Reading plans',
    body: 'Pick a plan (a year, the Gospels, chronological) and tick off each day as you go.',
  },
  {
    id: 'tool-profile',
    target: () => inMainReader('.pill-profile'),
    reveal: true,
    passThrough: false,
    title: 'Your account',
    body: 'Sign in to keep notes, highlights, your journal and plans in step across devices. Entirely optional.',
  },
  {
    id: 'part-one-end',
    title: 'That’s the basics',
    body: (ctx) =>
      get(installAllState).running
        ? 'We’ll show you the rest once your packs are in. Keep reading; the lime chip at the bottom shows how it’s going.'
        : ctx.tour.packsDeclined
          ? 'Whenever you’re ready, packs live in Settings → Storage & Updates → Manage Packs.'
          : 'Keep reading. There’s more to show you.',
    nextLabel: 'Keep reading',
  },
];
