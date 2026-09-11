/**
 * Searching and ranking the modern world's places.
 *
 * Deliberately pure: it holds no state, touches no database and imports
 * nothing, so it can be exercised against the real 562,524 rows outside a
 * browser. Loading is place-index.ts's job.
 *
 * The places arrive as columns — two text blobs and a set of typed arrays —
 * rather than half a million objects. Searching is `indexOf` over one
 * plain-ASCII blob, which sounds crude and is roughly a thousand times faster
 * than waking an object per row to ask it its name.
 *
 * Row order is population, descending, and everything here depends on it: the
 * blob is read front to back and stopped early, so the order of the bytes is
 * the ranking.
 *
 * The ranking itself came from the dev-server endpoint the lab used rather than
 * being reinvented, because it is the part that took the tuning. Without it
 * "Mount Sinai" returns a village in New York — the village has people in it
 * and the mountain does not — and "Grand Canyon" returns the hotel strip on
 * the rim.
 */

export interface PlaceHit {
  name: string;
  admin1: string;
  country: string;
  lat: number;
  lon: number;
  population: number;
  fclass: string;
  fcode: string;
}

export interface PlaceColumns {
  rows: number;
  /** Every searchable name, lowercase ASCII, newline-delimited at both ends. */
  norm: string;
  /** The same names as written, for display. */
  display: string;
  /** Where each row's name starts in `norm` / `display`. */
  normAt: Int32Array;
  displayAt: Int32Array;
  /** Degrees times a million: about 11 cm, finer than anything recorded. */
  lat: Int32Array;
  lon: Int32Array;
  pop: Uint32Array;
  /** The handful of rows whose population will not fit in 32 bits. */
  popExceptions: Record<number, number>;
  importance: Uint16Array;
  countryCol: Uint8Array;
  admin1Col: Uint16Array;
  fcodeCol: Uint8Array;
  countries: string[];
  admin1s: string[];
  fcodes: string[];
  /** The feature class of each entry in `fcodes`. Empty on an older pack. */
  fclasses: string[];
  /** Lowercased once, for the region filter. */
  countriesLower: string[];
  admin1sLower: string[];
}

/** Written forms that mean the same word. Mirrored from the client's normalise. */
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

/**
 * Words that say what kind of thing is being looked for.
 *
 * Population always wins otherwise, and a settlement named after a landmark
 * almost always has more people in it than the landmark has.
 */
const HINTS: Record<string, string> = {
  mount: 'T', mountain: 'T', peak: 'T', ridge: 'T', hill: 'T', valley: 'T',
  island: 'T', isle: 'T', cape: 'T', desert: 'T', plain: 'T', wilderness: 'T',
  canyon: 'T', gorge: 'T', volcano: 'T', mesa: 'T', butte: 'T', glacier: 'T',
  peninsula: 'T', dunes: 'T', plateau: 'T',
  lake: 'H', sea: 'H', river: 'H', bay: 'H', gulf: 'H', creek: 'H', brook: 'H',
  stream: 'H', spring: 'H', falls: 'H', strait: 'H', sound: 'H', harbour: 'H',
  marsh: 'H', swamp: 'H', delta: 'H', wadi: 'H', channel: 'H', narrows: 'H',
  harbor: 'H', lagoon: 'H', reservoir: 'H', pool: 'H',
  county: 'A', province: 'A', state: 'A', district: 'A',
  park: 'L', region: 'L', forest: 'L',
};

/** A town beats an administrative area beats water beats terrain. */
const CLASS_RANK: Record<string, number> = { P: 0, A: 1, H: 2, T: 3 };

/** What the dots on the map are allowed to be. */
const DOT_CLASSES = new Set(['P', 'H', 'T']);

/**
 * Strip accents and punctuation, then expand abbreviations, so every spelling
 * of the same place collapses onto one comparable string.
 */
export function normalise(text: string): string {
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
 * Where every line begins.
 *
 * Derived rather than shipped: it is 2 MB of offsets that one pass over the
 * blob reproduces in a few milliseconds, and 2 MB is a real fraction of an
 * 11 MB download.
 */
export function lineStarts(blob: string, rows: number): Int32Array {
  const at = new Int32Array(rows);
  let cursor = 0;
  for (let i = 0; i < rows; i++) {
    cursor = blob.indexOf('\n', cursor) + 1;
    at[i] = cursor;
  }
  return at;
}

/**
 * Assemble the columns from the raw inflated buffers.
 *
 * Here rather than beside the IndexedDB loader so that what ships and what the
 * checks exercise build the rows through the same code — the only difference
 * being where the bytes came from.
 */
export function columnsFrom(raw: Map<string, Uint8Array>): PlaceColumns {
  const decoder = new TextDecoder();
  const text = (name: string) => decoder.decode(raw.get(name)!);
  const json = (name: string) => JSON.parse(text(name));
  const typed = (name: string, Ctor: any) => {
    const bytes = raw.get(name)!;
    // The stored buffer need not start on the element boundary a typed array
    // requires, so copy rather than view. One copy at load beats a surprise.
    const copy = bytes.slice();
    return new Ctor(copy.buffer, copy.byteOffset, copy.length / Ctor.BYTES_PER_ELEMENT);
  };

  const norm = text('norm');
  const display = text('display');
  const lat = typed('lat', Int32Array) as Int32Array;
  const rows = lat.length;

  const countries: string[] = json('countries');
  const admin1s: string[] = json('admin1s');

  return {
    rows,
    norm,
    display,
    normAt: lineStarts(norm, rows),
    displayAt: lineStarts(display, rows),
    lat,
    lon: typed('lon', Int32Array) as Int32Array,
    pop: typed('population', Uint32Array) as Uint32Array,
    popExceptions: json('population_exceptions'),
    importance: typed('importance', Uint16Array) as Uint16Array,
    countryCol: typed('country', Uint8Array) as Uint8Array,
    admin1Col: typed('admin1', Uint16Array) as Uint16Array,
    fcodeCol: typed('fcode', Uint8Array) as Uint8Array,
    countries,
    admin1s,
    fcodes: json('fcodes'),
    // A pack built before search needed the feature class carries none. The map
    // still works: the ranking goes flat rather than graded, and the dots stop
    // filtering out administrative areas.
    fclasses: raw.has('fclasses') ? json('fclasses') : [],
    countriesLower: countries.map((c) => c.toLowerCase()),
    admin1sLower: admin1s.map((a) => a.toLowerCase()),
  };
}

/** Which row an offset into the names blob belongs to. */
function rowAt(cols: PlaceColumns, offset: number): number {
  let lo = 0;
  let hi = cols.rows - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (cols.normAt[mid] <= offset) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

function lineAt(blob: string, starts: Int32Array, row: number): string {
  const from = starts[row];
  const to = blob.indexOf('\n', from);
  return blob.slice(from, to < 0 ? undefined : to);
}

const classOf = (cols: PlaceColumns, row: number): string =>
  cols.fclasses[cols.fcodeCol[row]] ?? '';

const popOf = (cols: PlaceColumns, row: number): number =>
  cols.popExceptions[row] ?? cols.pop[row];

function toHit(cols: PlaceColumns, row: number): PlaceHit {
  return {
    name: lineAt(cols.display, cols.displayAt, row),
    admin1: cols.admin1s[cols.admin1Col[row]] ?? '',
    country: cols.countries[cols.countryCol[row]] ?? '',
    lat: cols.lat[row] / 1e6,
    lon: cols.lon[row] / 1e6,
    population: popOf(cols, row),
    fclass: classOf(cols, row),
    fcode: cols.fcodes[cols.fcodeCol[row]] ?? '',
  };
}

function hintClass(words: string[]): string | null {
  for (const w of words) if (HINTS[w]) return HINTS[w];
  return null;
}

/**
 * Search the modern world.
 *
 * A query may name the place and may also say where it is:
 *   "saint cloud"        -> both Saint Clouds, biggest first
 *   "saint cloud mn"     -> the Minnesota one
 *   "st. cloud florida"  -> the Florida one
 *
 * Trailing words are tried as a region filter, and also dropped entirely:
 * "tampa bay" is a bay, so nothing is named that, but the reader plainly means
 * Tampa. Every reading contributes candidates; the ranking below decides,
 * rather than whichever reading was tried first.
 */
export function searchIn(cols: PlaceColumns, query: string, limit = 40): PlaceHit[] {
  const q = normalise(query);
  if (q.length < 2) return [];

  const words = q.split(' ');
  const attempts: Array<{ name: string; region: string }> = [{ name: q, region: '' }];
  for (const take of [1, 2]) {
    if (words.length > take) {
      const tail = words.slice(-take).join(' ');
      attempts.push({ name: words.slice(0, -take).join(' '), region: STATES[tail] ?? tail });
      attempts.push({ name: words.slice(0, -take).join(' '), region: '' });
    }
  }

  const hint = hintClass(words);

  // Each reading is tried in turn and the first that finds anything wins.
  //
  // Pooling every reading and ranking the lot was the obvious thing and it is
  // wrong: "saint cloud mn" ends by trying the bare word "saint", which sweeps
  // in Saint Petersburg, and five million Russians outweigh sixty thousand
  // Minnesotans on any sane population sort. A vague reading must never get to
  // outvote a precise one that already worked.
  //
  // The kind-word narrows the same way. Landmarks have no population, so they
  // sit at the far end of a population-ordered blob and an early exit never
  // reaches them; asking for the class up front is what puts "Grand Canyon"
  // ahead of the village on its rim. If that finds nothing the passes run
  // again unfiltered, so a hint word can only help.
  for (const requireClass of hint ? [hint, null] : [null]) {
    for (const attempt of attempts) {
      const found = collect(cols, attempt, requireClass, limit);
      if (found.length) return rank(cols, found, q, hint).slice(0, limit).map((row) => toHit(cols, row));
    }
  }
  return [];
}

/** Every row matching one reading of the query, in the blob's own order. */
function collect(
  cols: PlaceColumns,
  attempt: { name: string; region: string },
  requireClass: string | null,
  limit: number
): number[] {
  if (attempt.name.length < 2) return [];

  const found: number[] = [];
  const seen = new Set<number>();
  const ceiling = limit * 8;

  for (
    let at = cols.norm.indexOf(attempt.name);
    at >= 0 && found.length < ceiling;
    at = cols.norm.indexOf(attempt.name, at + 1)
  ) {
    const row = rowAt(cols, at);
    if (seen.has(row)) continue;
    seen.add(row);

    if (requireClass && classOf(cols, row) !== requireClass) continue;

    if (attempt.region) {
      const admin = cols.admin1sLower[cols.admin1Col[row]] ?? '';
      const country = cols.countriesLower[cols.countryCol[row]] ?? '';
      if (!admin.includes(attempt.region) && !country.includes(attempt.region)) continue;
    }

    found.push(row);
  }
  return found;
}

function rank(cols: PlaceColumns, rows: number[], q: string, hint: string | null): number[] {
  const exactly = (row: number) => (lineAt(cols.norm, cols.normAt, row) === q ? 0 : 1);

  return rows.sort((a, b) => {
    // An exactly-matching name beats a longer one that merely contains it,
    // which is what kept "St. Cloud MN Metro Area" above the city itself.
    if (exactly(a) !== exactly(b)) return exactly(a) - exactly(b);
    if (hint) {
      const h = (row: number) => (classOf(cols, row) === hint ? 0 : 1);
      if (h(a) !== h(b)) return h(a) - h(b);
    }
    const byClass = (row: number) => CLASS_RANK[classOf(cols, row)] ?? 4;
    if (byClass(a) !== byClass(b)) return byClass(a) - byClass(b);
    if (popOf(cols, a) !== popOf(cols, b)) return popOf(cols, b) - popOf(cols, a);
    // Lakes, canyons and mountains all have no population, so without this two
    // features of the same name sort arbitrarily and Missouri's Grand Canyon
    // lands above Arizona's.
    return cols.importance[b] - cols.importance[a];
  });
}

/**
 * Everything worth a dot inside the current view, most significant first.
 *
 * A straight scan of half a million rows, which sounds wasteful and takes
 * about two milliseconds because it never leaves the typed arrays: the only
 * objects built are the handful that come back.
 */
export function boundsIn(
  cols: PlaceColumns,
  bounds: { west: number; south: number; east: number; north: number },
  options: { limit?: number; minPopulation?: number } = {}
): PlaceHit[] {
  const limit = options.limit ?? 700;
  const minPop = options.minPopulation ?? 0;
  const west = Math.round(bounds.west * 1e6);
  const east = Math.round(bounds.east * 1e6);
  const south = Math.round(bounds.south * 1e6);
  const north = Math.round(bounds.north * 1e6);

  const out: PlaceHit[] = [];
  for (let row = 0; row < cols.rows && out.length < limit; row++) {
    const lat = cols.lat[row];
    if (lat < south || lat > north) continue;
    const lon = cols.lon[row];
    if (lon < west || lon > east) continue;
    if (minPop > 0 && popOf(cols, row) < minPop) continue;
    if (cols.fclasses.length && !DOT_CLASSES.has(classOf(cols, row))) continue;
    out.push(toHit(cols, row));
  }
  return out;
}
