/**
 * Reading the voices' sounds, for the Name Lab.
 *
 * A word's sounds are espeak's symbols as one string ("zˈɛɹəbˌeɪbəl"), which is
 * what the app's phonemizer hands the voices. Everything here works on that
 * string: splitting it into syllables, writing it in plain letters, finding
 * which syllable is strong and moving that.
 *
 * Plain JavaScript with no imports, because two very different places run it:
 * public/name-lab.html in the browser, and scripts/build-name-lab-list.mjs in
 * Node, which uses the same reading to flag names against the ISBE guides.
 */

/** Two-symbol vowels first, so "eɪ" is never read as "e" then "ɪ". */
const VOWELS = [
  'eɪ', 'aɪ', 'aʊ', 'ɔɪ', 'oʊ', 'əʊ', 'ɪə', 'eə', 'ʊə', 'iː', 'uː', 'ɑː', 'ɔː', 'ɜː', 'ɛː', 'aː', 'oː',
  'i', 'ɪ', 'ᵻ', 'e', 'ɛ', 'æ', 'a', 'ɑ', 'ɒ', 'ɔ', 'o', 'ʊ', 'u', 'ʌ', 'ə', 'ɐ', 'ɚ', 'ɜ', 'y', 'ø', 'ɨ',
];
const CONSONANT_PAIRS = ['tʃ', 'dʒ'];

/** The mark espeak puts under a consonant that is a syllable of its own. */
const SYLLABIC = '̩';

/** Vowels that sit short and shut the syllable behind them when strong: RUB-uh, not ROO-buh. */
const SHORT = new Set(['ɪ', 'ɛ', 'æ', 'a', 'ʌ', 'ʊ', 'ɒ']);

/** Vowels an r leans on, so it stays in their syllable when they are strong: SHAR-un. */
const TAKES_R = /^(ɑ|ɔ|ɛ|ɪ|ʊ|æ|a|ɒ|eə|iə|ɪə|ʊə)/;

/** Consonant runs English can start a syllable with. Any single consonant can, except ŋ. */
const ONSETS = new Set(
  `pl bl kl ɡl fl sl pɹ bɹ tɹ dɹ kɹ ɡɹ fɹ θɹ ʃɹ sw tw dw kw ɡw θw sp st sk sm sn
   pj bj tj dj kj ɡj fj vj mj nj hj lj sj spl spɹ stɹ skɹ skw spj skj`.split(/\s+/),
);

const CONSONANT_LETTERS = {
  tʃ: 'ch', dʒ: 'j', ʃ: 'sh', ʒ: 'zh', θ: 'th', ð: 'dh', ŋ: 'ng', ɹ: 'r', r: 'r', ɾ: 't',
  j: 'y', ɡ: 'g', ʔ: '', x: 'kh', ç: 'h', ʍ: 'wh', ɬ: 'l', ʲ: 'y',
};

const VOWEL_LETTERS = {
  i: 'ee', 'iː': 'ee', ɪ: 'i', ᵻ: 'i', ɨ: 'i', e: 'e', ɛ: 'e', 'eɪ': 'ay', æ: 'a', a: 'a', 'aː': 'ah',
  ɑ: 'ah', 'ɑː': 'ah', ɒ: 'o', ɔ: 'aw', 'ɔː': 'aw', o: 'oh', 'oː': 'oh', 'oʊ': 'oh', 'əʊ': 'oh',
  ʊ: 'uu', u: 'oo', 'uː': 'oo', ʌ: 'u', ə: 'uh', ɐ: 'uh', ɚ: 'er', ɜ: 'er', 'ɜː': 'er', 'ɛː': 'air',
  'eə': 'air', 'ɪə': 'eer', 'iə': 'eer', 'ʊə': 'oor', 'aʊ': 'ow', 'ɔɪ': 'oy', 'aɪ': 'y', y: 'ew', ø: 'er',
  ['n' + SYLLABIC]: 'un', ['l' + SYLLABIC]: 'ul', ['m' + SYLLABIC]: 'um',
};

/** A vowel with an r behind it in the same syllable is one sound on the page. */
const WITH_R = {
  'ɑː': 'ar', ɑ: 'ar', 'ɔː': 'or', ɔ: 'or', ɒ: 'or', æ: 'ar', a: 'ar', ɪ: 'eer', ʊ: 'oor',
  'eə': 'air', 'ɛː': 'air', 'ɜː': 'er', ɜ: 'er', ɚ: 'er', 'iə': 'eer', 'ɪə': 'eer', 'ʊə': 'oor',
};

/**
 * Sounds → a flat list of pieces. A piece is a vowel or a consonant, with the
 * stress on a vowel (0 none, 1 strong, 2 lesser), or a gap (a space,
 * punctuation). espeak writes the stress mark just before its vowel.
 */
function pieces(sounds) {
  const out = [];
  let stress = 0;
  let i = 0;
  while (i < sounds.length) {
    const ch = sounds[i];
    if (ch === 'ˈ' || ch === 'ˌ') {
      stress = ch === 'ˈ' ? 1 : 2;
      i++;
      continue;
    }
    // UK writes the "ear" sound as iə. US only has those two side by side in
    // separate syllables (Lydia), and there the first is never stressed.
    const vowel = stress && sounds.startsWith('iə', i) ? 'iə' : VOWELS.find((v) => sounds.startsWith(v, i));
    if (vowel) {
      out.push({ kind: 'vowel', s: vowel, stress });
      stress = 0;
      i += vowel.length;
      continue;
    }
    if (sounds[i + 1] === SYLLABIC) {
      out.push({ kind: 'vowel', s: ch + SYLLABIC, stress });
      stress = 0;
      i += 2;
      continue;
    }
    const pair = CONSONANT_PAIRS.find((c) => sounds.startsWith(c, i));
    if (pair) {
      out.push({ kind: 'consonant', s: pair });
      i += pair.length;
      continue;
    }
    if (ch === ' ' || /[.,;:!?—…"“”()]/.test(ch)) out.push({ kind: 'gap', s: ch });
    else if ((ch === 'ː' || ch === '̃') && out.length) out[out.length - 1].s += ch;
    else out.push({ kind: 'consonant', s: ch });
    i++;
  }
  return out;
}

/** How many of the consonants between two vowels start the next syllable. */
function onsetSize(run, before) {
  let size = 0;
  for (let n = run.length; n >= 1; n--) {
    const candidate = run.slice(run.length - n);
    const legal = n === 1 ? candidate[0] !== 'ŋ' : ONSETS.has(candidate.join(''));
    if (legal) {
      size = n;
      break;
    }
  }
  // A strong short vowel holds on to a lone consonant, so a name is split the
  // way people read it: AB-suh-lum, MAN-uh-see. Likewise an r its vowel leans on.
  if (size === 1 && run.length === 1 && before.stress === 1) {
    if (SHORT.has(before.s)) return 0;
    if (run[0] === 'ɹ' && TAKES_R.test(before.s)) return 0;
  }
  return size;
}

/**
 * One word's syllables. Each is { pieces, vowel, stress }, where vowel is the
 * piece holding the syllable's stress. A word with no vowel at all stays whole.
 */
function syllablesOf(wordPieces) {
  const at = [];
  wordPieces.forEach((p, i) => {
    if (p.kind === 'vowel') at.push(i);
  });
  if (at.length === 0) return wordPieces.length ? [{ pieces: wordPieces, vowel: null, stress: 0 }] : [];

  const out = [];
  let start = 0;
  at.forEach((vowelAt, n) => {
    let end = wordPieces.length;
    if (n < at.length - 1) {
      const next = at[n + 1];
      const run = wordPieces.slice(vowelAt + 1, next).map((p) => p.s);
      end = next - onsetSize(run, wordPieces[vowelAt]);
    }
    out.push({ pieces: wordPieces.slice(start, end), vowel: wordPieces[vowelAt], stress: wordPieces[vowelAt].stress });
    start = end;
  });
  return out;
}

/** Sounds → words of syllables, with the gap after each word kept for rebuilding. */
function wordsOf(sounds) {
  const words = [];
  let current = [];
  for (const p of pieces(sounds)) {
    if (p.kind === 'gap') {
      words.push({ syllables: syllablesOf(current), gap: p.s });
      current = [];
    } else current.push(p);
  }
  words.push({ syllables: syllablesOf(current), gap: '' });
  return words;
}

/**
 * One syllable in plain letters. `rNext` says the next syllable starts with an
 * r, so a vowel here doesn't write one too: juh-ROO, not jer-ROO.
 */
function plainSyllable(syllable, rNext) {
  const list = syllable.pieces;
  const vowelAt = list.indexOf(syllable.vowel);
  let text = '';
  for (let i = 0; i < list.length; i++) {
    const p = list[i];
    if (p.kind === 'consonant') {
      text += CONSONANT_LETTERS[p.s] ?? p.s;
      continue;
    }
    if (list[i + 1]?.s === 'ɹ' && WITH_R[p.s]) {
      text += WITH_R[p.s];
      i++;
      continue;
    }
    if (p.s === 'ɚ' && rNext) {
      text += 'uh';
      continue;
    }
    let letters = VOWEL_LETTERS[p.s] ?? p.s;
    const open = i === list.length - 1;
    // The short sounds are only clear with something behind them: bul but
    // ruh, siz but lih, ZER but jeh.
    if (open && (letters === 'i' || letters === 'e')) letters += 'h';
    if (!open && letters === 'uh') letters = 'u';
    // Nothing in front to lean on, so the long i is written out: eye-ZAY-uh.
    if (letters === 'y' && vowelAt === 0) letters = 'eye';
    text += letters;
  }
  return text;
}

/** A word's syllables as plain letters, in order. */
function plainWord(word) {
  return word.syllables.map((s, i) => plainSyllable(s, word.syllables[i + 1]?.pieces[0]?.s === 'ɹ'));
}

/**
 * The syllables, for the tappable row in the fix card. `strong` is true on the
 * one carrying the main stress. Counted across all the sounds, gaps ignored.
 */
export function syllables(sounds) {
  const out = [];
  for (const word of wordsOf(sounds)) {
    const letters = plainWord(word);
    word.syllables.forEach((syllable, i) => {
      out.push({ text: letters[i], strong: syllable.stress === 1 });
    });
  }
  return out;
}

/** "zˈɛɹəbˌeɪbəl" → "ZER-uh-bay-bul". Words stay apart; a strong syllable is in capitals. */
export function plainLetters(sounds) {
  return wordsOf(sounds)
    .filter((w) => w.syllables.length)
    .map((w) => {
      const letters = plainWord(w);
      return w.syllables.map((s, i) => (s.stress === 1 ? letters[i].toUpperCase() : letters[i])).join('-');
    })
    .join(' ');
}

/** How many syllables, and which is strong (from 0, or -1 for none). */
export function strongSyllable(sounds) {
  const list = syllables(sounds);
  return { count: list.length, strong: list.findIndex((s) => s.strong) };
}

/**
 * An ISBE pronunciation guide read the same way: "ze-rub'-a-bel" is 4 syllables
 * with the second strong. The mark comes straight after the strong syllable,
 * and the guide's hyphen after it is sometimes left out ("mel-kiz'e-dek").
 */
export function guideStress(guide) {
  const parts = guide.split(/-|(?<=['"])/).filter((p) => /[a-z]/i.test(p));
  return { count: parts.length, strong: parts.findIndex((p) => /['"]/.test(p)) };
}

/** A guide with its strong syllable in capitals, to sit beside plain letters: ze-RUB-a-bel. */
export function guideLetters(guide) {
  return guide
    .split(/-|(?<=['"])/)
    .filter((p) => /[a-z]/i.test(p))
    .map((p) => (/['"]/.test(p) ? p.replace(/['"]/g, '').toUpperCase() : p))
    .join('-');
}

/**
 * Whether the voice leans on a different syllable from the guide, counting from
 * the start of the name. A one-syllable name has nothing to disagree about.
 */
export function stressDisagrees(guide, sounds) {
  if (!guide) return false;
  const g = guideStress(guide);
  const v = strongSyllable(sounds);
  if (g.strong < 0 || v.strong < 0 || g.count < 2 || v.count < 2) return false;
  return g.strong !== v.strong;
}

/** Whether the voice squeezes a name into fewer syllables than the guide: Joash as JOHSH. */
export function syllablesLost(guide, sounds) {
  if (!guide) return false;
  return strongSyllable(sounds).count < guideStress(guide).count;
}

/**
 * A vowel too weak to carry the main stress, and the full one it turns into
 * when it has to. espeak writes ɐ for a weak letter a, so that one comes back as
 * the a of "cat": AB-suh-lum, not UB-suh-lum.
 */
const FULL_VOWEL = { ə: 'ʌ', ɐ: 'æ', ᵻ: 'ɪ', ɨ: 'ɪ', ɚ: 'ɜːɹ', i: 'iː' };

function rebuild(words) {
  let out = '';
  for (const word of words) {
    for (const syllable of word.syllables) {
      for (const p of syllable.pieces) {
        if (p.kind === 'vowel' && p.stress) out += p.stress === 1 ? 'ˈ' : 'ˌ';
        out += p.s;
      }
    }
    out += word.gap;
  }
  return out;
}

/**
 * Make syllable `index` the strong one, counted across all the sounds.
 *
 * The old strong syllable keeps a lesser stress only if it is far enough away
 * to hold one, since two leaning syllables side by side don't sound like
 * English. A weak vowel on the new strong syllable becomes its full form, so
 * the voice isn't asked to lean on an "uh".
 */
export function moveStress(sounds, index) {
  const words = wordsOf(sounds);
  let seen = 0;
  for (const word of words) {
    const local = index - seen;
    seen += word.syllables.length;
    if (local < 0 || local >= word.syllables.length) continue;
    word.syllables.forEach((syllable, i) => {
      const vowel = syllable.vowel;
      if (!vowel) return;
      if (i === local) {
        vowel.stress = 1;
        vowel.s = FULL_VOWEL[vowel.s] ?? vowel.s;
      } else if (Math.abs(i - local) < 2) vowel.stress = 0;
      else if (vowel.stress === 1) vowel.stress = 2;
    });
    break;
  }
  return rebuild(words);
}

/** Sounds with the stress taken out, for comparing a word's sounds wherever it lands. */
export function withoutStress(sounds) {
  return sounds.replace(/[ˈˌ]/g, '');
}

/**
 * Put a word's edited sounds into a sentence's sounds, finding it by its plain
 * sounds with stress ignored, since a sentence can lean on a word differently
 * from the word alone. Null if it can't be found on word edges.
 */
export function spliceWord(sentence, word, edited) {
  const target = withoutStress(word);
  const parts = sentence.split(/( |[.,;:!?—…])/);
  const at = parts.findIndex((p) => withoutStress(p) === target);
  if (at < 0) return null;
  parts[at] = edited;
  return parts.join('');
}
