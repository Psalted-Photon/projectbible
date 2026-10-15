/**
 * What kind of text a translation id names: Greek, Hebrew, or English.
 *
 * One answer for the whole app. Ids arrive in either case — bundled packs use
 * uppercase (WLC, BYZ, TR, LXX), the consolidated ancient-languages pack uses
 * lowercase (hebrew-oshb, byz, tr, lxx) — so every test here ignores case.
 */

/** Texts in the original languages, with per-word morphology. */
export const ORIGINAL_LANGUAGE_IDS = ['wlc', 'lxx', 'byz', 'tr', 'sblgnt', 'hebrew-oshb'] as const;

const ORIGINAL = new Set<string>(ORIGINAL_LANGUAGE_IDS);
const GREEK = new Set(['lxx', 'byz', 'tr', 'sblgnt']);

/** English translations the app ships. lxx2012 is the English Septuagint. */
const ENGLISH = new Set(['kjv', 'web', 'bsb', 'net', 'lxx2012']);

function norm(translationId: string | null | undefined): string {
  return (translationId || '').toLowerCase();
}

export function isOriginalLanguage(translationId: string | null | undefined): boolean {
  return ORIGINAL.has(norm(translationId));
}

/**
 * The script a text is written in, or null for anything that isn't Greek or
 * Hebrew. Hebrew also takes in any id naming itself Hebrew, so an imported
 * Hebrew text still reads right to left.
 */
export function originalLanguageOf(translationId: string | null | undefined): 'greek' | 'hebrew' | null {
  const id = norm(translationId);
  if (GREEK.has(id)) return 'greek';
  if (id === 'wlc' || id === 'hebrew-oshb' || id.includes('hebrew')) return 'hebrew';
  return null;
}

export function isHebrewText(translationId: string | null | undefined): boolean {
  return originalLanguageOf(translationId) === 'hebrew';
}

export function isEnglishTranslation(translationId: string | null | undefined): boolean {
  return ENGLISH.has(norm(translationId));
}
