/**
 * TTS adapter — main-thread client for the Piper TTS worker.
 *
 * All synthesis runs in ttsWorker.ts (see src/lib/tts/). This module owns:
 *  - the worker lifecycle + id-correlated request/response bookkeeping
 *  - the single shared HTMLAudioElement used for all TTS playback
 *    (iOS only allows continued playback on an element that a user tap
 *    started, so every verse/chapter reuses this one element)
 */

import {
  TTS_VOICES,
  GREEK_VOICE_ID,
  resolveVoiceSource,
  resolveGreekRoute,
  type TtsVoiceInfo,
  type TtsProgress,
  type TtsSource,
  type SpeechRoute,
} from '../lib/tts/voices.js';
import { getTtsSettings } from './settings.js';

export { TTS_VOICES, GREEK_VOICE_ID };
export type { TtsVoiceInfo, TtsProgress, SpeechRoute };

export const DEFAULT_TTS_VOICE = 'en_US-lessac-medium';

/**
 * Which voice and pronunciation to use for Greek right now.
 *
 * Reconstructed Koine is voiced by an English model (see resolveGreekRoute),
 * so it borrows whichever English voice the user actually reads with — falling
 * back to the default if they have picked a non-English one.
 */
export function greekSpeechRoute(): SpeechRoute {
  const settings = getTtsSettings();
  const chosen = getVoiceInfo(settings.voiceId);
  const englishVoiceId =
    chosen && chosen.lang === 'en' ? settings.voiceId : DEFAULT_TTS_VOICE;
  return resolveGreekRoute(settings.greekPronunciation, englishVoiceId);
}

/** Output rate of a voice, for deciding whether two clips can share a segment. */
export function voiceSampleRate(voiceId: string): number {
  return getVoiceInfo(voiceId)?.sampleRate ?? 22050;
}

// ─── custom voice registry (localStorage) ───────────────────────────────────
// User-added voices (from a local file or a hosted URL). Persisted separately
// from the built-in catalog so they survive reloads and appear everywhere the
// built-in voices do.

const CUSTOM_VOICES_KEY = 'projectbible_tts_custom_voices';

export function getCustomVoices(): TtsVoiceInfo[] {
  try {
    const raw = localStorage.getItem(CUSTOM_VOICES_KEY);
    if (!raw) return [];
    const list = JSON.parse(raw);
    if (!Array.isArray(list)) return [];
    // Voices registered before language/rate were tracked: assume the common case.
    return list.map((v: Partial<TtsVoiceInfo>) => ({
      ...v,
      lang: v.lang ?? 'en',
      sampleRate: v.sampleRate ?? 22050,
    })) as TtsVoiceInfo[];
  } catch {
    return [];
  }
}

function saveCustomVoices(list: TtsVoiceInfo[]): void {
  localStorage.setItem(CUSTOM_VOICES_KEY, JSON.stringify(list));
}

export function registerCustomVoice(info: TtsVoiceInfo): void {
  const list = getCustomVoices().filter((v) => v.id !== info.id);
  list.push({ ...info, custom: true });
  saveCustomVoices(list);
}

function unregisterCustomVoice(id: string): void {
  saveCustomVoices(getCustomVoices().filter((v) => v.id !== id));
}

/** Built-in voices plus any user-added ones. */
export function getAllVoices(): TtsVoiceInfo[] {
  return [...TTS_VOICES, ...getCustomVoices()];
}

export function getVoiceInfo(id: string): TtsVoiceInfo | undefined {
  return getAllVoices().find((v) => v.id === id);
}

/** True when a voice has a remote source (built-in or hosted) it can (re)download from. */
export function voiceIsDownloadable(info: TtsVoiceInfo): boolean {
  return resolveVoiceSource(info) !== null;
}

/** Turn "My Voice.onnx" into a safe, stable voice id. */
export function voiceIdFromFilename(filename: string): string {
  return filename
    .replace(/\.onnx$/i, '')
    .replace(/[^a-zA-Z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase() || `voice-${Date.now()}`;
}

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
  opts?: { onProgress?: (p: TtsProgress) => void; timeoutMs?: number; transfer?: Transferable[] }
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
    getWorker().postMessage({ id, action, payload }, opts?.transfer ?? []);
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
  const info = getVoiceInfo(voiceId);
  const source: TtsSource | undefined = info ? resolveVoiceSource(info) ?? undefined : undefined;
  return call<void>('download', { voiceId, source }, { onProgress });
}

export async function removeVoice(voiceId: string): Promise<void> {
  await call<void>('remove', { voiceId });
  unregisterCustomVoice(voiceId);
}

/**
 * Install a cloned/custom voice from a picked .onnx model + .json config.
 * Registers it so it shows up alongside the built-in voices. Returns the id.
 */
export async function installVoiceFromFiles(
  modelFile: File,
  configFile: File,
  meta?: { label?: string }
): Promise<string> {
  const id = voiceIdFromFilename(modelFile.name);
  const configText = await configFile.text();
  // Read the rate before the buffer is transferred away — the reading engine
  // needs it to know whether this voice can share a segment with another.
  let sampleRate = 22050;
  try {
    sampleRate = JSON.parse(configText)?.audio?.sample_rate || 22050;
  } catch {
    // installData validates the config properly and will reject it.
  }
  const [model, config] = await Promise.all([modelFile.arrayBuffer(), configFile.arrayBuffer()]);
  await call<void>('installData', { voiceId: id, model, config }, { transfer: [model, config] });
  registerCustomVoice({
    id,
    label: meta?.label?.trim() || modelFile.name.replace(/\.onnx$/i, ''),
    quality: 'custom',
    approxSizeMB: Math.max(1, Math.round(modelFile.size / 1024 / 1024)),
    lang: 'en',
    sampleRate,
    custom: true,
  });
  return id;
}

/**
 * Synthesize one piece of text; resolves to a playable WAV blob.
 *
 * `speech` overrides the pronunciation the voice would use on its own — that is
 * how one Greek download serves both Modern and reconstructed Koine without
 * being reinstalled. Omit it for ordinary English reading.
 */
export async function synthesizeSpeech(
  text: string,
  voiceId: string,
  speech?: { espeakVoice?: string; substitutions?: Record<string, string> }
): Promise<Blob> {
  const wav = await call<ArrayBuffer>(
    'synthesize',
    { text, voiceId, espeakVoice: speech?.espeakVoice, substitutions: speech?.substitutions },
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
    // Attached to the page rather than left floating. Some phones only surface
    // lock-screen controls for an element that is actually in the document, and
    // a detached element is easier for the browser to treat as disposable.
    // Hidden, not display:none — a hidden element may be skipped entirely.
    sharedAudio.setAttribute('aria-hidden', 'true');
    sharedAudio.style.cssText = 'position:absolute;width:0;height:0;opacity:0;pointer-events:none;';
    if (typeof document !== 'undefined' && document.body) {
      document.body.appendChild(sharedAudio);
    }
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
