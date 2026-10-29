/**
 * Voice Control's worker: Whistle and Needle run here, off the page's thread,
 * the way Read Aloud's voices run, along with the rules that put Needle's
 * picks right, the verse text spoken quotes are matched against, and the
 * people list that names are matched against.
 *
 * Requests:  { id, action, payload }
 * Responses: { id, ok: true, result } | { id, ok: false, error }
 * Progress:  { id, progress: { stage } }
 *
 * Moved here from the Voice Control lab (public/voice-control-lab/worker.js).
 */

import { NeedleEngine, type NeedleAnswer } from './engine';
import {
  tidy,
  toolsFor,
  splitCommands,
  findRefs,
  noopReply,
  usePeopleNames,
  personNamed,
  isEveryday,
  APP_KEYWORDS,
  type ToolSpec,
} from './rules';
import { editDistance, soundKey } from '../fuzzy';

/** One action, as the app carries it out. */
export interface VoiceCall {
  name: string;
  args: Record<string, any>;
  /** The person named, as the people list has the name ("mephibosheth" for "Mefi Bosheth"). */
  person?: string;
  /** Everyone that is the name of, most-mentioned first: not those it is only in the title of ("Joseph, son of Jacob"). */
  personIds?: string[];
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
  /** "How many sons…", answered from the people list: "Jacob: 12 sons (Reuben, …)". */
  answer: string | null;
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
  await loadAppData();
  eng = engine;
}

// ── The app's verse text and people ─────────────────────────────────────────
// Read once from the app's own database, for matching spoken quotes and
// naming people, and again when a pack comes in. Only read: the connection
// closes as soon as they are in, so it can never hold up the app opening a
// newer version of the database.

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

function getAll(db: IDBDatabase, store: string, index?: string, key?: IDBValidKey): Promise<any[]> {
  return new Promise((resolve) => {
    if (!db.objectStoreNames.contains(store)) return resolve([]);
    const s = db.transaction(store, 'readonly').objectStore(store);
    const req = index ? s.index(index).getAll(key) : s.getAll();
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

async function loadAppData(): Promise<void> {
  const nextVerses: VerseWords[] = [];
  const byId = new Map<string, any>();
  const byName = new Map<string, string[]>();
  const db = await openAppDb();
  if (db) {
    try {
      for (const tid of QUOTE_TRANSLATIONS) {
        for (const v of await getAll(db, 'verses', 'translationId', tid)) {
          const words = verseWords(v.text);
          nextVerses.push({ ref: `${v.book} ${v.chapter}:${v.verse}`, words: ` ${words} `, count: words ? words.split(' ').length : 0 });
        }
      }
      for (const p of await getAll(db, 'people')) byId.set(p.id, p);
      for (const n of await getAll(db, 'person_names')) {
        if (!byName.has(n.nameLower)) byName.set(n.nameLower, []);
        byName.get(n.nameLower)!.push(n.personId);
      }
    } finally {
      db.close();
    }
  }
  verses = nextVerses;
  const single = [...byName.keys()].filter((k) => /^[a-z]+$/.test(k));
  people = { byId, byName, keys: single.map((k) => [k, soundKey(k)]) };
  // Their names bring in the family tree and bio actions (rules.ts).
  usePeopleNames(single);
}

// ── People ──────────────────────────────────────────────────────────────────

let people: { byId: Map<string, any>; byName: Map<string, string[]>; keys: [string, string][] } = {
  byId: new Map(),
  byName: new Map(),
  keys: [],
};

const parseList = (v: unknown): any[] => {
  if (Array.isArray(v)) return v;
  try {
    const x = JSON.parse(String(v || '[]'));
    return Array.isArray(x) ? x : [];
  } catch {
    return [];
  }
};

/** The name in the people list that a misheard name sounds most like, or null. */
function soundAlike(q: string): string | null {
  const flat = q.replace(/ /g, '');
  const key = soundKey(flat);
  if (key.length < 3) return null;
  let best: { name: string; kd: number; fd: number } | null = null;
  for (const [name, k] of people.keys) {
    const kd = editDistance(key, k);
    if (kd > (key.length >= 5 ? 2 : 1)) continue;
    const fd = editDistance(flat, name);
    if (fd > Math.max(2, Math.round(name.length * 0.45))) continue;
    if (!best || kd < best.kd || (kd === best.kd && fd < best.fd)) best = { name, kd, fd };
  }
  return best?.name ?? null;
}

const TITLE_WORDS = /\b(the|apostle|prophet|prophetess|king|queen|saint|st|priest|judge|named|called)\b/g;
const ownNames = (p: any) =>
  [p.name, String(p.displayTitle || '').replace(/\s*\(.*$/, ''), ...String(p.alsoCalled || '').split(/[,;]/)].map(plain).filter(Boolean);

/**
 * Who a spoken name means: the name as the people list has it, and everyone
 * with that name, most-mentioned first. A name not in the list as heard is
 * matched by how it sounds ("Mefi Bosheth"). Null when nobody fits.
 */
function resolvePerson(heard: string): { name: string; people: any[] } | null {
  if (!people.byName.size) return null;
  const q = plain(String(heard).replace(/'s\b/gi, '')).replace(TITLE_WORDS, ' ').replace(/\s+/g, ' ').trim();
  if (!q) return null;
  let key: string | null | undefined = q;
  let ids = people.byName.get(q);
  // A name heard as two words ("Matthew Bosheth") is tried by sound as a whole
  // before its words are tried one at a time.
  if (!ids && q.includes(' ')) {
    key = soundAlike(q);
    ids = key ? people.byName.get(key) : undefined;
  }
  if (!ids) {
    key = q.split(' ').find((w) => people.byName.has(w) && !isEveryday(w));
    ids = key ? people.byName.get(key) : undefined;
  }
  if (!ids) {
    key = soundAlike(q);
    ids = key ? people.byName.get(key) : undefined;
  }
  if (!ids || !key) return null;
  const name = key;
  let ps = ids.map((id) => people.byId.get(id)).filter(Boolean);
  // The index also files "Joseph (son of Jacob)" under jacob; keep the people it's the name of.
  const own = ps.filter((p) => ownNames(p).includes(name));
  if (own.length) ps = own;
  ps.sort((a, b) => (b.verseCount || 0) - (a.verseCount || 0));
  return { name, people: ps };
}

const COUNT_RE = /\bhow many (sons|daughters|children|kids|wives|husbands|brothers|sisters)\b/i;
const PLACE_OF_RE = /\bwhere (?:was|is|were) (.+?) (born|from|raised|buried)\b|\bwhere did (.+?) (die|come from|grow up|get buried)\b/i;

/** "How many sons…" answered from the people list, never from Needle. */
function familyCount(p: any, what: string): string {
  const kin = (field: string) => parseList(p[field]).map((k) => ({ name: String(k.name), female: people.byId.get(k.slug)?.gender === 'Female' }));
  const who = p.displayTitle || p.name;
  const list = (xs: { name: string }[]) => xs.map((x) => x.name).join(', ');
  const n = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;
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

/** Where the people list says someone was born or died, or null. */
function placeOf(p: any, died: boolean): string | null {
  try {
    return JSON.parse(p[died ? 'deathPlace' : 'birthPlace'] || 'null')?.name ?? null;
  } catch {
    return null;
  }
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
 * - "where was Jesus born" is the map at the place the people list has
 * - a person is the name the people list has, matched by sound if need be
 * - references come from the words, not from Needle, which split "1
 *   thessalonians 4:16" in two and dropped the 5 from "2 Corinthians 5"
 */
function settle(text: string, tools: ToolSpec[], answer: NeedleAnswer | undefined): Omit<VoicePiece, 'text' | 'confidence' | 'single'> {
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
  // "Where was Jesus born": the people list knows, so the map opens there
  // (Needle tends to put the person in as the place). With no place on
  // record, the bio is the best answer.
  const where = PLACE_OF_RE.exec(text);
  if (where && tools.some((t) => t.name === 'map')) {
    const found = resolvePerson(where[1] || where[3]);
    if (found?.people.length) {
      const place = placeOf(found.people[0], /die|buried/i.test(where[2] || where[4]));
      calls = place
        ? [...calls.filter((c) => c.name !== 'map'), { name: 'map', args: { place } }]
        : [{ name: 'biography', args: { person: found.name } }];
      promoted = true;
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
  // "Matthew Henry on Romans 8": the commentary opens there, and so do the
  // connections. A year Needle left out of a map is taken from the words.
  const year = /\b(\d{1,4})\s*(BC|AD|BCE|CE)\b/i.exec(text);
  for (const c of calls) {
    if (refs.length && c.name === 'commentary' && !c.args.at) c.args.at = refs[0].text;
    if (refs.length && c.name === 'connections' && !c.args.reference) c.args.reference = refs[0].text;
    if (c.name === 'map' && !c.args.year && year) c.args.year = `${year[1]} ${year[2].toUpperCase()}`;
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
  // A name as the people list has it, so the app finds them however Whistle spelled it.
  for (const c of calls) {
    if (typeof c.args.person !== 'string' || !c.args.person.trim()) continue;
    const found = resolvePerson(c.args.person);
    if (found) {
      c.person = found.name;
      c.personIds = found.people.map((p) => String(p.id));
    }
  }
  const bad = refs.find((r) => !r.valid);
  return { calls, promoted, grounded, refProblem: bad ? (bad.suggest ? `Did you mean ${bad.suggest}?` : `There's no ${bad.text}.`) : null };
}

/** One piece of what was said through Needle, with the actions its trigger words picked. */
function runPiece(engine: NeedleEngine, text: string, system: string): VoicePiece {
  const { tools } = toolsFor(text);
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
  return { text, confidence: answer?.confidence ?? null, single: tools.length === 1, ...settle(text, tools, answer) };
}

/** "How many sons does Jacob have": the count, from the people list, for the most-mentioned one of that name. */
function countAnswer(text: string, calls: VoiceCall[]): string | null {
  const asks = COUNT_RE.exec(text);
  if (!asks) return null;
  const who = calls.map((c) => c.args.person).find((p) => typeof p === 'string' && p.trim()) || personNamed(text);
  const found = who ? resolvePerson(who) : null;
  return found?.people.length ? familyCount(found.people[0], asks[1].toLowerCase()) : null;
}

function choose(engine: NeedleEngine, heard: string, system: string): VoiceChoice {
  const text = tidy(heard);
  const noop = noopReply(text);
  if (noop != null) return { tidied: text, noop, pieces: [], quote: null, answer: null };
  const pieces = splitCommands(text).map((p) => runPiece(engine, p, system));
  return { tidied: text, noop: null, pieces, quote: findQuote(text), answer: countAnswer(text, pieces.flatMap((p) => p.calls)) };
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

      case 'data':
        // A pack came in or went: the verses and people again.
        if (eng) await loadAppData();
        result = null;
        break;

      default:
        throw new Error('Unknown action ' + action);
    }
    self.postMessage({ id, ok: true, result });
  } catch (err) {
    self.postMessage({ id, ok: false, error: err instanceof Error ? err.message : String(err) });
  }
};
