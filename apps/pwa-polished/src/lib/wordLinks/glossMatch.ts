/**
 * Finding a Greek or Hebrew word's English in a verse by what it means.
 *
 * The fallback for English the Word Links pack (index.ts) doesn't cover, or
 * doesn't link to this number. It works from the lexicon: every way the KJV
 * rendered the number ("love", "beloved") plus its short definition, with
 * English endings added ("loved", "loveth"). It runs on any translation, so it
 * is cautious. It marks only when
 * the verse leaves no doubt: one match, or exactly as many matches as the
 * Greek or Hebrew has marked words. Anything else marks nothing, because a
 * missing highlight is better than a wrong one.
 */

import { lookupStrongs } from '../../adapters/lexicon-lookup.js';
import { classicId, parseKjvUsage } from '../strongs/entry';

export interface Span {
  s: number;
  e: number;
}

/** Words with no English of their own (the article, "and", the object marker). */
const NEVER_MARKED = new Set([
  'G3588', 'G2532', 'G1161', 'G0846',
  'H0853', 'H3588', 'H0834', 'H5921', 'H0413', 'H3605',
]);

/** True for a classic number whose English is never marked, linked or not. */
export function isNeverMarked(classicNumber: string): boolean {
  return NEVER_MARKED.has(classicNumber);
}

/** English too common to mean anything on its own. */
const FUNCTION_WORDS = new Set(
  ('a an the of to and or but nor be is are was were been am it its as at by he him his she her ' +
    'they them their we us our me my i you your thou thee thy ye so no not do did done that this ' +
    'these those there then than when where which who whom what while with for from in into on ' +
    'upon out up after before about through under over among between against unto also')
    .split(' '),
);

/** Past and other forms the ending rules can't make. */
const IRREGULAR: Record<string, string[]> = {
  arise: ['arose', 'arisen'],
  beget: ['begat', 'begot', 'begotten'],
  begin: ['began', 'begun'],
  bear: ['bare', 'bore', 'born', 'borne'],
  bring: ['brought'],
  build: ['built'],
  buy: ['bought'],
  catch: ['caught'],
  choose: ['chose', 'chosen'],
  come: ['came'],
  die: ['died', 'dying'],
  drink: ['drank', 'drunk'],
  eat: ['ate', 'eaten'],
  fall: ['fell', 'fallen'],
  find: ['found'],
  flee: ['fled'],
  forgive: ['forgave', 'forgiven'],
  forsake: ['forsook', 'forsaken'],
  give: ['gave', 'given'],
  go: ['went', 'gone', 'goeth'],
  have: ['had', 'hath', 'hast'],
  hear: ['heard'],
  hold: ['held'],
  keep: ['kept'],
  know: ['knew', 'known'],
  lay: ['laid'],
  lead: ['led'],
  leave: ['left'],
  lie: ['lay', 'lain', 'lying'],
  lose: ['lost'],
  make: ['made'],
  rise: ['rose', 'risen'],
  run: ['ran'],
  say: ['said', 'saith', 'saidst'],
  see: ['saw', 'seen'],
  seek: ['sought'],
  sell: ['sold'],
  send: ['sent'],
  sit: ['sat'],
  slay: ['slew', 'slain'],
  speak: ['spake', 'spoke', 'spoken'],
  stand: ['stood'],
  take: ['took', 'taken'],
  teach: ['taught'],
  tell: ['told'],
  think: ['thought'],
  understand: ['understood'],
  write: ['wrote', 'written'],
};

const VOWEL = /[aeiou]/;

/** A word with the endings English (and the KJV's -eth, -est) puts on it. */
function inflect(word: string): string[] {
  const w = word.toLowerCase();
  if (w.length < 3) return [w];
  const out = new Set([w, `${w}s`, `${w}es`, `${w}ed`, `${w}ing`, `${w}eth`, `${w}est`]);
  if (w.endsWith('e')) {
    const stem = w.slice(0, -1);
    for (const end of ['d', 'th', 'st', 'r']) out.add(w + end);
    for (const end of ['ing', 'ed', 'eth', 'est']) out.add(stem + end);
  }
  if (/[^aeiou]y$/.test(w)) {
    const stem = w.slice(0, -1);
    for (const end of ['ies', 'ied', 'ieth', 'iest']) out.add(stem + end);
  }
  // Doubled consonant: sin → sinned, sinning.
  const last = w[w.length - 1];
  if (!VOWEL.test(last) && !/[wxy]/.test(last) && VOWEL.test(w[w.length - 2]) && !VOWEL.test(w[w.length - 3])) {
    for (const end of ['ed', 'ing', 'eth', 'est']) out.add(w + last + end);
  }
  for (const form of IRREGULAR[w] ?? []) out.add(form);
  return [...out];
}

/**
 * Every reading of one rendering's bracket notation: "(be-)love(-ed)" is
 * love, loved, belove and beloved; "deliver (up)" is deliver and deliver up.
 */
function expand(text: string): string[] {
  const m = /\(([^()]*)\)/.exec(text);
  if (!m) return [text.replace(/\s+/g, ' ').trim()];
  const before = text.slice(0, m.index);
  const after = text.slice(m.index + m[0].length);
  const out = expand(before + ' ' + after);
  for (const alt of m[1].split(',').map((a) => a.trim()).filter(Boolean)) {
    if (alt.endsWith('-')) out.push(...expand(before + alt.slice(0, -1) + after.trimStart()));
    else if (alt.startsWith('-')) out.push(...expand(before.trimEnd() + alt.slice(1) + after));
    else out.push(...expand(`${before} ${alt} ${after}`));
  }
  return out;
}

/** Keep a phrase only when it is plain words and means something alone. */
function usable(phrase: string): boolean {
  if (!phrase || !/^[a-z][a-z' -]*$/i.test(phrase)) return false;
  const words = phrase.split(' ');
  if (words.length > 1) return words.some((w) => !FUNCTION_WORDS.has(w.toLowerCase()));
  return phrase.length >= 3 && !FUNCTION_WORDS.has(phrase.toLowerCase());
}

/** English some translations use that the lexicon doesn't list (WEB's "Yahweh"). */
const EXTRA_VOCABULARY: Record<string, string[]> = {
  H3050: ['Yah', 'Yahweh'],
  H3068: ['Yahweh'],
  H3069: ['Yahweh'],
};

function vocabularyOf(entry: { strongs?: string; kjvUsage?: string; shortDefinition?: string } | null): string[] {
  if (!entry) return [];
  const phrases: string[] = [...(EXTRA_VOCABULARY[entry.strongs ?? ''] ?? [])];
  for (const r of parseKjvUsage(entry.kjvUsage ?? '')) {
    // "X" and "+" renderings have no word of their own behind them, and
    // "[idiom]" ones are idioms; none of them is this word's English.
    if (r.marker || r.text.startsWith('[')) continue;
    phrases.push(...expand(r.text));
  }
  for (const piece of (entry.shortDefinition ?? '').split(/[,;:/]/)) {
    phrases.push(...expand(piece.trim().replace(/^to\s+/i, '')));
  }
  // "the Lord" marks "LORD", not the article in front of it.
  return phrases.map((p) => p.replace(/^(the|a|an)\s+/i, '')).filter(usable);
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function patternFor(phrases: string[]): RegExp | null {
  const alts = new Set<string>();
  for (const phrase of phrases) {
    const words = phrase.split(/[ -]/).filter(Boolean);
    const each = words.map((w) => `(?:${inflect(w).sort((a, b) => b.length - a.length).map(escape).join('|')})`);
    alts.add(each.join('[\\s-]+'));
  }
  if (!alts.size) return null;
  // Longest first, so "beloved" wins over "love" at the same spot.
  const body = [...alts].sort((a, b) => b.length - a.length).join('|');
  return new RegExp(`(?<![\\p{L}\\p{M}])(?:${body})(?![\\p{L}\\p{M}])`, 'giu');
}

const patterns = new Map<string, Promise<RegExp | null>>();

/** The English a number can show up as, read once per number. */
function patternOf(strongsId: string): Promise<RegExp | null> {
  const id = classicId(strongsId);
  let found = patterns.get(strongsId);
  if (!found) {
    found = (async () => {
      if (isNeverMarked(id)) return null;
      // A split meaning (G2424G) has its own row; its number's row adds the
      // renderings it shares.
      const ids = strongsId === id ? [id] : [strongsId, id];
      const entries = await Promise.all(ids.map((i) => lookupStrongs(i).catch(() => null)));
      return patternFor(entries.flatMap((e) => vocabularyOf(e)));
    })();
    patterns.set(strongsId, found);
  }
  return found;
}

/** True when the number's English covers `offset` in `text`: the same match, run the other way. */
export async function meansAt(strongsId: string, text: string, offset: number): Promise<boolean> {
  const pattern = await patternOf(strongsId);
  if (!pattern) return false;
  for (const m of text.matchAll(pattern)) {
    if (m.index! <= offset && offset < m.index! + m[0].length) return true;
  }
  return false;
}

/**
 * Where a number's English sits in each verse text: one list of spans per
 * text, all empty unless the match is unambiguous. `marked` is how many words
 * the Greek or Hebrew line marks. Each text is searched only inside its own
 * [start, end), the part of the verse its row shows.
 */
export async function glossSpans(
  strongsId: string,
  texts: { text: string; start: number; end: number }[],
  marked: number,
): Promise<Span[][]> {
  const none = texts.map(() => [] as Span[]);
  const pattern = await patternOf(strongsId);
  if (!pattern) return none;
  const found = texts.map(({ text, start, end }) => {
    const spans: Span[] = [];
    for (const m of text.slice(start, end).matchAll(pattern)) {
      spans.push({ s: start + m.index!, e: start + m.index! + m[0].length });
    }
    return spans;
  });
  const total = found.reduce((n, list) => n + list.length, 0);
  return total === 1 || (total > 0 && total === marked) ? found : none;
}
