/**
 * Power Search Configuration Schema and Safe Regex Generator
 * Converts visual UI controls into optimized search patterns
 */

export type MatchType = 
  | 'contains'
  | 'startsWith'
  | 'endsWith'
  | 'wholeWord'
  | 'wordStartsWith'
  | 'wordEndsWith';

export interface ProximityRule {
  word1: string;
  word2: string;
  maxDistance: number; // 1-30 words
}

export interface MorphologyFilter {
  // Hebrew/Greek morphology
  pos?: string; // part of speech
  tense?: string;
  voice?: string;
  mood?: string;
  case?: string;
  number?: string;
  gender?: string;
}

export interface EnglishMorphologyFilter {
  // English POS (Part of Speech) - using simplified categories
  pos?: 
    | 'noun'      // person, place, thing
    | 'verb'      // action or state
    | 'adjective' // describes noun
    | 'adverb'    // describes verb, adjective, or adverb
    | 'pronoun'   // replaces noun (he, she, it, they)
    | 'preposition' // shows relationship (in, on, at, by)
    | 'conjunction' // connects words (and, but, or)
    | 'interjection' // exclamation (oh!, wow!)
    | 'article';  // the, a, an
  
  // Verb-specific filters
  tense?: 
    | 'present'   // happening now
    | 'past'      // happened before
    | 'future';   // will happen
  
  // Noun-specific filters
  number?: 
    | 'singular'  // one
    | 'plural';   // more than one
  
  // TODO: Will be populated from dictionary packs containing:
  // - Definitions from Webster's 1913, OPTED, Wiktionary
  // - Etymology and word origins
  // - Synonyms/antonyms from Moby Thesaurus, WordNet
  // - Grammar patterns from NLP corpora
  // - POS tagging from annotated datasets
}

export interface SearchConfig {
  // Primary search term
  text: string;
  
  // Match behavior
  matchType: MatchType;
  caseInsensitive: boolean;
  exactPhrase: boolean;
  
  // Word variations
  includePlurals: boolean;
  includeSynonyms: boolean; // Expand search with synonyms from thesaurus
  maxSynonymsPerWord: number; // Limit to prevent pattern explosion (default: 10)
  
  // Must contain/exclude logic
  mustContain: string[];
  mustNotContain: string[];
  
  // Proximity search
  proximityRules: ProximityRule[];
  
  // Biblical research filters
  matchCapitalizedNames: boolean;
  matchQuotedSpeech: boolean;
  strongsNumbers: string[];
  morphologyFilters?: MorphologyFilter;
  
  // English language filters
  englishMorphology?: EnglishMorphologyFilter;
  showPronunciation: boolean; // Display IPA pronunciation in results
  
  // Scope filters
  translations?: string[];
  testament?: 'OT' | 'NT' | 'both';
  books?: string[];
}

export interface GeneratedQuery {
  regex: RegExp;
  description: string;
  estimatedComplexity: number; // 0-100 score
  resultVolumeEstimate: 'safe' | 'moderate' | 'high' | 'extreme';
  warning?: string;
}

/**
 * Escape special regex characters in user input
 */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Calculate regex complexity score to prevent catastrophic backtracking
 * Also checks for patterns that might match too broadly (100k+ results)
 */
function calculateComplexity(pattern: string): number {
  let score = 0;
  
  // Count quantifiers
  score += (pattern.match(/[*+?]/g) || []).length * 10;
  
  // Count nested groups
  score += (pattern.match(/\(/g) || []).length * 5;
  
  // Count lookaheads (expensive)
  score += (pattern.match(/\(\?[=!]/g) || []).length * 15;
  
  // Pattern length
  score += pattern.length * 0.1;
  
  return Math.min(score, 100);
}

/**
 * Estimate potential result count based on pattern characteristics
 * Returns: 'safe' | 'moderate' | 'high' | 'extreme'
 */
function estimateResultVolume(pattern: string, text: string): string {
  // Empty pattern or very short text = likely too broad
  if (text.trim().length === 0) return 'extreme';
  if (text.trim().length === 1) return 'high';
  if (text.trim().length === 2) return 'moderate';
  
  // Common single words that appear everywhere
  const ultraCommonWords = ['the', 'and', 'of', 'to', 'a', 'in', 'that', 'is', 'was', 'he', 'for', 'it', 'with', 'as', 'his', 'on', 'be', 'at', 'by', 'i', 'this', 'had', 'not', 'are', 'but', 'from', 'or', 'have', 'an', 'they', 'which', 'one', 'you', 'were', 'her', 'all', 'she', 'there', 'would', 'their'];
  const lowerText = text.toLowerCase().trim();
  
  if (ultraCommonWords.includes(lowerText)) return 'extreme';
  
  // Patterns with .* or .+ at start/end are dangerous
  if (pattern.includes('.*') || pattern.includes('.+')) return 'high';
  
  // Multiple optional quantifiers
  if ((pattern.match(/\?/g) || []).length > 3) return 'moderate';
  
  return 'safe';
}

/**
 * Generate safe regex pattern from match type
 * Can now handle synonym expansion (multiple words with OR pattern)
 */
function generateMatchPattern(
  text: string, 
  matchType: MatchType, 
  includePlurals: boolean,
  synonyms?: string[]
): string {
  const words = synonyms && synonyms.length > 0 ? [text, ...synonyms] : [text];
  const escaped = words.map(w => escapeRegex(w));
  const plural = includePlurals ? 's?' : '';
  
  // Build OR pattern if we have multiple words
  const wordPattern = escaped.length > 1 
    ? `(?:${escaped.join('|')})` 
    : escaped[0];
  
  switch (matchType) {
    case 'contains':
      return `${wordPattern}${plural}`;
    
    case 'startsWith':
      return `^${wordPattern}${plural}`;
    
    case 'endsWith':
      return `${wordPattern}${plural}$`;
    
    case 'wholeWord':
      return `\\b${wordPattern}${plural}\\b`;
    
    case 'wordStartsWith':
      return `\\b${wordPattern}\\w*${plural}`;
    
    case 'wordEndsWith':
      return `\\w*${wordPattern}${plural}\\b`;
    
    default:
      return wordPattern;
  }
}

/**
 * Generate lookahead patterns for must contain/exclude
 */
function generateLookaheads(mustContain: string[], mustNotContain: string[]): string {
  let pattern = '';
  
  // Positive lookaheads for must contain
  for (const word of mustContain) {
    const escaped = escapeRegex(word);
    pattern += `(?=.*\\b${escaped}\\b)`;
  }
  
  // Negative lookaheads for must not contain
  for (const word of mustNotContain) {
    const escaped = escapeRegex(word);
    pattern += `(?!.*\\b${escaped}\\b)`;
  }
  
  return pattern;
}

/**
 * Generate proximity search pattern
 * Matches word1 within maxDistance words of word2
 */
function generateProximityPattern(rule: ProximityRule): string {
  const word1 = escapeRegex(rule.word1);
  const word2 = escapeRegex(rule.word2);
  const distance = Math.min(Math.max(1, rule.maxDistance), 30); // Clamp 1-30
  
  // Match: word1 followed by 0-N words, then word2
  // \bword1\b\W+(?:\w+\W+){0,N}\bword2\b
  return `\\b${word1}\\b\\W+(?:\\w+\\W+){0,${distance}}\\b${word2}\\b`;
}

/**
 * Generate complete regex pattern from search config
 * Note: Synonym expansion should be done before calling this function
 * by the caller using englishLexicalService.expandWithSynonyms()
 */
export function generateSafeRegex(config: SearchConfig, expandedSynonyms?: string[]): GeneratedQuery {
  if (!config.text.trim() && config.proximityRules.length === 0) {
    throw new Error('Search text cannot be empty');
  }
  
  let pattern = '';
  let description = '';
  
  // Add lookaheads first (they don't consume characters)
  const lookaheads = generateLookaheads(config.mustContain, config.mustNotContain);
  pattern += lookaheads;
  
  // Add proximity patterns (if any)
  if (config.proximityRules.length > 0) {
    const proximityPatterns = config.proximityRules.map(generateProximityPattern);
    pattern += '(?:' + proximityPatterns.join('|') + ')';
    description = `Proximity search: ${config.proximityRules.map(r => 
      `"${r.word1}" within ${r.maxDistance} words of "${r.word2}"`
    ).join(', ')}`;
  } else if (config.text.trim()) {
    // Add main search pattern with optional synonym expansion
    const mainPattern = generateMatchPattern(
      config.text, 
      config.matchType, 
      config.includePlurals,
      expandedSynonyms
    );
    pattern += mainPattern;
    
    description = `${config.matchType} "${config.text}"`;
    if (config.includePlurals) description += ' (with plurals)';
    if (expandedSynonyms && expandedSynonyms.length > 0) {
      description += ` + ${expandedSynonyms.length} synonyms`;
    }
  }
  
  // Add must contain/exclude to description
  if (config.mustContain.length > 0) {
    description += ` + must contain: ${config.mustContain.join(', ')}`;
  }
  if (config.mustNotContain.length > 0) {
    description += ` + must NOT contain: ${config.mustNotContain.join(', ')}`;
  }
  
  // Build flags
  const flags = config.caseInsensitive ? 'gi' : 'g';
  
  // Safety checks
  const complexity = calculateComplexity(pattern);
  const volumeEstimate = estimateResultVolume(pattern, config.text);
  
  let warning: string | undefined;
  
  if (complexity > 80) {
    console.warn(`High complexity regex (${complexity}/100):`, pattern);
    warning = 'Very complex pattern - may be slow to execute';
  }
  
  if (volumeEstimate === 'extreme') {
    warning = '⚠️ This search will likely return 50,000+ results (very common word). Consider adding filters.';
  } else if (volumeEstimate === 'high') {
    warning = '⚠️ This search may return 10,000+ results. Consider narrowing your search.';
  }
  
  try {
    const regex = new RegExp(pattern, flags);
    return {
      regex,
      description,
      estimatedComplexity: complexity,
      resultVolumeEstimate: volumeEstimate,
      warning
    };
  } catch (error) {
    throw new Error(`Invalid regex pattern generated: ${error}`);
  }
}

/**
 * Create default search config
 */
export function createDefaultConfig(): SearchConfig {
  return {
    text: '',
    matchType: 'contains',
    caseInsensitive: true,
    exactPhrase: false,
    includePlurals: false,
    includeSynonyms: false,
    maxSynonymsPerWord: 10,
    mustContain: [],
    mustNotContain: [],
    proximityRules: [],
    matchCapitalizedNames: false,
    matchQuotedSpeech: false,
    strongsNumbers: [],
    showPronunciation: false,
    testament: 'both',
  };
}
