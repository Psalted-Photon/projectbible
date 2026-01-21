// helpers/normalize.js

export function normalizeLemma(str) {
  if (!str) return "";
  return str
    .toLowerCase()
    .normalize("NFKC")
    .replace(/[^\p{L}\p{N}\-']/gu, "")
    .trim();
}

export function normalizePOS(pos) {
  if (!pos) return null;
  
  const normalized = pos.toLowerCase().trim();
  
  // Map common variants to canonical POS
  const posMap = {
    "noun": "noun",
    "proper noun": "proper_noun",
    "verb": "verb",
    "adjective": "adjective",
    "adverb": "adverb",
    "pronoun": "pronoun",
    "preposition": "preposition",
    "conjunction": "conjunction",
    "interjection": "interjection",
    "determiner": "determiner",
    "article": "article",
    "participle": "participle",
    
    // Common abbreviations
    "n": "noun",
    "v": "verb",
    "adj": "adjective",
    "adv": "adverb",
    "prep": "preposition",
    "conj": "conjunction",
    "pron": "pronoun",
    "interj": "interjection",
    "det": "determiner"
  };
  
  return posMap[normalized] || normalized;
}
