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
import { isInstalledApp, isIOS, isPhoneOrTablet } from '../../lib/device';
import { canInstall, promptInstall } from '../../lib/installPrompt';

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

/**
 * How this device can put Hexapla on its home screen.
 * - 'prompt'  Chrome handed us its install event; one tap does it.
 * - 'ios'     Safari never offers one; it is Share -> Add to Home Screen.
 * - 'menu'    An Android browser with no event: it is in the browser menu.
 * - 'none'    Already installed, or a desktop browser that will not offer it.
 */
function installRoute(): 'prompt' | 'ios' | 'menu' | 'none' {
  if (isInstalledApp()) return 'none';
  if (get(canInstall)) return 'prompt';
  if (isIOS()) return 'ios';
  // A desktop browser with no offer has nothing worth saying; a phone does.
  return isPhoneOrTablet() ? 'menu' : 'none';
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

  // ── Onto the home screen ─────────────────────────────────────
  // Before the packs, so a gigabyte of them lands in the installed app rather
  // than in a browser tab the person then abandons.
  {
    id: 'install-app',
    // Asked fresh each time rather than remembered in ctx.tour: the offer can
    // arrive or disappear while the step is up, and ctx.tour does not survive
    // a reload anyway.
    skipIf: () => installRoute() === 'none',
    title: 'Keep Hexapla on your screen',
    body: () => {
      const opening =
        'Hexapla can live on your home screen like any other app: it opens full screen, with no browser bar, and still works with no signal.';
      switch (installRoute()) {
        case 'ios':
          return `${opening} Tap the Share button at the bottom of Safari, then Add to Home Screen.`;
        case 'menu':
          return `${opening} Open your browser’s menu, then tap Install app or Add to Home screen.`;
        default:
          return opening;
      }
    },
    nextLabel: () => (installRoute() === 'prompt' ? 'Install' : 'Got it'),
    // The browser draws its own dialog over us and never says in time what was
    // chosen, so the tour moves on either way. An accepted install reopens in
    // the app window, where the tour resumes past this step -- which is right.
    onNext: () => {
      if (installRoute() === 'prompt') void promptInstall();
    },
    alt: {
      label: 'Not now',
      when: () => installRoute() === 'prompt',
      run: (ctx) => ctx.goTo('packs-ready'),
    },
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
    id: 'window-resize',
    // The grip runs along the window's inner edge, whichever side that is. Only
    // on a window docked at the bottom does it lie along the title bar.
    target: (ctx) => windowElement(ctx.tour.windowId)?.querySelector(':scope > .resize-handle') ?? null,
    skipIf: (ctx) => !windowElement(ctx.tour.windowId),
    title: 'Resize it',
    body: (ctx) => {
      const edge = get(windowStore).find((w) => w.id === ctx.tour.windowId)?.edge;
      switch (edge) {
        case 'bottom':
          return 'Drag the bar along its top up or down to make the window taller or shorter.';
        case 'top':
          return 'Drag its bottom edge up or down to make the window taller or shorter.';
        case 'left':
          return 'Drag its right edge sideways to make the window wider or narrower.';
        default:
          return 'Drag its left edge sideways to make the window wider or narrower.';
      }
    },
  },
  {
    id: 'window-header',
    target: (ctx) => windowElement(ctx.tour.windowId)?.querySelector('.panel-header') ?? null,
    skipIf: (ctx) => !windowElement(ctx.tour.windowId),
    passThrough: false,
    title: 'Move it, close it',
    body: 'The arrows dock the window to another side of the screen, and × closes it.',
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
