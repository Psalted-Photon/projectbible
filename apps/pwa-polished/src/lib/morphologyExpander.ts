/**
 * morphologyExpander.ts
 *
 * Expands cryptic morphological parsing codes to plain English.
 *
 * Handles three code systems:
 *  1. Greek RMAC  (Robinson's Morphological Analysis Codes)
 *     e.g. N-NSM → "Noun, Nominative, Singular, Masculine"
 *          V-PAI-3S → "Verb, Present, Active, Indicative, Third person, Singular"
 *
 *  2. Hebrew/Aramaic OSHB
 *     e.g. HNcmsa → "Hebrew, Noun, common, masculine, singular, absolute"
 *          HVqp3ms → "Hebrew, Verb, Qal, perfect (qatal), third person, masculine, singular"
 *
 *  3. STEPBible partOfSpeech field (TBESG/TBESH format)
 *     e.g. G:N-F → "Greek, Noun, Feminine"
 *          N:N-M-P → "Proper name, Noun, Masculine, Person"
 *          G:A / G:ADV → "Greek, Adjective / Greek, Adverb"
 */

// ─────────────────────────────────────────────────────────────────
// 1. Greek RMAC codes
// ─────────────────────────────────────────────────────────────────

const RMAC_POS: Record<string, string> = {
  N:    'Noun',
  V:    'Verb',
  A:    'Adjective',
  T:    'Definite article',
  P:    'Personal pronoun',
  R:    'Relative pronoun',
  C:    'Reciprocal pronoun',
  D:    'Demonstrative pronoun',
  I:    'Interrogative pronoun',
  // TAGNT distinguishes the indefinite τις "someone, anyone" from the
  // interrogative τίς "who?", which older tagging ran together under I-.
  X:    'Indefinite pronoun',
  F:    'Reflexive pronoun',
  S:    'Possessive pronoun',
  K:    'Correlative pronoun',
  Q:    'Correlative/interrogative pronoun',
  ADV:  'Adverb',
  PREP: 'Preposition',
  CONJ: 'Conjunction',
  PRT:  'Particle',
  INJ:  'Interjection',
  COND: 'Conditional',
  HEB:  'Hebrew word (indeclinable)',
  ARAM: 'Aramaic word (indeclinable)',
};

const RMAC_CASE: Record<string, string> = {
  N: 'Nominative',
  G: 'Genitive',
  D: 'Dative',
  A: 'Accusative',
  V: 'Vocative',
};

const RMAC_NUM: Record<string, string> = {
  S: 'Singular',
  P: 'Plural',
};

const RMAC_GEN: Record<string, string> = {
  M: 'Masculine',
  F: 'Feminine',
  N: 'Neuter',
};

const RMAC_TENSE: Record<string, string> = {
  P: 'Present',
  I: 'Imperfect',
  F: 'Future',
  A: 'Aorist',
  X: 'Perfect',
  Y: 'Pluperfect',
};

const RMAC_2ND_TENSE: Record<string, string> = {
  A: 'Second Aorist',
  F: 'Second Future',
  X: 'Second Perfect',
  Y: 'Second Pluperfect',
};

const RMAC_VOICE: Record<string, string> = {
  A: 'Active',
  M: 'Middle',
  P: 'Passive',
  E: 'Middle or Passive',
  D: 'Middle Deponent',
  O: 'Passive Deponent',
  N: 'Middle or Passive Deponent',
  Q: 'Impersonal Active',
};

const RMAC_MOOD: Record<string, string> = {
  I: 'Indicative',
  S: 'Subjunctive',
  O: 'Optative',
  M: 'Imperative',
  N: 'Infinitive',
  P: 'Participle',
  R: 'Imperative Passive',
};

const RMAC_PERS: Record<string, string> = {
  '1': 'First person',
  '2': 'Second person',
  '3': 'Third person',
};

const RMAC_EXTRA: Record<string, string> = {
  C:   'Comparative',
  S:   'Superlative',
  ATT: 'Attic form',
  AP:  'Apocopated form',
  K:   'Kai',
  P:   'Person',
  L:   'Location',
  LG:  'Location gentilic',
  PG:  'Person gentilic',
  T:   'Title',
  NUI: 'Numerical indeclinable',
  N:   'Negative',
  I:   'Interrogative',
};

/** POS codes that take no inflection segments */
const RMAC_STANDALONE = new Set(['ADV', 'PREP', 'CONJ', 'PRT', 'INJ', 'COND', 'HEB', 'ARAM']);

/**
 * Expand a Greek RMAC code to plain English.
 * Returns the raw code as-is if it cannot be parsed.
 */
export function expandRmacCode(code: string): string {
  if (!code) return '';

  // TAGNT joins two words that are grammatically one — crasis, mostly — and
  // codes them as "CONJ + G1437=COND". Expand each side and keep the join
  // visible rather than handing back the raw code.
  if (code.includes('+')) {
    const sides = code
      .split('+')
      .map((side) => side.trim().replace(/^G\d+[A-Za-z]?=/, ''))
      .filter(Boolean)
      .map((side) => expandRmacCode(side));
    if (sides.length > 1 && sides.some((s, i) => s !== code.split('+')[i]?.trim())) {
      return sides.join(' + ');
    }
  }

  // MorphGNT 8-char positional codes like "----NSF-" — not RMAC, skip
  if (/^-/.test(code) || /^\d/.test(code.slice(1))) {
    // fall through to raw
  }

  const upper = code.toUpperCase();
  const parts = upper.split('-');
  const pos = parts[0];
  const posName = RMAC_POS[pos];

  if (!posName) return code; // unrecognised — return raw

  // Standalone POS (no inflection)
  if (RMAC_STANDALONE.has(pos)) {
    if (parts.length > 1) {
      const extra = RMAC_EXTRA[parts[1]] ?? parts[1];
      return `${posName}, ${extra}`;
    }
    return posName;
  }

  if (parts.length < 2) return posName;

  // ── Verbs ────────────────────────────────────────────────────────
  if (pos === 'V') {
    const tvmPart = parts[1]; // e.g. "PAI", "2AAI", "PAP"
    const result: string[] = [posName];
    let voiceMood: string;

    if (tvmPart.startsWith('2') && tvmPart.length >= 2) {
      result.push(RMAC_2ND_TENSE[tvmPart[1]] ?? tvmPart[1]);
      voiceMood = tvmPart.slice(2);
    } else {
      result.push(RMAC_TENSE[tvmPart[0]] ?? tvmPart[0]);
      voiceMood = tvmPart.slice(1);
    }

    if (voiceMood.length >= 1) result.push(RMAC_VOICE[voiceMood[0]] ?? voiceMood[0]);
    if (voiceMood.length >= 2) result.push(RMAC_MOOD[voiceMood[1]] ?? voiceMood[1]);

    if (parts.length > 2) {
      const infl = parts[2]; // e.g. "3S" or "NSM" or "APF"
      if (/^[123]/.test(infl)) {
        // finite: PERSON + NUMBER
        result.push(RMAC_PERS[infl[0]]);
        if (infl[1]) result.push(RMAC_NUM[infl[1]] ?? infl[1]);
      } else if (infl.length >= 2) {
        // participle: CASE + NUMBER [+ GENDER]
        result.push(RMAC_CASE[infl[0]] ?? infl[0]);
        result.push(RMAC_NUM[infl[1]] ?? infl[1]);
        if (infl[2]) result.push(RMAC_GEN[infl[2]] ?? infl[2]);
      }
    }

    for (let i = 3; i < parts.length; i++) {
      const ex = RMAC_EXTRA[parts[i]];
      if (ex) result.push(ex);
    }

    return result.join(', ');
  }

  // ── Nouns, Adjectives, Pronouns, Articles ────────────────────────
  const infl = parts[1]; // e.g. "NSM", "1GS", "APF"
  const result: string[] = [posName];
  let rest = infl;

  // Optional person prefix on pronouns (P-1GS etc.)
  if (/^[123]/.test(rest)) {
    result.push(RMAC_PERS[rest[0]]);
    rest = rest.slice(1);
  }

  if (rest.length >= 1) result.push(RMAC_CASE[rest[0]] ?? rest[0]);
  if (rest.length >= 2) result.push(RMAC_NUM[rest[1]] ?? rest[1]);
  if (rest.length >= 3) result.push(RMAC_GEN[rest[2]] ?? rest[2]);

  for (let i = 2; i < parts.length; i++) {
    const ex = RMAC_EXTRA[parts[i]];
    if (ex) result.push(ex);
  }

  return result.join(', ');
}

// ─────────────────────────────────────────────────────────────────
// 2. Hebrew/Aramaic OSHB codes
// ─────────────────────────────────────────────────────────────────

const OSHB_LANG: Record<string, string> = { H: 'Hebrew', A: 'Aramaic' };

const OSHB_POS: Record<string, string> = {
  N: 'Noun',
  V: 'Verb',
  A: 'Adjective',
  C: 'Conjunction',
  D: 'Adverb',
  P: 'Pronoun',
  R: 'Preposition',
  S: 'Suffix',
  T: 'Particle',
};

const OSHB_NOUN_TYPE: Record<string, string> = {
  c: 'common',
  g: 'gentilic',
  p: 'proper name',
};

const OSHB_ADJ_TYPE: Record<string, string> = {
  a: 'adjective',
  c: 'cardinal number',
  g: 'gentilic',
  o: 'ordinal number',
};

const OSHB_PRON_TYPE: Record<string, string> = {
  d: 'demonstrative',
  f: 'indefinite',
  i: 'interrogative',
  p: 'personal',
  r: 'relative',
};

const OSHB_STEM_H: Record<string, string> = {
  q: 'Qal',       N: 'Niphal',      p: 'Piel',       P: 'Pual',
  h: 'Hiphil',    H: 'Hophal',      t: 'Hithpael',   o: 'Polel',
  O: 'Polal',     r: 'Hithpolel',   m: 'Poel',        M: 'Poal',
  k: 'Palel',     K: 'Pulal',       Q: 'Qal passive', l: 'Pilpel',
  L: 'Polpal',    f: 'Hithpalpel',  D: 'Nithpael',   j: 'Pealal',
  i: 'Pilel',     u: 'Hothpaal',    c: 'Tiphil',      v: 'Hishtaphel',
  w: 'Nithpalel', y: 'Nithpoel',    z: 'Hithpoel',
};

const OSHB_STEM_A: Record<string, string> = {
  q: 'Peal',      Q: 'Peil',        u: 'Hithpeel',   p: 'Pael',
  P: 'Ithpaal',   M: 'Hithpaal',    a: 'Aphel',       h: 'Haphel',
  s: 'Saphel',    e: 'Shaphel',     H: 'Hophal',      i: 'Ithpeel',
  t: 'Hishtaphel', v: 'Ishtaphel',  w: 'Hithaphel',   o: 'Polel',
  z: 'Ithpoel',   r: 'Hithpolel',   f: 'Hithpalpel',  b: 'Hephal',
  c: 'Tiphel',    m: 'Poel',        l: 'Palpel',       L: 'Ithpalpel',
  O: 'Ithpolel',  G: 'Ittaphal',
};

const OSHB_CONJ: Record<string, string> = {
  p: 'perfect (qatal)',
  q: 'sequential perfect (weqatal)',
  i: 'imperfect (yiqtol)',
  w: 'sequential imperfect (wayyiqtol)',
  h: 'cohortative',
  j: 'jussive',
  v: 'imperative',
  r: 'participle active',
  s: 'participle passive',
  a: 'infinitive absolute',
  c: 'infinitive construct',
};

const OSHB_PERS: Record<string, string> = {
  '1': 'first',
  '2': 'second',
  '3': 'third',
  x:   'unspecified',
};

const OSHB_GEN: Record<string, string> = {
  m: 'masculine',
  f: 'feminine',
  c: 'common',
  b: 'both',
};

const OSHB_NUM: Record<string, string> = {
  s: 'singular',
  p: 'plural',
  d: 'dual',
};

const OSHB_STATE: Record<string, string> = {
  a: 'absolute',
  c: 'construct',
  d: 'determined',
};

/**
 * Expand a Hebrew/Aramaic OSHB code to plain English.
 * Handles compound codes with '/' separator (prefix/main-word).
 * Returns the raw code if unrecognised.
 */
export function expandOshbCode(raw: string): string {
  if (!raw) return '';

  // Compound: "HR/Ncfsa" — expand each part
  const slashIdx = raw.indexOf('/');
  if (slashIdx > -1) {
    const prefixPart = expandOshbCode(raw.slice(0, slashIdx));
    const mainPart   = expandOshbCode(raw.slice(slashIdx + 1));
    return [prefixPart, mainPart].filter(Boolean).join(' / ');
  }

  const lang = raw[0];
  const langName = OSHB_LANG[lang];
  if (!langName) return raw; // not an OSHB code

  const rest = raw.slice(1);
  if (!rest) return langName;

  const pos = rest[0];
  const posName = OSHB_POS[pos];
  if (!posName) return raw;

  const parts: string[] = [langName, posName];
  let i = 1;

  if (pos === 'V') {
    const stemChar = rest[i++] ?? '';
    const stems = lang === 'A' ? OSHB_STEM_A : OSHB_STEM_H;
    if (stemChar) parts.push(stems[stemChar] ?? stemChar);

    const conjChar = rest[i++] ?? '';
    if (conjChar) parts.push(OSHB_CONJ[conjChar] ?? conjChar);

    const persChar = rest[i] ?? '';
    if (persChar && /[123x]/.test(persChar)) {
      parts.push((OSHB_PERS[persChar] ?? persChar) + ' person');
      i++;
    }
    if (rest[i]) { parts.push(OSHB_GEN[rest[i]] ?? rest[i]); i++; }
    if (rest[i]) { parts.push(OSHB_NUM[rest[i]] ?? rest[i]); i++; }
    if (rest[i]) { parts.push(OSHB_STATE[rest[i]] ?? rest[i]); }

  } else if (pos === 'N') {
    if (rest[i]) { parts.push(OSHB_NOUN_TYPE[rest[i]] ?? rest[i]); i++; }
    if (rest[i]) { parts.push(OSHB_GEN[rest[i]] ?? rest[i]); i++; }
    if (rest[i]) { parts.push(OSHB_NUM[rest[i]] ?? rest[i]); i++; }
    if (rest[i]) { parts.push(OSHB_STATE[rest[i]] ?? rest[i]); }

  } else if (pos === 'A') {
    if (rest[i]) { parts.push(OSHB_ADJ_TYPE[rest[i]] ?? rest[i]); i++; }
    if (rest[i]) { parts.push(OSHB_GEN[rest[i]] ?? rest[i]); i++; }
    if (rest[i]) { parts.push(OSHB_NUM[rest[i]] ?? rest[i]); i++; }
    if (rest[i]) { parts.push(OSHB_STATE[rest[i]] ?? rest[i]); }

  } else if (pos === 'P') {
    if (rest[i]) { parts.push(OSHB_PRON_TYPE[rest[i]] ?? rest[i]); i++; }
    if (rest[i] && /[123]/.test(rest[i])) {
      parts.push((OSHB_PERS[rest[i]] ?? rest[i]) + ' person');
      i++;
    }
    if (rest[i]) { parts.push(OSHB_GEN[rest[i]] ?? rest[i]); i++; }
    if (rest[i]) { parts.push(OSHB_NUM[rest[i]] ?? rest[i]); }

  }
  // C, D, T, R, S — language + POS is sufficient

  return parts.join(', ');
}

// ─────────────────────────────────────────────────────────────────
// 3. STEPBible partOfSpeech field
// ─────────────────────────────────────────────────────────────────

const STEP_LANG: Record<string, string> = {
  G: 'Greek',
  H: 'Hebrew',
  A: 'Aramaic',
  N: 'Proper name',
};

const STEP_POS: Record<string, string> = {
  N:    'Noun',
  V:    'Verb',
  A:    'Adjective',
  ADJ:  'Adjective',
  ADV:  'Adverb',
  PREP: 'Preposition',
  CONJ: 'Conjunction',
  ART:  'Article',
  PRON: 'Pronoun',
  PRO:  'Pronoun',
  INJ:  'Interjection',
  Intj: 'Interjection',
  PRT:  'Particle',
  PART: 'Particle',
  LI:   'Letter (indeclinable)',
};

const STEP_GEN: Record<string, string> = {
  M:   'Masculine',
  F:   'Feminine',
  N:   'Neuter',
  'M/F': 'Masculine or Feminine',
  LI:  'Indeclinable',
};

const STEP_TYPE: Record<string, string> = {
  P: 'Person',
  L: 'Place',
  T: 'Transliterated',
};

function expandOnePOS(token: string): string {
  const colon = token.indexOf(':');
  if (colon < 0) return token;

  const lang = token.slice(0, colon);
  const rest  = token.slice(colon + 1).split('-');
  const parts: string[] = [];

  if (lang === 'N') {
    parts.push('Proper name');
  } else {
    const langName = STEP_LANG[lang];
    if (langName) parts.push(langName);
  }

  if (rest[0]) parts.push(STEP_POS[rest[0]] ?? rest[0]);
  if (rest[1]) parts.push(STEP_GEN[rest[1]] ?? rest[1]);
  if (rest[2]) parts.push(STEP_TYPE[rest[2]] ?? rest[2]);

  return parts.join(', ');
}

/**
 * Expand a STEPBible partOfSpeech code to plain English.
 * Handles multiple values separated by ' / '.
 */
export function expandStepBiblePOS(pos: string): string {
  if (!pos) return '';
  return pos.split(' / ').map(t => expandOnePOS(t.trim())).join(' / ');
}
