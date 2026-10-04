/**
 * testamentDefaults.ts
 *
 * Settings → Reader's default Old and New Testament translations, and the one
 * rule that puts them to work: going to a book in the other testament lands
 * you in your default for it.
 *
 * "Going" means a jump — the book list, a link, search, a reading plan. Reading
 * straight on from Malachi into Matthew, by scrolling or Read Aloud, never
 * swaps the text out mid-flow. Within a testament a translation you picked
 * yourself stays put; the one exception is still reading in the *other*
 * testament's default, which is what that straight-on reading leaves you in,
 * so the next jump puts it right.
 *
 * Stored as dailyDriverEnglishOT/NT, names from an older design; the picker
 * lists every installed translation, original languages included. An empty
 * string is "Not set", kept as a value rather than removed so that unsetting
 * it syncs to the account's other devices like any other change.
 */

import { BIBLE_BOOKS, normalizeBookName } from './bibleData';
import { getSettings } from '../adapters/settings';

type Testament = 'OT' | 'NT';

const TESTAMENT = new Map<string, Testament>(BIBLE_BOOKS.map((b) => [b.name, b.testament]));

export function testamentOf(book: string): Testament | null {
  return TESTAMENT.get(normalizeBookName(book)) ?? null;
}

function defaultFor(testament: Testament): string {
  const s = getSettings();
  return (testament === 'OT' ? s.dailyDriverEnglishOT : s.dailyDriverEnglishNT) || '';
}

/** Your default for this book's testament, when one is set and installed here. */
export function defaultTranslationFor(book: string, installed: readonly string[]): string | null {
  const testament = testamentOf(book);
  if (!testament) return null;
  const pick = defaultFor(testament);
  return pick && installed.includes(pick) ? pick : null;
}

/** Which translation a jump from `fromBook` to `toBook` should land in. */
export function translationForJump(
  current: string,
  fromBook: string,
  toBook: string,
  installed: readonly string[],
): string {
  const to = testamentOf(toBook);
  const target = defaultTranslationFor(toBook, installed);
  if (!to || !target || target === current) return current;

  const crossing = testamentOf(fromBook) !== to;
  const otherDefault = defaultFor(to === 'OT' ? 'NT' : 'OT');
  const onOtherDefault = otherDefault !== '' && current === otherDefault;
  return crossing || onOtherDefault ? target : current;
}
