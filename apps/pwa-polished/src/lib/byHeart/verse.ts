/**
 * A saved By Heart verse, read for the screen: its card, its reference and
 * when it is next due. The row itself is stored by adapters/SyncedByHeartStore.
 */

import type { DBByHeartVerse } from '../../adapters/db';
import { localDateStr } from '../../stores/clockStore';
import { translationLabel } from '../bibleData';
import {
  applyLook,
  sanitizeStyle,
  type CardContent,
  type CardStyle,
  type Emphasis,
} from '../shareCard';
import { formatShareRef, type ShareRef } from '../shareText';

/** A painting behind the card. It is in the art pack, so only its id is kept. */
export interface SavedPainting {
  imageId: string;
  credit: string;
  zoom: number;
  panX: number;
  panY: number;
}

/** What a saved verse's `card` holds. */
export interface SavedCard {
  style: CardStyle;
  /** Word index (in the passage split on spaces) → emphasis. */
  emphasis: Record<number, Emphasis>;
  painting?: SavedPainting;
}

/** The card as saved, made safe to draw whatever build or device wrote it. */
export function savedCardOf(verse: Pick<DBByHeartVerse, 'card'>): SavedCard {
  const raw = (verse.card ?? {}) as Partial<SavedCard>;
  return {
    style: sanitizeStyle(raw.style),
    emphasis: raw.emphasis && typeof raw.emphasis === 'object' ? raw.emphasis : {},
    painting: raw.painting?.imageId ? raw.painting : undefined,
  };
}

/** The look to draw with: a picture this device doesn't have falls back to the background color. */
export function drawableStyle(card: SavedCard, hasImage: boolean): CardStyle {
  return applyLook(card.style, hasImage);
}

export function shareRefOf(verse: DBByHeartVerse): ShareRef {
  return {
    book: verse.book,
    chapter: verse.chapter,
    startVerse: verse.startVerse,
    endVerse: verse.endVerse,
    verses: verse.verses,
  };
}

/** "John 3:16", or "Psalm 119:1-40, part 2 of 5" for a long passage saved in parts. */
export function referenceOf(verse: DBByHeartVerse): string {
  const ref = formatShareRef(shareRefOf(verse));
  return verse.parts > 1 ? `${ref}, part ${verse.part} of ${verse.parts}` : ref;
}

/** What renderCard draws for this verse. */
export function cardContentOf(verse: DBByHeartVerse): CardContent {
  return {
    passage: verse.passage,
    reference: referenceOf(verse),
    translationLabel: translationLabel(verse.translation),
  };
}

/** Due today or before, or never recited yet. */
export function isDue(verse: DBByHeartVerse, today = localDateStr(new Date())): boolean {
  return verse.nextDate === null || verse.nextDate <= today;
}

/** The row's line on when it comes back. */
export function nextDateLabel(verse: DBByHeartVerse, today = localDateStr(new Date())): string {
  if (verse.nextDate === null) return 'New';
  if (verse.nextDate <= today) return 'Due today';
  const next = new Date(`${verse.nextDate}T12:00:00`);
  const tomorrow = new Date(`${today}T12:00:00`);
  tomorrow.setDate(tomorrow.getDate() + 1);
  if (localDateStr(tomorrow) === verse.nextDate) return 'Next: tomorrow';
  const sameYear = next.getFullYear() === tomorrow.getFullYear();
  return `Next: ${next.toLocaleDateString(undefined, { month: 'short', day: 'numeric', ...(sameYear ? {} : { year: 'numeric' }) })}`;
}
