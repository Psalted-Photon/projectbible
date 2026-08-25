/**
 * Speech text for original-language (Greek/Hebrew) reading.
 *
 * The counterpart to extractSpeechText() in verseRendering.ts, which prepares
 * ordinary translation prose. Original-language verses are not stored as prose:
 * the readable form lives per-word in the morphology cache, and the plain
 * `verses.text` in the pack is unusable here — the Greek there is unaccented
 * and lowercased, which makes espeak stress the wrong syllable (θˈeon rather
 * than θeˈon). The accented per-word text is the only correct source.
 *
 * Dependency-free on purpose, like voices.ts, so UI code can import it.
 */

/** The per-word fields this needs; a structural subset of DBMorphology. */
export interface SpeechWord {
  word_index?: number;
  wordPosition?: number;
  text: string;
}

/**
 * Original-language texts we can actually speak.
 *
 * Greek only, for now. Hebrew is missing for two separate reasons: espeak has
 * no working Hebrew letter-to-sound rules — it reads out the *names* of the
 * letters and points — and there is no permissively-licensed Hebrew voice to
 * read them with. The LXX is Greek but its pack ships no per-word rows at all,
 * and its verse text is lemmatized rather than running text, so it could only
 * ever produce silence.
 */
const SPEAKABLE = new Set(['byz', 'tr', 'sblgnt']);

/** True when this original-language text can be read aloud. */
export function canSpeakOriginal(translationId: string): boolean {
  return SPEAKABLE.has(translationId.toLowerCase());
}

/**
 * Hebrew cantillation (te'amim), plus meteg and rafe.
 *
 * Deliberately stops at U+05AF: U+05B0–U+05BC is the niqqud, and stripping that
 * would take the vowels with it — the pointing is the whole reason Biblical
 * Hebrew can be pronounced by rule at all.
 */
const HEBREW_MARKS = /[֑-ֽֿ֯]/g;

/**
 * One word, ready to speak.
 *
 * Greek needs no cleanup: the polytonic accents carry the stress and the
 * trailing punctuation shapes the phrasing, so both are kept as-is. Hebrew
 * needs the OSHB morpheme slashes removed (they are an editorial separator,
 * not a word break) and the cantillation stripped, since espeak has no rules
 * for those marks. The niqqud stays — it is what makes the vowels readable.
 */
export function speechWordText(text: string, language: string): string {
  if (language !== 'hebrew' && language !== 'aramaic') return text.trim();
  return text
    .replace(/\//g, '')
    .replace(HEBREW_MARKS, '')
    .replace(/ֺ/g, 'ֹ') // holam haser for vav → plain holam
    .replace(/־/g, ' ')      // maqaf joins two words; speak them apart
    .trim();
}

/** One verse of original-language text, words in order, ready to speak. */
export function originalSpeechText(words: SpeechWord[], language: string): string {
  return [...words]
    .sort((a, b) => wordIndex(a) - wordIndex(b))
    .map((w) => speechWordText(w.text ?? '', language))
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function wordIndex(word: SpeechWord): number {
  return word.word_index ?? word.wordPosition ?? 0;
}
