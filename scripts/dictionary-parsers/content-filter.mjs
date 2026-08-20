/**
 * Content filter for the modern (Wordset) dictionary.
 *
 * Wordset is built on Princeton WordNet, whose purpose was to catalogue every
 * attested sense of a word so software could tell them apart. No reader was
 * considered, so sordid senses get attached to ordinary words — "street" ships
 * with a sense about poverty, crime and prostitution.
 *
 * The test applied here is not "does this contain a rude word". It is whether
 * the sordid material is IN the word or IMPORTED INTO a word that does not call
 * for it. "street" is not a word about prostitution; "prostitute" is. So:
 *
 *   - A sense whose definition is explicit is dropped, UNLESS the word itself
 *     denotes the thing. That keeps "harlot", "adultery" and "fornication"
 *     defined plainly, as Scripture uses all three, while "street" loses only
 *     its fifth sense and keeps all four senses about roads.
 *   - Blocked headwords are dropped whole. Kept deliberately short: only terms
 *     with no innocent sense. "prick" is not here (the KJV has "kick against
 *     the pricks"), nor "screw", "bitch", "horny" or "queer", which all have
 *     ordinary meanings a reader could legitimately look up.
 *   - Examples are dropped entirely by the caller. Innuendo hides there and no
 *     keyword rule catches it: "street" sense 4 reads "a situation offering
 *     opportunities", perfectly clean, with the example "I worked both sides of
 *     the street". Webster 1913 keeps its quotations; only Wordset loses them.
 */

/**
 * Patterns marking a definition as explicit, tested case-insensitively.
 *
 * Several must be word-bounded or they maul innocent entries: "rape" sits
 * inside "therapeutic", "pimp" inside "pimpernel" and "pimple", "anus" inside
 * "tetanus", "genital" inside "congenital" (which cost "mole" its birthmark
 * sense). Castration is not screened at all — an earlier pass on "castrat"
 * deleted bull, "uncastrated adult male of domestic cattle", a clean and
 * thoroughly biblical animal. The plain definitions of "bullock" and "eunuch"
 * are not what this filter is for.
 */
export const EXPLICIT_PATTERNS = [
  /prostitut/, /\bwhore/, /sexual intercourse/, /copulat/, /\bgenital/,
  /penis/, /vagina/, /masturbat/, /obscene/, /excrement/, /feces/,
  /\banus\b/, /erotic/, /\bporn/, /orgasm/, /testicl/, /buttock/, /sexually/,
  /\blewd/, /fornicat/, /incest/, /\brape[ds]?\b/, /\brapist/,
  /\bpimp(s|ing|ed)?\b/, /brothel/, /venereal/, /sodom(y|ize|ise)/,
  /bestiality/, /ejaculat/, /scrotum/, /\bsemen\b/,
];

/**
 * Headwords removed outright. Only unambiguous profanity and slurs — nothing
 * with an innocent sense, and nothing that appears in the biblical text.
 */
export const BLOCKED_HEADWORDS = new Set([
  'asshole', 'arsehole', 'arse', 'shit', 'shite', 'bullshit', 'fuck', 'fucking',
  'fucker', 'motherfucker', 'cunt', 'wanker', 'slut', 'hooker', 'bollocks',
  'turd', 'dyke', 'fag', 'faggot', 'nigger', 'nigga', 'retard', 'retarded',
  'dildo', 'vibrator', 'masturbate', 'masturbation', 'porn', 'porno',
  'pornography', 'pornographic', 'orgy', 'blowjob', 'handjob', 'cocksucker',
  'jism', 'jizz', 'wank', 'whorehouse', 'brothel', 'nympho', 'nymphomaniac',
  'sodomize', 'sodomise', 'pedophile', 'paedophile',
]);

/**
 * Words whose explicit sense IS the word's meaning, but whose first sense does
 * not say so plainly enough for the test above to notice. Without this,
 * "virgin" loses "a person who has never had sexual intercourse" — its actual
 * meaning, and the word of Isaiah 7:14 — because its first sense reads "in a
 * state of sexual virginity", which trips no pattern.
 */
export const INHERENT_WORDS = new Set([
  'virgin', 'virginity', 'virility', 'emasculate', 'emasculation', 'eunuch',
  'concubine', 'harlot', 'adultery', 'adulterer', 'adulteress', 'fornication',
  'fornicator', 'prostitute', 'prostitution', 'chastity', 'chaste', 'celibate',
  'celibacy', 'seduce', 'seduction', 'defile', 'ravish',
]);

export function isExplicit(text) {
  if (!text) return false;
  const t = String(text).toLowerCase();
  return EXPLICIT_PATTERNS.some((re) => re.test(t));
}

/**
 * Filter one headword's senses.
 *
 * @param {string} word    the headword, lowercased
 * @param {Array}  senses  rows for that word, each { definition_order, definition_text, ... }
 * @returns {{ kept: Array, blocked: boolean, dropped: Array }}
 */
export function filterWordSenses(word, senses) {
  const lemma = String(word).toLowerCase();

  if (BLOCKED_HEADWORDS.has(lemma)) {
    return { kept: [], blocked: true, dropped: senses.slice() };
  }

  // The lowest-numbered sense stands in for "what the word means".
  const primary = senses.reduce(
    (lo, s) => (lo === null || s.definition_order < lo.definition_order ? s : lo),
    null,
  );
  const inherent =
    INHERENT_WORDS.has(lemma) ||
    (primary ? isExplicit(primary.definition_text) : false);

  const kept = [];
  const dropped = [];
  for (const s of senses) {
    if (!inherent && isExplicit(s.definition_text)) dropped.push(s);
    else kept.push(s);
  }
  return { kept, blocked: false, dropped };
}
