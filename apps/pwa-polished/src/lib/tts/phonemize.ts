/**
 * Text → sounds, via the bundled espeak-ng.
 *
 * Shared by both engines. They use the result differently — Piper takes the ids
 * espeak hands back, Kokoro re-derives its own from the symbols — but the
 * espeak call itself is identical, so it lives in one place.
 *
 * Runs inside ttsWorker.ts — do not import from the main thread.
 */

import { createPiperPhonemize } from './vendor/piper-phonemize.js';
import { ASSET_BASE } from './ttsRuntime.js';
import { moveNameStress } from './pronunciations.js';

export interface Phonemized {
  /** The sounds, as espeak's own symbols. */
  phonemes: string[];
  /** espeak's numbering. Piper uses these directly; Kokoro ignores them. */
  phonemeIds: number[];
  /** A name's stress was moved after espeak, so phonemeIds no longer match the sounds. */
  edited: boolean;
}

export async function phonemize(text: string, espeakVoice: string): Promise<Phonemized> {
  const input = JSON.stringify([{ text: text.trim() }]);
  return new Promise((resolve, reject) => {
    createPiperPhonemize({
      print: (msg) => {
        try {
          const parsed = JSON.parse(msg);
          const phonemes: string[] = parsed.phonemes ?? [];
          const sounds = phonemes.join('');
          const moved = moveNameStress(sounds, espeakVoice);
          const edited = moved !== sounds;
          resolve({ phonemes: edited ? [...moved] : phonemes, phonemeIds: parsed.phoneme_ids, edited });
        } catch {
          reject(new Error(`Unexpected phonemizer output: ${msg}`));
        }
      },
      printErr: (msg) => reject(new Error(`Phonemizer error: ${msg}`)),
      locateFile: (file) => `${ASSET_BASE}/${file}`,
    })
      .then((mod) => {
        mod.callMain(['-l', espeakVoice, '--input', input, '--espeak_data', '/espeak-ng-data']);
      })
      .catch(reject);
  });
}
