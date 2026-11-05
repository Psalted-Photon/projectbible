/**
 * The list the Name Lab works from (apps/pwa-polished/public/name-lab-names.json).
 *
 * Every Bible name, most common first, with how many times the KJV, WEB, BSB
 * and NET use it, the pronunciation guide from ISBE where there is one, and the
 * sounds the voices will actually say for it in a US and a UK accent. Those
 * come from the app's own phonemizer, so the lab can show all 3,000+ without
 * running it thousands of times on open.
 *
 * Names come from lib/voice/bibleNames.ts, plus ALSO below: real names that
 * list leaves out because they are everyday words too (Lot, Mark, Ai).
 *
 * ISBE's guides are a hint and not the answer. They date from 1915, and the
 * lost accent marks mean a guide says nothing about long and short vowels, so
 * the lab only uses them to spot a strong syllable worth listening to.
 *
 * Run from the repo root after the packs or the name list change:
 *   node scripts/build-name-lab-list.mjs
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import Database from 'better-sqlite3';
import { stripFootnotes, stripHtml } from './lib/clean-text.mjs';
import { plainLetters, stressDisagrees, syllablesLost } from '../apps/pwa-polished/public/name-lab-sounds.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const app = join(root, 'apps', 'pwa-polished');
const OUT = join(app, 'public', 'name-lab-names.json');
const TTS_DIR = join(app, 'public', 'tts');
const VENDOR = join(app, 'src', 'lib', 'tts', 'vendor', 'piper-phonemize.js');
const NAMES_FILE = join(app, 'src', 'lib', 'voice', 'bibleNames.ts');

/** Real names that bibleNames.ts leaves out because they are everyday words too. */
const ALSO = `Lot Ai Mark Er Ram Mica Dodo Beer Gob Beno Zelek Sallu Jeriah Jemuel Shittim Ephah Hod Pinon
  Leviathan Babylonia Tidal Tartan Maim Shisha Ether Amok`.split(/\s+/);

// ─── names ──────────────────────────────────────────────────────────────────

const lists = [...readFileSync(NAMES_FILE, 'utf8').matchAll(/`([\s\S]*?)`/g)].map((m) => m[1].trim().split(/\s+/));
const names = [...new Set([...lists.flat(), ...ALSO])];

// ─── counts ─────────────────────────────────────────────────────────────────

const packs = join(root, 'packs');
const tx = new Database(join(packs, 'consolidated', 'translations.sqlite'), { readonly: true });
const net = new Database(join(packs, 'net.sqlite'), { readonly: true });

const counts = new Map();
const WORD_RE = /[A-Za-z]+(?:['’-][A-Za-z]+)*/g;

function countVerses(rows) {
  for (const { text } of rows) {
    const clean = stripHtml(stripFootnotes(text)).replace(/[\x00-\x1f]/g, ' ');
    for (const m of clean.matchAll(WORD_RE)) {
      if (!/^[A-Z]/.test(m[0])) continue;
      // Possessives count for the name, and capitals ("JEHOVAH") read as the name.
      const bare = m[0].replace(/['’]s?$/, '');
      const word = bare === bare.toUpperCase() ? bare[0] + bare.slice(1).toLowerCase() : bare;
      counts.set(word, (counts.get(word) || 0) + 1);
    }
  }
}
for (const t of ['kjv', 'web', 'bsb']) countVerses(tx.prepare('SELECT text FROM verses WHERE translation_id = ?').all(t));
countVerses(net.prepare('SELECT text FROM verses').all());

// ─── ISBE guides ────────────────────────────────────────────────────────────

const isbe = new Database(join(packs, 'consolidated', 'isbe.sqlite'), { readonly: true });
const namedEntries = isbe.prepare(
  'SELECT e.title, e.lead FROM entry_names n JOIN entries e ON e.entry_id = n.entry_id WHERE n.name_lower = ?',
);
/** "PETER, SIMON" and "SAMARIA, CITY OF" aren't listed under the name alone. */
const titledEntries = isbe.prepare("SELECT title, lead FROM entries WHERE title LIKE ? || ',%' OR title LIKE ? || ' %'");

/**
 * Words at the very start of an article that are spelled as sounds, as in
 * "pi'-lat, pi'-lat, pon'-shi-us (Pontios". Only ones with a mark count, since
 * a plain word can't say which syllable is strong and may just be the headword.
 */
function guideWords(lead) {
  const out = [];
  for (const piece of (lead || '').split(/[\s,]+/)) {
    const m = piece.match(/^([a-z][a-z'"-]*)([:.;()]?)/);
    if (!m || !/['"-]/.test(m[1])) break;
    out.push(m[1]);
    if (m[2]) break;
  }
  return out;
}

/** The consonants of a word as they sound, so "Zacchaeus" and "za-ke'-us" can be compared. */
function skeleton(word) {
  return word
    .toLowerCase()
    .replace(/['"-]/g, '')
    .replace(/ph/g, 'f')
    .replace(/ch|c|q/g, 'k')
    .replace(/th/g, 't')
    .replace(/z/g, 's')
    .replace(/[gj]/g, 'j')
    .replace(/[aeiouyhw]/g, '')
    .replace(/(.)\1+/g, '$1');
}

function editDistance(a, b) {
  let row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const next = [i];
    for (let j = 1; j <= b.length; j++) {
      next[j] = Math.min(row[j] + 1, next[j - 1] + 1, row[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    row = next;
  }
  return row[b.length];
}

/** The closest guide word to the name, or null if none of them look like it. */
function closestGuide(name, words) {
  const want = skeleton(name);
  let best = null;
  let bestDistance = Infinity;
  for (const word of words) {
    const distance = editDistance(want, skeleton(word));
    if (distance < bestDistance) {
      best = word;
      bestDistance = distance;
    }
  }
  return best !== null && bestDistance <= Math.max(1, Math.floor(want.length / 3)) ? best : null;
}

/** "JOASH (1)" before "JEHOASH; JOASH", so a name lands on its own article first. */
function entryRank(title, name) {
  const upper = name.toUpperCase();
  const clean = title.toUpperCase();
  if (clean === upper) return 0;
  if (clean.startsWith(`${upper} (`)) return 1;
  if (clean.startsWith(`${upper};`)) return 2;
  return 3;
}

function guideFor(name) {
  const upper = name.toUpperCase();
  const entries = [...namedEntries.all(name.toLowerCase()), ...titledEntries.all(upper, upper)]
    .map((e) => ({ ...e, rank: entryRank(e.title, name) }))
    .sort((a, b) => a.rank - b.rank);
  for (const entry of entries) {
    const guide = closestGuide(name, guideWords(entry.lead));
    if (guide) return guide;
  }
  return null;
}

// ─── sounds ─────────────────────────────────────────────────────────────────

// The vendored module is an Emscripten build that expects a CommonJS-ish global
// scope when it detects Node, the same setup as scripts/phonemize-probe.mjs.
globalThis.require = createRequire(import.meta.url);
globalThis.__dirname = TTS_DIR;
globalThis.__filename = join(TTS_DIR, 'piper-phonemize.js');
const { createPiperPhonemize } = await import(pathToFileURL(VENDOR).href);

const BATCH = 50;

/**
 * Each input object prints one line. In batches, because a long input overruns
 * the module's memory, and with a fresh module per batch, because one aborts
 * after a few calls. The app starts a fresh one per call too.
 */
async function soundsFor(words, accent) {
  const out = [];
  for (let at = 0; at < words.length; at += BATCH) {
    const batch = words.slice(at, at + BATCH);
    const printed = [];
    const phonemizer = await createPiperPhonemize({
      print: (line) => printed.push(line),
      printErr: (line) => console.error(line),
      locateFile: (file) => join(TTS_DIR, file),
    });
    phonemizer.callMain([
      '-l', accent,
      '--input', JSON.stringify(batch.map((text) => ({ text }))),
      '--espeak_data', '/espeak-ng-data',
    ]);
    if (printed.length !== batch.length) {
      throw new Error(`Asked for ${batch.length} words in ${accent} and got ${printed.length}`);
    }
    out.push(...printed.map((line) => JSON.parse(line).phonemes.join('')));
  }
  return out;
}

const us = await soundsFor(names, 'en-us');
const uk = await soundsFor(names, 'en-gb-x-rp');

// ─── writing ────────────────────────────────────────────────────────────────

const rows = names
  .map((name, i) => {
    const row = { n: name, c: counts.get(name) || 0, us: us[i], uk: uk[i] };
    const guide = guideFor(name);
    if (guide) row.g = guide;
    return row;
  })
  .sort((a, b) => b.c - a.c || a.n.localeCompare(b.n));

writeFileSync(OUT, `[\n${rows.map((r) => JSON.stringify(r)).join(',\n')}\n]\n`);

const leansWrong = (r) => stressDisagrees(r.g, r.us) || stressDisagrees(r.g, r.uk);
const shortened = (r) => syllablesLost(r.g, r.us) || syllablesLost(r.g, r.uk);
const report = (label, list) => {
  const guided = list.filter((r) => r.g);
  console.log(
    `${label}: ${list.length} names, ${guided.length} with a guide, ${guided.filter(leansWrong).length} leaning on another syllable, ` +
      `${guided.filter((r) => !leansWrong(r) && shortened(r)).length} more losing a syllable`,
  );
};
console.log(`→ ${OUT}`);
report('Everything', rows);
report('Used 40+ times', rows.filter((r) => r.c >= 40));
console.log('Most common flagged:', rows.filter((r) => r.g && leansWrong(r)).slice(0, 8).map((r) => `${r.n} ${r.g} → ${plainLetters(r.us)}`).join(' | '));
