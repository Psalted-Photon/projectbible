/**
 * Piper TTS engine — synthesizes speech from text using a Piper ONNX voice,
 * fully on-device (onnxruntime-web WASM + espeak-ng phonemizer WASM).
 *
 * Adapted from @diffusionstudio/vits-web 1.0.3 (MIT) with three changes:
 *  1. Runtime WASM assets load from same-origin /tts/ instead of CDNs,
 *     so the feature keeps working offline (service worker caches /tts/).
 *  2. The ONNX session and voice config are cached between calls — the
 *     original recreated them per synthesis, far too slow for per-verse use.
 *  3. Synthesis throws VOICE_NOT_INSTALLED instead of silently downloading
 *     ~60 MB, so the UI controls when the download happens.
 *
 * Voice files live in OPFS under /piper/ (same layout as vits-web).
 * Runs inside ttsWorker.ts — do not import from the main thread.
 */

import * as ort from 'onnxruntime-web';
import { createPiperPhonemize } from './vendor/piper-phonemize.js';
import {
  TTS_VOICES,
  TtsError,
  resolveVoiceSource,
  voiceModelName,
  voiceConfigName,
  type TtsProgressCallback,
  type TtsSource,
} from './voices.js';

const ASSET_BASE = '/tts';
const OPFS_DIR = 'piper';

// ─── OPFS storage (layout-compatible with vits-web; keyed by voice id) ──────

async function opfsDir(): Promise<FileSystemDirectoryHandle> {
  const root = await navigator.storage.getDirectory();
  return root.getDirectoryHandle(OPFS_DIR, { create: true });
}

async function opfsRead(name: string): Promise<File | undefined> {
  try {
    const dir = await opfsDir();
    const handle = await dir.getFileHandle(name);
    return await handle.getFile();
  } catch {
    return undefined;
  }
}

async function opfsWrite(name: string, data: Blob | ArrayBuffer): Promise<void> {
  const dir = await opfsDir();
  const handle = await dir.getFileHandle(name, { create: true });
  const writable = await handle.createWritable();
  await writable.write(data);
  await writable.close();
}

async function opfsRemove(name: string): Promise<void> {
  try {
    const dir = await opfsDir();
    await dir.removeEntry(name);
  } catch {
    // already gone
  }
}

async function fetchWithProgress(url: string, onProgress?: TtsProgressCallback): Promise<Blob> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Download failed (${response.status}) for ${url}`);
  const total = +(response.headers.get('Content-Length') ?? 0);
  const reader = response.body?.getReader();
  if (!reader) return response.blob();

  let loaded = 0;
  const chunks: Uint8Array[] = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    loaded += value.length;
    onProgress?.({ loaded, total });
  }
  return new Blob(chunks, { type: response.headers.get('Content-Type') ?? undefined });
}

// ─── voice management ───────────────────────────────────────────────────────

/**
 * Resolve the download source for a voice. The main thread passes `source`
 * for custom voices (from its localStorage catalog); built-ins fall back to
 * the static catalog so the dev hook and internal callers work source-free.
 */
function downloadSource(voiceId: string, source?: TtsSource): TtsSource {
  if (source) return source;
  const info = TTS_VOICES.find((v) => v.id === voiceId);
  const resolved = info ? resolveVoiceSource(info) : null;
  if (!resolved) throw new TtsError('UNKNOWN_VOICE', `No download source for voice: ${voiceId}`);
  return resolved;
}

export async function downloadVoice(
  voiceId: string,
  source?: TtsSource,
  onProgress?: TtsProgressCallback
): Promise<void> {
  const { modelUrl, configUrl } = downloadSource(voiceId, source);
  // Config first (tiny), then the model with progress reporting.
  const configBlob = await fetchWithProgress(configUrl);
  await opfsWrite(voiceConfigName(voiceId), configBlob);
  const modelBlob = await fetchWithProgress(modelUrl, onProgress);
  await opfsWrite(voiceModelName(voiceId), modelBlob);
}

/**
 * Install a voice from raw bytes (an .onnx model + its .json config), e.g.
 * a user's cloned voice picked from local disk. Buffers arrive transferred
 * across the worker boundary — no copy.
 */
export async function installVoiceData(
  voiceId: string,
  model: ArrayBuffer,
  config: ArrayBuffer
): Promise<void> {
  // Validate the config is parseable before committing the model.
  const parsed = JSON.parse(new TextDecoder().decode(config));
  if (!parsed?.audio?.sample_rate || !parsed?.espeak?.voice) {
    throw new TtsError('SYNTH_FAILED', 'Config JSON is missing audio.sample_rate or espeak.voice');
  }
  await opfsWrite(voiceConfigName(voiceId), config);
  await opfsWrite(voiceModelName(voiceId), model);
  sessions.delete(voiceId);
  configs.delete(voiceId);
}

export async function removeVoice(voiceId: string): Promise<void> {
  await opfsRemove(voiceModelName(voiceId));
  await opfsRemove(voiceConfigName(voiceId));
  sessions.delete(voiceId);
  configs.delete(voiceId);
}

/** All voice ids with a model file in OPFS (built-in and custom alike). */
export async function storedVoices(): Promise<string[]> {
  const found: string[] = [];
  try {
    const dir = await opfsDir();
    for await (const name of (dir as any).keys()) {
      if (typeof name === 'string' && name.endsWith('.onnx') && !name.endsWith('.onnx.json')) {
        found.push(name.slice(0, -'.onnx'.length));
      }
    }
  } catch {
    // OPFS unavailable → no voices
  }
  return found;
}

export async function isVoiceInstalled(voiceId: string): Promise<boolean> {
  return !!(await opfsRead(voiceModelName(voiceId)));
}

// ─── synthesis (cached config + session) ────────────────────────────────────

interface VoiceConfig {
  audio: { sample_rate: number };
  espeak: { voice: string };
  inference: { noise_scale: number; length_scale: number; noise_w: number };
  speaker_id_map: Record<string, number>;
  /** Shared IPA symbol table. Identical across Piper voices, but read per-voice. */
  phoneme_id_map?: Record<string, number[] | number>;
}

const configs = new Map<string, VoiceConfig>();
const sessions = new Map<string, ort.InferenceSession>();
let ortConfigured = false;

function configureOrt(): void {
  if (ortConfigured) return;
  // Single-threaded on purpose: the app is not cross-origin isolated, and a
  // deterministic single .wasm keeps the offline cache small and predictable.
  ort.env.wasm.numThreads = 1;
  ort.env.wasm.wasmPaths = `${ASSET_BASE}/`;
  ortConfigured = true;
}

async function getConfig(voiceId: string): Promise<VoiceConfig> {
  const cached = configs.get(voiceId);
  if (cached) return cached;
  const file = await opfsRead(voiceConfigName(voiceId));
  if (!file) throw new TtsError('VOICE_NOT_INSTALLED', `Voice ${voiceId} is not installed`);
  const parsed = JSON.parse(await file.text()) as VoiceConfig;
  configs.set(voiceId, parsed);
  return parsed;
}

async function getSession(voiceId: string): Promise<ort.InferenceSession> {
  const cached = sessions.get(voiceId);
  if (cached) return cached;
  configureOrt();
  const file = await opfsRead(voiceModelName(voiceId));
  if (!file) throw new TtsError('VOICE_NOT_INSTALLED', `Voice ${voiceId} is not installed`);
  const session = await ort.InferenceSession.create(await file.arrayBuffer());
  sessions.set(voiceId, session);
  return session;
}

async function phonemize(
  text: string,
  espeakVoice: string
): Promise<{ phonemes: string[]; phonemeIds: number[] }> {
  const input = JSON.stringify([{ text: text.trim() }]);
  return new Promise((resolve, reject) => {
    createPiperPhonemize({
      print: (msg) => {
        try {
          const parsed = JSON.parse(msg);
          resolve({ phonemes: parsed.phonemes ?? [], phonemeIds: parsed.phoneme_ids });
        } catch (e) {
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

/**
 * Rebuild phoneme ids after rewriting some phonemes.
 *
 * Piper's id stream is `^ _ p₁ _ p₂ _ … pₙ _ $` — a start symbol, then every
 * phoneme separated by padding, then an end symbol, which is why the length is
 * always 2n+3. Phonemes missing from the table are dropped, matching Piper.
 */
function idsFromPhonemes(phonemes: string[], map: Record<string, number[] | number>): number[] {
  const idOf = (symbol: string): number | undefined => {
    const entry = map[symbol];
    return Array.isArray(entry) ? entry[0] : entry;
  };
  const pad = idOf('_') ?? 0;
  const ids: number[] = [idOf('^') ?? 1, pad];
  for (const phoneme of phonemes) {
    const id = idOf(phoneme);
    if (id === undefined) continue;
    ids.push(id, pad);
  }
  ids.push(idOf('$') ?? 2);
  return ids;
}

/** Mono 16-bit PCM WAV from float samples. */
function encodeWav(samples: Float32Array, sampleRate: number): ArrayBuffer {
  const headerBytes = 44;
  const view = new DataView(new ArrayBuffer(samples.length * 2 + headerBytes));
  view.setUint32(0, 0x46464952, true); // "RIFF"
  view.setUint32(4, view.buffer.byteLength - 8, true);
  view.setUint32(8, 0x45564157, true); // "WAVE"
  view.setUint32(12, 0x20746d66, true); // "fmt "
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  view.setUint32(36, 0x61746164, true); // "data"
  view.setUint32(40, samples.length * 2, true);
  let offset = headerBytes;
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    offset += 2;
  }
  return view.buffer;
}

/**
 * Synthesize speech for one piece of text. Returns a WAV file as ArrayBuffer
 * (transferable across the worker boundary without copying).
 */
export async function synthesize(
  text: string,
  voiceId: string,
  speech?: { espeakVoice?: string; substitutions?: Record<string, string> }
): Promise<ArrayBuffer> {
  const config = await getConfig(voiceId);
  const session = await getSession(voiceId);
  const result = await phonemize(text, speech?.espeakVoice || config.espeak.voice);

  // Only re-derive ids when a substitution actually applies — the phonemizer's
  // own ids are authoritative otherwise, and English must stay untouched.
  const substitutions = speech?.substitutions;
  let phonemeIds = result.phonemeIds;
  if (substitutions && Object.keys(substitutions).length > 0 && config.phoneme_id_map) {
    const rewritten = result.phonemes.map((p) => substitutions[p] ?? p);
    if (rewritten.some((p, i) => p !== result.phonemes[i])) {
      phonemeIds = idsFromPhonemes(rewritten, config.phoneme_id_map);
    }
  }

  const feeds: Record<string, ort.Tensor> = {
    input: new ort.Tensor('int64', phonemeIds, [1, phonemeIds.length]),
    input_lengths: new ort.Tensor('int64', [phonemeIds.length]),
    scales: new ort.Tensor('float32', [
      config.inference.noise_scale,
      config.inference.length_scale,
      config.inference.noise_w,
    ]),
  };
  if (Object.keys(config.speaker_id_map ?? {}).length > 0) {
    feeds.sid = new ort.Tensor('int64', [0]);
  }

  const results = await session.run(feeds);
  const samples = results.output.data as Float32Array;
  return encodeWav(samples, config.audio.sample_rate);
}
