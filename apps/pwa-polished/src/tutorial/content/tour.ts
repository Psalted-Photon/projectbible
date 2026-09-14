/**
 * The guided tour's first half: everything that works before any packs.
 *
 * Packs come first because most of the app does nothing without them. The book
 * picker comes next, and teaches the book colours, because they carry through
 * the whole app. The half that needs packs -- the tap-a-word ring, commentary,
 * cross-references, Read Aloud -- runs once they are installed.
 */

import { get } from 'svelte/store';
import type { TourStep, StepContext } from './types';
import { slideOutWindowStep } from './steps';
import { find, inMainReader } from '../engine/targets';
import { paneOpen, anyPaneOpen } from '../engine/watch';
import { windowStore } from '../../lib/stores/windowStore';
import { navigationStore } from '../../stores/navigationStore';
import { BIBLE_BOOKS, CATEGORY_LABELS, normalizeBookName } from '../../lib/bibleData';
import {
  installAllState,
  packsStillToInstall,
  voicesStillToInstall,
} from '../../lib/packInstaller';

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
    checkpoint: true,
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
    checkpoint: true,
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
  { ...slideOutWindowStep('edge-window'), checkpoint: true },
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
    checkpoint: true,
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
