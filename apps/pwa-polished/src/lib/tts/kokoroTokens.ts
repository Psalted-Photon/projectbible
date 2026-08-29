/**
 * Turning espeak's phonemes into the numbers Kokoro expects.
 *
 * Deliberately dependency-free, like voices.ts: this is the part most likely to
 * be wrong, and keeping it free of onnxruntime and browser storage means it can
 * be checked against the real model from a plain script.
 *
 * Two differences from Piper, which are why this file exists at all:
 *
 *  - Piper ships a phoneme table inside every voice's config. Kokoro has one
 *    fixed table shared by all voices, so it lives here.
 *  - Piper wraps its ids as `^ _ p _ p _ … _ $`. Kokoro wants a plain run of
 *    ids with a single 0 at each end.
 */

/**
 * Kokoro's symbol table, copied from the model repo's tokenizer.json
 * (onnx-community/Kokoro-82M-v1.0-ONNX). Ids are sparse and deliberately so —
 * they are the model's own numbering, not an index into this list.
 */
export const KOKORO_VOCAB: Record<string, number> = {
  $: 0, ';': 1, ':': 2, ',': 3, '.': 4, '!': 5, '?': 6, '—': 9, '…': 10, '"': 11,
  '(': 12, ')': 13, '“': 14, '”': 15, ' ': 16, '̃': 17, ʣ: 18, ʥ: 19, ʦ: 20,
  ʨ: 21, ᵝ: 22, ꭧ: 23, A: 24, I: 25, O: 31, Q: 33, S: 35, T: 36, W: 39, Y: 41,
  ᵊ: 42, a: 43, b: 44, c: 45, d: 46, e: 47, f: 48, h: 50, i: 51, j: 52, k: 53,
  l: 54, m: 55, n: 56, o: 57, p: 58, q: 59, r: 60, s: 61, t: 62, u: 63, v: 64,
  w: 65, x: 66, y: 67, z: 68, ɑ: 69, ɐ: 70, ɒ: 71, æ: 72, β: 75, ɔ: 76, ɕ: 77,
  ç: 78, ɖ: 80, ð: 81, ʤ: 82, ə: 83, ɚ: 85, ɛ: 86, ɜ: 87, ɟ: 90, ɡ: 92, ɥ: 99,
  ɨ: 101, ɪ: 102, ʝ: 103, ɯ: 110, ɰ: 111, ŋ: 112, ɳ: 113, ɲ: 114, ɴ: 115,
  ø: 116, ɸ: 118, θ: 119, œ: 120, ɹ: 123, ɾ: 125, ɻ: 126, ʁ: 128, ɽ: 129,
  ʂ: 130, ʃ: 131, ʈ: 132, ʧ: 133, ʊ: 135, ʋ: 136, ʌ: 138, ɣ: 139, ɤ: 140,
  χ: 142, ʎ: 143, ʒ: 147, ʔ: 148, ˈ: 156, ˌ: 157, ː: 158, ʰ: 162, ʲ: 164,
  '↓': 169, '→': 171, '↗': 172, '↘': 173, ᵻ: 177,
};

/**
 * Sounds espeak writes one way and Kokoro was trained on another.
 *
 * Each is a symbol Kokoro either has no id for, or has an id for but never
 * heard during training, so leaving it alone would drop the sound or mangle it.
 * Matches what kokoro-js applies before tokenizing.
 */
export const KOKORO_FOLD: Record<string, string> = {
  ʲ: 'j', // palatalisation written as a modifier; Kokoro wants a plain glide
  r: 'ɹ', // espeak's tapped r for English; Kokoro learned the approximant
  x: 'k', // velar fricative English does not use — nearest sound it knows
  ɬ: 'l', // Welsh ll, not in Kokoro's table at all
};

/** Kokoro reads at most 510 sounds at once, plus the 0 at each end. */
export const KOKORO_TOKEN_LIMIT = 510;

/**
 * espeak phonemes → Kokoro token ids.
 *
 * Symbols with no id are dropped rather than substituted: a wrong sound is
 * worse than a missing one, and the caller can see the count differ.
 *
 * Returns the ids without the surrounding zeros — the caller adds those, since
 * the style vector is chosen by the *unpadded* length.
 */
export function phonemesToTokens(phonemes: string[]): {
  tokens: number[];
  dropped: string[];
} {
  const tokens: number[] = [];
  const dropped: string[] = [];

  for (const phoneme of phonemes) {
    // A phoneme from espeak can be more than one character (e.g. "tʃ"), and
    // Kokoro's table is per character, so fold and read each character.
    for (const ch of phoneme) {
      const folded = KOKORO_FOLD[ch] ?? ch;
      const id = KOKORO_VOCAB[folded];
      if (id === undefined) {
        dropped.push(ch);
        continue;
      }
      tokens.push(id);
    }
  }

  return { tokens, dropped };
}

/** The final id sequence handed to the model: a zero, the sounds, a zero. */
export function padTokens(tokens: number[]): number[] {
  return [0, ...tokens, 0];
}
