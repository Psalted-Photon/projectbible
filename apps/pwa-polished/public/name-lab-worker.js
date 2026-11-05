/**
 * The Name Lab's voices, off the page's thread so the list stays tappable while
 * a name is being generated.
 *
 * Runs the voices already on this device, from the same storage folders as Read
 * Aloud, through the app's own copy of the runtime in /tts/. It downloads
 * nothing. What it says for a set of sounds is what the reader would say:
 * lib/tts/kokoroEngine.ts and piperEngine.ts are the originals of what is here.
 */

import * as ort from '/tts/ort.min.mjs';
import { createPiperPhonemize } from '/tts/piper-phonemize.js';

ort.env.wasm.wasmPaths = '/tts/';
ort.env.wasm.numThreads = 1;

// ─── the natural voices ─────────────────────────────────────────────────────

/** Copied from KOKORO_VOICES in lib/tts/voices.ts. Jacob's 0.9 is his own normal pace. */
const KOKORO_VOICES = {
  af_heart: { label: 'Heart', accent: 'en-us' },
  af_bella: { label: 'Bella', accent: 'en-us' },
  af_nicole: { label: 'Nicole', accent: 'en-us' },
  am_michael: { label: 'Michael', accent: 'en-us' },
  am_fenrir: { label: 'Fenrir', accent: 'en-us' },
  am_puck: { label: 'Puck', accent: 'en-us' },
  blend_jacob: { label: 'Jacob', accent: 'en-gb-x-rp', speed: 0.9 },
  bf_emma: { label: 'Emma', accent: 'en-gb-x-rp' },
  bm_george: { label: 'George', accent: 'en-gb-x-rp' },
};
const KOKORO_MODEL_FILE = 'kokoro-model.onnx';
const KOKORO_RATE = 24000;
const STYLE_DIMS = 256;
const TOKEN_LIMIT = 510;

/** Copied from lib/tts/kokoroTokens.ts, and must stay identical to it. */
const VOCAB = {
  $: 0, ';': 1, ':': 2, ',': 3, '.': 4, '!': 5, '?': 6, '—': 9, '…': 10, '"': 11,
  '(': 12, ')': 13, '“': 14, '”': 15, ' ': 16, '̃': 17, ʣ: 18, ʥ: 19, ʦ: 20,
  ʨ: 21, ᵝ: 22, ꭧ: 23, A: 24, I: 25, O: 31, Q: 33, S: 35, T: 36, W: 39, Y: 41,
  ᵊ: 42, a: 43, b: 44, c: 45, d: 46, e: 47, f: 48, h: 50, i: 51, j: 52, k: 53,
  l: 54, m: 55, n: 56, o: 57, p: 58, q: 59, r: 60, s: 61, t: 62, u: 63, v: 64,
  w: 65, x: 66, y: 67, z: 68, ɑ: 69, ɐ: 70, ɒ: 71, æ: 72, β: 75, ɔ: 76, ɕ: 77,
  ç: 78, ɖ: 80, ð: 81, ʤ: 82, ə: 83, ɚ: 85, ɛ: 86, ɜ: 87, ɟ: 90, ɡ: 92, ɥ: 99,
  ɨ: 101, ɪ: 102, ʝ: 103, ɯ: 110, ɰ: 111, ŋ: 112, ɳ: 113, ɲ: 114, ɴ: 115,
  ø: 116, ɸ: 118, θ: 119, œ: 120, ɹ: 123, ɾ: 125, ɻ: 126, ʁ: 128, ɽ: 129,
  ʂ: 130, ʃ: 131, ʈ: 132, ʧ: 133, ʊ: 135, ʋ: 136, ʌ: 138, ɣ: 139, ɤ: 140,
  χ: 142, ʎ: 143, ʒ: 147, ʔ: 148, ˈ: 156, ˌ: 157, ː: 158, ʰ: 162, ʲ: 164,
  '↓': 169, '→': 171, '↗': 172, '↘': 173, ᵻ: 177,
};
const FOLD = { ʲ: 'j', r: 'ɹ', x: 'k', ɬ: 'l' };

/** Below this a clip is silence, above it the graphics chip returned nonsense. See kokoroEngine.ts. */
const SILENCE_FLOOR = 0.01;
const GARBAGE_CEILING = 1.5;

const status = (text) => postMessage({ status: text });

async function folder(name) {
  const root = await navigator.storage.getDirectory();
  return root.getDirectoryHandle(name, { create: true });
}

async function fileNames(name) {
  const out = [];
  try {
    for await (const [file, entry] of (await folder(name)).entries()) {
      if (entry.kind === 'file' && (await entry.getFile()).size > 0) out.push(file);
    }
  } catch {
    // Storage unavailable: no voices, and the page says so.
  }
  return out;
}

async function readFile(dir, name) {
  return (await (await folder(dir)).getFileHandle(name)).getFile();
}

function peak(samples) {
  let top = 0;
  for (let i = 0; i < samples.length; i++) top = Math.max(top, Math.abs(samples[i]));
  return top;
}

// ─── which voices are here ──────────────────────────────────────────────────

async function listVoices() {
  const voices = [];

  const kokoro = await fileNames('kokoro');
  if (kokoro.includes(KOKORO_MODEL_FILE)) {
    for (const file of kokoro) {
      if (!file.endsWith('.bin')) continue;
      const id = file.slice(0, -4);
      const known = KOKORO_VOICES[id];
      voices.push({
        id,
        engine: 'kokoro',
        label: known?.label ?? id,
        accent: known?.accent ?? (id.startsWith('b') ? 'en-gb-x-rp' : 'en-us'),
      });
    }
  }

  const piper = await fileNames('piper');
  for (const file of piper) {
    if (!file.endsWith('.onnx') || !piper.includes(`${file}.json`)) continue;
    try {
      const config = JSON.parse(await (await readFile('piper', `${file}.json`)).text());
      const accent = config?.espeak?.voice ?? '';
      // Greek and the German voice that reads Hebrew have no business reading English names.
      if (!accent.startsWith('en')) continue;
      const id = file.slice(0, -5);
      voices.push({ id, engine: 'piper', label: id.replace(/^en_[A-Z]+-/, ''), accent });
    } catch {
      // A damaged config: leave the voice out rather than fail the whole list.
    }
  }

  return voices;
}

// ─── text to sounds ─────────────────────────────────────────────────────────

/** A fresh phonemizer every call, as in lib/tts/phonemize.ts: one aborts after a few uses. */
function soundsOf(text, accent) {
  if (!text.trim()) return Promise.resolve('');
  return new Promise((resolve, reject) => {
    createPiperPhonemize({
      print: (line) => {
        try {
          resolve(JSON.parse(line).phonemes.join(''));
        } catch {
          reject(new Error(`Unexpected phonemizer output: ${line}`));
        }
      },
      printErr: (line) => reject(new Error(`Phonemizer error: ${line}`)),
      locateFile: (file) => `/tts/${file}`,
    })
      .then((mod) => {
        mod.callMain(['-l', accent, '--input', JSON.stringify([{ text: text.trim() }]), '--espeak_data', '/espeak-ng-data']);
      })
      .catch(reject);
  });
}

// ─── Kokoro ─────────────────────────────────────────────────────────────────

let kokoroSession = null;
let kokoroChip = null;
let refuseGraphicsChip = false;
const kokoroStyles = new Map();

async function getKokoroSession() {
  if (kokoroSession) return kokoroSession;
  status('Starting the voice…');
  const file = await readFile('kokoro', KOKORO_MODEL_FILE);
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (!refuseGraphicsChip && self.navigator.gpu) {
    try {
      kokoroSession = await ort.InferenceSession.create(bytes, { executionProviders: ['webgpu'] });
      kokoroChip = 'graphics chip';
    } catch (err) {
      console.warn('[name-lab] graphics chip unavailable, using the processor:', err);
    }
  }
  if (!kokoroSession) {
    kokoroSession = await ort.InferenceSession.create(bytes, { executionProviders: ['wasm'] });
    kokoroChip = 'processor';
  }
  status(kokoroChip === 'processor' ? 'Running on the processor, so each name takes a moment.' : 'Running on the graphics chip.');
  return kokoroSession;
}

async function getKokoroStyle(id) {
  if (kokoroStyles.has(id)) return kokoroStyles.get(id);
  const style = new Float32Array(await (await readFile('kokoro', `${id}.bin`)).arrayBuffer());
  kokoroStyles.set(id, style);
  return style;
}

async function sayKokoro(id, sounds) {
  const tokens = [];
  for (const ch of sounds) {
    const token = VOCAB[FOLD[ch] ?? ch];
    if (token !== undefined) tokens.push(token);
  }
  if (tokens.length === 0) throw new Error('Nothing to say.');
  const kept = tokens.slice(0, TOKEN_LIMIT);

  const style = await getKokoroStyle(id);
  const speed = KOKORO_VOICES[id]?.speed ?? 1;
  const row = kept.length;
  const padded = [0, ...kept, 0];

  const run = async () => {
    const model = await getKokoroSession();
    const result = await model.run({
      input_ids: new ort.Tensor('int64', BigInt64Array.from(padded, (v) => BigInt(v)), [1, padded.length]),
      style: new ort.Tensor('float32', style.slice(row * STYLE_DIMS, (row + 1) * STYLE_DIMS), [1, STYLE_DIMS]),
      speed: new ort.Tensor('float32', new Float32Array([speed]), [1]),
    });
    return result.waveform.data;
  };

  let samples = await run();
  let top = peak(samples);
  // The graphics chip can return numbers that aren't audio at all. Noise is
  // worse than slow, so the processor takes over for the rest of the session.
  if (top > GARBAGE_CEILING && kokoroChip === 'graphics chip') {
    console.warn(`[name-lab] graphics chip returned nonsense (peak ${top.toFixed(0)}); using the processor`);
    refuseGraphicsChip = true;
    await kokoroSession.release().catch(() => {});
    kokoroSession = null;
    samples = await run();
    top = peak(samples);
  }
  if (top < SILENCE_FLOOR) throw new Error(`The voice returned silence on the ${kokoroChip}.`);
  if (top > GARBAGE_CEILING) throw new Error(`The voice returned noise on the ${kokoroChip}.`);
  return { samples: Float32Array.from(samples), rate: KOKORO_RATE };
}

// ─── Piper ──────────────────────────────────────────────────────────────────

const piperVoices = new Map();

async function getPiper(id) {
  if (piperVoices.has(id)) return piperVoices.get(id);
  status('Starting the voice…');
  const config = JSON.parse(await (await readFile('piper', `${id}.onnx.json`)).text());
  const model = await readFile('piper', `${id}.onnx`);
  const session = await ort.InferenceSession.create(await model.arrayBuffer(), { executionProviders: ['wasm'] });
  const voice = { config, session };
  piperVoices.set(id, voice);
  status('');
  return voice;
}

/** `^ _ p _ p _ … _ $`, the same stream as idsFromPhonemes in piperEngine.ts. */
function piperIds(sounds, map) {
  const idOf = (symbol) => {
    const entry = map[symbol];
    return Array.isArray(entry) ? entry[0] : entry;
  };
  const pad = idOf('_') ?? 0;
  const ids = [idOf('^') ?? 1, pad];
  for (const ch of sounds) {
    const id = idOf(ch);
    if (id === undefined) continue;
    ids.push(id, pad);
  }
  ids.push(idOf('$') ?? 2);
  return ids;
}

async function sayPiper(id, sounds) {
  const { config, session } = await getPiper(id);
  const ids = piperIds(sounds, config.phoneme_id_map);
  const feeds = {
    input: new ort.Tensor('int64', ids, [1, ids.length]),
    input_lengths: new ort.Tensor('int64', [ids.length]),
    scales: new ort.Tensor('float32', [
      config.inference.noise_scale,
      config.inference.length_scale,
      config.inference.noise_w,
    ]),
  };
  if (Object.keys(config.speaker_id_map ?? {}).length > 0) feeds.sid = new ort.Tensor('int64', [0]);
  const result = await session.run(feeds);
  return { samples: Float32Array.from(result.output.data), rate: config.audio.sample_rate };
}

// ─── jobs ───────────────────────────────────────────────────────────────────

/** One at a time, in order. "drop" clears what hasn't started, when the page moves on. */
const queue = [];
let busy = false;

async function pump() {
  if (busy) return;
  busy = true;
  while (queue.length) {
    const job = queue.shift();
    try {
      if (job.op === 'voices') {
        postMessage({ id: job.id, ok: true, result: await listVoices() });
      } else if (job.op === 'sounds') {
        postMessage({ id: job.id, ok: true, result: await soundsOf(job.text, job.accent) });
      } else {
        const said = job.engine === 'kokoro' ? await sayKokoro(job.voice, job.sounds) : await sayPiper(job.voice, job.sounds);
        postMessage({ id: job.id, ok: true, result: said }, [said.samples.buffer]);
      }
    } catch (err) {
      postMessage({ id: job.id, ok: false, error: err?.message ?? String(err) });
    }
  }
  busy = false;
}

self.onmessage = ({ data }) => {
  if (data.op === 'drop') {
    // Only voices are dropped: a question about a spelling still wants its answer.
    for (let i = queue.length - 1; i >= 0; i--) {
      if (queue[i].op === 'say') {
        postMessage({ id: queue[i].id, ok: false, dropped: true, error: 'dropped' });
        queue.splice(i, 1);
      }
    }
    return;
  }
  queue.push(data);
  void pump();
};
