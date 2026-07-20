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
  quality: 'standard' | 'compact';
  approxSizeMB: number;
  path: string; // repo-relative path to the .onnx file
}

/** Voices offered by the app. A cloned voice later is just another entry. */
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

export type TtsProgress = { loaded: number; total: number };
export type TtsProgressCallback = (progress: TtsProgress) => void;

export class TtsError extends Error {
  constructor(
    public code: 'VOICE_NOT_INSTALLED' | 'UNKNOWN_VOICE' | 'SYNTH_FAILED',
    message: string
  ) {
    super(message);
    this.name = 'TtsError';
  }
}
