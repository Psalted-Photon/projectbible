/**
 * Read Aloud voice catalog + shared types.
 *
 * Deliberately dependency-free: the main thread (settings, packs, player UI)
 * imports voice metadata from here WITHOUT pulling in the synthesis engine
 * (onnxruntime-web + phonemizer live in piperEngine.ts, worker-only).
 */

/** Language a voice was actually trained on — not the language it can be asked to read. */
export type TtsVoiceLang = 'en' | 'el';

export interface TtsVoiceInfo {
  id: string;
  label: string;
  quality: 'standard' | 'compact' | 'custom';
  approxSizeMB: number;
  lang: TtsVoiceLang;
  /**
   * Output rate of the model. Clips of different rates cannot share a stitched
   * segment, so the reading engine needs this before it synthesizes anything.
   */
  sampleRate: number;

  /** Built-in voices: path under the rhasspy/piper-voices HF repo. */
  path?: string;
  /** Hosted custom voices: full URLs to the .onnx and its .json config. */
  modelUrl?: string;
  configUrl?: string;
  /** True for user-added voices (from a file or a hosted URL). */
  custom?: boolean;
}

/** Built-in voices shipped with the app. A cloned voice is added at runtime. */
export const TTS_VOICES: TtsVoiceInfo[] = [
  {
    id: 'en_US-lessac-medium',
    label: 'Standard (US English)',
    quality: 'standard',
    approxSizeMB: 64,
    lang: 'en',
    sampleRate: 22050,
    path: 'en/en_US/lessac/medium/en_US-lessac-medium.onnx',
  },
  {
    id: 'en_US-lessac-low',
    label: 'Compact (US English)',
    quality: 'compact',
    approxSizeMB: 30,
    lang: 'en',
    sampleRate: 16000,
    path: 'en/en_US/lessac/low/en_US-lessac-low.onnx',
  },
  {
    // The only permissively-licensed Greek voice on piper-voices (dataset is
    // CC0). The other el_GR voice, "joy", is CC BY-NC and cannot be shipped.
    id: 'el_GR-rapunzelina-medium',
    label: 'Greek (Ελληνικά)',
    quality: 'standard',
    approxSizeMB: 60,
    lang: 'el',
    sampleRate: 22050,
    path: 'el/el_GR/rapunzelina/medium/el_GR-rapunzelina-medium.onnx',
  },
];

export const GREEK_VOICE_ID = 'el_GR-rapunzelina-medium';

/**
 * How to read Greek aloud.
 *
 * "modern" is the pronunciation the Greek Orthodox church has used to read the
 * New Testament continuously since antiquity; "reconstructed" is the Erasmian
 * scheme taught in most seminaries. Neither is a fallback for the other.
 */
export type GreekPronunciation = 'modern' | 'reconstructed';

/** A voice plus the pronunciation to drive it with. */
export interface SpeechRoute {
  voiceId: string;
  /** espeak-ng language code handed to the phonemizer. */
  espeakVoice: string;
  /** Phoneme rewrites applied before the voice sees them (see below). */
  substitutions: Record<string, string>;
}

/**
 * Pick the voice and pronunciation for Greek text.
 *
 * Both pronunciations use the Greek voice. Reconstructed Koine used to be
 * voiced by the English model, on the theory that it had the ancient-only
 * sounds Modern Greek lacks — but that cost a real chi, which English cannot
 * make at all, and it left two different voices in play for one language.
 * Folding the ancient-only sounds onto Greek ones the voice actually knows
 * keeps the Erasmian character (eta as "ay", alpha-iota as "eye", hard g,
 * rough breathing) and gets chi back.
 *
 * Substitutions match ONE symbol at a time: espeak emits "ɛ" and "ː" as
 * separate entries, so a multi-character key like "ɛː" silently matches
 * nothing. Map the length mark away on its own instead.
 */
const KOINE_FOLD: Record<string, string> = {
  ː: '',  // ː — drop vowel length; Greek has no long/short contrast
  ɛ: 'e', // ɛ → e
  ɪ: 'i', // ɪ → i
  ʊ: 'u', // ʊ → u
  y: 'i',      // upsilon, the front rounded vowel Modern Greek lost
};

export function resolveGreekRoute(pronunciation: GreekPronunciation): SpeechRoute {
  if (pronunciation === 'reconstructed') {
    return { voiceId: GREEK_VOICE_ID, espeakVoice: 'grc', substitutions: KOINE_FOLD };
  }
  return { voiceId: GREEK_VOICE_ID, espeakVoice: 'el', substitutions: {} };
}

const HF_VOICE_BASE = 'https://huggingface.co/rhasspy/piper-voices/resolve/main';

/**
 * Where a voice's model + config can be downloaded from, or null when the
 * voice can only arrive via local file install (no remote source).
 */
export function resolveVoiceSource(
  info: TtsVoiceInfo
): { modelUrl: string; configUrl: string } | null {
  if (info.modelUrl && info.configUrl) {
    return { modelUrl: info.modelUrl, configUrl: info.configUrl };
  }
  if (info.path) {
    return { modelUrl: `${HF_VOICE_BASE}/${info.path}`, configUrl: `${HF_VOICE_BASE}/${info.path}.json` };
  }
  return null;
}

/** OPFS filenames are keyed by voice id (stable across built-in and custom). */
export function voiceModelName(voiceId: string): string {
  return `${voiceId}.onnx`;
}
export function voiceConfigName(voiceId: string): string {
  return `${voiceId}.onnx.json`;
}

export type TtsProgress = { loaded: number; total: number };
export type TtsProgressCallback = (progress: TtsProgress) => void;
export type TtsSource = { modelUrl: string; configUrl: string };

export class TtsError extends Error {
  constructor(
    public code: 'VOICE_NOT_INSTALLED' | 'UNKNOWN_VOICE' | 'SYNTH_FAILED',
    message: string
  ) {
    super(message);
    this.name = 'TtsError';
  }
}
