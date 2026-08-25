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
 * Every Piper voice shares one IPA symbol table, so any phoneme *maps* — but a
 * voice only ever trained embeddings for sounds in its own language. Handing it
 * an id it never saw yields an untrained embedding, which is noise rather than
 * an accent. That decides both pairings here:
 *
 *  - Modern Greek is the Greek voice's native language, so it needs no fixups.
 *  - Reconstructed Koine emits h, ɛː and uː, none of which exist in Modern
 *    Greek. The English voice has all of them and lacks only χ, which we remap
 *    to h — and an English-voiced Erasmian is what the classroom sounds like.
 */
export function resolveGreekRoute(
  pronunciation: GreekPronunciation,
  englishVoiceId: string
): SpeechRoute {
  if (pronunciation === 'reconstructed') {
    return { voiceId: englishVoiceId, espeakVoice: 'grc', substitutions: { x: 'h' } };
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
