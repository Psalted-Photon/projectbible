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
import { tidy, toolsFor, usePeopleNames, personNamed, isEveryday, splitCommands, findRefs, noopReply } from './tools.js';

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
  await timed('app', async () => {
    app = await loadAppData();
  });

  readyAt = performance.now();
  return {
    ms, fromCache, bytes: total, heapMB: eng.heapBytes() / 1048576, models: eng.models(),
    app: { people: app.byId.size, verses: app.verses.length, translations: app.translations },
  };
}

// ── The app's own data ──────────────────────────────────────────────────────
// The lab is on the app's site, so it can read the people list and the verse
// text the app has already installed in its own database. It only reads: on a
// device where the app has never run there is nothing to read, the database
// is not created, and the lab carries on without it.

let app = { byId: new Map(), byName: new Map(), keys: [], verses: [], translations: [] };
const QUOTE_TRANSLATIONS = ['kjv', 'web', 'bsb', 'net'];

function openAppDb() {
  return new Promise((resolve) => {
    const req = indexedDB.open('projectbible');
    // Only fires when the database doesn't exist yet; stop it being made.
    req.onupgradeneeded = () => req.transaction.abort();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(null);
    req.onblocked = () => resolve(null);
  });
}

function getAll(db, store, index, key) {
  return new Promise((resolve) => {
    if (!db.objectStoreNames.contains(store)) return resolve([]);
    const s = db.transaction(store, 'readonly').objectStore(store);
    const req = index ? s.index(index).getAll(key) : s.getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => resolve([]);
  });
}

/** Lower case, letters and digits only, one space between words. */
const plain = (s) => String(s ?? '').toLowerCase().replace(/[’']/g, '').replace(/[^a-z0-9]+/g, ' ').trim();

/** A stored verse as plain words: notes, tags and the reader's marks taken out. */
const verseWords = (text) =>
  plain(String(text ?? '')
    .replace(/<[^>]+>/g, '')
    .replace(/\+[^+\x01\x14\x15]*[\x01\x14\x15]/g, ' ')
    .replace(/[\x10-\x12]/g, ' ')
    .replace(/[\x00-\x1f]/g, ''));

const parseList = (v) => {
  if (Array.isArray(v)) return v;
  try { const x = JSON.parse(v || '[]'); return Array.isArray(x) ? x : []; } catch { return []; }
};

async function loadAppData() {
  const out = { byId: new Map(), byName: new Map(), keys: [], verses: [], translations: [] };
  const db = await openAppDb();
  if (!db) return out;
  try {
    for (const p of await getAll(db, 'people')) out.byId.set(p.id, p);
    for (const n of await getAll(db, 'person_names')) {
      if (!out.byName.has(n.nameLower)) out.byName.set(n.nameLower, []);
      out.byName.get(n.nameLower).push(n.personId);
    }
    for (const tid of QUOTE_TRANSLATIONS) {
      const rows = await getAll(db, 'verses', 'translationId', tid);
      if (!rows.length) continue;
      out.translations.push(tid);
      for (const v of rows) {
        const words = verseWords(v.text);
        out.verses.push({ ref: `${v.book} ${v.chapter}:${v.verse}`, tid, words: ` ${words} `, count: words ? words.split(' ').length : 0 });
      }
    }
  } finally {
    db.close();
  }
  const single = [...out.byName.keys()].filter((k) => /^[a-z]+$/.test(k));
  out.keys = single.map((k) => [k, soundKey(k)]);
  usePeopleNames(single);
  return out;
}

// ── People ──────────────────────────────────────────────────────────────────

/** How a name sounds, roughly: "mephibosheth" and "mefa boshes" both come out "mfps(t)". */
function soundKey(s) {
  const k = s.replace(/[^a-z]/g, '')
    .replace(/ph/g, 'f').replace(/sh/g, 's').replace(/th/g, 't').replace(/ch/g, 'k').replace(/gh/g, 'g')
    .replace(/c(?=[eiy])/g, 's').replace(/[cq]/g, 'k').replace(/x/g, 'ks')
    .replace(/d/g, 't').replace(/g/g, 'k').replace(/b/g, 'p').replace(/v/g, 'f').replace(/z/g, 's');
  if (!k) return '';
  return (k[0] + k.slice(1).replace(/[aeiouhwy]/g, '')).replace(/(.)\1+/g, '$1');
}

function editDistance(a, b) {
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[b.length];
}

/** The name in the people list that a misheard name sounds most like, or null. */
function soundAlike(q) {
  const flat = q.replace(/ /g, '');
  const key = soundKey(flat);
  if (key.length < 3) return null;
  let best = null;
  for (const [name, k] of app.keys) {
    const kd = editDistance(key, k);
    if (kd > (key.length >= 5 ? 2 : 1)) continue;
    const fd = editDistance(flat, name);
    if (fd > Math.max(2, Math.round(name.length * 0.45))) continue;
    if (!best || kd < best.kd || (kd === best.kd && fd < best.fd)) best = { name, kd, fd };
  }
  return best && best.name;
}

const TITLE_WORDS = /\b(the|apostle|prophet|prophetess|king|queen|saint|st|priest|judge|named|called)\b/g;
const ownNames = (p) => [p.name, String(p.displayTitle || '').replace(/\s*\(.*$/, ''), ...String(p.alsoCalled || '').split(/[,;]/)].map(plain).filter(Boolean);

function describePerson(p) {
  const kids = parseList(p.children);
  const father = parseList(p.father)[0];
  const bits = [];
  if (father) bits.push(`${p.gender === 'Female' ? 'daughter' : 'son'} of ${father.name}`);
  if (kids.length) bits.push(`${kids.length} ${kids.length === 1 ? 'child' : 'children'}`);
  if (p.verseCount) bits.push(`${p.verseCount} verse${p.verseCount === 1 ? '' : 's'}`);
  return { id: p.id, title: p.displayTitle || p.name, line: bits.join(', ') };
}

/**
 * Who a spoken name means: everyone with that name ("Which Jacob?"), or the
 * name it sounds most like when it isn't in the list as heard.
 */
function resolvePerson(heard) {
  if (!app.byName.size) return null;
  const q = plain(String(heard).replace(/'s\b/gi, '')).replace(TITLE_WORDS, ' ').replace(/\s+/g, ' ').trim();
  if (!q) return null;
  let how = 'exact';
  let key = q;
  let ids = app.byName.get(q);
  // A name heard as two words ("Matthew Bosheth") is tried by sound as a whole
  // before its words are tried one at a time.
  if (!ids && q.includes(' ')) {
    key = soundAlike(q);
    how = 'sounds like';
    ids = key && app.byName.get(key);
  }
  if (!ids) {
    key = q.split(' ').find((w) => app.byName.has(w) && !isEveryday(w));
    how = 'exact';
    ids = key && app.byName.get(key);
  }
  if (!ids) {
    key = soundAlike(q);
    how = 'sounds like';
    ids = key && app.byName.get(key);
  }
  if (!ids) return { heard, how: 'none', people: [] };
  let ps = ids.map((id) => app.byId.get(id)).filter(Boolean);
  // The index also files "Joseph (son of Jacob)" under jacob; keep the people it's the name of.
  const own = ps.filter((p) => ownNames(p).includes(key));
  if (own.length) ps = own;
  ps.sort((a, b) => (b.verseCount || 0) - (a.verseCount || 0));
  return { heard, how, name: key, people: ps.slice(0, 6).map(describePerson) };
}

const COUNT_RE = /\bhow many (sons|daughters|children|kids|wives|husbands|brothers|sisters)\b/i;

/** "How many sons…" answered from the people list, never from Needle. */
function familyCount(p, what) {
  const kin = (field) => parseList(p[field]).map((k) => ({ name: k.name, female: app.byId.get(k.slug)?.gender === 'Female' }));
  const who = p.displayTitle || p.name;
  const list = (xs) => xs.map((x) => x.name).join(', ');
  const n = (count, one, many) => `${count} ${count === 1 ? one : many}`;
  if (what === 'sons' || what === 'daughters') {
    const xs = kin('children').filter((k) => k.female === (what === 'daughters'));
    return `${who}: ${n(xs.length, what.slice(0, -1), what)}${xs.length ? ` (${list(xs)})` : ''}`;
  }
  if (what === 'children' || what === 'kids') {
    const xs = kin('children');
    const d = xs.filter((k) => k.female).length;
    return `${who}: ${n(xs.length, 'child', 'children')}${xs.length ? `, ${n(xs.length - d, 'son', 'sons')} and ${n(d, 'daughter', 'daughters')} (${list(xs)})` : ''}`;
  }
  if (what === 'wives' || what === 'husbands') {
    const xs = kin('partners');
    return `${who}: ${n(xs.length, what === 'wives' ? 'wife' : 'husband', what)}${xs.length ? ` (${list(xs)})` : ''}`;
  }
  const xs = kin('siblings').filter((k) => k.female === (what === 'sisters'));
  return `${who}: ${n(xs.length, what.slice(0, -1), what)}${xs.length ? ` (${list(xs)})` : ''}`;
}

/** The hearing list with the best-known people added, most-mentioned first. */
function withPeople(keywords, count) {
  if (!count || !app.byId.size) return keywords;
  const seen = new Set();
  const names = [];
  for (const p of [...app.byId.values()].sort((a, b) => (b.verseCount || 0) - (a.verseCount || 0))) {
    const name = String(p.name || '').trim();
    const k = plain(name);
    if (!k || seen.has(k) || isEveryday(k)) continue;
    seen.add(k);
    names.push(name);
    if (names.length >= count) break;
  }
  return [keywords, ...names].filter(Boolean).join('\n');
}

// ── Quotes ──────────────────────────────────────────────────────────────────

const STOP = new Set(`the and of to a in that he i is it for his was unto shall be they with not all him them but my you me
  so as their there this which said have from will are thy thou thee ye on by when what who were then into had no her she
  we our us your up out do did does let an at or if go its one has been can may over say says where show open find tell
  about look verse verses chapter read`.split(/\s+/));

/** A word without its ending, so "loved", "love" and "loveth" match, and "God's" matches "God". */
const stem = (w) => (w.length > 3 ? w.replace(/(eth|est|ing|ed|es|s|e)$/, '') : w) || w;

/**
 * The best stretch where the spoken words follow a verse in order: each match
 * scores 2, each skipped or misheard word costs 1, so the stretch stays tight.
 * Returns how many words matched and how long the verse stretch was.
 */
function alignInOrder(said, verse) {
  const n = said.length;
  const m = verse.length;
  const H = Array.from({ length: n + 1 }, () => new Int16Array(m + 1));
  let best = 0;
  let bi = 0;
  let bj = 0;
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      const h = Math.max(0, H[i - 1][j - 1] + (said[i - 1] === verse[j - 1] ? 2 : -1), H[i - 1][j] - 1, H[i][j - 1] - 1);
      H[i][j] = h;
      if (h > best) [best, bi, bj] = [h, i, j];
    }
  }
  // Back through the stretch, counting matches.
  let i = bi;
  let j = bj;
  let matched = 0;
  let first = bj;
  while (i > 0 && j > 0 && H[i][j] > 0) {
    const h = H[i][j];
    if (said[i - 1] === verse[j - 1] && h === H[i - 1][j - 1] + 2) {
      matched++;
      first = j;
      i--;
      j--;
    } else if (h === H[i - 1][j - 1] - 1) {
      i--;
      j--;
    } else if (h === H[i - 1][j] - 1) {
      i--;
    } else {
      j--;
    }
  }
  return { score: best, matched, span: bj - first + 1 };
}

/**
 * Whether what was said is a verse being quoted: four or more words in order
 * from one verse, at most two verse words skipped, so one misheard word ("For
 * God's love, the world") still finds it; or a whole short verse ("Jesus
 * wept"). A phrase that turns up in more than three verses is a saying, not a
 * quote.
 */
function findQuote(text) {
  if (!app.verses.length) return null;
  const t = performance.now();
  const words = plain(text).split(' ').filter(Boolean);
  if (words.length < 2) return null;
  const said = words.map(stem);
  const content = [...new Set(words.filter((w) => w.length >= 3 && !STOP.has(w)).map(stem))].sort((a, b) => b.length - a.length).slice(0, 4);
  if (!content.length) return null;
  const need = Math.min(2, content.length);
  let best = null;
  let found = new Map();
  for (const v of app.verses) {
    let hits = 0;
    for (const w of content) if (v.words.includes(` ${w}`)) hits++;
    if (hits < need) continue;
    const a = alignInOrder(said, v.words.trim().split(' ').map(stem));
    const whole = a.matched === words.length && v.count === words.length;
    if (!whole && (a.matched < 4 || a.span > a.matched + 2)) continue;
    if (!best || a.score > best.score) {
      best = a;
      found = new Map();
    }
    if (a.score === best.score) {
      if (!found.has(v.ref)) found.set(v.ref, { ref: v.ref, tids: [], whole });
      found.get(v.ref).tids.push(v.tid);
    }
  }
  const ms = performance.now() - t;
  if (!best) return { ms, none: true };
  const refs = [...found.values()];
  if (refs.length > 3) return { ms, common: refs.length, run: best.matched, of: words.length };
  return { ms, ref: refs[0].ref, tids: refs[0].tids, also: refs.slice(1).map((r) => r.ref), run: best.matched, of: words.length, whole: refs[0].whole };
}

const argsOf = (c) => {
  if (typeof c.arguments === 'string') {
    try { return JSON.parse(c.arguments); } catch { return {}; }
  }
  return c.arguments || {};
};

/** Sets the tools only when they differ from the last set, and times it. */
function useTools(system, toolsJson) {
  if (toolsSent === system + '\n' + toolsJson) return { initMs: 0, prefix: null };
  const t = performance.now();
  const prefix = eng.init(system, toolsJson);
  toolsSent = system + '\n' + toolsJson;
  return { initMs: performance.now() - t, prefix };
}

/**
 * Needle's picks for one piece, put right by what the words say:
 * - a call the engine held back is used when it was the only action shown and
 *   every value in it was said ("find every verse about the wind")
 * - a color, look or new window nobody said is dropped
 * - references come from the words, not from Needle, which split "1
 *   thessalonians 4:16" in two and dropped the 5 from "2 Corinthians 5"
 */
function settle(text, picked, answer) {
  const notes = [];
  const words = text.toLowerCase();
  let calls = (answer?.function_calls || []).map((c) => ({ name: c.name, args: { ...argsOf(c) } }));
  let promoted = false;
  if (!calls.length && picked.tools.length === 1) {
    const held = (answer?.suppressed_calls || []).find((c) => c.name === picked.tools[0].name
      && Object.values(argsOf(c)).every((v) => typeof v !== 'string' || (v.trim() && words.includes(v.toLowerCase().trim()))));
    if (held) {
      calls = [{ name: held.name, args: { ...argsOf(held) } }];
      promoted = true;
      notes.push('held back by the engine, but every word of it was said');
    }
  }
  for (const c of calls) {
    if (c.name === 'highlight') {
      for (const k of ['color', 'look']) {
        if (c.args[k] && !new RegExp(`\\b${c.args[k]}\\b`, 'i').test(text)) {
          notes.push(`dropped ${k} "${c.args[k]}", which wasn't said`);
          delete c.args[k];
        }
      }
    }
    if (c.args.new_window === true && !/\bnew window\b/i.test(text)) {
      notes.push('dropped "new window", which wasn\'t said');
      c.args.new_window = false;
    }
  }
  const refs = findRefs(text);
  // "Matthew Henry on Romans 8": the commentary opens there.
  for (const c of calls) {
    if (refs.length && c.name === 'commentary' && !c.args.at) c.args.at = refs[0].text;
    if (refs.length && c.name === 'connections' && !c.args.reference) c.args.reference = refs[0].text;
  }
  const at = calls.findIndex((c) => c.name === 'passage');
  if (at >= 0) {
    const needle = calls.filter((c) => c.name === 'passage').map((c) => c.args.reference).join(' + ');
    const rest = calls.filter((c) => c.name !== 'passage');
    let passages;
    if (refs.length) {
      passages = refs.map((r) => ({ name: 'passage', args: { reference: r.valid ? r.text : r.suggest || r.text } }));
      const ours = refs.map((r) => r.text).join(' + ');
      if (ours.toLowerCase() !== needle.toLowerCase()) notes.push(`reference read from the words: ${ours} (Needle had ${needle})`);
    } else {
      passages = [{ name: 'passage', args: { reference: needle.replace(/ \+ /g, ' ') } }];
      if (needle.includes(' + ')) notes.push(`Needle's pieces joined: ${passages[0].args.reference}`);
    }
    calls = [...rest.slice(0, at), ...passages, ...rest.slice(at)];
  }
  const bad = refs.find((r) => !r.valid);
  return { calls, notes, promoted, refProblem: bad ? (bad.suggest ? `Did you mean ${bad.suggest}?` : `There's no ${bad.text}`) : null };
}

/** One piece of what was said through Needle, with the actions its trigger words picked. */
function runPiece(text, system, everything, maxNewTokens) {
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
  const needleMs = performance.now() - t;
  return {
    text, answer, needleMs, ...tools, toolCount: picked.tools.length, toolNames: picked.tools.map((x) => x.name), groups: picked.groups,
    single: picked.tools.length === 1, ...settle(text, picked, answer),
  };
}

function choose(heard, system, everything, maxNewTokens) {
  const text = tidy(heard);
  const appData = app.byId.size > 0 || app.verses.length > 0;
  const noop = noopReply(text);
  if (noop != null) return { tidied: text, noop, pieces: [], calls: [], people: [], appData };
  const pieces = (everything ? [text] : splitCommands(text)).map((p) => runPiece(p, system, everything, maxNewTokens));
  const calls = pieces.flatMap((p) => p.calls);
  const sum = (k) => pieces.reduce((a, p) => a + (p[k] || 0), 0);
  // What the app adds from its own data: a verse the words quote, who a named
  // person is, and family counts.
  const quote = findQuote(text);
  const people = calls.map((c) => (c.args.person ? resolvePerson(c.args.person) : null));
  let count = null;
  let countWho = null;
  const asks = COUNT_RE.exec(text);
  if (asks) {
    const who = calls.map((c) => c.args.person).find(Boolean) || personNamed(text);
    const found = who && resolvePerson(who);
    if (found?.people.length) {
      count = found.people.slice(0, 3).map((p) => familyCount(app.byId.get(p.id), asks[1].toLowerCase()));
      countWho = found.people[0].title;
    }
  }
  return {
    tidied: text, pieces, calls, answer: pieces.length === 1 ? pieces[0].answer : null,
    needleMs: sum('needleMs'), initMs: sum('initMs'), toolCount: sum('toolCount'),
    quote, people, count, countWho, appData,
  };
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
        const transcript = eng.transcribe(payload.pcm, { language: 'en', keywords: withPeople(payload.keywords, payload.people) });
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
        const withList = eng.transcribe(payload.pcm, { language: 'en', keywords: withPeople(payload.keywords, payload.people) });
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
