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
import {
  TTS_VOICES,
  TtsError,
  resolveVoiceSource,
  voiceModelName,
  voiceConfigName,
  type TtsProgressCallback,
  type TtsSource,
  type PiperSource,
} from './voices.js';
import {
  carrierFor,
  measureCopies,
  copiesAgree,
  cutWord,
  WORD_ATTEMPTS,
} from './wordAudio.js';
import { opfsFolder, fetchWithProgress, configureOrt, encodeWav } from './ttsRuntime.js';
import { phonemize } from './phonemize.js';

const store = opfsFolder('piper');

// ─── voice management ───────────────────────────────────────────────────────

/**
 * Resolve the download source for a voice. The main thread passes `source`
 * for custom voices (from its localStorage catalog); built-ins fall back to
 * the static catalog so the dev hook and internal callers work source-free.
 *
 * Rejects a Kokoro source rather than reading the fields it happens to share.
 * A Kokoro voice reaching this engine is a routing mistake, and failing here
 * says so instead of downloading a 310 MB model into Piper's OPFS folder.
 */
function downloadSource(voiceId: string, source?: TtsSource): PiperSource {
  const info = TTS_VOICES.find((v) => v.id === voiceId);
  const resolved = source ?? (info ? resolveVoiceSource(info) : null);
  if (!resolved) throw new TtsError('UNKNOWN_VOICE', `No download source for voice: ${voiceId}`);
  if (resolved.engine !== 'piper') {
    throw new TtsError('UNKNOWN_VOICE', `Voice ${voiceId} is not a Piper voice`);
  }
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
  await store.write(voiceConfigName(voiceId), configBlob);
  const modelBlob = await fetchWithProgress(modelUrl, onProgress);
  await store.write(voiceModelName(voiceId), modelBlob);
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
  await store.write(voiceConfigName(voiceId), config);
  await store.write(voiceModelName(voiceId), model);
  sessions.delete(voiceId);
  configs.delete(voiceId);
}

export async function removeVoice(voiceId: string): Promise<void> {
  await store.remove(voiceModelName(voiceId));
  await store.remove(voiceConfigName(voiceId));
  sessions.delete(voiceId);
  configs.delete(voiceId);
}

/** All voice ids with a model file in OPFS (built-in and custom alike). */
export async function storedVoices(): Promise<string[]> {
  const names = await store.list();
  return names
    .filter((n) => n.endsWith('.onnx') && !n.endsWith('.onnx.json'))
    .map((n) => n.slice(0, -'.onnx'.length));
}

export async function isVoiceInstalled(voiceId: string): Promise<boolean> {
  return !!(await store.read(voiceModelName(voiceId)));
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
async function getConfig(voiceId: string): Promise<VoiceConfig> {
  const cached = configs.get(voiceId);
  if (cached) return cached;
  const file = await store.read(voiceConfigName(voiceId));
  if (!file) throw new TtsError('VOICE_NOT_INSTALLED', `Voice ${voiceId} is not installed`);
  const parsed = JSON.parse(await file.text()) as VoiceConfig;
  configs.set(voiceId, parsed);
  return parsed;
}

async function getSession(voiceId: string): Promise<ort.InferenceSession> {
  const cached = sessions.get(voiceId);
  if (cached) return cached;
  configureOrt();
  const file = await store.read(voiceModelName(voiceId));
  if (!file) throw new TtsError('VOICE_NOT_INSTALLED', `Voice ${voiceId} is not installed`);
  const session = await ort.InferenceSession.create(await file.arrayBuffer());
  sessions.set(voiceId, session);
  return session;
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
  const espeakVoice = speech?.espeakVoice || config.espeak.voice;
  const result = await phonemize(text, espeakVoice);

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

  console.log(
    `🔊 synth voice=${voiceId} espeak=${espeakVoice} ` +
      `text="${text.slice(0, 40)}${text.length > 40 ? '…' : ''}" ` +
      `phonemes="${result.phonemes.join('').slice(0, 60)}"`
  );

  const results = await session.run(feeds);
  const samples = results.output.data as Float32Array;
  return encodeWav(samples, config.audio.sample_rate);
}

/**
 * Synthesize a single word.
 *
 * The word is spoken inside a carrier and cut back out; see wordAudio.ts for
 * why it cannot simply be synthesized on its own. Renders are stochastic, so a
 * clip whose two copies disagree is thrown away and re-rolled rather than
 * played — a wrong cut is never heard, at worst the word is reported unspoken.
 */
export async function synthesizeWord(
  word: string,
  voiceId: string,
  speech?: { espeakVoice?: string; substitutions?: Record<string, string> }
): Promise<ArrayBuffer> {
  const config = await getConfig(voiceId);
  const session = await getSession(voiceId);
  const espeakVoice = speech?.espeakVoice || config.espeak.voice;
  const sampleRate = config.audio.sample_rate;
  const text = carrierFor(word.trim());

  for (let attempt = 0; attempt < WORD_ATTEMPTS; attempt++) {
    const result = await phonemize(text, espeakVoice);
    let phonemeIds = result.phonemeIds;
    const subs = speech?.substitutions;
    if (subs && Object.keys(subs).length > 0 && config.phoneme_id_map) {
      const rewritten = result.phonemes.map((p) => subs[p] ?? p);
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

    const measured = measureCopies(samples, sampleRate);
    if (!measured) continue;
    if (!copiesAgree(measured.first, measured.last)) continue;

    return encodeWav(cutWord(samples, sampleRate, measured.cutAt, measured.gapEnd), sampleRate);
  }

  throw new TtsError('SYNTH_FAILED', `Could not pronounce "${word}" cleanly`);
}
