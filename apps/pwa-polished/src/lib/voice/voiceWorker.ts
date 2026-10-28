/**
 * Voice Control's worker: Whistle and Needle run here, off the page's thread,
 * the way Read Aloud's voices run, along with the rules that put Needle's
 * picks right and the verse text spoken quotes are matched against.
 *
 * Requests:  { id, action, payload }
 * Responses: { id, ok: true, result } | { id, ok: false, error }
 * Progress:  { id, progress: { stage } }
 *
 * Moved here from the Voice Control lab (public/voice-control-lab/worker.js).
 */

import { NeedleEngine, type NeedleAnswer } from './engine';
import { tidy, toolsFor, splitCommands, findRefs, noopReply, APP_KEYWORDS, type ToolSpec } from './rules';

/** One action, as the app carries it out. */
export interface VoiceCall {
  name: string;
  args: Record<string, any>;
}

/** One piece of what was said, with Needle's picks put right. */
export interface VoicePiece {
  text: string;
  calls: VoiceCall[];
  confidence: number | null;
  /** Only one action was shown to Needle. */
  single: boolean;
  /** A call the rules made sure of even though Needle held it back or had nothing. */
  promoted: boolean;
  /** Every value in the calls was said. */
  grounded: boolean;
  /** "Did you mean Psalm 119:105?", or "There's no John 30". */
  refProblem: string | null;
  /** Only actions the app can't do yet were asked for, so Needle wasn't asked. */
  notYet: boolean;
}

/** A verse the words quote, or why they don't. */
export interface QuoteMatch {
  ref?: string;
  /** Matched words in order, out of how many were said. */
  run?: number;
  of?: number;
  /** The whole verse was said. */
  whole?: boolean;
  /** The phrase is in this many verses: a saying, not a quote. */
  common?: number;
}

export interface VoiceChoice {
  tidied: string;
  /** Said to the app but asking for nothing: the reply ("" for none). */
  noop: string | null;
  pieces: VoicePiece[];
  quote: QuoteMatch | null;
}

// The files voicePack.ts downloads, in the same folder of the browser's file storage.
const FOLDER = 'voice-control';
const FILES = { js: 'voice-needle.js', wasm: 'voice-needle.wasm', whistle: 'voice-whistle.cact', needle: 'voice-needle3.cact' };

async function readFile(name: string): Promise<Uint8Array> {
  const root = await navigator.storage.getDirectory();
  const dir = await root.getDirectoryHandle(FOLDER);
  const file = await (await dir.getFileHandle(name)).getFile();
  return new Uint8Array(await file.arrayBuffer());
}

// ── Engines ─────────────────────────────────────────────────────────────────

let eng: NeedleEngine | null = null;
let toolsSent: string | null = null;

async function load(post: (stage: string) => void): Promise<void> {
  post('engine');
  const [js, wasm] = await Promise.all([readFile(FILES.js), readFile(FILES.wasm)]);
  const createNeedle = new Function(new TextDecoder().decode(js) + '\nreturn createNeedle;')();
  const engine = await NeedleEngine.create(createNeedle, wasm);
  post('whistle');
  engine.load(await readFile(FILES.whistle));
  post('needle');
  engine.load(await readFile(FILES.needle));
  post('verses');
  verses = await loadVerses();
  eng = engine;
}

// ── The app's verse text ────────────────────────────────────────────────────
// Read once from the app's own database, for matching spoken quotes. Only
// read: the connection closes as soon as the verses are in, so it can never
// hold up the app opening a newer version of the database.

interface VerseWords {
  ref: string;
  words: string;
  count: number;
}

let verses: VerseWords[] = [];
const QUOTE_TRANSLATIONS = ['kjv', 'web', 'bsb', 'net'];

function openAppDb(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    const req = indexedDB.open('projectbible');
    // Only fires when the database doesn't exist yet; stop it being made.
    req.onupgradeneeded = () => req.transaction?.abort();
    req.onsuccess = () => {
      req.result.onversionchange = () => req.result.close();
      resolve(req.result);
    };
    req.onerror = () => resolve(null);
    req.onblocked = () => resolve(null);
  });
}

function versesOf(db: IDBDatabase, translationId: string): Promise<any[]> {
  return new Promise((resolve) => {
    if (!db.objectStoreNames.contains('verses')) return resolve([]);
    const req = db.transaction('verses', 'readonly').objectStore('verses').index('translationId').getAll(translationId);
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => resolve([]);
  });
}

/** Lower case, letters and digits only, one space between words. */
const plain = (s: unknown) => String(s ?? '').toLowerCase().replace(/[’']/g, '').replace(/[^a-z0-9]+/g, ' ').trim();

/** A stored verse as plain words: notes, tags and the reader's marks taken out. */
const verseWords = (text: unknown) =>
  plain(String(text ?? '')
    .replace(/<[^>]+>/g, '')
    .replace(/\+[^+\x01\x14\x15]*[\x01\x14\x15]/g, ' ')
    .replace(/[\x10-\x12]/g, ' ')
    .replace(/[\x00-\x1f]/g, ''));

async function loadVerses(): Promise<VerseWords[]> {
  const out: VerseWords[] = [];
  const db = await openAppDb();
  if (!db) return out;
  try {
    for (const tid of QUOTE_TRANSLATIONS) {
      for (const v of await versesOf(db, tid)) {
        const words = verseWords(v.text);
        out.push({ ref: `${v.book} ${v.chapter}:${v.verse}`, words: ` ${words} `, count: words ? words.split(' ').length : 0 });
      }
    }
  } finally {
    db.close();
  }
  return out;
}

// ── Quotes ──────────────────────────────────────────────────────────────────

const STOP = new Set(`the and of to a in that he i is it for his was unto shall be they with not all him them but my you me
  so as their there this which said have from will are thy thou thee ye on by when what who were then into had no her she
  we our us your up out do did does let an at or if go its one has been can may over say says where show open find tell
  about look verse verses chapter read`.split(/\s+/));

/** A word without its ending, so "loved", "love" and "loveth" match, and "God's" matches "God". */
const stem = (w: string) => (w.length > 3 ? w.replace(/(eth|est|ing|ed|es|s|e)$/, '') : w) || w;

/**
 * The best stretch where the spoken words follow a verse in order: each match
 * scores 2, each skipped or misheard word costs 1, so the stretch stays tight.
 * Returns how many words matched and how long the verse stretch was.
 */
function alignInOrder(said: string[], verse: string[]): { score: number; matched: number; span: number } {
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
function findQuote(text: string): QuoteMatch | null {
  if (!verses.length) return null;
  const words = plain(text).split(' ').filter(Boolean);
  if (words.length < 2) return null;
  const said = words.map(stem);
  const content = [...new Set(words.filter((w) => w.length >= 3 && !STOP.has(w)).map(stem))].sort((a, b) => b.length - a.length).slice(0, 4);
  if (!content.length) return null;
  const need = Math.min(2, content.length);
  let best: { score: number; matched: number } | null = null;
  let found = new Map<string, boolean>();
  for (const v of verses) {
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
    if (a.score === best.score && !found.has(v.ref)) found.set(v.ref, whole);
  }
  if (!best) return null;
  if (found.size > 3) return { common: found.size, run: best.matched, of: words.length };
  const [ref, whole] = [...found][0];
  return { ref, run: best.matched, of: words.length, whole };
}

// ── Needle's picks, put right ───────────────────────────────────────────────

const argsOf = (c: { arguments?: unknown }): Record<string, any> => {
  if (typeof c.arguments === 'string') {
    try {
      return JSON.parse(c.arguments);
    } catch {
      return {};
    }
  }
  return (c.arguments as Record<string, any>) || {};
};

/** Sets the tools only when they differ from the last set. */
function useTools(engine: NeedleEngine, system: string, toolsJson: string): void {
  if (toolsSent === system + '\n' + toolsJson) return;
  engine.init(system, toolsJson);
  toolsSent = system + '\n' + toolsJson;
}

/**
 * Needle's picks for one piece, put right by what the words say:
 * - a call the engine held back is used when it was the only action shown and
 *   every value in it was said ("find every verse about the wind")
 * - a cut-off word ("orgiveness") is the whole word that was said
 * - a color, look or new window nobody said is dropped
 * - references come from the words, not from Needle, which split "1
 *   thessalonians 4:16" in two and dropped the 5 from "2 Corinthians 5"
 */
function settle(text: string, tools: ToolSpec[], answer: NeedleAnswer | undefined): Omit<VoicePiece, 'text' | 'confidence' | 'single' | 'notYet'> {
  const words = text.toLowerCase();
  const said = (v: unknown) => typeof v !== 'string' || (v.trim() !== '' && words.includes(v.toLowerCase().trim()));
  const refs = findRefs(text);
  let calls: VoiceCall[] = (answer?.function_calls || []).map((c) => ({ name: c.name, args: { ...argsOf(c) } }));
  let promoted = false;
  if (!calls.length && tools.length === 1) {
    const held = (answer?.suppressed_calls || []).find((c) => c.name === tools[0].name && Object.values(argsOf(c)).every(said));
    if (held) {
      calls = [{ name: held.name, args: { ...argsOf(held) } }];
      promoted = true;
    } else if (tools[0].name === 'passage' && refs.some((r) => r.valid)) {
      // "Open Mark 4": Needle had nothing, but a reference said alone is a passage.
      calls = [{ name: 'passage', args: { reference: refs[0].text } }];
      promoted = true;
    }
  }
  const wholeWord = (v: string) => new RegExp(`(^|[^a-z'])${v.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^a-z'])`, 'i').test(text);
  for (const c of calls) {
    for (const [k, v] of Object.entries(c.args)) {
      if (typeof v !== 'string' || v.trim().length < 4 || wholeWord(v)) continue;
      const at = words.indexOf(v.toLowerCase().trim());
      if (at < 0) continue;
      let s = at;
      let e = at + v.trim().length;
      while (s > 0 && /[a-z']/.test(words[s - 1])) s--;
      while (e < words.length && /[a-z']/.test(words[e])) e++;
      c.args[k] = text.slice(s, e);
    }
  }
  for (const c of calls) {
    if (c.name === 'highlight') {
      for (const k of ['color', 'look']) {
        if (c.args[k] && !new RegExp(`\\b${c.args[k]}\\b`, 'i').test(text)) delete c.args[k];
      }
    }
    if (c.args.new_window === true && !/\bnew window\b/i.test(text)) c.args.new_window = false;
  }
  // "Matthew Henry on Romans 8": the commentary opens there.
  for (const c of calls) {
    if (refs.length && c.name === 'commentary' && !c.args.at) c.args.at = refs[0].text;
  }
  // Every value in the picks was said (the commentator's name, the search
  // words), so a low score from Needle needn't stop a turn with one action.
  const grounded = calls.length > 0
    && calls.every((c) => Object.entries(c.args).filter(([k, v]) => k !== 'at' && typeof v === 'string').some(([, v]) => v.trim())
      && Object.entries(c.args).every(([k, v]) => k === 'at' || said(v)));
  const at = calls.findIndex((c) => c.name === 'passage');
  if (at >= 0) {
    const needle = calls.filter((c) => c.name === 'passage').map((c) => c.args.reference).join(' ');
    const rest = calls.filter((c) => c.name !== 'passage');
    const passages = refs.length
      ? refs.map((r) => ({ name: 'passage', args: { reference: r.valid ? r.text : r.suggest || r.text } }))
      : [{ name: 'passage', args: { reference: needle } }];
    calls = [...rest.slice(0, at), ...passages, ...rest.slice(at)];
  }
  const bad = refs.find((r) => !r.valid);
  return { calls, promoted, grounded, refProblem: bad ? (bad.suggest ? `Did you mean ${bad.suggest}?` : `There's no ${bad.text}.`) : null };
}

/** One piece of what was said through Needle, with the actions its trigger words picked. */
function runPiece(engine: NeedleEngine, text: string, system: string): VoicePiece {
  const { tools } = toolsFor(text);
  if (!tools.length) return { text, calls: [], confidence: null, single: false, promoted: false, grounded: false, refProblem: null, notYet: true };
  const toolsJson = JSON.stringify(tools);
  useTools(engine, system, toolsJson);
  engine.reset();
  let answer: NeedleAnswer;
  try {
    answer = engine.complete(text);
  } catch {
    // If a reset also drops the tools, setting them again is the fix.
    toolsSent = null;
    useTools(engine, system, toolsJson);
    answer = engine.complete(text);
  }
  return { text, confidence: answer?.confidence ?? null, single: tools.length === 1, notYet: false, ...settle(text, tools, answer) };
}

function choose(engine: NeedleEngine, heard: string, system: string): VoiceChoice {
  const text = tidy(heard);
  const noop = noopReply(text);
  if (noop != null) return { tidied: text, noop, pieces: [], quote: null };
  const pieces = splitCommands(text).map((p) => runPiece(engine, p, system));
  return { tidied: text, noop: null, pieces, quote: findQuote(text) };
}

function ready(): NeedleEngine {
  if (!eng) throw new Error('Voice Control is not loaded');
  return eng;
}

self.onmessage = async (e: MessageEvent<{ id: number; action: string; payload?: any }>) => {
  const { id, action, payload } = e.data;
  try {
    let result: unknown;
    switch (action) {
      case 'load':
        if (!eng) await load((stage) => self.postMessage({ id, progress: { stage } }));
        result = null;
        break;

      case 'command': {
        // Speech in: Whistle, then Needle on what it heard.
        const engine = ready();
        const heard = engine.transcribe(payload.pcm, APP_KEYWORDS).text?.trim() ?? '';
        result = { heard, choice: heard ? choose(engine, heard, payload.system) : null };
        break;
      }

      case 'choose':
        // Text in: Needle only.
        result = choose(ready(), payload.text, payload.system);
        break;

      default:
        throw new Error('Unknown action ' + action);
    }
    self.postMessage({ id, ok: true, result });
  } catch (err) {
    self.postMessage({ id, ok: false, error: err instanceof Error ? err.message : String(err) });
  }
};
