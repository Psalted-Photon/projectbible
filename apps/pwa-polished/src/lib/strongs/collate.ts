/**
 * Sort keys for the Strong's list.
 *
 * Neither the pack nor the browser can sort these words properly by raw code
 * point: accented Greek sits in its own Unicode block after all plain Greek,
 * capitals split from lowercase, and Hebrew vowel points and final letters
 * sort ahead of or apart from the letters they belong to. So each word is
 * folded to bare letters first, the way a printed lexicon files it.
 */

const MARKS = /\p{M}/gu;

/** Several forms are filed under one number ("α, Ἀλφα"); the first is the headword. */
export function firstForm(lemma: string): string {
  return (lemma ?? '').split(',')[0].trim();
}

/** Accents and breathings off, lowercase, final sigma as sigma, letters only. */
export function greekKey(text: string): string {
  return text
    .normalize('NFKD')
    .replace(MARKS, '')
    .toLowerCase()
    .replace(/ς/g, 'σ')
    .replace(/[^α-ω]/g, '');
}

const FINALS: Record<string, string> = { ך: 'כ', ם: 'מ', ן: 'נ', ף: 'פ', ץ: 'צ' };

/**
 * Vowel points, accents and the shin/sin dot off, final letters as their
 * ordinary forms, letters only. Sin and shin then file together, as they do in
 * Strong's own order.
 */
export function hebrewKey(text: string): string {
  return text
    .normalize('NFKD')
    .replace(MARKS, '')
    .replace(/[ךםןףץ]/g, (c) => FINALS[c])
    .replace(/[^א-ת]/g, '');
}

/** Latin text folded for matching: accents off, lowercase. "agapē" → "agape". */
export function latinKey(text: string): string {
  return (text ?? '').normalize('NFKD').replace(MARKS, '').toLowerCase().trim();
}

/** A transliteration as one run of letters: "e.lo.him" → "elohim". */
export function translitKey(text: string): string {
  return latinKey(text).replace(/[^a-z]/g, '');
}

/**
 * Where an English gloss files. A qualifier in front is passed over — "(Mount)
 * Sinai" files under S — but brackets that are part of a name only lose their
 * brackets, so "(Beth)-ashbea" stays Beth-ashbea. A verb's "to" is passed over
 * too, so "to create" files under C.
 */
export function glossKey(gloss: string): string {
  return latinKey(gloss)
    .replace(/^\([^)]*\)\s+/, '')
    .replace(/[()]/g, '')
    .replace(/^to\s+/, '')
    .replace(/^[^a-z0-9]+/, '');
}

/** True when the text is written in Greek or Hebrew letters. */
export function isGreekText(text: string): boolean {
  return /[Ͱ-Ͽἀ-῿]/.test(text);
}

export function isHebrewText(text: string): boolean {
  return /[֐-׿יִ-ﭏ]/.test(text);
}
