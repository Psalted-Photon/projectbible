/**
 * Pointed Hebrew → the sounds a voice is given, skipping espeak entirely.
 *
 * espeak's Hebrew rules are broken and no open Hebrew voice is shippable, but
 * fully pointed text is regular enough to read by rule, and the German voice
 * has nearly every Hebrew sound (sh, kh, ts, the throat r, the glottal catch).
 * ח and ע are read the modern way, as kh and a catch or nothing.
 *
 * Tuned in public/hebrew-voice-lab.html, which keeps its own copy of these
 * rules. This one adds three fixes found by running all 12,033 Strong's
 * headwords through it: an accent on a headword marks its stress, patah plus
 * hiriq on one letter is "-ayi-" (Jerusalem), and a vowel letter after a
 * silent aleph still belongs to the letter before.
 *
 * Dependency-free on purpose: the main thread decides whether a word can be
 * said at all, and the worker only ever sees the finished sounds.
 */

/** The Piper voice that reads Hebrew. CC0 (the Thorsten-Voice dataset). */
export const HEBREW_VOICE_ID = 'de_DE-thorsten-medium';

/**
 * Slower than the voice's own pace, as auditioned in the lab: a word said to
 * be learned wants a little more time than a word inside a sentence.
 */
export const HEBREW_WORD_PACE = 0.85;

const M = {
  SHVA: 'ְ', HSEG: 'ֱ', HPAT: 'ֲ', HQAM: 'ֳ',
  HIRIQ: 'ִ', TSERE: 'ֵ', SEGOL: 'ֶ', PATAH: 'ַ',
  QAMATS: 'ָ', HOLAM: 'ֹ', HOLAM_HASER: 'ֺ', QUBUTS: 'ֻ',
  DAGESH: 'ּ', METEG: 'ֽ', MAQAF: '־', SIN: 'ׂ',
  QQATAN: 'ׇ',
};

type VowelKind =
  | 'patah' | 'qamats' | 'qqatan' | 'tsere' | 'segol' | 'hiriq' | 'holam'
  | 'qubuts' | 'shureq' | 'shva' | 'hpatah' | 'hsegol' | 'hqamats';

const VOWEL_OF: Record<string, VowelKind> = {
  [M.PATAH]: 'patah', [M.QAMATS]: 'qamats', [M.QQATAN]: 'qqatan',
  [M.TSERE]: 'tsere', [M.SEGOL]: 'segol', [M.HIRIQ]: 'hiriq',
  [M.HOLAM]: 'holam', [M.HOLAM_HASER]: 'holam', [M.QUBUTS]: 'qubuts',
  [M.SHVA]: 'shva', [M.HPAT]: 'hpatah', [M.HSEG]: 'hsegol', [M.HQAM]: 'hqamats',
};

const REDUCED = new Set<VowelKind>(['shva', 'hpatah', 'hsegol', 'hqamats']);
const FINAL_FORM: Record<string, string> = { 'ך': 'כ', 'ם': 'מ', 'ן': 'נ', 'ף': 'פ', 'ץ': 'צ' };
const BEGADKEFAT = new Set(['ב', 'ג', 'ד', 'כ', 'פ', 'ת']);
const VOWELS = new Set(['a', 'e', 'i', 'o', 'u']);

interface Unit {
  base: string;
  marks: Set<string>;
  vowel: VowelKind | null;
  /** Patah and hiriq on one letter: the yod of "-ayi-" left unwritten. */
  ayi?: boolean;
  /** Carries an accent, which on a headword sits on the stressed syllable. */
  accent?: boolean;
  silent?: boolean;
  shureqAlone?: boolean;
}

interface Syllable {
  start: number;
  kind: VowelKind;
  base: string;
  accent: boolean;
}

function soundOfVowel(kind: VowelKind): string {
  switch (kind) {
    case 'patah': case 'qamats': case 'hpatah': return 'a';
    case 'tsere': case 'segol': case 'hsegol': case 'shva': return 'e';
    case 'hiriq': return 'i';
    case 'holam': case 'qqatan': case 'hqamats': return 'o';
    case 'qubuts': case 'shureq': return 'u';
  }
}

function consonantOf(u: Unit, i: number): string {
  const d = u.marks.has(M.DAGESH);
  switch (u.base) {
    case 'א': case 'ע': return i === 0 ? '' : 'ʔ';
    case 'ב': return d ? 'b' : 'v';
    case 'ג': return 'ɡ';
    case 'ד': return 'd';
    case 'ה': return 'h';
    case 'ו': return 'v';
    case 'ז': return 'z';
    case 'ח': return 'x';
    case 'ט': return 't';
    case 'י': return 'j';
    case 'כ': return d ? 'k' : 'x';
    case 'ל': return 'l';
    case 'מ': return 'm';
    case 'נ': return 'n';
    case 'ס': return 's';
    case 'פ': return d ? 'p' : 'f';
    case 'צ': return 'ts';
    case 'ק': return 'k';
    case 'ר': return 'ʁ';
    case 'ש': return u.marks.has(M.SIN) ? 's' : 'ʃ';
    case 'ת': return 't';
    default: return '';
  }
}

function parseUnits(word: string): Unit[] {
  const units: Unit[] = [];
  for (const ch of word) {
    if (ch >= 'א' && ch <= 'ת') {
      units.push({ base: FINAL_FORM[ch] ?? ch, marks: new Set(), vowel: null });
      continue;
    }
    const u = units[units.length - 1];
    if (!u) continue;
    if (ch >= '֑' && ch <= '֯') {
      u.accent = true;
    } else if (ch >= 'ְ' && ch <= 'ׇ') {
      u.marks.add(ch);
      const kind = VOWEL_OF[ch];
      if (!kind) continue;
      // Holam on a vav is decided later: it may belong to the letter before.
      if (u.base === 'ו' && ch === M.HOLAM) continue;
      if (!u.vowel) u.vowel = kind;
      else if (
        (kind === 'hiriq' && (u.vowel === 'patah' || u.vowel === 'qamats')) ||
        ((kind === 'patah' || kind === 'qamats') && u.vowel === 'hiriq')
      ) {
        u.vowel = 'patah';
        u.ayi = true;
      }
    }
  }
  return units;
}

/** The letter before `i` that is still heard, skipping silent ones. */
function spokenBefore(units: Unit[], i: number): Unit | null {
  for (let j = i - 1; j >= 0; j--) if (!units[j].silent) return units[j];
  return null;
}

/** The vowel a letter ends up with, looking back past a silent vowel letter. */
function effectiveVowel(units: Unit[], i: number): VowelKind | null {
  for (let j = i; j >= 0; j--) {
    if (units[j].vowel) return units[j].vowel;
    if (!units[j].silent) return null;
  }
  return null;
}

/** One word (no spaces, no maqaf). `stressless` for the first of a maqaf pair. */
function wordSounds(units: Unit[], stressless: boolean): string[] {
  const n = units.length;

  // Pass 1: vowel letters. A vav or yod that only spells a vowel goes silent
  // and hands its vowel to the letter before.
  for (let i = 0; i < n; i++) {
    const u = units[i];
    if (u.base === 'ו') {
      const hasHolam = u.marks.has(M.HOLAM);
      if (u.marks.has(M.DAGESH) && !u.vowel && !hasHolam) {
        const prev = spokenBefore(units, i);
        if (!prev) { u.shureqAlone = true; continue; }
        if (!prev.vowel) { prev.vowel = 'shureq'; u.silent = true; continue; }
      }
      if (hasHolam && !u.vowel) {
        const prev = spokenBefore(units, i);
        if (prev && !prev.vowel) { prev.vowel = 'holam'; u.silent = true; continue; }
        u.vowel = 'holam'; // a vav carrying its own o: "vo"
      }
    } else if (u.base === 'י' && !u.vowel && !u.marks.has(M.DAGESH) && i > 0) {
      const pv = effectiveVowel(units, i - 1);
      const last = units[n - 1];
      if (pv === 'hiriq' || pv === 'tsere' || pv === 'segol') u.silent = true;
      else if ((pv === 'qamats' || pv === 'patah') && i === n - 2 && last.base === 'ו' && !last.vowel) u.silent = true; // -av
    } else if (u.base === 'א' && (!u.vowel || u.vowel === 'shva') && i > 0) {
      u.silent = true;
    } else if (u.base === 'ע' && (!u.vowel || u.vowel === 'shva') && i > 0) {
      u.silent = true; // modern reading: a vowelless ayin is not heard
    } else if (u.base === 'ה' && i === n - 1 && !u.vowel && !u.marks.has(M.DAGESH)) {
      u.silent = true;
    }
  }

  let lastSpoken = 0;
  for (let j = n - 1; j >= 0; j--) if (!units[j].silent) { lastSpoken = j; break; }

  // Pass 2: sounds, spoken or silent shva, then stress.
  const out: string[] = [];
  const sylls: Syllable[] = [];
  let lastWasVowel = false;
  let prevShvaSilent = false;

  for (let i = 0; i < n; i++) {
    const u = units[i];
    if (u.silent) continue;

    if (u.shureqAlone) {
      sylls.push({ start: out.length, kind: 'shureq', base: u.base, accent: !!u.accent });
      out.push('u');
      lastWasVowel = true;
      prevShvaSilent = false;
      continue;
    }

    const hasDagesh = u.marks.has(M.DAGESH);
    const isMappiq = u.base === 'ה' && hasDagesh;
    const forte = hasDagesh && !isMappiq && (!BEGADKEFAT.has(u.base) || (i > 0 && lastWasVowel));

    let kind = u.vowel;
    let shvaSilentHere = false;
    if (kind === 'shva') {
      const next = units[i + 1];
      const vocal =
        i < lastSpoken &&
        !(i === lastSpoken - 1 && units[lastSpoken].vowel === 'shva') &&
        (i === 0 ||
          forte ||
          prevShvaSilent ||
          (!!next && next.base === u.base) ||
          (i > 0 && units[i - 1].marks.has(M.METEG)));
      if (!vocal) { kind = null; shvaSilentHere = true; }
    }

    const cons = Array.from(consonantOf(u, i));

    // Furtive patah: a final ח, ע or הּ after another vowel is said "-ach".
    if (
      i === n - 1 && kind === 'patah' && lastWasVowel &&
      (u.base === 'ח' || u.base === 'ע' || isMappiq)
    ) {
      out.push('a', ...cons.filter((c) => c !== 'ʔ'));
      lastWasVowel = false;
      prevShvaSilent = false;
      continue;
    }

    const start = out.length;
    out.push(...cons);
    if (kind) {
      sylls.push({ start, kind, base: u.base, accent: !!u.accent });
      out.push(soundOfVowel(kind));
      if (u.ayi) {
        sylls.push({ start: out.length, kind: 'hiriq', base: 'י', accent: false });
        out.push('j', 'i');
      }
      lastWasVowel = true;
    } else {
      lastWasVowel = false;
    }
    prevShvaSilent = shvaSilentHere;
  }

  if (!stressless && sylls.length) {
    const accented = sylls.findIndex((s) => s.accent && !REDUCED.has(s.kind));
    let s = sylls.length - 1;
    const lastS = sylls[s];
    if (accented >= 0) {
      s = accented;
    } else if (sylls.length >= 2 && lastS.kind === 'segol' && !lastWasVowel) {
      s -= 1; // segolate nouns: chesed, melekh, nefesh
    } else if (
      sylls.length >= 2 && lastS.kind === 'hiriq' && lastS.base === 'י' && !lastWasVowel &&
      (sylls[s - 1].kind === 'patah' || sylls[s - 1].kind === 'qamats')
    ) {
      s -= 1; // -ayim: shamayim, mayim
    }
    while (s > 0 && REDUCED.has(sylls[s].kind)) s -= 1;
    out.splice(sylls[s].start, 0, 'ˈ');
  }
  return out;
}

function consonantsOnly(word: string): string {
  return Array.from(word).filter((c) => c >= 'א' && c <= 'ת').join('');
}

/**
 * One Hebrew word or maqaf pair → its sounds, ready for the Hebrew voice, or
 * null when there is nothing to say (an unpointed root, a prefix fragment).
 *
 * Stressed vowels are held (ː), as the German voice says them most naturally.
 */
export function hebrewWordSounds(text: string): string[] | null {
  const words = text
    .normalize('NFD')
    .replace(/\//g, '')
    .split(/[\s׃׀,.;:!?|]+/)
    .filter(Boolean);
  const out: string[] = [];
  for (const word of words) {
    const parts = word.split(M.MAQAF).filter(Boolean);
    if (out.length) out.push(' ');
    parts.forEach((part, k) => {
      const stressless = k < parts.length - 1;
      // The divine name is read as its vowels direct: Adonai, or Elohim when
      // it is pointed with hiriq (where the text already has Adonai beside it).
      if (consonantsOnly(part) === 'יהוה') {
        const name = part.includes(M.HIRIQ) ? ['e', 'l', 'o', 'h', 'i', 'm'] : ['a', 'd', 'o', 'n', 'a', 'j'];
        if (!stressless) name.splice(3, 0, 'ˈ');
        out.push(...name);
        return;
      }
      out.push(...wordSounds(parseUnits(part), stressless));
    });
  }
  if (!out.some((s) => VOWELS.has(s))) return null;
  return holdStressedVowels(out);
}

function holdStressedVowels(sounds: string[]): string[] {
  const out: string[] = [];
  let pending = false;
  for (const s of sounds) {
    out.push(s);
    if (s === 'ˈ') pending = true;
    else if (s === ' ') pending = false;
    else if (pending && VOWELS.has(s)) {
      out.push('ː');
      pending = false;
    }
  }
  return out;
}
