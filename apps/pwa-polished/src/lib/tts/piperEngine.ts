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
import { TTS_VOICES, TtsError, type TtsVoiceInfo, type TtsProgressCallback } from './voices.js';

const ASSET_BASE = '/tts';
const VOICE_BASE = 'https://huggingface.co/rhasspy/piper-voices/resolve/main';
const OPFS_DIR = 'piper';

function voiceInfo(voiceId: string): TtsVoiceInfo {
  const info = TTS_VOICES.find((v) => v.id === voiceId);
  if (!info) throw new TtsError('UNKNOWN_VOICE', `Unknown TTS voice: ${voiceId}`);
  return info;
}

// ─── OPFS storage (layout-compatible with vits-web) ─────────────────────────

async function opfsDir(): Promise<FileSystemDirectoryHandle> {
  const root = await navigator.storage.getDirectory();
  return root.getDirectoryHandle(OPFS_DIR, { create: true });
}

function opfsName(url: string): string {
  return url.split('/').at(-1)!;
}

async function opfsRead(url: string): Promise<File | undefined> {
  try {
    const dir = await opfsDir();
    const handle = await dir.getFileHandle(opfsName(url));
    return await handle.getFile();
  } catch {
    return undefined;
  }
}

async function opfsWrite(url: string, blob: Blob): Promise<void> {
  const dir = await opfsDir();
  const handle = await dir.getFileHandle(opfsName(url), { create: true });
  const writable = await handle.createWritable();
  await writable.write(blob);
  await writable.close();
}

async function opfsRemove(url: string): Promise<void> {
  try {
    const dir = await opfsDir();
    await dir.removeEntry(opfsName(url));
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

function voiceUrls(voiceId: string): { model: string; config: string } {
  const info = voiceInfo(voiceId);
  return {
    model: `${VOICE_BASE}/${info.path}`,
    config: `${VOICE_BASE}/${info.path}.json`,
  };
}

export async function downloadVoice(voiceId: string, onProgress?: TtsProgressCallback): Promise<void> {
  const { model, config } = voiceUrls(voiceId);
  // Config first (tiny), then the model with progress reporting.
  const configBlob = await fetchWithProgress(config);
  await opfsWrite(config, configBlob);
  const modelBlob = await fetchWithProgress(model, onProgress);
  await opfsWrite(model, modelBlob);
}

export async function removeVoice(voiceId: string): Promise<void> {
  const { model, config } = voiceUrls(voiceId);
  await opfsRemove(model);
  await opfsRemove(config);
  sessions.delete(voiceId);
  configs.delete(voiceId);
}

export async function storedVoices(): Promise<string[]> {
  const known = new Set(TTS_VOICES.map((v) => v.id));
  const found: string[] = [];
  try {
    const dir = await opfsDir();
    for await (const name of (dir as any).keys()) {
      if (typeof name === 'string' && name.endsWith('.onnx')) {
        const id = name.slice(0, -'.onnx'.length);
        if (known.has(id)) found.push(id);
      }
    }
  } catch {
    // OPFS unavailable → no voices
  }
  return found;
}

export async function isVoiceInstalled(voiceId: string): Promise<boolean> {
  const { model } = voiceUrls(voiceId);
  return !!(await opfsRead(model));
}

// ─── synthesis (cached config + session) ────────────────────────────────────

interface VoiceConfig {
  audio: { sample_rate: number };
  espeak: { voice: string };
  inference: { noise_scale: number; length_scale: number; noise_w: number };
  speaker_id_map: Record<string, number>;
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
  const { config } = voiceUrls(voiceId);
  const file = await opfsRead(config);
  if (!file) throw new TtsError('VOICE_NOT_INSTALLED', `Voice ${voiceId} is not installed`);
  const parsed = JSON.parse(await file.text()) as VoiceConfig;
  configs.set(voiceId, parsed);
  return parsed;
}

async function getSession(voiceId: string): Promise<ort.InferenceSession> {
  const cached = sessions.get(voiceId);
  if (cached) return cached;
  configureOrt();
  const { model } = voiceUrls(voiceId);
  const file = await opfsRead(model);
  if (!file) throw new TtsError('VOICE_NOT_INSTALLED', `Voice ${voiceId} is not installed`);
  const session = await ort.InferenceSession.create(await file.arrayBuffer());
  sessions.set(voiceId, session);
  return session;
}

async function phonemize(text: string, espeakVoice: string): Promise<number[]> {
  const input = JSON.stringify([{ text: text.trim() }]);
  return new Promise((resolve, reject) => {
    createPiperPhonemize({
      print: (msg) => {
        try {
          resolve(JSON.parse(msg).phoneme_ids);
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
export async function synthesize(text: string, voiceId: string): Promise<ArrayBuffer> {
  const config = await getConfig(voiceId);
  const session = await getSession(voiceId);
  const phonemeIds = await phonemize(text, config.espeak.voice);

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
