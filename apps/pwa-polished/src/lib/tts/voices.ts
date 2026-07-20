/**
 * Read Aloud voice catalog + shared types.
 *
 * Deliberately dependency-free: the main thread (settings, packs, player UI)
 * imports voice metadata from here WITHOUT pulling in the synthesis engine
 * (onnxruntime-web + phonemizer live in piperEngine.ts, worker-only).
 */

export interface TtsVoiceInfo {
  id: string;
  label: string;
  quality: 'standard' | 'compact' | 'custom';
  approxSizeMB: number;

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
    path: 'en/en_US/lessac/medium/en_US-lessac-medium.onnx',
  },
  {
    id: 'en_US-lessac-low',
    label: 'Compact (US English)',
    quality: 'compact',
    approxSizeMB: 30,
    path: 'en/en_US/lessac/low/en_US-lessac-low.onnx',
  },
];

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
