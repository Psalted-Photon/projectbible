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
  splitPhonemes,
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
  sessionFailure = null;
  graphicsChipWorks = null;
}

// ─── the model ──────────────────────────────────────────────────────────────

let session: ort.InferenceSession | null = null;
let sessionBackend: 'webgpu' | 'wasm' | null = null;
let graphicsChipWorks: boolean | null = null;
const styles = new Map<string, Float32Array>();

let sessionFailure: string | null = null;

/**
 * Which chip the loaded model is running on, and why if it is not the fast one.
 * Null before anything is loaded.
 */
export function backend(): { chip: 'webgpu' | 'wasm' | null; reason: string | null } {
  return { chip: sessionBackend, reason: sessionFailure };
}

/**
 * Whether this device can really run Kokoro on the graphics chip.
 *
 * Not the same question as "does an adapter exist". On an AMD laptop the
 * adapter is there, `requestAdapter()` succeeds, and the voices get offered —
 * then the runtime fails to build a WebGPU session and we quietly drop to the
 * processor at roughly a third of the speed speech needs.
 *
 * Returns **null when it cannot tell**, which is the honest answer before the
 * model is downloaded: the only way to know is to build a session, and that
 * needs the 310 MB file. Answering `false` there would hide the voices forever
 * on a machine that can run them perfectly well.
 */
export async function canRunOnGraphicsChip(): Promise<boolean | null> {
  if (graphicsChipWorks !== null) return graphicsChipWorks;
  if (!(navigator as any).gpu) {
    graphicsChipWorks = false;
    return false;
  }
  if (!(await hasSharedModel())) return null; // nothing to probe with yet
  try {
    await getSession();
    graphicsChipWorks = sessionBackend === 'webgpu';
  } catch {
    // Could not build a session at all — a broken install, not a verdict on
    // the chip, so it is not remembered.
    return null;
  }
  return graphicsChipWorks;
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
    // Kept for anyone reading the worker's own console, but the reason also
    // travels out via backendReason() — a warning nobody can see is how a
    // silent drop to an unusable speed went unexplained for a day.
    console.warn('[Kokoro] graphics chip unavailable, falling back to the processor:', err);
    sessionFailure = err instanceof Error ? err.message : String(err);
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

  const { dropped } = phonemesToTokens(phonemes);
  if (dropped.length > 0) {
    console.warn(`[Kokoro] dropped ${dropped.length} unknown sound(s):`, dropped.join(' '));
  }

  // Long text is split here rather than in the reading engine, so one verse
  // stays one verse: the joining, highlighting and position tracking upstream
  // never learn that this happened.
  const pieces = splitPhonemes(phonemes);
  if (pieces.length === 0) {
    throw new TtsError('SYNTH_FAILED', `Nothing to say for: "${text.slice(0, 40)}"`);
  }
  if (pieces.length > 1) {
    console.log(`[Kokoro] verse split into ${pieces.length} pieces to fit the model`);
  }

  const style = await getStyle(voiceId);
  const model = await getSession();

  const rendered: Float32Array[] = [];
  for (const piece of pieces) {
    rendered.push(await speak(piece, style, model));
  }

  return encodeWav(concat(rendered), KOKORO_SAMPLE_RATE);
}

/** One pass through the model, for a run of sounds already known to fit. */
async function speak(
  phonemes: string[],
  style: Float32Array,
  model: ort.InferenceSession
): Promise<Float32Array> {
  const { tokens } = phonemesToTokens(phonemes);

  // The style vector holds a row per possible length and is indexed by the
  // unpadded token count — which is why the file is half a megabyte.
  const row = tokens.length;
  if ((row + 1) * STYLE_DIMS > style.length) {
    throw new TtsError('SYNTH_FAILED', `Style vector has no row for ${row} sounds`);
  }

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
  return samples;
}

function concat(parts: Float32Array[]): Float32Array {
  if (parts.length === 1) return parts[0];
  let total = 0;
  for (const p of parts) total += p.length;
  const out = new Float32Array(total);
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}
