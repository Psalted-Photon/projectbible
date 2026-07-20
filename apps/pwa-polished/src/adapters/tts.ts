/**
 * TTS adapter — main-thread client for the Piper TTS worker.
 *
 * All synthesis runs in ttsWorker.ts (see src/lib/tts/). This module owns:
 *  - the worker lifecycle + id-correlated request/response bookkeeping
 *  - the single shared HTMLAudioElement used for all TTS playback
 *    (iOS only allows continued playback on an element that a user tap
 *    started, so every verse/chapter reuses this one element)
 */

import { TTS_VOICES, type TtsVoiceInfo, type TtsProgress } from '../lib/tts/voices.js';

export { TTS_VOICES };
export type { TtsVoiceInfo, TtsProgress };

export const DEFAULT_TTS_VOICE = 'en_US-lessac-medium';

type Pending = {
  resolve: (value: any) => void;
  reject: (err: Error) => void;
  onProgress?: (progress: TtsProgress) => void;
  timer?: ReturnType<typeof setTimeout>;
};

let worker: Worker | null = null;
let nextId = 1;
const pending = new Map<number, Pending>();

const SYNTH_TIMEOUT_MS = 120_000; // downloads get no timeout; synthesis does

export function isTtsSupported(): boolean {
  return (
    typeof Worker !== 'undefined' &&
    typeof navigator !== 'undefined' &&
    !!navigator.storage?.getDirectory
  );
}

function getWorker(): Worker {
  if (worker) return worker;
  worker = new Worker(new URL('../lib/tts/ttsWorker.ts', import.meta.url), { type: 'module' });
  worker.onmessage = (event) => {
    const { id, ok, result, error, code, progress } = event.data ?? {};
    const entry = pending.get(id);
    if (!entry) return;
    if (progress) {
      entry.onProgress?.(progress);
      return;
    }
    pending.delete(id);
    if (entry.timer) clearTimeout(entry.timer);
    if (ok) {
      entry.resolve(result);
    } else {
      const err = new Error(error ?? 'TTS worker error');
      (err as any).code = code;
      entry.reject(err);
    }
  };
  worker.onerror = (event) => {
    console.error('[TTS] Worker crashed:', event.message);
    for (const [id, entry] of pending) {
      if (entry.timer) clearTimeout(entry.timer);
      entry.reject(new Error(`TTS worker crashed: ${event.message}`));
      pending.delete(id);
    }
    worker?.terminate();
    worker = null; // next call spins up a fresh worker
  };
  return worker;
}

function call<T>(
  action: string,
  payload?: Record<string, unknown>,
  opts?: { onProgress?: (p: TtsProgress) => void; timeoutMs?: number }
): Promise<T> {
  const id = nextId++;
  return new Promise<T>((resolve, reject) => {
    const entry: Pending = { resolve, reject, onProgress: opts?.onProgress };
    if (opts?.timeoutMs) {
      entry.timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`TTS ${action} timed out after ${opts.timeoutMs}ms`));
      }, opts.timeoutMs);
    }
    pending.set(id, entry);
    getWorker().postMessage({ id, action, payload });
  });
}

// ─── public API ─────────────────────────────────────────────────────────────

export function storedVoices(): Promise<string[]> {
  return call<string[]>('stored');
}

export function isVoiceInstalled(voiceId: string): Promise<boolean> {
  return call<boolean>('installed', { voiceId });
}

export function downloadVoice(
  voiceId: string,
  onProgress?: (p: TtsProgress) => void
): Promise<void> {
  return call<void>('download', { voiceId }, { onProgress });
}

export function removeVoice(voiceId: string): Promise<void> {
  return call<void>('remove', { voiceId });
}

/** Synthesize one piece of text; resolves to a playable WAV blob. */
export async function synthesizeSpeech(text: string, voiceId: string): Promise<Blob> {
  const wav = await call<ArrayBuffer>(
    'synthesize',
    { text, voiceId },
    { timeoutMs: SYNTH_TIMEOUT_MS }
  );
  return new Blob([wav], { type: 'audio/wav' });
}

// ─── shared audio element (iOS autoplay workaround) ─────────────────────────

let sharedAudio: HTMLAudioElement | null = null;

export function getSharedTtsAudio(): HTMLAudioElement {
  if (!sharedAudio) {
    sharedAudio = new Audio();
    sharedAudio.preload = 'auto';
  }
  return sharedAudio;
}

/**
 * Call from inside a user tap before any async work. Playing a tiny silent
 * clip "unlocks" the shared element so later programmatic .play() calls
 * (next verse, next chapter) are allowed on iOS.
 */
export function unlockTtsAudio(): void {
  const audio = getSharedTtsAudio();
  if (audio.dataset.unlocked === 'true') return;
  audio.src = makeSilentWavUrl();
  audio.play().then(
    () => {
      audio.dataset.unlocked = 'true';
    },
    () => {
      // A later real play from a tap will unlock it instead.
    }
  );
}

let silentWavUrl: string | null = null;

function makeSilentWavUrl(): string {
  if (silentWavUrl) return silentWavUrl;
  const sampleRate = 22050;
  const samples = 220; // ~10ms of silence
  const view = new DataView(new ArrayBuffer(44 + samples * 2));
  view.setUint32(0, 0x46464952, true);
  view.setUint32(4, view.buffer.byteLength - 8, true);
  view.setUint32(8, 0x45564157, true);
  view.setUint32(12, 0x20746d66, true);
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  view.setUint32(36, 0x61746164, true);
  view.setUint32(40, samples * 2, true);
  silentWavUrl = URL.createObjectURL(new Blob([view.buffer], { type: 'audio/wav' }));
  return silentWavUrl;
}

// ─── dev console hook ───────────────────────────────────────────────────────

if (import.meta.env.DEV && typeof window !== 'undefined') {
  (window as any).__tts = {
    voices: TTS_VOICES,
    extractSpeechText: (text: string) =>
      import('../lib/verseRendering.js').then((m) => m.extractSpeechText(text)),
    stored: storedVoices,
    download: (id: string = DEFAULT_TTS_VOICE) =>
      downloadVoice(id, (p) =>
        console.log(`[TTS] download ${((100 * p.loaded) / (p.total || 1)).toFixed(0)}%`)
      ),
    remove: removeVoice,
    synthesize: synthesizeSpeech,
    speak: async (text: string, id: string = DEFAULT_TTS_VOICE) => {
      const t0 = performance.now();
      const blob = await synthesizeSpeech(text, id);
      console.log(`[TTS] synthesized in ${(performance.now() - t0).toFixed(0)}ms`);
      const audio = getSharedTtsAudio();
      audio.src = URL.createObjectURL(blob);
      await audio.play();
    },
  };
}
