/**
 * How the bar's search reads what is typed: each word finds itself and its
 * own forms (eye → eyes, eyed, eyeing), never the same letters inside another
 * word (obeyed, journeyed). Advanced Search keeps the anywhere-in-a-word kind
 * through patternMatcher.
 *
 * The forms come from plain English endings rather than a stemmer, so what a
 * word finds is predictable and every form can be marked in the results:
 *   -s/-es, -ed, -ing, and the KJV's -eth/-est on every word;
 *   -d, -r/-rs, -th, -st and a dropped e before -ing on words ending in e
 *     (love → loved, lover, loveth, lovest, loving; die → dying);
 *   y → ies/ied/ieth/iest after a consonant (cry → cries, cried);
 *   a doubled last letter after a short vowel (sin → sinned, sinneth).
 * There is no -er except on words ending in e, which is what keeps corn from
 * finding corner and man from finding manner.
 */

/** A test for searched text, built once per search and run on every entry. */
export interface TextMatcher {
  test(text: string): boolean;
  /** Where the first hit starts, for windowing a snippet; -1 when none. */
  indexIn(text: string): number;
}

/** A letter, mark or digit, the parts a word is made of in any script. */
const WORD_CHAR = '[\\p{L}\\p{M}\\p{N}]';
const BEFORE = `(?<!${WORD_CHAR})`;
const AFTER = `(?!${WORD_CHAR})`;
const SEPARATOR = `[^\\p{L}\\p{M}\\p{N}]+`;

/** Words so common their forms would only add noise; they find themselves. */
const LITTLE_WORDS = new Set([
  'the', 'and', 'for', 'but', 'nor', 'yet', 'not', 'are', 'was', 'were', 'his',
  'her', 'him', 'its', 'our', 'you', 'she', 'who', 'all', 'any', 'has', 'had',
  'may', 'can', 'did', 'how', 'why', 'out', 'own', 'too', 'also', 'unto', 'thee',
  'thou', 'thy', 'them', 'they', 'then', 'than', 'that', 'this', 'with', 'from',
  'into', 'upon', 'been', 'have', 'shall', 'will', 'what', 'when', 'where',
  'which', 'there', 'here', 'these', 'those', 'your', 'their',
]);

const VOWEL = /[aeiou]/;

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Every form of one plain English word, the word itself included. */
function formsOf(word: string): string[] {
  const forms = new Set([word]);
  if (word.length < 3 || LITTLE_WORDS.has(word)) return [...forms];

  for (const end of ['s', 'es', 'ed', 'ing', 'eth', 'est']) forms.add(word + end);

  const last = word[word.length - 1];
  const before = word[word.length - 2];

  if (last === 'e') {
    const stem = word.slice(0, -1);
    // "see" + d is seed and "fee" + d is feed, a different word each time.
    if (!(word.length === 3 && before === 'e')) forms.add(word + 'd');
    for (const end of ['r', 'rs', 'th', 'st']) forms.add(word + end);
    if (before === 'i') forms.add(word.slice(0, -2) + 'ying');
    else forms.add(stem + 'ing');
  } else if (last === 'y' && !VOWEL.test(before)) {
    const stem = word.slice(0, -1);
    for (const end of ['ies', 'ied', 'ieth', 'iest']) forms.add(stem + end);
  } else if (
    !VOWEL.test(last) &&
    !'wxy'.includes(last) &&
    VOWEL.test(before) &&
    !VOWEL.test(word[word.length - 3])
  ) {
    for (const end of ['ed', 'ing', 'eth', 'est']) forms.add(word + last + end);
  }

  return [...forms];
}

/**
 * The words a typed plural could stand for, so "eyes" finds eye as well.
 * Endings in ss, us and is are left alone (bless, Jesus, this).
 */
function singularsOf(word: string): string[] {
  if (word.endsWith('ies') && word.length > 4) return [word.slice(0, -3) + 'y'];
  if (!word.endsWith('s') || /(ss|us|is)$/.test(word)) return [];
  const bases = [word.slice(0, -1)];
  if (word.endsWith('es')) bases.push(word.slice(0, -2));
  return bases.filter((base) => base.length >= 3);
}

/**
 * The pattern one typed word stands for. Plain English words get their forms;
 * Greek, Hebrew and other scripts are matched anywhere, as they were before,
 * since their endings aren't English ones; anything else (numbers, lord's)
 * is matched as a whole word, exactly.
 */
function wordPattern(token: string): string {
  const word = token.toLowerCase().replace(/’/g, "'");
  if (/^[a-z]+$/.test(word)) {
    const forms = new Set(formsOf(word));
    for (const base of singularsOf(word)) for (const form of formsOf(base)) forms.add(form);
    return `${BEFORE}(?:${[...forms].join('|')})${AFTER}`;
  }
  if (/[^\x00-\x7F]/.test(word)) return escapeRegExp(word);
  // Some translations print a curly apostrophe, some a straight one.
  return `${BEFORE}${escapeRegExp(word).replace(/'/g, "['’]")}${AFTER}`;
}

/** The query's words, without the punctuation round them ("he?" → he). */
function tokensOf(query: string): string[] {
  return query
    .trim()
    .split(/\s+/)
    .map((token) => token.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, ''))
    .filter(Boolean);
}

function firstIndex(patterns: RegExp[], text: string): number {
  let at = -1;
  for (const re of patterns) {
    const i = text.search(re);
    if (i !== -1 && (at === -1 || i < at)) at = i;
  }
  return at;
}

/**
 * The bar's search. `all` wants every word somewhere in the text, in any
 * order, which is how verses and devotionals have always matched; `phrase`
 * wants the words together in the order typed, which is how notes, the
 * journal, highlights and commentaries have.
 */
export function wordMatcher(query: string, how: 'all' | 'phrase'): TextMatcher {
  const tokens = tokensOf(query);
  // Nothing but punctuation: look for it as typed.
  if (!tokens.length) {
    const needle = query.trim().toLowerCase();
    return {
      test: (text) => !!needle && text.toLowerCase().includes(needle),
      indexIn: (text) => (needle ? text.toLowerCase().indexOf(needle) : -1),
    };
  }

  const pieces = tokens.map(wordPattern);
  const patterns =
    how === 'all'
      ? pieces.map((piece) => new RegExp(piece, 'iu'))
      : [new RegExp(pieces.join(SEPARATOR), 'iu')];
  return {
    test: (text) => patterns.every((re) => re.test(text)),
    indexIn: (text) => firstIndex(patterns, text),
  };
}

/** Advanced Search's pattern, used as given. */
export function patternMatcher(pattern: RegExp): TextMatcher {
  // A global pattern carries lastIndex from one test into the next.
  const re = new RegExp(pattern.source, pattern.flags.replace('g', ''));
  return {
    test: (text) => re.test(text),
    indexIn: (text) => text.search(re),
  };
}

/**
 * One pattern marking every hit in a result, the hit as group 1. The bar's
 * results mark only the word forms that were searched for; Advanced Search
 * (`anywhere`) marks its words wherever the letters appear, as it matched them.
 */
export function highlightPattern(query: string, anywhere = false): RegExp | null {
  if (anywhere) {
    const alt = query
      .trim()
      .split(/\s+/)
      .filter((t) => t.length >= 2)
      .map(escapeRegExp)
      .join('|');
    return alt ? new RegExp(`(${alt})`, 'gi') : null;
  }
  const tokens = tokensOf(query);
  return tokens.length ? new RegExp(`(${tokens.map(wordPattern).join('|')})`, 'giu') : null;
}
