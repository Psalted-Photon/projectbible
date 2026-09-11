/**
 * Place search.
 *
 * People don't type the way a gazetteer spells things. "st cloud", "St. Cloud"
 * and "Saint Cloud" are the same request, and "saint cloud mn" is that request
 * plus a way of saying which one. All of that has to work, so matching happens
 * on a normalised form rather than the raw string.
 *
 * Rows are packed arrays to keep 168,000 places affordable:
 *   [name, asciiName|0, admin1, country, lat, lon, population]
 */

const NAME = 0, ASCII = 1, ADMIN = 2, COUNTRY = 3, LAT = 4, LON = 5, POP = 6;

/** US state and territory abbreviations, so "mn" finds Minnesota. */
const STATES = {
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

/** Common written forms that mean the same place-name word. */
const WORDS = {
  st: 'saint', 'st.': 'saint', ste: 'sainte', 'ste.': 'sainte',
  mt: 'mount', 'mt.': 'mount', mtn: 'mountain',
  ft: 'fort', 'ft.': 'fort',
  n: 'north', s: 'south', e: 'east', w: 'west',
  usa: 'united states', us: 'united states', uk: 'united kingdom',
};

/**
 * Strip accents and punctuation, then expand abbreviations, so every spelling
 * of the same place collapses onto one comparable string.
 */
export function normalise(text) {
  const cleaned = String(text)
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[.'’`]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
  if (!cleaned) return '';
  return cleaned.split(' ').map((w) => WORDS[w] ?? w).join(' ');
}

export class PlaceSearch {
  constructor(rows) {
    this.rows = rows;
    /** Normalised name per row, built once — the expensive part. */
    this.keys = rows.map((r) => normalise(r[ASCII] || r[NAME]));
    this.admin = rows.map((r) => normalise(`${r[ADMIN]} ${r[COUNTRY]}`));
  }

  /**
   * A query may name the place, and may also say where it is:
   *   "saint cloud"        -> both Saint Clouds, biggest first
   *   "saint cloud mn"     -> the Minnesota one
   *   "st. cloud florida"  -> the Florida one
   *
   * The trailing words are tried as a region filter, but only if that actually
   * finds something — otherwise they stay part of the name.
   */
  search(query, limit = 40) {
    const q = normalise(query);
    if (q.length < 2) return [];

    const words = q.split(' ');
    const attempts = [{ name: q, region: '' }];

    // Try peeling one or two trailing words off as a place-of qualifier.
    for (const take of [1, 2]) {
      if (words.length > take) {
        const region = words.slice(-take).join(' ');
        attempts.push({
          name: words.slice(0, -take).join(' '),
          region: STATES[region] ?? region,
        });
      }
    }

    // Last resort: drop the trailing words entirely. "tampa bay" is a bay, so
    // nothing is named that — but the reader plainly means Tampa.
    for (const take of [1, 2]) {
      if (words.length > take) attempts.push({ name: words.slice(0, -take).join(' '), region: '' });
    }

    for (const attempt of attempts) {
      const hits = this.collect(attempt.name, attempt.region, limit);
      if (hits.length) return hits;
    }
    return [];
  }

  collect(name, region, limit) {
    if (name.length < 2) return [];
    const exact = [];
    const starts = [];
    const contains = [];

    for (let i = 0; i < this.keys.length; i++) {
      const key = this.keys[i];
      if (!key.includes(name)) continue;
      if (region && !this.admin[i].includes(region)) continue;

      if (key === name) exact.push(i);
      else if (key.startsWith(name)) starts.push(i);
      else contains.push(i);

      // The rows arrive sorted by population, so an early exit still keeps the
      // most likely answers.
      if (exact.length + starts.length > limit * 6) break;
    }

    return [...exact, ...starts, ...contains].slice(0, limit).map((i) => {
      const r = this.rows[i];
      return {
        name: r[NAME], admin: r[ADMIN], country: r[COUNTRY],
        lat: r[LAT], lon: r[LON], population: r[POP],
      };
    });
  }
}

/**
 * Squashed form, for readers who close up a hyphen.
 *
 * Scripture is full of names like Beth-Shemesh and Kiriath-Jearim, and nobody
 * agrees where the break goes. Comparing without the gaps means "bethshemesh",
 * "beth shemesh" and "Beth-shemesh" are all one request.
 */
function squash(text) {
  return normalise(text).replace(/ /g, '');
}

/**
 * The Bible's own places.
 *
 * The gazetteer knows the modern world and nothing else, so a Bible atlas that
 * searches only the gazetteer cannot find Capernaum, Golgotha or Gethsemane —
 * which is most of what anybody opens this map to look for. This searches the
 * places Scripture names and the ancient names the Barrington Atlas letters,
 * and it runs against data already in memory, so it answers as you type.
 *
 * Modern names count too: Capernaum is Khirbet Minyeh today, and someone
 * reading about the dig will type that.
 */
export class ScriptureSearch {
  /**
   * @param places  the 1,278 places Scripture names, with their verses
   * @param ancient the 1,787 dated names from the Barrington regional linework
   */
  constructor(places = [], ancient = []) {
    this.entries = [];

    for (const p of places) {
      this.entries.push({
        kind: 'biblical',
        name: p.n,
        lat: p.y,
        lon: p.x,
        verses: p.v?.length ?? 0,
        modern: p.m || '',
        type: p.t || '',
        place: p,
        // A place is worth finding by whatever it is called now as well as
        // then, but the two are kept apart: the name Scripture uses has to
        // outrank a modern site name, or searching "Nineveh" answers "Assyria",
        // whose ruins are at Nineveh and which is named far more often.
        keys: [squash(p.n)],
        alsoKeys: p.m ? [squash(p.m)] : [],
      });
    }

    for (const a of ancient) {
      this.entries.push({
        kind: 'ancient',
        name: a.n,
        lat: a.y,
        lon: a.x,
        verses: 0,
        type: a.k || '',
        from: a.a,
        to: a.b,
        keys: [squash(a.n)],
        alsoKeys: [],
      });
    }
  }

  /**
   * Best matches, most-cited first.
   *
   * A name Scripture uses fifty times should outrank one it uses once, and an
   * exact match should outrank a place that merely contains the word — so
   * "Bethlehem" leads with Bethlehem rather than Bethlehem Ephrathah.
   */
  search(query, limit = 12) {
    const q = squash(query);
    if (q.length < 2) return [];

    /**
     * How good a match is: closeness first, then whose name it was.
     *
     * Doubling the closeness and adding one for a modern name puts an exact
     * match on the biblical name above an exact match on somebody's modern
     * site, while still keeping any exact match above any partial one.
     */
    const rankOf = (key, modern) => {
      if (!key.includes(q)) return -1;
      const close = key === q ? 0 : key.startsWith(q) ? 1 : 2;
      return close * 2 + (modern ? 1 : 0);
    };

    const scored = [];
    for (const e of this.entries) {
      let best = -1;
      for (const key of e.keys) {
        const r = rankOf(key, false);
        if (r >= 0 && (best < 0 || r < best)) best = r;
      }
      for (const key of e.alsoKeys) {
        const r = rankOf(key, true);
        if (r >= 0 && (best < 0 || r < best)) best = r;
      }
      if (best < 0) continue;
      scored.push({ e, rank: best });
    }

    scored.sort((a, b) => {
      if (a.rank !== b.rank) return a.rank - b.rank;
      // Places Scripture names outrank bare ancient labels at equal closeness.
      if ((a.e.kind === 'biblical') !== (b.e.kind === 'biblical')) return a.e.kind === 'biblical' ? -1 : 1;
      if (a.e.verses !== b.e.verses) return b.e.verses - a.e.verses;
      return a.e.name.localeCompare(b.e.name);
    });

    return scored.slice(0, limit).map((s) => s.e);
  }
}
