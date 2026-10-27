/**
 * Voice Control lab worker — downloads and runs every model off the page's
 * thread, the way Read Aloud's voices run.
 *
 * Requests:  { id, action, payload }
 * Responses: { id, ok: true, result } | { id, ok: false, error }
 * Progress:  { id, progress }
 * Events:    { event: 'net' | 'piece', ... }   (not tied to a request)
 */

import * as ort from 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.23.2/dist/ort.wasm.min.mjs';
import { NeedleEngine, Punctuator, SileroVad, planChunks, VAD_FRAME } from './engine.js';
import { tidy, toolsFor } from './tools.js';

ort.env.wasm.wasmPaths = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.23.2/dist/';
// Threads need a cross-origin isolated page, which the app is not.
ort.env.wasm.numThreads = self.crossOriginIsolated ? Math.min(4, navigator.hardwareConcurrency || 1) : 1;

// Pinned to a commit, so the bytes cannot change under the lab, and checked
// against their SHA-256 as well. The punctuation files come from a mirror,
// byte-identical to sherpa-onnx's own release (which has no CORS).
const HF = 'https://huggingface.co/';
const NEEDLE = HF + 'Cactus-Compute/needle3/resolve/d6c7d6a2e9655505e0f8e23339356dd1705900eb/';
const PUNCT = HF + 'brady-pplx/sherpa-onnx-online-punct-en-2024-08-06/resolve/29a49a07620ef067e6fa40580da620c11db07b83/';
const FILES = {
  engineJs: {
    label: 'Engine glue',
    url: NEEDLE + 'wasm/needle.js',
    size: 62082,
    sha256: 'a675c66f506a1b6f922d852c0cc0b82a843ce9d0fab6a80a408106f516df126f',
  },
  engineWasm: {
    label: 'Engine',
    url: NEEDLE + 'wasm/needle.wasm',
    size: 930545,
    sha256: '7b73d09c17923bf81d6bdb82e19b3c343b8994f83d512ddec52eec9f6b029802',
  },
  whistle: {
    label: 'Whistle (speech → text)',
    url: HF + 'Cactus-Compute/whistle/resolve/741118687e1f008f06d1351a402a731274789790/whistle.cact',
    size: 16919407,
    sha256: 'b6e02f048568ac5d01a2042556c658061e699acbc0aa2a1439f52f3d461dffeb',
  },
  needle: {
    label: 'Needle 3 (text → actions)',
    url: NEEDLE + 'needle3.cact',
    size: 35335380,
    sha256: 'c9d915eca282ed42d1a09b143b592adb4cc6744ffe2d294adf5cfc5548170c38',
  },
  punct: {
    label: 'Punctuation add-on',
    url: PUNCT + 'model.int8.onnx',
    size: 7490500,
    sha256: '9d611f445fe4a46186080fe161be6059d87d72eb88d3a8cb00c1a06e83a6067e',
  },
  vocab: {
    label: 'Punctuation word list',
    url: PUNCT + 'bpe.vocab',
    size: 149430,
    sha256: 'e118b7ad88c54db562517df49e1cffd4836d166c34fb190fd311d7f34eb238f5',
  },
  vad: {
    label: 'Voice detector',
    url: HF + 'onnx-community/silero-vad/resolve/e71cae966052b992a7eca6b17738916ce0eca4ec/onnx/model.onnx',
    size: 2243022,
    sha256: 'a4a068cd6cf1ea8355b84327595838ca748ec29a25bc91fc82e6c299ccdc5808',
  },
};

const CACHE = 'voice-control-lab-v1';

// ── Network watch ───────────────────────────────────────────────────────────
// Once the models are in, nothing should go online. Every request this
// worker makes after that is reported, however it was made.

let readyAt = Infinity;
const report = (url, how) => {
  if (performance.now() >= readyAt && !/^(blob|data):/.test(String(url))) {
    self.postMessage({ event: 'net', where: 'worker', url: String(url), how });
  }
};
const realFetch = self.fetch.bind(self);
self.fetch = (input, init) => {
  report(typeof input === 'string' ? input : input.url, 'fetch');
  return realFetch(input, init);
};
const realOpen = XMLHttpRequest.prototype.open;
XMLHttpRequest.prototype.open = function (method, url, ...rest) {
  report(url, 'xhr');
  return realOpen.call(this, method, url, ...rest);
};
// Script imports go past both wrappers; resource timing sees those. Fetches
// and XHRs are left to the wrappers, so nothing is counted twice.
try {
  new PerformanceObserver((list) => {
    for (const e of list.getEntries()) {
      if (e.startTime < readyAt || e.initiatorType === 'fetch' || e.initiatorType === 'xmlhttprequest') continue;
      report(e.name, e.initiatorType);
    }
  }).observe({ type: 'resource', buffered: false });
} catch {
  /* resource timing missing in this worker; the wrappers above still report */
}

// ── Downloads ───────────────────────────────────────────────────────────────

async function sha256(bytes) {
  const d = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return Array.from(d, (b) => b.toString(16).padStart(2, '0')).join('');
}

/** A file's bytes, from the lab's cache or downloaded into it. */
async function getFile(key, onBytes) {
  const f = FILES[key];
  const cache = await caches.open(CACHE);
  let res = await cache.match(f.url);
  let fromCache = true;
  if (!res) {
    fromCache = false;
    res = await realFetch(f.url);
    if (!res.ok) throw new Error(`${f.label}: download failed (${res.status})`);
    const reader = res.body.getReader();
    const parts = [];
    let got = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      parts.push(value);
      got += value.length;
      onBytes(got);
    }
    const blob = new Blob(parts);
    await cache.put(f.url, new Response(blob));
    res = new Response(blob);
  }
  const bytes = new Uint8Array(await res.arrayBuffer());
  onBytes(bytes.length);
  if (f.sha256 && (await sha256(bytes)) !== f.sha256) {
    await cache.delete(f.url);
    throw new Error(`${f.label}: the file did not match its checksum`);
  }
  return { bytes, fromCache };
}

// ── Engines ─────────────────────────────────────────────────────────────────

let eng = null;
let punct = null;
let vad = null;
let toolsSent = null;
let cancelled = false;

async function load(post, cacheOnly) {
  const keys = Object.keys(FILES);
  if (cacheOnly) {
    // Opening the page again loads from the cache on its own, but never
    // starts a 63 MB download nobody asked for.
    const cache = await caches.open(CACHE);
    for (const k of keys) if (!(await cache.match(FILES[k].url))) return { missing: true };
  }
  const got = Object.fromEntries(keys.map((k) => [k, 0]));
  const total = keys.reduce((a, k) => a + FILES[k].size, 0);
  const t0 = performance.now();
  const results = await Promise.all(
    keys.map((k) =>
      getFile(k, (n) => {
        got[k] = n;
        post({ stage: 'download', loaded: keys.reduce((a, q) => a + got[q], 0), total });
      }),
    ),
  );
  const files = Object.fromEntries(keys.map((k, i) => [k, results[i]]));
  const ms = { download: performance.now() - t0 };
  const fromCache = keys.every((k) => files[k].fromCache);

  const timed = async (name, fn) => {
    post({ stage: name });
    const t = performance.now();
    const r = await fn();
    ms[name] = performance.now() - t;
    return r;
  };

  await timed('engine', async () => {
    const glue = new TextDecoder().decode(files.engineJs.bytes);
    const createNeedle = new Function(glue + '\nreturn createNeedle;')();
    eng = await NeedleEngine.create(createNeedle, files.engineWasm.bytes);
  });
  await timed('whistle', () => eng.load(files.whistle.bytes));
  await timed('needle', () => eng.load(files.needle.bytes));
  await timed('punct', async () => {
    punct = await Punctuator.create(ort, files.punct.bytes, new TextDecoder().decode(files.vocab.bytes));
  });
  await timed('vad', async () => {
    vad = await SileroVad.create(ort, files.vad.bytes);
  });

  readyAt = performance.now();
  return { ms, fromCache, bytes: total, heapMB: eng.heapBytes() / 1048576, models: eng.models() };
}

/** Sets the tools only when they differ from the last set, and times it. */
function useTools(system, toolsJson) {
  if (toolsSent === system + '\n' + toolsJson) return { initMs: 0, prefix: null };
  const t = performance.now();
  const prefix = eng.init(system, toolsJson);
  toolsSent = system + '\n' + toolsJson;
  return { initMs: performance.now() - t, prefix };
}

function choose(heard, system, everything, maxNewTokens) {
  const text = tidy(heard);
  const picked = toolsFor(text, everything);
  const toolsJson = JSON.stringify(picked.tools);
  const tools = useTools(system, toolsJson);
  eng.reset();
  const t = performance.now();
  let answer;
  try {
    answer = eng.complete(text, maxNewTokens);
  } catch (e) {
    // If a reset also drops the tools, setting them again is the fix.
    toolsSent = null;
    useTools(system, toolsJson);
    answer = eng.complete(text, maxNewTokens);
  }
  return { answer, needleMs: performance.now() - t, ...tools, toolCount: picked.tools.length, toolNames: picked.tools.map((x) => x.name), groups: picked.groups, tidied: text };
}

/**
 * A long recording: voice detector → pieces at pauses → Whistle → punctuation.
 * Each piece is sent to the page as it is done, so text appears as it goes.
 */
async function transcribeLong(id, { pcm, keywords, paraSec, maxSec }, post) {
  cancelled = false;
  vad.reset();
  const frames = Math.floor(pcm.length / VAD_FRAME);
  const probs = new Float32Array(frames);
  const step = Math.floor(10 * (16000 / VAD_FRAME)); // 10 s of audio per pass
  const ms = { vad: 0, whistle: 0, punct: 0 };
  const t0 = performance.now();
  let startFrame = 0;
  let pieces = 0;
  let speechSec = 0;

  for (let upTo = 0; upTo < frames; ) {
    const next = Math.min(frames, upTo + step);
    let t = performance.now();
    probs.set(await vad.probs(pcm, upTo * VAD_FRAME, next * VAD_FRAME), upTo);
    ms.vad += performance.now() - t;
    upTo = next;
    const final = upTo >= frames;

    for (const p of planChunks(probs, upTo, { startFrame, final, maxSec, paraSec })) {
      startFrame = p.endFrame;
      const clip = pcm.subarray(p.start, p.end);
      t = performance.now();
      const tr = eng.transcribe(clip, { language: 'en', keywords });
      const wMs = performance.now() - t;
      ms.whistle += wMs;
      t = performance.now();
      const text = tr.text ? await punct.punctuate(tr.text) : '';
      ms.punct += performance.now() - t;
      pieces++;
      speechSec += clip.length / 16000;
      self.postMessage({
        event: 'piece',
        id,
        piece: { start: p.start / 16000, end: p.end / 16000, gapBefore: p.gapBefore, raw: tr.text, text, whistleMs: wMs },
      });
    }
    post({ doneSec: (upTo * VAD_FRAME) / 16000, totalSec: pcm.length / 16000, wallMs: performance.now() - t0, ms, pieces, speechSec });
    // Lets a Stop from the page through.
    await new Promise((r) => setTimeout(r, 0));
    if (cancelled) break;
  }
  return { cancelled, wallMs: performance.now() - t0, ms, pieces, speechSec, audioSec: pcm.length / 16000 };
}

self.onmessage = async (e) => {
  const { id, action, payload } = e.data;
  const post = (progress) => self.postMessage({ id, progress });
  try {
    let result;
    switch (action) {
      case 'load':
        result = eng ? { already: true } : await load(post, payload && payload.cacheOnly);
        break;

      case 'command': {
        // Speech in: Whistle, then Needle on what it heard.
        const t = performance.now();
        const transcript = eng.transcribe(payload.pcm, { language: 'en', keywords: payload.keywords });
        const whistleMs = performance.now() - t;
        result = { transcript, whistleMs };
        if (transcript.text && transcript.text.trim()) {
          Object.assign(result, choose(transcript.text, payload.system, payload.everything, payload.maxNewTokens));
        }
        break;
      }

      case 'choose':
        // Text in: Needle only.
        result = choose(payload.text, payload.system, payload.everything, payload.maxNewTokens);
        break;

      case 'hear': {
        // Whistle on one clip, with and without the names list.
        const t1 = performance.now();
        const withList = eng.transcribe(payload.pcm, { language: 'en', keywords: payload.keywords });
        const t2 = performance.now();
        const without = eng.transcribe(payload.pcm, { language: 'en', keywords: null });
        result = { withList, without, withMs: t2 - t1, withoutMs: performance.now() - t2 };
        break;
      }

      case 'punctuate': {
        const t = performance.now();
        result = { text: await punct.punctuate(payload.text), ms: performance.now() - t };
        break;
      }

      case 'long':
        result = await transcribeLong(id, payload, post);
        break;

      case 'cancel':
        cancelled = true;
        result = null;
        break;

      case 'forget':
        result = await caches.delete(CACHE);
        break;

      default:
        throw new Error('Unknown action ' + action);
    }
    self.postMessage({ id, ok: true, result });
  } catch (err) {
    self.postMessage({ id, ok: false, error: err && err.message ? err.message : String(err) });
  }
};
