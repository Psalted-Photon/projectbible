/**
 * Read Aloud voice catalog + shared types.
 *
 * Deliberately dependency-free: the main thread (settings, packs, player UI)
 * imports voice metadata from here WITHOUT pulling in the synthesis engine
 * (onnxruntime-web + phonemizer live in piperEngine.ts, worker-only).
 */

/** Language a voice was actually trained on — not the language it can be asked to read. */
export type TtsVoiceLang = 'en' | 'el';

/**
 * Which model runs a voice. They differ in nearly every practical way:
 * Piper is one self-contained file per voice with its own config and phoneme
 * table; Kokoro is one large shared model plus a small style vector per voice,
 * with a single phoneme table for all of them.
 *
 * Absent means Piper — the voices already saved in localStorage predate this
 * field and are all Piper.
 */
export type TtsEngine = 'piper' | 'kokoro';

export interface TtsVoiceInfo {
  id: string;
  label: string;
  /** Defaults to 'piper' when absent. Read it through voiceEngine(). */
  engine?: TtsEngine;
  quality: 'standard' | 'compact' | 'custom';
  approxSizeMB: number;
  lang: TtsVoiceLang;
  /**
   * Output rate of the model. Clips of different rates cannot share a stitched
   * segment, so the reading engine needs this before it synthesizes anything.
   */
  sampleRate: number;

  /** Built-in Piper voices: path under the rhasspy/piper-voices HF repo. */
  path?: string;
  /** Hosted custom Piper voices: full URLs to the .onnx and its .json config. */
  modelUrl?: string;
  configUrl?: string;
  /** True for user-added voices (from a file or a hosted URL). Piper only. */
  custom?: boolean;

  /**
   * Kokoro only: the voice's style vector, e.g. "af_heart.bin". Half a megabyte
   * of numbers that shape the shared model into this particular voice.
   */
  styleFile?: string;
  /**
   * Kokoro only: which espeak language to phonemize with. US and UK voices need
   * different ones. Piper carries this inside its own config file instead.
   *
   * Distinct from SpeechRoute.espeakVoice, which is a per-utterance override for
   * Greek pronunciation and must never reach Kokoro.
   */
  phonemeVoice?: string;
}

/** Engine for a voice, treating the absent field as Piper. */
export function voiceEngine(info: TtsVoiceInfo): TtsEngine {
  return info.engine ?? 'piper';
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

// ─── Kokoro ─────────────────────────────────────────────────────────────────
// One 310 MB model shared by every Kokoro voice, plus ~510 KB of style vector
// each. So the first Kokoro voice is a large download and the second is almost
// free — the inverse of Piper, where each voice is its own 60 MB file.
//
// fp32 deliberately, despite being twice the size of fp16. Measured on an
// Adreno 740 (Galaxy Z Fold 5) on 28 Aug: fp16 produced sound in 0 of 4 clips,
// fp32 in 4 of 4. fp16 runs at full speed and reports normal timings — it just
// returns silence — so nothing errors and nothing warns. The int8 builds are
// worse still: their quantized operations fall back off the graphics chip one
// at a time.

const KOKORO_BASE = 'https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX/resolve/main';

export const KOKORO_MODEL_URL = `${KOKORO_BASE}/onnx/model.onnx`;
export const KOKORO_MODEL_MB = 310;
/** OPFS name for the one model every Kokoro voice shares. */
export const KOKORO_MODEL_FILE = 'kokoro-model.onnx';

function kokoro(
  id: string,
  label: string,
  phonemeVoice: 'en-us' | 'en-gb'
): TtsVoiceInfo {
  return {
    id,
    label,
    engine: 'kokoro',
    quality: 'standard',
    // The honest first-install cost. Phase 5 shows the real figure, which is
    // ~0.5 MB once the shared model is already present.
    approxSizeMB: KOKORO_MODEL_MB,
    lang: 'en',
    sampleRate: 24000,
    styleFile: `${id}.bin`,
    phonemeVoice,
  };
}

/**
 * A curated eight rather than all fifty-seven Kokoro ships: enough range to
 * pick a voice you like without turning the Settings dropdown into a list.
 * Adding more is a matter of appending here.
 *
 * Deliberately NOT merged into TTS_VOICES yet. Settings and Manage Packs both
 * build their lists from that array, so merging here would offer voices the
 * engine cannot yet synthesize. They join the list in Phase 7, once the engine
 * exists and the device check that hides them on unsupported hardware does too.
 */
export const KOKORO_VOICES: TtsVoiceInfo[] = [
  kokoro('af_heart', 'Heart (US, female)', 'en-us'),
  kokoro('af_bella', 'Bella (US, female)', 'en-us'),
  kokoro('af_nicole', 'Nicole (US, female)', 'en-us'),
  kokoro('am_michael', 'Michael (US, male)', 'en-us'),
  kokoro('am_fenrir', 'Fenrir (US, male)', 'en-us'),
  kokoro('am_puck', 'Puck (US, male)', 'en-us'),
  kokoro('bf_emma', 'Emma (UK, female)', 'en-gb'),
  kokoro('bm_george', 'George (UK, male)', 'en-gb'),
];

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
  // Sounds reconstructed Koine needs that this Modern-Greek voice never met.
  // Measured against 5,000 characters of NT text: the share of a Koine reading
  // each accounts for, against how often the voice heard it while training.
  'ː': '',   // ː  8.7% of Koine, 0.0% of Modern — drop vowel length
  'ɛ': 'e',  // ɛ  3.5% / 0.0%
  'ɔ': 'o',  // ɔ  2.2% / 0.0%
  'ɪ': 'i',  // ɪ  1.9% / 0.04%
  'ɡ': 'ɣ', // ɡ → ɣ  1.9% / 0.13%. Koine wants a hard g; Modern Greek's
                  // gamma is the fricative, so a hard g renders as weak breath.
  'ʊ': 'u',  // ʊ  1.2% / 0.0%
  y: 'i',         // upsilon, the front rounded vowel Modern Greek lost
  // Hard b is deliberately NOT folded: at 0.30% it is rare but audible, and
  // keeping it preserves a real Erasmian distinction (βίβλος as b, not v).
};

export function resolveGreekRoute(pronunciation: GreekPronunciation): SpeechRoute {
  if (pronunciation === 'reconstructed') {
    return { voiceId: GREEK_VOICE_ID, espeakVoice: 'grc', substitutions: KOINE_FOLD };
  }
  return { voiceId: GREEK_VOICE_ID, espeakVoice: 'el', substitutions: {} };
}

const HF_VOICE_BASE = 'https://huggingface.co/rhasspy/piper-voices/resolve/main';

/**
 * Where a voice's files can be downloaded from, or null when the voice can only
 * arrive via local file install (no remote source).
 *
 * The two engines fetch genuinely different things — Piper a model and its
 * config, Kokoro a shared model and a style vector — so this is a tagged union
 * rather than a common shape. Each engine narrows it and rejects the other's,
 * instead of quietly reading fields that happen to be missing.
 */
export function resolveVoiceSource(info: TtsVoiceInfo): TtsSource | null {
  if (voiceEngine(info) === 'kokoro') {
    if (!info.styleFile) return null;
    return {
      engine: 'kokoro',
      modelUrl: KOKORO_MODEL_URL,
      styleUrl: `${KOKORO_BASE}/voices/${info.styleFile}`,
    };
  }
  if (info.modelUrl && info.configUrl) {
    return { engine: 'piper', modelUrl: info.modelUrl, configUrl: info.configUrl };
  }
  if (info.path) {
    return {
      engine: 'piper',
      modelUrl: `${HF_VOICE_BASE}/${info.path}`,
      configUrl: `${HF_VOICE_BASE}/${info.path}.json`,
    };
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

/** Piper: one model file plus its own config, which carries the phoneme table. */
export type PiperSource = { engine: 'piper'; modelUrl: string; configUrl: string };
/** Kokoro: the shared model plus this voice's style vector. */
export type KokoroSource = { engine: 'kokoro'; modelUrl: string; styleUrl: string };
export type TtsSource = PiperSource | KokoroSource;

export class TtsError extends Error {
  constructor(
    public code: 'VOICE_NOT_INSTALLED' | 'UNKNOWN_VOICE' | 'SYNTH_FAILED',
    message: string
  ) {
    super(message);
    this.name = 'TtsError';
  }
}
