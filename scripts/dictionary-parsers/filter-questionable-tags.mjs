#!/usr/bin/env node

/**
 * filter-questionable-tags.mjs
 * 
 * Reduces full Wiktionary tag list to a shortlist of potentially unsafe tags
 * for manual review before creating final blocklist.
 * 
 * Input: all-wiktionary-tags.json (array of all tags)
 * Output: questionable-tags.json (tags matching unsafe content keywords)
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

console.log('🔍 Questionable Tag Filter\n');

// Unsafe content categories
const unsafeCategories = [
  'Vulgarity',
  'Profanity',
  'Obscenity',
  'Sexual content',
  'Sexual slang',
  'Sexual acts',
  'Sexual anatomy',
  'Pornography themes',
  'Adult entertainment',
  'Prostitution themes',
  'Derogatory slurs',
  'Ethnic slurs',
  'Racial slurs',
  'Religious slurs',
  'Sexual-orientation slurs',
  'Gender-based slurs',
  'Body-shaming insults',
  'Violence themes',
  'Graphic violence',
  'Torture themes',
  'Abuse themes',
  'Domestic violence themes',
  'Self-harm themes',
  'Suicide themes',
  'Homicide themes',
  'Murder terminology',
  'Crime terminology',
  'Drug use themes',
  'Illegal drugs',
  'Drug paraphernalia',
  'Alcohol abuse themes',
  'Addiction terminology',
  'Gambling terminology',
  'Criminal organizations',
  'Hate speech categories',
  'Extremist ideology terms',
  'Derogatory stereotypes',
  'Offensive humor categories',
  'Scatological themes',
  'Bodily-function vulgarity',
  'Excrement terminology',
  'Urination vulgarity',
  'Flatulence vulgarity',
  'Anatomical vulgarity',
  'Insult categories',
  'Dehumanizing language',
  'Harassment terminology',
  'Bullying terminology',
  'Threatening language',
  'Explicit slang categories',
  'Internet explicit slang',
  'Modern explicit memes',
  'Adult idioms',
  'Lewd metaphors',
  'Sexual innuendo categories',
  'Obscene gestures',
  'Explicit sound-alike euphemisms',
  'Offensive abbreviations',
  'Offensive acronyms',
  'Offensive portmanteaus',
  'Explicit compound words',
  'Explicit verb forms',
  'Explicit adjective forms',
  'Explicit noun forms',
  'Explicit participles',
  'Explicit interjections',
  'Explicit intensifiers',
  'Explicit idiomatic expressions',
  'Explicit phrasal verbs',
  'Explicit regional slang',
  'Explicit dialectal slang',
  'Explicit youth slang',
  'Explicit online slang',
  'Explicit gaming slang',
  'Explicit music-culture slang',
  'Explicit pop-culture slang',
  'Explicit insult templates',
  'Explicit taunts',
  'Explicit curses',
  'Explicit imprecations',
  'Explicit blasphemous usage',
  'Offensive historical terminology',
  'Derogatory archaic terms',
  'Obscene loanwords',
  'Obscene borrowings',
  'Obscene calques',
  'Obscene neologisms',
  'Obscene abbreviations',
  'Obscene initialisms',
  'Obscene hashtags',
  'Obscene emoji-based terms',
  'Obscene phonetic spellings',
  'Obscene misspellings',
  'Obscene euphemisms',
  'Obscene dysphemisms'
];

// Stopwords to remove from keyword extraction
const stopwords = new Set([
  'themes', 'categories', 'terms', 'terminology', 'language',
  'usage', 'forms', 'content', 'based', 'related', 'associated'
]);

/**
 * Extract keywords from category names
 */
function extractKeywords(categories) {
  const keywords = new Set();
  
  for (const category of categories) {
    const normalized = category.toLowerCase();
    
    // Split on spaces and hyphens
    const words = normalized.split(/[\s\-]+/);
    
    for (const word of words) {
      const cleaned = word.trim();
      
      // Skip stopwords and very short words
      if (stopwords.has(cleaned) || cleaned.length < 3) {
        continue;
      }
      
      keywords.add(cleaned);
    }
  }
  
  return [...keywords].sort();
}

/**
 * Check if a tag matches any unsafe keyword
 */
function isQuestionable(tag, keywords) {
  const normalizedTag = tag.toLowerCase().trim();
  
  // Check if any keyword appears as substring in the tag
  for (const keyword of keywords) {
    if (normalizedTag.includes(keyword)) {
      return { match: true, keyword };
    }
  }
  
  return { match: false };
}

// Main execution
try {
  // Load all tags
  const inputFile = path.join(__dirname, 'all-wiktionary-tags.json');
  
  if (!fs.existsSync(inputFile)) {
    console.error('❌ Error: all-wiktionary-tags.json not found');
    console.error('   Run extract-wiktionary-tags.mjs first\n');
    process.exit(1);
  }
  
  const data = JSON.parse(fs.readFileSync(inputFile, 'utf8'));
  const allTags = Array.isArray(data) ? data : (data.tags || []);
  
  console.log(`📥 Loaded ${allTags.length} tags from all-wiktionary-tags.json\n`);
  
  // Extract keywords from unsafe categories
  const keywords = extractKeywords(unsafeCategories);
  console.log(`🔑 Extracted ${keywords.length} unsafe keywords:`);
  console.log(`   ${keywords.slice(0, 20).join(', ')}...`);
  console.log('');
  
  // Filter tags
  const questionableTags = [];
  const matchDetails = [];
  
  for (const tag of allTags) {
    const result = isQuestionable(tag, keywords);
    if (result.match) {
      questionableTags.push(tag);
      matchDetails.push({
        tag,
        keyword: result.keyword
      });
    }
  }
  
  // Sort results
  questionableTags.sort();
  
  console.log(`📊 Results:`);
  console.log(`   Total tags scanned: ${allTags.length}`);
  console.log(`   Questionable tags found: ${questionableTags.length}`);
  console.log(`   Reduction: ${((1 - questionableTags.length / allTags.length) * 100).toFixed(1)}%\n`);
  
  // Show sample matches
  console.log(`📋 Sample questionable tags (first 20):`);
  matchDetails.slice(0, 20).forEach(({ tag, keyword }) => {
    console.log(`   "${tag}" → matched "${keyword}"`);
  });
  
  if (questionableTags.length > 20) {
    console.log(`   ... and ${questionableTags.length - 20} more\n`);
  } else {
    console.log('');
  }
  
  // Save output
  const outputFile = path.join(__dirname, 'questionable-tags.json');
  const output = {
    generated: new Date().toISOString(),
    source: 'all-wiktionary-tags.json',
    unsafe_categories_used: unsafeCategories.length,
    keywords_extracted: keywords.length,
    total_tags_scanned: allTags.length,
    questionable_tags_found: questionableTags.length,
    reduction_percentage: ((1 - questionableTags.length / allTags.length) * 100).toFixed(1) + '%',
    tags: questionableTags,
    match_details: matchDetails,
    keywords_used: keywords
  };
  
  fs.writeFileSync(outputFile, JSON.stringify(output, null, 2));
  
  console.log(`💾 Saved: ${outputFile}\n`);
  console.log(`📝 Next steps:`);
  console.log(`   1. Review questionable-tags.json manually`);
  console.log(`   2. Verify each tag is actually unsafe`);
  console.log(`   3. Create blocked-tags.json from confirmed unsafe tags`);
  console.log(`   4. Update parse-wiktionary.mjs to filter using blocklist\n`);
  
  console.log(`✅ Tag filtering complete!\n`);
  
} catch (error) {
  console.error('❌ Error:', error.message);
  process.exit(1);
}
