/**
 * check-people-refs — every scripture link the app makes for itself in the
 * People bios, so a wrong pick can be spotted and put in the fix list.
 *
 * Runs each Easton bio in packs/people.sqlite through the same eastonRefs the
 * app uses and prints, bio by bio, each link the source didn't tag itself:
 * the rule that picked it, where it goes, the words around it, and the start
 * of that verse in the KJV so a wrong book shows at a glance. Anything that
 * looked like a reference but couldn't be placed is printed as PLAIN.
 *
 * Usage:
 *   npx tsx scripts/check-people-refs.ts                 everything
 *   npx tsx scripts/check-people-refs.ts --misses        only what was left plain
 *   npx tsx scripts/check-people-refs.ts --rule=earlier  only one rule's picks
 *   npx tsx scripts/check-people-refs.ts noah_2210 ...   only these people
 *
 * The fix list is apps/pwa-polished/src/lib/eastonRefFixes.ts.
 */

import Database from 'better-sqlite3';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { eastonBioReport, type BioPiece } from '../apps/pwa-polished/src/lib/eastonRefs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const people = new Database(join(root, 'packs/people.sqlite'), { readonly: true });
const kjv = new Database(join(root, 'packs/kjv.sqlite'), { readonly: true });

const args = process.argv.slice(2);
const onlyMisses = args.includes('--misses');
const onlyRule = args.find((a) => a.startsWith('--rule='))?.slice(7);
const onlyPeople = new Set(args.filter((a) => !a.startsWith('--')));

const verseText = kjv.prepare('SELECT text FROM verses WHERE book = ? AND chapter = ? AND verse = ?');
function kjvStart(book: string, chapter: number, verse: number): string {
  const row = verseText.get(book === 'Psalm' ? 'Psalms' : book, chapter, verse) as { text: string } | undefined;
  if (!row) return '(no KJV verse)';
  const text = row.text.replace(/[\x00-\x1f]/g, '').replace(/\s+/g, ' ').trim();
  return text.length > 70 ? `${text.slice(0, 70)}…` : text;
}

/** The words either side of piece `i` in its paragraph. */
function context(para: BioPiece[], i: number): string {
  const before = para.slice(0, i).map((p) => p.text).join('');
  const after = para.slice(i + 1).map((p) => p.text).join('');
  return `…${before.slice(-45)}【${para[i].text}】${after.slice(0, 20)}…`;
}

const rows = people
  .prepare("SELECT person_id AS id, name, dict_text AS text FROM people WHERE dict_text IS NOT NULL AND dict_text <> '' ORDER BY rowid")
  .all() as { id: string; name: string; text: string }[];

// People who share one Easton entry are reported once, under the first of them.
const byText = new Map<string, { id: string; name: string }[]>();
for (const r of rows) {
  if (onlyPeople.size && !onlyPeople.has(r.id)) continue;
  const list = byText.get(r.text) ?? [];
  list.push(r);
  byText.set(r.text, list);
}

const counts: Record<string, number> = {};
let picked = 0;
let plain = 0;
const lines: string[] = [];

for (const [text, who] of byText) {
  const reports = who.map((p) => eastonBioReport(text, p));
  const report = reports[0];
  const out: string[] = [];

  report.paragraphs.forEach((para) => {
    para.forEach((piece, i) => {
      const ref = piece.ref;
      if (!ref) return;
      counts[ref.rule] = (counts[ref.rule] ?? 0) + 1;
      if (ref.rule === 'source') return;
      picked++;
      if (onlyMisses || (onlyRule && ref.rule !== onlyRule)) return;
      out.push(
        `  ${ref.rule.padEnd(8)} ${ref.key.padEnd(22)} ${context(para, i)}\n           ${''.padEnd(22)} KJV: ${kjvStart(ref.book, ref.chapter, ref.verse)}`,
      );
    });
  });
  for (const m of report.misses) {
    plain++;
    if (!onlyRule) out.push(`  PLAIN    ${''.padEnd(22)} ${m.context}`);
  }

  // A fix written for one of them only — the others would still show the old pick.
  const shape = (r: typeof report) => JSON.stringify(r);
  if (reports.some((r) => shape(r) !== shape(report))) {
    out.push(`  NOTE     these people share one entry but got different links: ${who.map((p) => p.id).join(', ')}`);
  }

  if (out.length) {
    const also = who.length > 1 ? ` (also ${who.slice(1).map((p) => p.id).join(', ')})` : '';
    lines.push(`## ${who[0].id} — ${who[0].name}${also}`, ...out, '');
  }
}

console.log(lines.join('\n'));
console.log('Links by rule:', Object.entries(counts).map(([k, v]) => `${k} ${v}`).join(', '));
console.log(`${picked} links chosen by the app, ${plain} left plain.`);
