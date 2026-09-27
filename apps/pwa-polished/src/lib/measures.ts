/**
 * Weights, measures and money — what a cubit or a talent comes to today.
 *
 * Tap a unit word and the ring's bottom pill says what it equals: "about 18
 * inches" for a lone cubit, "about 450 feet" for the 300 cubits of Genesis
 * 6:15, "a day's wage" for a denarius. Everything here is synchronous and
 * table-driven so the pill arrives with the ring instead of popping in late.
 *
 * English words carry no Strong's numbers, so a unit is recognised by its
 * spelling, across the translations we ship (BSB, NET, KJV, WEB, LXX2012).
 * Greek and Hebrew taps match on the Strong's number instead.
 *
 * Values follow ISBE's "Weights and Measures" and the figures the BSB's own
 * footnotes use. Money is given in days' wages, never dollars — a denarius
 * was a labourer's pay for a day, and that holds up where a price does not.
 */

import { BIBLE_BOOKS, normalizeBookName } from './bibleData';

export type UnitSystem = 'us' | 'metric';

type Kind = 'length' | 'dry' | 'liquid' | 'weight' | 'money';

interface Unit {
  kind: Kind;
  /** Metres, litres, grams, or days' wages, by kind. */
  value: number;
  /** History gives a range, so the figure reads "about …". */
  varies: boolean;
  /** Wording for one unit on its own, in place of a converted figure. */
  single?: string;
}

const U: Record<string, Unit> = {
  // Length (metres)
  cubit:        { kind: 'length', value: 0.4572, varies: true },
  longCubit:    { kind: 'length', value: 0.5334, varies: true }, // a cubit and a handbreadth
  span:         { kind: 'length', value: 0.2286, varies: true },
  handbreadth:  { kind: 'length', value: 0.0762, varies: true },
  reed:         { kind: 'length', value: 3.2, varies: true },    // six long cubits (Ezekiel 40:5)
  fathom:       { kind: 'length', value: 1.83, varies: true },
  stadion:      { kind: 'length', value: 185, varies: true },
  romanMile:    { kind: 'length', value: 1480, varies: true },
  sabbathWalk:  { kind: 'length', value: 914, varies: true },   // 2,000 cubits
  dayWalk:      { kind: 'length', value: 32000, varies: true },

  // Dry volume (litres)
  ephah:        { kind: 'dry', value: 22, varies: true },
  omer:         { kind: 'dry', value: 2.2, varies: true },
  homer:        { kind: 'dry', value: 220, varies: true },
  kor:          { kind: 'dry', value: 220, varies: true },
  lethech:      { kind: 'dry', value: 110, varies: true },
  seah:         { kind: 'dry', value: 7.3, varies: true },
  cab:          { kind: 'dry', value: 1.2, varies: true },
  choinix:      { kind: 'dry', value: 1.1, varies: true },

  // Liquid volume (litres)
  bath:         { kind: 'liquid', value: 22, varies: true },
  hin:          { kind: 'liquid', value: 3.7, varies: true },
  log:          { kind: 'liquid', value: 0.31, varies: true },
  metretes:     { kind: 'liquid', value: 39, varies: true },

  // Weight (grams)
  shekel:       { kind: 'weight', value: 11.4, varies: true },
  beka:         { kind: 'weight', value: 5.7, varies: true },
  gerah:        { kind: 'weight', value: 0.57, varies: true, single: '1/20 of a shekel' },
  pim:          { kind: 'weight', value: 7.6, varies: true },
  mina:         { kind: 'weight', value: 570, varies: true },
  talentWeight: { kind: 'weight', value: 34200, varies: true },
  litra:        { kind: 'weight', value: 327, varies: true },

  // Money (days' wages)
  denarius:     { kind: 'money', value: 1, varies: false },
  didrachma:    { kind: 'money', value: 2, varies: false },
  stater:       { kind: 'money', value: 4, varies: false },
  assarion:     { kind: 'money', value: 1 / 16, varies: false },
  quadrans:     { kind: 'money', value: 1 / 64, varies: false },
  lepton:       { kind: 'money', value: 1 / 128, varies: false },
  minaMoney:    { kind: 'money', value: 100, varies: false },
  talentMoney:  { kind: 'money', value: 6000, varies: true },
};

// ── Where a word counts ─────────────────────────────────────────────────────

/** A book, optionally narrowed to chapters and a verse range within the first. */
interface Passage {
  book: string;
  from?: number;
  to?: number;
  verses?: [number, number];
}

const p = (book: string, from?: number, to = from, verses?: [number, number]): Passage =>
  ({ book, from, to, verses });

function inPassage(list: Passage[] | undefined, book: string, chapter: number, verse: number | null): boolean {
  if (!list) return false;
  return list.some((q) => {
    if (q.book !== book) return false;
    if (q.from === undefined) return true;
    if (chapter < q.from || chapter > (q.to ?? q.from)) return false;
    if (!q.verses || verse == null) return !q.verses;
    return verse >= q.verses[0] && verse <= q.verses[1];
  });
}

const NT_BOOKS = new Set(BIBLE_BOOKS.filter((b) => b.testament === 'NT').map((b) => b.name));

interface Entry {
  /** Each spelling is a run of lowercase tokens: "silver coin" is ['silver', 'coin']. */
  spellings: string[][];
  /** The unit, or one picked by where the verse is. */
  unit: string | ((book: string, chapter: number, verse: number | null) => string | null);
  /** Only a unit in these passages ("a bruised reed" is a plant). */
  only?: Passage[];
  /** Only a unit next to a number, or in these passages. */
  needsNumber?: boolean;
  where?: Passage[];
  /** Never a unit here, whatever the wording. */
  never?: Passage[];
}

const words = (...list: string[]) => list.map((s) => s.split(' '));

/** Old Testament talents and minas are weights of metal; in the Gospels they are sums of money. */
const talent = (book: string) => (NT_BOOKS.has(book) ? 'talentMoney' : 'talentWeight');
const mina = (book: string) => (NT_BOOKS.has(book) ? 'minaMoney' : 'mina');

/** Which coin "penny" means depends on the translation's verse: KJV's is a denarius, BSB's a small copper. */
function penny(book: string, chapter: number, verse: number | null): string {
  if (book === 'Matthew' && chapter === 5 && verse === 26) return 'quadrans';
  if (book === 'Luke' && chapter === 12 && verse === 59) return 'lepton';
  if ((book === 'Matthew' && chapter === 10 && verse === 29) || (book === 'Luke' && chapter === 12 && verse === 6)) {
    return 'assarion';
  }
  return 'denarius';
}

function farthing(book: string, chapter: number, verse: number | null): string {
  if ((book === 'Matthew' && chapter === 10 && verse === 29) || (book === 'Luke' && chapter === 12 && verse === 6)) {
    return 'assarion';
  }
  return 'quadrans';
}

/** "Pound" is a mina in Luke 19 and the Old Testament, a Roman litra in John. */
function pound(book: string): string {
  if (book === 'John') return 'litra';
  return mina(book);
}

/** KJV's "measure" stands for several Hebrew and Greek units, so it is mapped verse by verse. */
const MEASURE_BY_VERSE: [string, number, number, string][] = [
  ['Genesis', 18, 6, 'seah'],
  ['1 Samuel', 25, 18, 'seah'],
  ['1 Kings', 18, 32, 'seah'],
  ['2 Kings', 7, 1, 'seah'],
  ['2 Kings', 7, 16, 'seah'],
  ['2 Kings', 7, 18, 'seah'],
  ['Matthew', 13, 33, 'seah'],
  ['Luke', 13, 21, 'seah'],
  ['1 Kings', 4, 22, 'kor'],
  ['1 Kings', 5, 11, 'kor'],
  ['2 Chronicles', 2, 10, 'kor'],
  ['2 Chronicles', 27, 5, 'kor'],
  ['Ezra', 7, 22, 'kor'],
  ['Luke', 16, 6, 'bath'],
  ['Luke', 16, 7, 'kor'],
  ['Revelation', 6, 6, 'choinix'],
];

function measure(book: string, chapter: number, verse: number | null): string | null {
  const hit = MEASURE_BY_VERSE.find(([b, c, v]) => b === book && c === chapter && v === verse);
  return hit ? hit[3] : null;
}

const ENTRIES: Entry[] = [
  // Length
  { spellings: words('cubit', 'cubits'), unit: 'cubit' },
  { spellings: words('span', 'spans'), unit: 'span', needsNumber: true,
    where: [p('Exodus', 28), p('Exodus', 39), p('1 Samuel', 17), p('Isaiah', 40), p('Ezekiel', 43), p('Lamentations', 2)] },
  { spellings: words('handbreadth', 'handbreadths', 'handbreath', 'hand breadth', 'handsbreadth'), unit: 'handbreadth' },
  { spellings: words('reed', 'reeds', 'rod', 'rods'), unit: 'reed', only: [p('Ezekiel', 40, 48)] },
  { spellings: words('fathom', 'fathoms'), unit: 'fathom' },
  { spellings: words('furlong', 'furlongs', 'stadia', 'stadion', 'stades'), unit: 'stadion' },
  // BSB and NET already give modern miles in John and Luke; only Jesus' "go a mile" is Roman.
  { spellings: words('mile', 'miles'), unit: 'romanMile', only: [p('Matthew', 5)] },
  { spellings: words('sabbath day s journey', 'sabbath days journey', 'sabbath day journey'), unit: 'sabbathWalk' },
  { spellings: words('day s journey', 'days journey', 'days journeys'), unit: 'dayWalk' },

  // Dry volume
  { spellings: words('ephah', 'ephahs'), unit: 'ephah' },
  { spellings: words('omer', 'omers'), unit: 'omer' },
  { spellings: words('homer', 'homers'), unit: 'homer' },
  { spellings: words('cor', 'cors', 'kor', 'kors'), unit: 'kor' },
  { spellings: words('lethech'), unit: 'lethech' },
  { spellings: words('seah', 'seahs'), unit: 'seah' },
  { spellings: words('cab', 'cabs', 'kab', 'kabs'), unit: 'cab' },
  { spellings: words('measure', 'measures'), unit: measure },

  // Liquid volume
  { spellings: words('bath', 'baths'), unit: 'bath', needsNumber: true,
    where: [p('1 Kings', 7), p('2 Chronicles', 2), p('2 Chronicles', 4), p('Ezra', 7), p('Isaiah', 5), p('Ezekiel', 45)] },
  { spellings: words('hin', 'hins'), unit: 'hin' },
  { spellings: words('log', 'logs'), unit: 'log', only: [p('Leviticus', 14)] },
  { spellings: words('firkin', 'firkins', 'metretes', 'metretae'), unit: 'metretes' },

  // Weight
  { spellings: words('shekel', 'shekels'), unit: 'shekel' },
  { spellings: words('beka', 'bekah', 'bekas'), unit: 'beka' },
  { spellings: words('gerah', 'gerahs'), unit: 'gerah' },
  { spellings: words('pim'), unit: 'pim' },
  { spellings: words('mina', 'minas', 'minae', 'maneh', 'manehs'), unit: mina },
  { spellings: words('talent', 'talents'), unit: talent },
  { spellings: words('pound', 'pounds'), unit: pound,
    only: [p('Luke', 19), p('John', 12), p('John', 19), p('1 Kings', 10), p('Ezra', 2), p('Nehemiah', 7)] },

  // Money
  { spellings: words('denarius', 'denarii', 'denarion', 'pence', 'pennyworth'), unit: 'denarius' },
  { spellings: words('penny', 'pennies'), unit: penny },
  // NET's "silver coin" is a denarius or drachma — except Judas's thirty, which were shekels.
  { spellings: words('silver coin', 'silver coins'), unit: 'denarius',
    never: [p('Matthew', 26), p('Matthew', 27)] },
  { spellings: words('drachma', 'drachmas', 'drachmae'), unit: 'denarius' },
  { spellings: words('didrachma', 'didrachmas'), unit: 'didrachma' },
  { spellings: words('stater', 'staters'), unit: 'stater' },
  { spellings: words('assarion', 'assaria'), unit: 'assarion' },
  { spellings: words('quadrans', 'kodrantes', 'farthing', 'farthings'), unit: farthing },
  { spellings: words('lepton', 'lepta', 'mite', 'mites', 'copper coin', 'copper coins'), unit: 'lepton' },
];

/** Longest spellings first, so "sabbath day's journey" wins over "day's journey". */
const BY_TOKEN = new Map<string, { entry: Entry; spelling: string[] }[]>();
for (const entry of ENTRIES) {
  for (const spelling of entry.spellings) {
    for (const tok of new Set(spelling)) {
      if (tok === 's') continue; // the tail of "day's" is never what was tapped
      const list = BY_TOKEN.get(tok) ?? [];
      list.push({ entry, spelling });
      BY_TOKEN.set(tok, list);
    }
  }
}
for (const list of BY_TOKEN.values()) list.sort((a, b) => b.spelling.length - a.spelling.length);

/** Strong's number → unit, for Greek and Hebrew taps. */
interface StrongsEntry {
  unit: string | ((book: string, chapter: number, verse: number | null) => string | null);
  /** The same word has other senses; only count it when the gloss says unit. */
  gloss?: RegExp;
  only?: Passage[];
}

const STRONGS: Record<string, StrongsEntry> = {
  H520: { unit: 'cubit' },
  G4083: { unit: 'cubit' },
  H2239: { unit: 'span' },
  H2947: { unit: 'handbreadth' },
  H2948: { unit: 'handbreadth' },
  H7070: { unit: 'reed', only: [p('Ezekiel', 40, 48)] },
  G3712: { unit: 'fathom' },
  G4712: { unit: 'stadion' },
  G3400: { unit: 'romanMile' },
  H374: { unit: 'ephah' },
  H6016: { unit: 'omer', gloss: /omer/i },
  H2563: { unit: 'homer', gloss: /homer/i },
  H3734: { unit: 'kor' },
  G2884: { unit: 'kor' },
  H3963: { unit: 'lethech' },
  H5429: { unit: 'seah' },
  G4568: { unit: 'seah' },
  H6894: { unit: 'cab' },
  G5518: { unit: 'choinix' },
  H1324: { unit: 'bath' },
  G943: { unit: 'bath' },
  H1969: { unit: 'hin' },
  H3849: { unit: 'log' },
  G3355: { unit: 'metretes' },
  H8255: { unit: 'shekel' },
  H1235: { unit: 'beka' },
  H1626: { unit: 'gerah' },
  H6378: { unit: 'pim' },
  H4488: { unit: 'mina' },
  G3414: { unit: 'minaMoney' },
  H3603: { unit: 'talentWeight', gloss: /talent/i },
  G5007: { unit: 'talentMoney' },
  G3046: { unit: 'litra' },
  G1220: { unit: 'denarius' },
  G1406: { unit: 'denarius' },
  G1323: { unit: 'didrachma' },
  G4715: { unit: 'stater' },
  G787: { unit: 'assarion' },
  G2835: { unit: 'quadrans' },
  G3016: { unit: 'lepton' },
};

// ── Reading the amount ──────────────────────────────────────────────────────

const tokenize = (s: string): string[] =>
  (s.toLowerCase().match(/\p{L}+|\d[\d,]*(?:\.\d+)?/gu) ?? []) as string[];

const ONES: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9,
  ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15,
  sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19,
  twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90,
  // KJV counts in scores.
  twoscore: 40, threescore: 60, fourscore: 80, fivescore: 100, sixscore: 120,
};
const SCALES: Record<string, number> = { hundred: 100, thousand: 1000, million: 1_000_000 };
const FRACTIONS: Record<string, number> = {
  half: 1 / 2, halves: 1 / 2, third: 1 / 3, thirds: 1 / 3, quarter: 1 / 4, quarters: 1 / 4,
  fourth: 1 / 4, fourths: 1 / 4, fifth: 1 / 5, fifths: 1 / 5, sixth: 1 / 6, sixths: 1 / 6,
  tenth: 1 / 10, tenths: 1 / 10,
};
/** Words that can sit between a number and its unit: "six long cubits", "twenty sanctuary shekels". */
const BETWEEN = new Set(['long', 'great', 'small', 'full', 'sanctuary', 'royal', 'common', 'heavy', 'whole']);

const isDigits = (t: string) => /^\d/.test(t);
const isNumberWord = (t: string) => t in ONES || t in SCALES || t === 'score' || isDigits(t);

/** Words, read forward: "a thousand and six hundred" → 1600. */
function parseNumberWords(run: string[]): number | null {
  let total = 0;
  let current = 0;
  let seen = false;
  for (const t of run) {
    if (isDigits(t)) {
      current += parseFloat(t.replace(/,/g, ''));
      seen = true;
    } else if (t in ONES) {
      current += ONES[t];
      seen = true;
    } else if (t === 'a' || t === 'an') {
      current += 1;
    } else if (t === 'score') {
      current = (current || 1) * 20;
      seen = true;
    } else if (t in SCALES) {
      const scale = SCALES[t];
      if (scale >= 1000) {
        total += (current || 1) * scale;
        current = 0;
      } else {
        current = (current || 1) * scale;
      }
      seen = true;
    }
    // "and" joins parts and adds nothing.
  }
  return seen ? total + current : null;
}

/**
 * The longest run of number words ending at `end` (exclusive): its value and
 * where it starts. A bare "a" is not a number — "a cubit" is one cubit, but it
 * does not tell an ambiguous word it is a unit.
 */
function numberRunBefore(toks: string[], end: number): { value: number; start: number } | null {
  // Figures stand alone ("1,600"); they never join a run of words.
  if (end > 0 && isDigits(toks[end - 1])) {
    return { value: parseFloat(toks[end - 1].replace(/,/g, '')), start: end - 1 };
  }
  let start = end;
  while (start > 0) {
    const t = toks[start - 1];
    if ((isNumberWord(t) && !isDigits(t)) || t === 'and' || t === 'a' || t === 'an') start--;
    else break;
  }
  // Trim joiners from the front: "cubits, and fifty" starts at "fifty".
  while (start < end && (toks[start] === 'and' || ((toks[start] === 'a' || toks[start] === 'an') &&
    !(toks[start + 1] in SCALES) && toks[start + 1] !== 'score'))) {
    start++;
  }
  if (start >= end) return null;
  const value = parseNumberWords(toks.slice(start, end));
  return value == null ? null : { value, start };
}

interface Amount {
  lo: number;
  hi: number;
  /** A number was written. Without one this is a lone "a cubit". */
  explicit: boolean;
  /** "six long cubits" — Ezekiel's cubit and a handbreadth. */
  long: boolean;
}

/** The amount written before the unit, and "and a half" after it. */
function readAmount(before: string[], after: string[]): Amount {
  let end = before.length;
  let long = false;
  while (end > 0 && BETWEEN.has(before[end - 1])) {
    if (before[end - 1] === 'long') long = true;
    end--;
  }
  const at = (i: number) => before[end - i];
  const halfAfter = after[0] === 'and' && (after[1] === 'a' || after[1] === 'an') && after[2] === 'half' ? 0.5 : 0;

  let amount: { lo: number; hi: number } | null = null;

  if (end >= 3 && at(1) === 'half' && at(2) === 'a' && at(3) === 'and') {
    // "two and a half cubits"
    const run = numberRunBefore(before, end - 3);
    if (run) amount = { lo: run.value + 0.5, hi: run.value + 0.5 };
  }
  if (!amount && end >= 2 && (at(1) === 'a' || at(1) === 'an') && at(2) === 'half') {
    // "half a shekel"
    amount = { lo: 0.5, hi: 0.5 };
  }
  if (!amount) {
    // "three-tenths of an ephah", "a third of a shekel", "a quarter cab", "a half shekel"
    let f = end;
    if (before[f - 1] === 'a' || before[f - 1] === 'an') {
      if (before[f - 2] === 'of') f -= 2;
    } else if (before[f - 1] === 'of') {
      f -= 1;
    }
    const frac = FRACTIONS[before[f - 1]];
    if (frac !== undefined) {
      const run = numberRunBefore(before, f - 1);
      const count = run?.value ?? 1;
      amount = { lo: count * frac, hi: count * frac };
    }
  }
  if (!amount) {
    const run = numberRunBefore(before, end);
    if (run) {
      amount = { lo: run.value, hi: run.value };
      // "two or three firkins", "twenty to thirty"
      const joiner = before[run.start - 1];
      if (joiner === 'or' || joiner === 'to') {
        const first = numberRunBefore(before, run.start - 1);
        if (first && first.value < run.value) amount.lo = first.value;
      }
    }
  }

  if (!amount) return { lo: 1 + halfAfter, hi: 1 + halfAfter, explicit: halfAfter > 0, long };
  return { lo: amount.lo + halfAfter, hi: amount.hi + halfAfter, explicit: true, long };
}

// ── Saying it ───────────────────────────────────────────────────────────────

const GLYPH: Record<number, string> = { 0.25: '¼', 0.5: '½', 0.75: '¾' };

/**
 * A friendly figure. US: one decimal under 1, quarters to 10, halves to 20.
 * Metric: one decimal under 10. Both: whole numbers after that, and three
 * significant digits past a thousand.
 */
function figure(v: number, metric: boolean): string {
  if (v >= 1000) {
    const mag = Math.pow(10, Math.floor(Math.log10(v)) - 2);
    return (Math.round(v / mag) * mag).toLocaleString('en-US');
  }
  if (v < 1) {
    // US: "½ pint" when it is close to a quarter, otherwise "0.4 ounces".
    const q = Math.round(v * 4) / 4;
    if (!metric && q > 0 && Math.abs(v - q) < 0.06) return q === 1 ? '1' : GLYPH[q];
    return String(Number(v.toPrecision(1)));
  }
  if (metric) return v >= 10 ? Math.round(v).toLocaleString('en-US') : String(Math.round(v * 10) / 10);
  if (v >= 20) return Math.round(v).toLocaleString('en-US');
  const step = v >= 10 ? 2 : 4;
  const q = Math.round(v * step) / step;
  const whole = Math.floor(q);
  const part = GLYPH[q - whole];
  return part ? `${whole || ''}${part}` : String(whole);
}

/** "1 foot", "½ mile" — but "0.4 ounces", "2 feet". */
const singular = (shown: string) => shown === '1' || /^[¼½¾]$/.test(shown);

interface Scale {
  /** How many base units (metres, litres, grams) make one of these. */
  size: number;
  one: string;
  many: string;
  /** Use this one from this many base units up. */
  from: number;
}

const SCALES_US: Record<Exclude<Kind, 'money'>, Scale[]> = {
  length: [
    { size: 0.0254, one: 'inch', many: 'inches', from: 0 },
    { size: 0.3048, one: 'foot', many: 'feet', from: 0.6096 },
    { size: 1609.34, one: 'mile', many: 'miles', from: 804.67 },
  ],
  dry: [
    { size: 0.5506, one: 'pint', many: 'pints', from: 0 },
    { size: 1.1012, one: 'quart', many: 'quarts', from: 1.0 },
    { size: 35.239, one: 'bushel', many: 'bushels', from: 35.239 },
  ],
  liquid: [
    { size: 0.2366, one: 'cup', many: 'cups', from: 0 },
    { size: 0.9464, one: 'quart', many: 'quarts', from: 0.9 },
    { size: 3.7854, one: 'gallon', many: 'gallons', from: 3.4 },
  ],
  weight: [
    { size: 28.3495, one: 'ounce', many: 'ounces', from: 0 },
    { size: 453.592, one: 'pound', many: 'pounds', from: 453.592 },
    { size: 907185, one: 'ton', many: 'tons', from: 907185 },
  ],
};

const SCALES_METRIC: Record<Exclude<Kind, 'money'>, Scale[]> = {
  length: [
    { size: 0.01, one: 'cm', many: 'cm', from: 0 },
    { size: 1, one: 'm', many: 'm', from: 1 },
    { size: 1000, one: 'km', many: 'km', from: 1000 },
  ],
  dry: [
    { size: 0.001, one: 'ml', many: 'ml', from: 0 },
    { size: 1, one: 'L', many: 'L', from: 1 },
  ],
  liquid: [
    { size: 0.001, one: 'ml', many: 'ml', from: 0 },
    { size: 1, one: 'L', many: 'L', from: 1 },
  ],
  weight: [
    { size: 1, one: 'g', many: 'g', from: 0 },
    { size: 1000, one: 'kg', many: 'kg', from: 1000 },
    { size: 1_000_000, one: 'metric ton', many: 'metric tons', from: 1_000_000 },
  ],
};

/** Metres → "3 feet 9 inches", "1 foot 6 inches", "2 feet". */
function feetAndInches(metres: number): string {
  const total = Math.round(metres / 0.0254);
  const ft = Math.floor(total / 12);
  const inches = total % 12;
  const feet = `${ft} ${ft === 1 ? 'foot' : 'feet'}`;
  return inches ? `${feet} ${inches} ${inches === 1 ? 'inch' : 'inches'}` : feet;
}

function physical(kind: Exclude<Kind, 'money'>, lo: number, hi: number, system: UnitSystem): string {
  const metric = system === 'metric';
  const scales = (metric ? SCALES_METRIC : SCALES_US)[kind];
  // Pick the scale by the larger end so a range reads in one unit.
  const scale = [...scales].reverse().find((s) => hi >= s.from) ?? scales[0];
  // Nobody says "3¾ feet": short lengths read as feet and inches.
  if (!metric && scale.one === 'foot' && hi / scale.size < 20) {
    const a = feetAndInches(lo);
    const b = feetAndInches(hi);
    return a === b ? a : `${a} to ${b}`;
  }
  const a = figure(lo / scale.size, metric);
  const b = figure(hi / scale.size, metric);
  const name = a === b && singular(a) ? scale.one : scale.many;
  return a === b ? `${a} ${name}` : `${a}–${b} ${name}`;
}

/** Days' wages, in words: "a day's wage", "200 days' wages", "about 20 years' wages", "1/128 of a day's wage". */
function wages(days: number): { text: string; approx: boolean } {
  if (days >= 300) {
    const years = days / 300;
    return { text: years < 1.125 ? "a year's wages" : `${figure(years, false)} years' wages`, approx: true };
  }
  if (days === 1) return { text: "a day's wage", approx: false };
  if (days > 1) {
    const whole = Number.isInteger(days);
    return { text: `${figure(days, false)} days' wages`, approx: !whole };
  }
  if (days === 0.5) return { text: "half a day's wage", approx: false };
  const inv = 1 / days;
  if (Math.abs(inv - Math.round(inv)) < 0.01) return { text: `1/${Math.round(inv)} of a day's wage`, approx: false };
  return { text: `${Number(days.toPrecision(2))} of a day's wage`, approx: true };
}

function describe(unitId: string, amount: Amount, system: UnitSystem): string {
  const id = unitId === 'cubit' && amount.long ? 'longCubit' : unitId;
  const unit = U[id];
  if (!unit) return '';
  if (!amount.explicit && unit.single) return unit.single;

  const lo = amount.lo * unit.value;
  const hi = amount.hi * unit.value;

  if (unit.kind === 'money') {
    if (lo !== hi) {
      const a = wages(lo);
      const b = wages(hi);
      // "200–300 days' wages" rather than repeating the noun.
      const aNum = a.text.split(' ')[0];
      const text = a.text.split(' ').slice(1).join(' ') === b.text.split(' ').slice(1).join(' ')
        ? `${aNum}–${b.text}`
        : `${a.text} to ${b.text}`;
      return (unit.varies || a.approx || b.approx ? 'about ' : '') + text;
    }
    const w = wages(lo);
    return (unit.varies || w.approx ? 'about ' : '') + w.text;
  }

  return (unit.varies ? 'about ' : '') + physical(unit.kind, lo, hi, system);
}

// ── Public ──────────────────────────────────────────────────────────────────

export interface MeasureContext {
  /** Verse text before the tapped word, as read (footnote markers left out). */
  before: string;
  /** Verse text after it. */
  after: string;
  book: string;
  chapter: number;
  verse: number | null;
}

/**
 * The pill text for an English word, or '' when it is not a unit here.
 *
 * "cubits" in "300 cubits long" → "about 450 feet"; a lone "cubit" → "about
 * 18 inches"; "a bruised reed" → ''.
 */
export function measureForWord(word: string, ctx: MeasureContext, system: UnitSystem): string {
  const tapped = tokenize(word)[0];
  if (!tapped) return '';
  const candidates = BY_TOKEN.get(tapped);
  if (!candidates) return '';

  const book = normalizeBookName(ctx.book);
  const before = tokenize(ctx.before).slice(-16);
  const after = tokenize(ctx.after).slice(0, 8);

  for (const { entry, spelling } of candidates) {
    // The tapped word can be any word of a multi-word spelling: "silver" or "coin".
    for (let i = 0; i < spelling.length; i++) {
      if (spelling[i] !== tapped) continue;
      const head = spelling.slice(0, i);
      const tail = spelling.slice(i + 1);
      const headStart = before.length - head.length;
      if (headStart < 0 || head.some((t, k) => before[headStart + k] !== t)) continue;
      if (tail.some((t, k) => after[k] !== t)) continue;

      if (inPassage(entry.never, book, ctx.chapter, ctx.verse)) return '';
      if (entry.only && !inPassage(entry.only, book, ctx.chapter, ctx.verse)) return '';

      const amount = readAmount(before.slice(0, headStart), after.slice(tail.length));
      if (entry.needsNumber && !amount.explicit && !inPassage(entry.where, book, ctx.chapter, ctx.verse)) return '';

      const unitId = typeof entry.unit === 'function' ? entry.unit(book, ctx.chapter, ctx.verse) : entry.unit;
      if (!unitId) return '';
      return describe(unitId, amount, system);
    }
  }
  return '';
}

/** The pill text for a Greek or Hebrew word, by its Strong's number. Always a single unit. */
export function measureForStrongs(
  strongs: string,
  gloss: string,
  bookName: string,
  chapter: number,
  verse: number | null,
  system: UnitSystem,
): string {
  const m = /^([GH])0*(\d+)/i.exec(strongs.trim());
  if (!m) return '';
  const entry = STRONGS[`${m[1].toUpperCase()}${m[2]}`];
  if (!entry) return '';
  const book = normalizeBookName(bookName);
  if (entry.gloss && !entry.gloss.test(gloss)) return '';
  if (entry.only && !inPassage(entry.only, book, chapter, verse)) return '';
  const unitId = typeof entry.unit === 'function' ? entry.unit(book, chapter, verse) : entry.unit;
  if (!unitId) return '';
  return describe(unitId, { lo: 1, hi: 1, explicit: false, long: false }, system);
}
