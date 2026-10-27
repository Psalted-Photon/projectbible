/**
 * Where the Bible's Read Aloud player lives: docked in a reader's navbar, or
 * pulled out into a floating pill of its own (FloatingBiblePlayer.svelte).
 *
 * Two kinds of state, kept apart:
 *
 *   Saved   `bibleFloating` — once pulled out, the next reading shows the pill
 *           too, until it is docked back. Per device, in settings.
 *   Live    `dockDrag` — a drag that involves a bar: the tab being pulled out
 *           of one, or the pill being carried back to one. Only while a finger
 *           is down; nothing about it survives a reload.
 *
 * The reader whose bar is named in `dockDrag` holds that bar down for as long
 * as the drag lasts, so the slot or the tab never slides away under the
 * finger, and then puts it back the way it was.
 *
 * Only some bars carry the player at all — the main reader's, and a harmony
 * view's master. Each registers here while it does, so the pill knows which
 * bar to offer its slot in.
 */

import { writable, get } from 'svelte/store';
import { getBibleTtsFloating, setBibleTtsFloating } from '../../adapters/settings';

/** The main reader has no window id; every other bar goes by its own. */
export const MAIN_BAR = 'main';

export function playerBarKey(windowId: string | undefined | null): string {
  return windowId || MAIN_BAR;
}

// --- Saved -------------------------------------------------------------------

export const bibleFloating = writable<boolean>(getBibleTtsFloating());

export function setBibleFloating(floating: boolean): void {
  bibleFloating.set(floating);
  setBibleTtsFloating(floating);
}

// --- Live --------------------------------------------------------------------

export interface DockDrag {
  /** 'tear': the tab is being pulled and the player is still in the bar.
   *  'dock': the pill is being carried and the bar shows its empty slot. */
  mode: 'tear' | 'dock';
  /** Which bar, by playerBarKey. */
  bar: string;
  /** The pill is close enough to the slot that letting go docks it. */
  near: boolean;
}

export const dockDrag = writable<DockDrag | null>(null);

/** The bar the player was last pulled out of. Its slot is offered first. */
let originBar = MAIN_BAR;

export function setOriginBar(bar: string): void {
  originBar = bar;
}

// --- Bars that carry the player ----------------------------------------------

/** In the order they appeared, so the newest — the one on top — is last. */
export const playerBars = writable<string[]>([]);

/** A bar showing the player, until the returned function is called. */
export function registerPlayerBar(bar: string): () => void {
  playerBars.update((bars) => [...bars.filter((b) => b !== bar), bar]);
  return () => playerBars.update((bars) => bars.filter((b) => b !== bar));
}

/**
 * The bar the pill goes back to: the one it came from, or — that window has
 * closed since — the newest bar still carrying the player.
 */
export function homeBar(): string {
  const bars = get(playerBars);
  if (bars.includes(originBar)) return originBar;
  return bars[bars.length - 1] ?? MAIN_BAR;
}
