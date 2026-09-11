/**
 * Dev-only search endpoint for the atlas lab.
 *
 * The gazetteer is far too large to hand a browser as JSON, so the lab queries
 * it the way the app eventually will — as an indexed pack, not a linear scan.
 * This plugin is the dev-server stand-in for that; nothing here ships.
 */
import type { Plugin } from 'vite';
import { existsSync } from 'fs';
import { resolve } from 'path';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

/** Written forms that mean the same word, mirrored from the client. */
const WORDS: Record<string, string> = {
  st: 'saint', ste: 'sainte', mt: 'mount', mtn: 'mountain', ft: 'fort',
  n: 'north', s: 'south', e: 'east', w: 'west',
};

const STATES: Record<string, string> = {
  al: 'alabama', ak: 'alaska', az: 'arizona', ar: 'arkansas', ca: 'california',
  co: 'colorado', ct: 'connecticut', de: 'delaware', fl: 'florida', ga: 'georgia',
  hi: 'hawaii', id: 'idaho', il: 'illinois', in: 'indiana', ia: 'iowa',
  ks: 'kansas', ky: 'kentucky', la: 'louisiana', me: 'maine', md: 'maryland',
  ma: 'massachusetts', mi: 'michigan', mn: 'minnesota', ms: 'mississippi',
  mo: 'missouri', mt: 'montana', ne: 'nebraska', nv: 'nevada', nh: 'new hampshire',
  nj: 'new jersey', nm: 'new mexico', ny: 'new york', nc: 'north carolina',
  nd: 'north dakota', oh: 'ohio', ok: 'oklahoma', or: 'oregon', pa: 'pennsylvania',
  ri: 'rhode island', sc: 'south carolina', sd: 'south dakota', tn: 'tennessee',
  tx: 'texas', ut: 'utah', vt: 'vermont', va: 'virginia', wa: 'washington',
  wv: 'west virginia', wi: 'wisconsin', wy: 'wyoming', dc: 'district of columbia',
  pr: 'puerto rico',
};

function normalise(text: string): string {
  const cleaned = String(text)
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[.'’`]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
  if (!cleaned) return '';
  return cleaned.split(' ').map((w) => WORDS[w] ?? w).join(' ');
}

/**
 * Rank by what someone probably meant: a populated place beats a field of the
 * same name, an exact name beats a partial, and a big city beats a hamlet.
 */
const RANK_SQL = `
  CASE fclass WHEN 'P' THEN 0 WHEN 'A' THEN 1 WHEN 'H' THEN 2 WHEN 'T' THEN 3 ELSE 4 END
`;

/**
 * Words that say what kind of thing is being looked for.
 *
 * Without this, population always wins and "Mount Sinai" returns a village in
 * New York rather than the mountain, because the village has people living in
 * it and the mountain does not.
 */
const HINTS: Record<string, string> = {
  mount: 'T', mountain: 'T', peak: 'T', ridge: 'T', hill: 'T', valley: 'T',
  island: 'T', isle: 'T', cape: 'T', desert: 'T', plain: 'T', wilderness: 'T',
  // Without these, "Grand Canyon" returns the village on its rim, because a
  // village has people in it and a canyon does not.
  canyon: 'T', gorge: 'T', volcano: 'T', mesa: 'T', butte: 'T', glacier: 'T',
  peninsula: 'T', dunes: 'T', plateau: 'T',
  lake: 'H', sea: 'H', river: 'H', bay: 'H', gulf: 'H', creek: 'H', brook: 'H',
  stream: 'H', spring: 'H', falls: 'H', strait: 'H', sound: 'H', harbour: 'H',
  marsh: 'H', swamp: 'H', delta: 'H', wadi: 'H', channel: 'H', narrows: 'H',
  harbor: 'H', lagoon: 'H', reservoir: 'H', pool: 'H',
  county: 'A', province: 'A', state: 'A', district: 'A',
  park: 'L', region: 'L', forest: 'L',
};

function hintClass(words: string[]): string | null {
  for (const w of words) if (HINTS[w]) return HINTS[w];
  return null;
}

export function atlasSearch(): Plugin {
  let db: any = null;

  const open = () => {
    if (db) return db;
    const file = resolve(__dirname, '../../packs/gazetteer.sqlite');
    if (!existsSync(file)) return null;
    const Database = require('better-sqlite3');
    db = new Database(file, { readonly: true });
    return db;
  };

  return {
    name: 'atlas-search',
    apply: 'serve',
    configureServer(server) {
      /**
       * Everything worth a dot inside the current view, most significant first.
       * The map draws these as clickable specks for places it can't letter.
       */
      server.middlewares.use('/api/atlas-places', (req, res) => {
        const send = (code: number, body: unknown) => {
          res.statusCode = code;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify(body));
        };

        const database = open();
        if (!database) return send(503, { error: 'gazetteer not built', results: [] });

        const url = new URL(req.url ?? '', 'http://localhost');
        const nums = (url.searchParams.get('bbox') ?? '').split(',').map(Number);
        if (nums.length !== 4 || nums.some((n) => !Number.isFinite(n))) {
          return send(400, { error: 'bbox=w,s,e,n required', results: [] });
        }
        const [w, s, e, n] = nums;
        const limit = Math.min(1500, Number(url.searchParams.get('limit')) || 700);
        // A population floor, so the map thins itself instead of shipping every
        // hamlet and then hiding most of them. Zero means show everything.
        const minPop = Math.max(0, Number(url.searchParams.get('minpop')) || 0);

        try {
          const rows = database.prepare(`
            SELECT name, admin1, country, lat, lon, population, fclass, fcode
            FROM places
            WHERE lat BETWEEN ? AND ? AND lon BETWEEN ? AND ?
              AND fclass IN ('P','H','T')
              AND (population >= ? OR (? = 0))
            ORDER BY population DESC, ${RANK_SQL}
            LIMIT ${limit}
          `).all(s, n, w, e, minPop, minPop);
          send(200, { results: rows });
        } catch (err: any) {
          send(500, { error: String(err?.message ?? err), results: [] });
        }
      });

      server.middlewares.use('/api/atlas-search', (req, res) => {
        const send = (code: number, body: unknown) => {
          res.statusCode = code;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify(body));
        };

        const database = open();
        if (!database) {
          return send(503, { error: 'gazetteer.sqlite not built yet', results: [] });
        }

        const url = new URL(req.url ?? '', 'http://localhost');
        const raw = (url.searchParams.get('q') ?? '').trim();
        const limit = Math.min(60, Number(url.searchParams.get('limit')) || 40);
        const q = normalise(raw);
        if (q.length < 2) return send(200, { results: [] });

        const words = q.split(' ');

        /** Try the whole query, then peel trailing words off as a region. */
        const attempts: Array<{ name: string; region: string }> = [{ name: q, region: '' }];
        for (const take of [1, 2]) {
          if (words.length > take) {
            const tail = words.slice(-take).join(' ');
            attempts.push({ name: words.slice(0, -take).join(' '), region: STATES[tail] ?? tail });
            attempts.push({ name: words.slice(0, -take).join(' '), region: '' });
          }
        }

        // "mount sinai" means the mountain, not a village named after it, and
        // "jordan river" means the river. The wording says which kind of thing
        // is wanted, so it steers the ranking.
        const hint = hintClass(words);

        try {
          /** Every reading contributes; ranking decides, not query order. */
          const seen = new Map<string, any>();

          for (const attempt of attempts) {
            if (attempt.name.length < 2) continue;
            const match = attempt.name.split(' ').filter(Boolean)
              .map((w) => `"${w.replace(/"/g, '')}"*`).join(' ');

            // All placeholders are positional; mixing ?1-style with bare ? is
            // rejected outright by the driver.
            const params: unknown[] = [match];
            let where = '';
            if (attempt.region) {
              where = 'AND (LOWER(p.admin1) LIKE ? OR LOWER(p.country) LIKE ?)';
              params.push(`%${attempt.region}%`, `%${attempt.region}%`);
            }
            params.push(attempt.name);

            // The hint has to steer the SQL, not just the sort afterwards: the
            // inner LIMIT decides which rows are even considered, and ranking a
            // shortlist that already excluded the mountains achieves nothing.
            let hintOrder = '';
            if (hint) {
              hintOrder = 'CASE WHEN p.fclass = ? THEN 0 ELSE 1 END,';
              params.push(hint);
            }

            const rows = database.prepare(`
              SELECT p.name, p.norm, p.admin1, p.country, p.lat, p.lon,
                     p.population, p.fclass, p.fcode, p.importance
              FROM places_fts f
              JOIN places p ON p.id = f.rowid
              WHERE f.norm MATCH ? ${where}
              ORDER BY CASE WHEN p.norm = ? THEN 0 ELSE 1 END, ${hintOrder} ${RANK_SQL}, p.population DESC, p.importance DESC
              LIMIT ${Math.max(60, limit * 4)}
            `).all(...params);

            for (const r of rows) {
              const key = `${r.name}|${r.lat}|${r.lon}`;
              if (!seen.has(key)) seen.set(key, { ...r, region: Boolean(attempt.region) });
            }
            if (seen.size >= limit * 3) break;
          }

          const CLASS_RANK: Record<string, number> = { P: 0, A: 1, H: 2, T: 3 };
          const ranked = [...seen.values()].sort((a, b) => {
            // An exactly-matching name beats a longer one that merely contains
            // it, which is what kept "St. Cloud, MN Metro Area" above the city.
            const exact = (r: any) => (r.norm === q || r.norm === words.join(' ') ? 0 : 1);
            if (exact(a) !== exact(b)) return exact(a) - exact(b);

            if (hint) {
              const h = (r: any) => (r.fclass === hint ? 0 : 1);
              if (h(a) !== h(b)) return h(a) - h(b);
            }
            const cls = (r: any) => CLASS_RANK[r.fclass] ?? 4;
            if (cls(a) !== cls(b)) return cls(a) - cls(b);
            if ((a.population ?? 0) !== (b.population ?? 0)) {
              return (b.population ?? 0) - (a.population ?? 0);
            }
            // Lakes, canyons and mountains all have no population, so without
            // this two features of the same name sort arbitrarily and Missouri's
            // Grand Canyon lands above Arizona's.
            return (b.importance ?? 0) - (a.importance ?? 0);
          });

          send(200, {
            results: ranked.slice(0, limit).map(({ norm, region, importance, ...rest }) => rest),
          });
        } catch (err: any) {
          send(500, { error: String(err?.message ?? err), results: [] });
        }
      });
    },
  };
}
