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
 * list leaves out because they are everyday words too (Lot, Mark, Ai). Fixes
 * already in the app (scripts/name-fixes.txt) ride along, so the lab shows them.
 *
 * ISBE's guides are a hint and not the answer. They date from 1915, and the
 * lost accent marks mean a guide says nothing about long and short vowels, so
 * the lab only uses them to spot a strong syllable worth listening to.
 *
 * Run from the repo root after the packs or the name list change:
 *   node scripts/build-name-lab-list.mjs
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { bibleWordCounts, readNameFixes, soundsFor } from './lib/name-sounds.mjs';
import { plainLetters, stressDisagrees, syllablesLost } from '../apps/pwa-polished/public/name-lab-sounds.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const app = join(root, 'apps', 'pwa-polished');
const OUT = join(app, 'public', 'name-lab-names.json');
const NAMES_FILE = join(app, 'src', 'lib', 'voice', 'bibleNames.ts');

/** Real names that bibleNames.ts leaves out because they are everyday words too. */
const ALSO = `Lot Ai Mark Er Ram Mica Dodo Beer Gob Beno Zelek Sallu Jeriah Jemuel Shittim Ephah Hod Pinon
  Leviathan Babylonia Tidal Tartan Maim Shisha Ether Amok`.split(/\s+/);

// ─── names ──────────────────────────────────────────────────────────────────

const lists = [...readFileSync(NAMES_FILE, 'utf8').matchAll(/`([\s\S]*?)`/g)].map((m) => m[1].trim().split(/\s+/));
const names = [...new Set([...lists.flat(), ...ALSO])];

// ─── counts ─────────────────────────────────────────────────────────────────

const packs = join(root, 'packs');
const counts = bibleWordCounts();

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

const us = await soundsFor(names, 'en-us');
const uk = await soundsFor(names, 'en-gb-x-rp');

// ─── fixes already in the app ───────────────────────────────────────────────

const fixes = readNameFixes();
const spelled = fixes.filter((f) => f.spell);
const spelledUs = await soundsFor(spelled.map((f) => f.spell), 'en-us');
const spelledUk = await soundsFor(spelled.map((f) => f.spell), 'en-gb-x-rp');
const inApp = new Map(
  fixes.map((f) => {
    const at = spelled.indexOf(f);
    return [f.name, {
      spell: f.spell,
      us: spelledUs[at],
      uk: spelledUk[at],
      stress: f.strong ? f.strong - 1 : undefined,
      hear: f.hear.length ? f.hear : undefined,
    }];
  }),
);

// ─── writing ────────────────────────────────────────────────────────────────

const rows = names
  .map((name, i) => {
    const row = { n: name, c: counts.get(name) || 0, us: us[i], uk: uk[i] };
    const guide = guideFor(name);
    if (guide) row.g = guide;
    if (inApp.has(name)) row.f = inApp.get(name);
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
