/**
 * The English a Strong's number can show up as, for the word-links builder.
 *
 * Ported from apps/pwa-polished/src/lib/wordLinks/glossMatch.ts and
 * parseKjvUsage() in lib/strongs/entry.ts. Keep them in step: the builder
 * filters WEB and NET tags with the same vocabulary the app matches with.
 */

/** Words with no English of their own (the article, "and", the object marker). */
export const NEVER_MARKED = new Set([
  'G3588', 'G2532', 'G1161', 'G0846',
  'H0853', 'H3588', 'H0834', 'H5921', 'H0413', 'H3605',
]);

/** English too common to mean anything on its own. */
export const FUNCTION_WORDS = new Set(
  ('a an the of to and or but nor be is are was were been am it its as at by he him his she her ' +
    'they them their we us our me my i you your thou thee thy ye so no not do did done that this ' +
    'these those there then than when where which who whom what while with for from in into on ' +
    'upon out up after before about through under over among between against unto also')
    .split(' '),
);

const IRREGULAR = {
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
export function inflect(word) {
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
  const last = w[w.length - 1];
  if (!VOWEL.test(last) && !/[wxy]/.test(last) && VOWEL.test(w[w.length - 2]) && !VOWEL.test(w[w.length - 3])) {
    for (const end of ['ed', 'ing', 'eth', 'est']) out.add(w + last + end);
  }
  for (const form of IRREGULAR[w] ?? []) out.add(form);
  return [...out];
}

/**
 * Words built on a dictionary word of 5+ letters (faithful → faithfulness,
 * worthy → worthiness). Only for checking a word a source already tagged with
 * the number; never for finding one.
 */
export function derive(word) {
  const w = word.toLowerCase();
  if (w.length < 5 || !/^[a-z]+$/.test(w)) return [];
  const out = new Set();
  for (const end of ['ness', 'ly', 'ful', 'fully', 'ment', 'ments', 'er', 'ers', 'ion', 'ions']) out.add(w + end);
  if (w.endsWith('e')) for (const end of ['ion', 'ions']) out.add(w.slice(0, -1) + end);
  if (w.endsWith('le')) out.add(`${w.slice(0, -1)}y`);
  if (/[^aeiou]y$/.test(w)) for (const end of ['iness', 'ily']) out.add(w.slice(0, -1) + end);
  return [...out];
}

function expand(text) {
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

export function usable(phrase) {
  if (!phrase || !/^[a-z][a-z' -]*$/i.test(phrase)) return false;
  const words = phrase.split(' ');
  if (words.length > 1) return words.some((w) => !FUNCTION_WORDS.has(w.toLowerCase()));
  return phrase.length >= 3 && !FUNCTION_WORDS.has(phrase.toLowerCase());
}

function parseKjvUsage(usage) {
  const parts = [];
  let depth = 0;
  let buf = '';
  for (const ch of usage) {
    if (ch === '(' || ch === '[') depth++;
    else if (ch === ')' || ch === ']') depth = Math.max(0, depth - 1);
    if (ch === ',' && depth === 0) {
      parts.push(buf);
      buf = '';
      continue;
    }
    buf += ch;
  }
  parts.push(buf);
  const out = [];
  for (const raw of parts) {
    let t = raw.replace(/\s+/g, ' ').trim().split(/\.\s+(?=[A-Z])/)[0];
    t = t.replace(/\.$/, '').trim();
    if (!t || /^compare\b/i.test(t)) continue;
    let marker = null;
    if (/^X\s+/.test(t)) {
      marker = 'supplied';
      t = t.replace(/^X\s+/, '');
    } else if (/^\+\s*/.test(t)) {
      marker = 'combined';
      t = t.replace(/^\+\s*/, '');
    }
    if (t) out.push({ text: t, marker });
  }
  return out;
}

/** English some translations use that the lexicon doesn't list (WEB's "Yahweh"). */
export const EXTRA_VOCABULARY = {
  H3050: ['Yah', 'Yahweh'],
  H3068: ['Yahweh'],
  H3069: ['Yahweh'],
};

export function vocabularyOf(entry) {
  if (!entry) return [];
  const phrases = [...(EXTRA_VOCABULARY[entry.id] ?? [])];
  for (const r of parseKjvUsage(entry.kjvUsage ?? '')) {
    if (r.marker || r.text.startsWith('[')) continue;
    phrases.push(...expand(r.text));
  }
  phrases.push(...headwordsOf(entry));
  return phrases.map((p) => p.replace(/^(the|a|an)\s+/i, '')).filter(usable);
}

/** The short definition's English alone: the tie-break when a number's meanings match too many words. */
export function headwordsOf(entry) {
  if (!entry) return [];
  const phrases = [];
  for (const piece of (entry.shortDefinition ?? '').split(/[,;:/]/)) {
    phrases.push(...expand(piece.trim().replace(/^to\s+/i, '')));
  }
  return phrases.map((p) => p.replace(/^(the|a|an)\s+/i, '')).filter(usable);
}

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function patternFor(phrases) {
  const alts = new Set();
  for (const phrase of phrases) {
    const words = phrase.split(/[ -]/).filter(Boolean);
    const each = words.map((w) => `(?:${inflect(w).sort((a, b) => b.length - a.length).map(escape).join('|')})`);
    alts.add(each.join('[\\s-]+'));
  }
  if (!alts.size) return null;
  const body = [...alts].sort((a, b) => b.length - a.length).join('|');
  return new RegExp(`(?<![\\p{L}\\p{M}])(?:${body})(?![\\p{L}\\p{M}])`, 'giu');
}
