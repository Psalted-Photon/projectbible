/**
 * The Bubble view (BubbleView.svelte): whether it is open, and the ways in
 * and out of it.
 *
 * It opens full screen under the main reader's navbar, so the Repeat tabs and
 * their menus still work over it. Every English Repeat lights up on it, so
 * lighting a word is making it a Repeat (showOnBubbles).
 *
 * Leaving for a verse (goFromBubbles) leaves a Bubbles crumb in the main
 * reader's trail carrying where the view stood, and walking that crumb back
 * opens it again at the same zoom. Leaving by the trail while it is open does
 * the same, through the screen surface registered here. Any other jump of
 * the reader to another book or chapter closes it, since the reader is what
 * you went to see.
 */

import { get, writable } from 'svelte/store';
import {
  availableTranslations,
  navigationStore,
  pendingRestore,
  registerScreenSurface,
} from './navigationStore';
import { normalizeRepeatWord, repeatsStore, type RepeatGroup, type RepeatOrigin } from './repeatsStore';
import { showNotice } from './noticeStore';
import { MAX_REPEAT_GROUPS } from '../lib/repeatColors';
import { FILLER_WORDS } from '../lib/fillerWords';
import { DEFAULT_TRANSLATION, normalizeBookName } from '../lib/bibleData';
import { convertRef } from '../lib/versification';
import { translationForJump } from '../lib/testamentDefaults';
import { isOriginalLanguage } from '../lib/translationKind';
import { versesWithWord } from '../lib/search/searchClient';
import type { ZoomSpot } from '../lib/bookPicture/bubbleScene';

/** A verse shown on the card at the bottom, numbered as the map numbers it (the NET's). */
export interface BubbleCard {
  book: string;
  chapter: number;
  verse: number;
}

export interface BubbleViewState {
  open: boolean;
  /** Where to stand on opening: a crumb's zoom. Null fits the whole map. */
  spot: ZoomSpot | null;
  /** The verse card to show again. */
  card: BubbleCard | null;
  /** Bumped on every open. */
  opened: number;
}

export const bubbleView = writable<BubbleViewState>({ open: false, spot: null, card: null, opened: 0 });

export function openBubbles(opts: { spot?: ZoomSpot | null; card?: BubbleCard | null } = {}): void {
  bubbleView.update((s) => ({ open: true, spot: opts.spot ?? null, card: opts.card ?? null, opened: s.opened + 1 }));
}

export function closeBubbles(): void {
  bubbleView.update((s) => (s.open ? { ...s, open: false } : s));
}

/** What a Bubbles crumb carries. */
interface BubblesOrigin {
  surface: 'bubbles';
  spot: ZoomSpot | null;
  card: BubbleCard | null;
}

/** The open view's own account of where it stands. */
let readView: (() => { spot: ZoomSpot | null; card: BubbleCard | null }) | null = null;

export function registerBubbleView(read: () => { spot: ZoomSpot | null; card: BubbleCard | null }): () => void {
  readView = read;
  return () => {
    if (readView === read) readView = null;
  };
}

function origin(): BubblesOrigin {
  const now = readView?.() ?? { spot: null, card: null };
  return { surface: 'bubbles', spot: now.spot, card: now.card };
}

/** The translation the Bubbles find lit words in: the one being read, or the NET under Greek and Hebrew. */
export function bubbleTranslation(reading: string): string {
  return isOriginalLanguage(reading) ? DEFAULT_TRANSLATION : reading;
}

/**
 * Close the Bubbles and take the main reader to a verse, leaving a Bubbles
 * crumb to come back by. The verse is in `fromTranslation`'s numbering and
 * is put into the numbering of the text the reader lands in.
 */
export function goFromBubbles(book: string, chapter: number, verse: number, fromTranslation = 'net'): void {
  const state = get(navigationStore);
  navigationStore.pushHistory(state, 'bubbles', origin());
  closeBubbles();
  const normalized = normalizeBookName(book);
  const landIn = translationForJump(state.translation, state.book, normalized, get(availableTranslations));
  const mapped = convertRef(fromTranslation, landIn, { book: normalized, chapter, verse })[0];
  navigationStore.navigateTo(state.translation, normalized, mapped?.chapter ?? chapter, mapped?.verse ?? verse);
}

/**
 * Light a word on the Bubbles: it becomes a Repeat (unless it is one
 * already) and the Bubbles open. Filler words are refused the way Repeats
 * refuses to list them, and an eighth word asks for one to come off the tabs
 * first. Returns whether it opened.
 */
export function showOnBubbles(label: string, from: RepeatOrigin = {}): boolean {
  if (!makeRepeat(label, from)) return false;
  closeWordCloud();
  if (!get(bubbleView).open) openBubbles();
  return true;
}

/**
 * The word as a Repeat: the one already on the tabs, or a new one. Null,
 * with a notice saying why, for a filler word or an eighth word.
 */
export function makeRepeat(label: string, from: RepeatOrigin = {}): RepeatGroup | null {
  const shown = label.trim();
  const word = normalizeRepeatWord(shown);
  if (!word) return null;
  if (FILLER_WORDS.has(word)) {
    void refuseFiller(shown, word);
    return null;
  }
  const groups = get(repeatsStore);
  const had = groups.find((g) => g.word === word);
  if (had) return had;
  if (groups.length >= MAX_REPEAT_GROUPS) {
    showNotice(`${MAX_REPEAT_GROUPS} words are lit, the most at once. Remove one from the tabs first.`, 'info');
    return null;
  }
  return repeatsStore.add(shown, from);
}

// ── The full-screen word cloud ──────────────────────────────────────────────

export interface WordCloudOpen {
  book: string;
  /** The translation of the reader it was opened from; its verse lists use it. */
  translation: string;
  /** Take that reader to a verse, numbered as `from` numbers it, leaving a crumb. */
  leave: (book: string, chapter: number, verse: number, from: string) => void;
}

/** WordCloudView, open over everything for one book, or null. */
export const wordCloudView = writable<WordCloudOpen | null>(null);

export function openWordCloud(o: WordCloudOpen): void {
  wordCloudView.set(o);
}

export function closeWordCloud(): void {
  if (get(wordCloudView)) wordCloudView.set(null);
}

/** "Too common to list", with how many verses it is in when the word lists can say. */
async function refuseFiller(label: string, word: string): Promise<void> {
  const found = await versesWithWord(bubbleTranslation(get(navigationStore).translation), word).catch(() => null);
  const n = found?.total ?? 0;
  const roughly = n >= 1000 ? `${(Math.floor(n / 1000) * 1000).toLocaleString()}+` : n.toLocaleString();
  showNotice(n ? `Too common to list (‘${label}’ is in ${roughly} verses)` : `Too common to list (‘${label}’)`, 'info');
}

// ── Crumbs ──────────────────────────────────────────────────────────────────

// Walking a Bubbles crumb back opens the view where it stood.
pendingRestore.subscribe((pending) => {
  const o = pending as BubblesOrigin | null;
  if (o?.surface !== 'bubbles') return;
  queueMicrotask(() => {
    if (get(pendingRestore) !== pending) return;
    pendingRestore.set(null);
    openBubbles({ spot: o.spot ?? null, card: o.card ?? null });
  });
});

// Leaving by the trail while it is open: the crumb left behind brings it back.
// Above the search results, which sit under it.
registerScreenSurface({
  priority: 3,
  capture: () => (get(bubbleView).open ? { kind: 'bubbles', origin: origin() } : null),
  close: closeBubbles,
});

// Any other jump to another book or chapter shows the reader. A moment after
// opening is left alone: the reader may still be settling where a crumb put it.
let openedAt = 0;
let seen = { book: '', chapter: 0 };
bubbleView.subscribe((s) => {
  if (s.open) {
    openedAt = performance.now();
    const nav = get(navigationStore);
    seen = { book: nav.book, chapter: nav.chapter };
  }
});
navigationStore.subscribe((nav) => {
  if (!get(bubbleView).open) return;
  if (nav.book === seen.book && nav.chapter === seen.chapter) return;
  seen = { book: nav.book, chapter: nav.chapter };
  if (performance.now() - openedAt > 1500) closeBubbles();
});
