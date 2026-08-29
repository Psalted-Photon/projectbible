/**
 * Kokoro speech engine — the natural-sounding English voices.
 *
 * Shaped quite differently from Piper, for reasons measured rather than assumed
 * (see the Phase 0 findings in the plan):
 *
 *  - **One shared model, many voices.** 310 MB once, then ~510 KB per voice, so
 *    the first voice is a big download and the rest are nearly free. Piper is
 *    the inverse: every voice is its own 60 MB file.
 *  - **It runs on the graphics chip.** On the main processor it manages about
 *    0.55x realtime — slower than playback, so it could never keep up. On the
 *    graphics chip it reaches ~1.6-1.75x, which does.
 *  - **fp32, despite fp16 being half the size.** On an Adreno 740, fp16 returns
 *    correctly-shaped silence at full speed with no error at all. See voices.ts.
 *
 * Runs inside ttsWorker.ts — do not import from the main thread.
 */

import * as ort from 'onnxruntime-web';
import {
  TtsError,
  KOKORO_MODEL_FILE,
  KOKORO_VOICES,
  resolveVoiceSource,
  type TtsProgressCallback,
  type TtsSource,
  type KokoroSource,
} from './voices.js';
import {
  opfsFolder,
  fetchWithProgress,
  configureOrt,
  encodeWav,
  peakAmplitude,
} from './ttsRuntime.js';
import { phonemize } from './phonemize.js';
import {
  phonemesToTokens,
  padTokens,
  KOKORO_TOKEN_LIMIT,
} from './kokoroTokens.js';

const store = opfsFolder('kokoro');

/** Kokoro always outputs at this rate, whatever the voice. */
export const KOKORO_SAMPLE_RATE = 24000;

/** Each voice's style vector is 510 rows of 256 numbers. */
const STYLE_DIMS = 256;

/**
 * Below this the clip is silence rather than speech. Real speech measures ~0.5;
 * this only has to be above the noise floor of a genuinely working clip.
 */
const SILENCE_FLOOR = 0.01;

const styleName = (voiceId: string) => `${voiceId}.bin`;

// ─── installing ─────────────────────────────────────────────────────────────

function kokoroSource(voiceId: string, source?: TtsSource): KokoroSource {
  const info = KOKORO_VOICES.find((v) => v.id === voiceId);
  const resolved = source ?? (info ? resolveVoiceSource(info) : null);
  if (!resolved) throw new TtsError('UNKNOWN_VOICE', `No download source for voice: ${voiceId}`);
  if (resolved.engine !== 'kokoro') {
    throw new TtsError('UNKNOWN_VOICE', `Voice ${voiceId} is not a Kokoro voice`);
  }
  return resolved;
}

/** True once the shared model is on disk — the expensive half of an install. */
export async function hasSharedModel(): Promise<boolean> {
  return !!(await store.read(KOKORO_MODEL_FILE));
}

/**
 * Download a voice. The shared model comes first and only if missing, so the
 * first voice costs 310 MB and every one after it costs half a megabyte.
 * Progress is reported against whichever part is actually being fetched.
 */
export async function downloadVoice(
  voiceId: string,
  source?: TtsSource,
  onProgress?: TtsProgressCallback
): Promise<void> {
  const { modelUrl, styleUrl } = kokoroSource(voiceId, source);

  if (!(await hasSharedModel())) {
    const model = await fetchWithProgress(modelUrl, onProgress);
    await store.write(KOKORO_MODEL_FILE, model);
  }

  const style = await fetchWithProgress(styleUrl, onProgress);
  await store.write(styleName(voiceId), style);
  styles.delete(voiceId);
}

/** A Kokoro voice needs both halves before it can say anything. */
export async function isVoiceInstalled(voiceId: string): Promise<boolean> {
  if (!(await store.read(styleName(voiceId)))) return false;
  return hasSharedModel();
}

/** Voice ids with a style vector on disk, empty if the shared model is missing. */
export async function storedVoices(): Promise<string[]> {
  const names = await store.list();
  if (!names.includes(KOKORO_MODEL_FILE)) return [];
  return names.filter((n) => n.endsWith('.bin')).map((n) => n.slice(0, -'.bin'.length));
}

/**
 * Remove one voice's style vector. The shared model stays — it belongs to every
 * Kokoro voice, so freeing it is a separate, explicit decision.
 */
export async function removeVoice(voiceId: string): Promise<void> {
  await store.remove(styleName(voiceId));
  styles.delete(voiceId);
}

/** Free the shared 310 MB. Every Kokoro voice stops working until re-downloaded. */
export async function removeSharedModel(): Promise<void> {
  await store.remove(KOKORO_MODEL_FILE);
  session = null;
  sessionBackend = null;
}

// ─── the model ──────────────────────────────────────────────────────────────

let session: ort.InferenceSession | null = null;
let sessionBackend: 'webgpu' | 'wasm' | null = null;
const styles = new Map<string, Float32Array>();

/** Which chip the loaded model is running on, or null before it is loaded. */
export function backend(): 'webgpu' | 'wasm' | null {
  return sessionBackend;
}

async function getSession(): Promise<ort.InferenceSession> {
  if (session) return session;
  configureOrt();
  const file = await store.read(KOKORO_MODEL_FILE);
  if (!file) throw new TtsError('VOICE_NOT_INSTALLED', 'The Kokoro model is not installed');
  const bytes = new Uint8Array(await file.arrayBuffer());

  // Graphics chip first. The processor fallback is kept because it is better to
  // read slowly than not at all, but it cannot keep up with playback — which is
  // why the UI hides these voices where the graphics chip is unavailable.
  try {
    session = await ort.InferenceSession.create(bytes, { executionProviders: ['webgpu'] });
    sessionBackend = 'webgpu';
  } catch (err) {
    console.warn('[Kokoro] graphics chip unavailable, falling back to the processor:', err);
    session = await ort.InferenceSession.create(bytes, { executionProviders: ['wasm'] });
    sessionBackend = 'wasm';
  }
  return session;
}

async function getStyle(voiceId: string): Promise<Float32Array> {
  const cached = styles.get(voiceId);
  if (cached) return cached;
  const file = await store.read(styleName(voiceId));
  if (!file) throw new TtsError('VOICE_NOT_INSTALLED', `Voice ${voiceId} is not installed`);
  const style = new Float32Array(await file.arrayBuffer());
  styles.set(voiceId, style);
  return style;
}

// ─── speaking ───────────────────────────────────────────────────────────────

/**
 * Synthesize one piece of text. Returns a WAV as ArrayBuffer, transferable
 * across the worker boundary without copying.
 *
 * `phonemeVoice` is the espeak language for this voice — US and UK differ. It is
 * not the Greek pronunciation override, which never reaches this engine.
 */
export async function synthesize(
  text: string,
  voiceId: string,
  phonemeVoice: string
): Promise<ArrayBuffer> {
  const { phonemes } = await phonemize(text, phonemeVoice);
  const { tokens, dropped } = phonemesToTokens(phonemes);

  if (tokens.length === 0) {
    throw new TtsError('SYNTH_FAILED', `Nothing to say for: "${text.slice(0, 40)}"`);
  }
  if (dropped.length > 0) {
    console.warn(`[Kokoro] dropped ${dropped.length} unknown sound(s):`, dropped.join(' '));
  }
  // Phase 4 splits long text; until then this fails loudly rather than letting
  // the model quietly cut the end off a long verse.
  if (tokens.length > KOKORO_TOKEN_LIMIT) {
    throw new TtsError(
      'SYNTH_FAILED',
      `Too long for one pass: ${tokens.length} sounds, limit ${KOKORO_TOKEN_LIMIT}`
    );
  }

  const style = await getStyle(voiceId);
  // The style vector has a row per possible length, and the row is chosen by
  // the unpadded token count — that is why the file is half a megabyte.
  const row = tokens.length;
  if ((row + 1) * STYLE_DIMS > style.length) {
    throw new TtsError('SYNTH_FAILED', `Style vector has no row for ${row} sounds`);
  }

  const model = await getSession();
  const padded = padTokens(tokens);
  const results = await model.run({
    input_ids: new ort.Tensor(
      'int64',
      BigInt64Array.from(padded, (v) => BigInt(v)),
      [1, padded.length]
    ),
    style: new ort.Tensor('float32', style.slice(row * STYLE_DIMS, (row + 1) * STYLE_DIMS), [
      1,
      STYLE_DIMS,
    ]),
    speed: new ort.Tensor('float32', new Float32Array([1]), [1]),
  });

  const samples = results.waveform.data as Float32Array;

  // A model can return a correctly-sized buffer of nothing, at full speed, with
  // no error — that is exactly how fp16 behaves on Adreno. Without this check a
  // whole chapter reads as silence and nothing anywhere says why.
  const peak = peakAmplitude(samples);
  if (peak < SILENCE_FLOOR) {
    throw new TtsError(
      'SYNTH_FAILED',
      `Model returned silence (peak ${peak.toFixed(4)}) on ${sessionBackend ?? 'unknown'}`
    );
  }

  return encodeWav(samples, KOKORO_SAMPLE_RATE);
}
