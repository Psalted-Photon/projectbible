/**
 * English verse numbers to the Hebrew and BYZ numbering, for build scripts.
 *
 * Reads the app's apps/pwa-polished/src/data/versification.json, decoded as
 * lib/versification.ts decodes it. Only the Hebrew, BYZ and WEB tables are
 * here; the Septuagint mapping stays in the app.
 */

import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const DATA = JSON.parse(
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../../apps/pwa-polished/src/data/versification.json'), 'utf8'),
);

const TABLES = { hebrew: DATA.hebrew, majority: DATA.byz, web: DATA.web };

const tableBook = (book) => (book === 'Psalm' ? 'Psalms' : book);

function decode(table, book, chapter, verse) {
  const runs = table[tableBook(book)]?.[chapter];
  if (!runs) return null;
  for (const run of runs) {
    const [src, dst] = run.split('>');
    const [a, b = a] = src.split('-').map(Number);
    if (verse < a || verse > b) continue;
    if (!dst) return [];
    return dst.split(',').map((t) => {
      const [, ch, v] = t.match(/^(\d+):(\d+)([tb]?)$/);
      return { book, chapter: Number(ch), verse: Number(v) + (verse - a) };
    });
  }
  return [];
}

/** A verse in `scheme` numbering, as English verses. */
export function toEnglish(scheme, ref) {
  const table = TABLES[scheme];
  return (table && decode(table, ref.book, ref.chapter, ref.verse)) ?? [{ ...ref }];
}

const inverses = new Map();

/** An English verse in `scheme` numbering. */
export function fromEnglish(scheme, ref) {
  const table = TABLES[scheme];
  if (!table) return [{ ...ref }];
  let inv = inverses.get(scheme);
  if (!inv) {
    inv = { byVerse: new Map(), chapters: new Set() };
    for (const [book, chapters] of Object.entries(table)) {
      for (const [ch, runs] of Object.entries(chapters)) {
        inv.chapters.add(`${book} ${ch}`);
        for (const run of runs) {
          const [a, b = a] = run.split('>')[0].split('-').map(Number);
          for (let v = a; v <= b; v++) {
            for (const t of decode(table, book, Number(ch), v) ?? []) {
              inv.chapters.add(`${book} ${t.chapter}`);
              const k = `${book} ${t.chapter}:${t.verse}`;
              const list = inv.byVerse.get(k) ?? [];
              list.push({ book, chapter: Number(ch), verse: v });
              inv.byVerse.set(k, list);
            }
          }
        }
      }
    }
    inverses.set(scheme, inv);
  }
  const tb = tableBook(ref.book);
  if (!inv.chapters.has(`${tb} ${ref.chapter}`)) return [{ ...ref }];
  return (inv.byVerse.get(`${tb} ${ref.chapter}:${ref.verse}`) ?? []).map((r) => ({ ...r, book: ref.book }));
}
