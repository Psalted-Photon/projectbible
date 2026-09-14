/**
 * The guided tour's second half: what the packs switched on.
 *
 * Runs once Install All has finished and the app has restarted (or straight
 * after the first half, for someone who passed on the packs). Each section
 * checks for the pack it needs and quietly leaves itself out when it is
 * missing, so nobody is asked to tap Define with no dictionary behind it.
 * It ends on the Settings gear, where Tutorial Mode is turned off.
 */

import { get } from 'svelte/store';
import type { TourStep, StepContext } from './types';
import {
  find,
  inMainReader,
  nearestInMainReader,
  comfortablyOnScreen,
  boxOf,
  hasSize,
} from '../engine/targets';
import { tutorial } from '../state';
import { navigationStore, availableTranslations } from '../../stores/navigationStore';
import { normalizeBookName } from '../../lib/bibleData';
import { isReadingActive } from '../../lib/tts/readingEngine';
import { packInstallFinished } from '../../adapters/db-manager';
import { installAll, packsStillToInstall, voicesStillToInstall } from '../../lib/packInstaller';

/** Is this pack installed? Asked once per tour run. */
async function hasPack(ctx: StepContext, id: string): Promise<boolean> {
  ctx.tour.packs ??= {};
  if (ctx.tour.packs[id] === undefined) ctx.tour.packs[id] = await packInstallFinished(id);
  return ctx.tour.packs[id];
}

/** The answer `hasPack` already found, for card text that can't wait. */
function knownPack(ctx: StepContext, id: string): boolean {
  return ctx.tour.packs?.[id] === true;
}

async function missingInstalls(ctx: StepContext): Promise<number> {
  if (ctx.tour.missing === undefined) {
    const [packs, voices] = await Promise.all([packsStillToInstall(), voicesStillToInstall()]);
    ctx.tour.missing = packs.length + voices.length;
  }
  return ctx.tour.missing;
}

/** The chapter the main reader is on. */
function currentSection(): HTMLElement | null {
  const { book, chapter } = get(navigationStore);
  return document.querySelector<HTMLElement>(
    `.main-content .chapter-section[data-book="${CSS.escape(normalizeBookName(book))}"][data-chapter="${chapter}"]`,
  );
}

/** A dropdown together with the button that opened it, so a second tap on the button can close it. */
function withTrigger(trigger: string, dropdown: string): Element[] | null {
  const list = inMainReader(dropdown);
  if (!list) return null;
  const button = inMainReader(trigger);
  return button ? [button, list] : [list];
}

/** Close a navbar dropdown the tour opened, if it is still open. */
function closeDropdown(trigger: string, dropdown: string): void {
  if (inMainReader(dropdown)) inMainReader(trigger)?.click();
}

const TRANSLATION_BUTTON = '.translation-dropdown-trigger .pill-btn';
const TRANSLATION_LIST = '.translation-dropdown.positioned';
const COMMENTARY_BUTTON = '.pill-comm';
const COMMENTARY_LIST = '.comm-dropdown.positioned';

/**
 * A verse to tap a word in. The one picked stays picked while it is still on
 * screen, so the spotlight doesn't hop between verses as the text settles.
 */
function verseToTap(ctx: StepContext): HTMLElement | null {
  const kept = ctx.tour.verse as HTMLElement | undefined;
  if (kept?.isConnected && hasSize(kept) && comfortablyOnScreen(boxOf(kept))) return kept;
  ctx.tour.verse = nearestInMainReader('.verse-text');
  return ctx.tour.verse;
}

/** The tap-a-word ring (or the classic toolbar, for people who chose that). */
function ring(): HTMLElement | null {
  return inMainReader('.toast');
}

function annotationPanel(): HTMLElement | null {
  return find('.annotation-panel.open');
}

function selectedAuthors(): string[] {
  return get(navigationStore).selectedCommentaryAuthors ?? [];
}

/** The commentary badges beside the verse nearest to where the person is reading. */
function badgesNearby(): Element[] | null {
  const first = nearestInMainReader('.anno-icon');
  if (!first) return null;
  const gutter = first.closest('.verse-gutter');
  return gutter ? Array.from(gutter.querySelectorAll('.anno-icon')).filter(hasSize) : [first];
}

function readAloudButton(): HTMLElement | null {
  const own = currentSection()?.querySelector<HTMLElement>('.tts-player');
  return own && hasSize(own) ? own : nearestInMainReader('.tts-player');
}

function ringBody(ctx: StepContext): string {
  const dictionary = knownPack(ctx, 'dictionary-en');
  const people = knownPack(ctx, 'people-biblical-v1');
  const encyclopedia = knownPack(ctx, 'encyclotopical');
  const lookup = !dictionary
    ? ''
    : people && encyclopedia
      ? 'Define looks the word up. On a person it becomes Bio, and on a place or topic Info, with Map beside it. '
      : 'Define looks the word up. ';
  return `${lookup}Mark highlights, Notes adds a note, Share sends the verse, and Verse selects the whole verse.`;
}

export const PART_TWO: TourStep[] = [
  {
    id: 'part-two-intro',
    checkpoint: true,
    onEnter: async (ctx) => {
      await missingInstalls(ctx);
    },
    title: (ctx) => (ctx.tour.missing ? 'A few packs aren’t in' : 'Your packs are in'),
    body: (ctx) =>
      ctx.tour.missing
        ? 'Anything below that needs a missing pack gets skipped. Install the rest now (Wi-Fi is best), or later from Settings → Storage & Updates → Manage Packs.'
        : 'Here’s what they switched on: more translations, the word ring, commentary, cross-references and Read Aloud.',
    nextLabel: 'Let’s go',
    alt: {
      label: 'Install now',
      when: (ctx) => ctx.tour.missing > 0,
      run: () => {
        void installAll();
        tutorial.setStage('waiting');
      },
    },
  },

  // ── Translations ─────────────────────────────────────────────────────────
  {
    id: 'translations',
    checkpoint: true,
    target: () => inMainReader(TRANSLATION_BUTTON),
    reveal: true,
    skipIf: () => get(availableTranslations).length < 2,
    doneWhen: () => !!inMainReader(TRANSLATION_LIST),
    title: 'Translations',
    body: 'Tap here to switch Bibles.',
  },
  {
    id: 'translation-list',
    target: () => withTrigger(TRANSLATION_BUTTON, TRANSLATION_LIST),
    pad: 2,
    skipIf: () => !inMainReader(TRANSLATION_LIST),
    doneWhen: () => !inMainReader(TRANSLATION_LIST),
    onLeave: () => closeDropdown(TRANSLATION_BUTTON, TRANSLATION_LIST),
    title: 'Pick one',
    body: 'Tap a translation to read in it. Every window can read a different one.',
    nextLabel: 'Done',
  },

  // ── The word ring ────────────────────────────────────────────────────────
  {
    id: 'tap-word',
    checkpoint: true,
    onEnter: async (ctx) => {
      await Promise.all(
        ['dictionary-en', 'people-biblical-v1', 'encyclotopical'].map((id) => hasPack(ctx, id)),
      );
    },
    target: verseToTap,
    reveal: 'center',
    doneWhen: () => !!ring(),
    title: 'Tap a word',
    body: 'Tap any word in this verse.',
  },
  {
    id: 'ring',
    target: ring,
    pad: 4,
    skipIf: () => !ring(),
    doneWhen: () => !ring(),
    title: 'The word ring',
    body: ringBody,
  },
  {
    id: 'ring-close',
    // The whole reader is the hole: a tap anywhere on the page closes the ring.
    target: () => inMainReader('.bible-reader'),
    pad: -6,
    skipIf: () => !ring(),
    doneWhen: () => !ring(),
    title: 'Closing it',
    body: 'Tap anywhere on the page to close the ring.',
  },

  // ── Commentary ───────────────────────────────────────────────────────────
  {
    id: 'commentary',
    checkpoint: true,
    target: () => inMainReader(COMMENTARY_BUTTON),
    reveal: true,
    skipIf: async (ctx) => !(await hasPack(ctx, 'commentaries')) || selectedAuthors().length > 0,
    doneWhen: () => !!inMainReader(COMMENTARY_LIST),
    title: 'Commentary',
    body: 'Tap here to choose commentators to read alongside the text.',
  },
  {
    id: 'commentary-list',
    target: () => withTrigger(COMMENTARY_BUTTON, COMMENTARY_LIST),
    pad: 2,
    skipIf: () => !inMainReader(COMMENTARY_LIST),
    doneWhen: () => !inMainReader(COMMENTARY_LIST),
    onLeave: () => closeDropdown(COMMENTARY_BUTTON, COMMENTARY_LIST),
    title: 'Pick a few',
    body: 'Tick the commentators you want. Each one has its own color.',
    nextLabel: 'Done',
  },
  {
    id: 'commentary-badges',
    target: badgesNearby,
    reveal: 'center',
    waitMs: 5000,
    skipIf: async (ctx) => !(await hasPack(ctx, 'commentaries')) || selectedAuthors().length === 0,
    doneWhen: () => !!annotationPanel(),
    title: 'Commentary badges',
    body: () =>
      badgesNearby()
        ? 'A badge by a verse means that commentator wrote about it, in their color. Tap one to read it.'
        : 'Nobody you picked wrote on this chapter. Their badges show up by the verses they did write about.',
  },
  {
    id: 'commentary-panel',
    target: annotationPanel,
    pad: 0,
    allowOverlay: '.panel-backdrop',
    skipIf: () => !annotationPanel(),
    doneWhen: () => !annotationPanel(),
    title: 'What they said',
    body: 'The tabs switch between commentary and cross-references. Tap ✕ to close.',
  },

  // ── Cross-references ─────────────────────────────────────────────────────
  {
    id: 'cross-references',
    checkpoint: true,
    target: () => inMainReader('.pill-refs'),
    reveal: true,
    skipIf: async (ctx) =>
      !(await hasPack(ctx, 'tsk-references')) || !!get(navigationStore).showReferences,
    doneWhen: () => !!get(navigationStore).showReferences,
    title: 'Cross-references',
    body: 'Tap to show cross-references: the other passages each verse echoes.',
  },
  {
    id: 'cross-reference-markers',
    target: () => nearestInMainReader('.anno-ref'),
    reveal: 'center',
    pad: 10,
    waitMs: 5000,
    skipIf: async (ctx) =>
      !(await hasPack(ctx, 'tsk-references')) || !get(navigationStore).showReferences,
    doneWhen: () => !!annotationPanel(),
    title: 'The ◆ markers',
    body: () =>
      nearestInMainReader('.anno-ref')
        ? 'A ◆ by a verse opens the passages linked to it. Tap one.'
        : 'Each ◆ by a verse opens the passages linked to it. They show up once this chapter’s links load.',
  },
  {
    id: 'cross-reference-panel',
    target: annotationPanel,
    pad: 0,
    allowOverlay: '.panel-backdrop',
    skipIf: () => !annotationPanel(),
    doneWhen: () => !annotationPanel(),
    title: 'Linked passages',
    body: 'Tap one to preview it without losing your place. Tap ✕ to close.',
  },

  // ── Read Aloud ───────────────────────────────────────────────────────────
  {
    id: 'read-aloud',
    checkpoint: true,
    target: readAloudButton,
    reveal: 'center',
    pad: 8,
    skipIf: () => !inMainReader('.tts-player') || get(isReadingActive),
    doneWhen: () => get(isReadingActive),
    title: 'Read Aloud',
    body: 'Tap the talking head and Hexapla reads the chapter to you.',
  },
  {
    id: 'read-aloud-controls',
    target: () => inMainReader('.nav-tts'),
    reveal: true,
    skipIf: () => !get(isReadingActive),
    title: 'While it reads',
    body: 'The controls wait up here: pause, jump to a verse, stop, carry on into the next chapter, and a sleep timer.',
  },

  // ── Finale ───────────────────────────────────────────────────────────────
  {
    id: 'finale',
    checkpoint: true,
    target: () => inMainReader('.pill-settings'),
    reveal: true,
    passThrough: false,
    title: 'Glowing dots mark everything else',
    body: 'Tap a lime dot anytime to see what it does. When you don’t need them anymore, turn Tutorial Mode off in Settings → General.',
    nextLabel: 'Finish',
  },
];
