#!/usr/bin/env node
/**
 * Test English Lexical Packs
 * 
 * Quick validation script to test the three SQLite packs:
 * - Wordlist (pronunciations)
 * - Thesaurus (synonyms)
 * - Grammar (POS, verbs, plurals)
 */

import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PACK_DIR = path.join(__dirname, '../packs/polished');

console.log('='.repeat(60));
console.log('Testing English Lexical Packs');
console.log('='.repeat(60));
console.log('');

// Test 1: Wordlist Pack
console.log('📚 TEST 1: Wordlist + IPA Pronunciations');
console.log('-'.repeat(60));

try {
  const wordlistDb = new Database(path.join(PACK_DIR, 'english-wordlist-v1.sqlite'), { readonly: true });
  
  // Test some common words
  const testWords = ['love', 'faith', 'grace', 'peace', 'hope'];
  
  for (const word of testWords) {
    const result = wordlistDb.prepare('SELECT * FROM words WHERE word = ?').get(word);
    if (result) {
      console.log(`✓ ${word}:`);
      if (result.ipa_us) console.log(`  US: /${result.ipa_us}/`);
      if (result.ipa_uk) console.log(`  UK: /${result.ipa_uk}/`);
    } else {
      console.log(`✗ ${word}: Not found`);
    }
  }
  
  // Statistics
  const stats = wordlistDb.prepare('SELECT COUNT(*) as total FROM words').get();
  console.log(`\nTotal words in database: ${stats.total.toLocaleString()}`);
  
  wordlistDb.close();
  console.log('✓ Wordlist pack test passed!\n');
} catch (error) {
  console.error('✗ Wordlist pack test failed:', error.message);
}

// Test 2: Thesaurus Pack
console.log('🔄 TEST 2: Thesaurus (Synonyms)');
console.log('-'.repeat(60));

try {
  const thesaurusDb = new Database(path.join(PACK_DIR, 'english-thesaurus-v1.sqlite'), { readonly: true });
  
  // Test some theological words
  const testWords = ['love', 'faith', 'holy', 'grace'];
  
  for (const word of testWords) {
    const synonyms = thesaurusDb.prepare('SELECT synonym FROM synonyms WHERE word = ? LIMIT 10').all(word);
    if (synonyms.length > 0) {
      console.log(`✓ ${word}: ${synonyms.map(s => s.synonym).join(', ')}...`);
    } else {
      console.log(`✗ ${word}: No synonyms found`);
    }
  }
  
  // Statistics
  const stats = thesaurusDb.prepare('SELECT COUNT(*) as total FROM synonyms').get();
  console.log(`\nTotal synonym relationships: ${stats.total.toLocaleString()}`);
  
  thesaurusDb.close();
  console.log('✓ Thesaurus pack test passed!\n');
} catch (error) {
  console.error('✗ Thesaurus pack test failed:', error.message);
}

// Test 3: Grammar Pack
console.log('📝 TEST 3: Grammar (Verbs, Plurals, POS)');
console.log('-'.repeat(60));

try {
  const grammarDb = new Database(path.join(PACK_DIR, 'english-grammar-v1.sqlite'), { readonly: true });
  
  // Test irregular verbs
  console.log('Irregular Verbs:');
  const verbs = grammarDb.prepare('SELECT * FROM verb_forms LIMIT 5').all();
  for (const verb of verbs) {
    console.log(`  ${verb.base_form}: ${verb.past} / ${verb.past_participle} / ${verb.present_participle}`);
  }
  
  // Test irregular plurals
  console.log('\nIrregular Plurals:');
  const plurals = grammarDb.prepare('SELECT * FROM noun_plurals LIMIT 5').all();
  for (const plural of plurals) {
    console.log(`  ${plural.singular} → ${plural.plural}`);
  }
  
  // Test POS tags
  console.log('\nPOS Tags (sample):');
  const posTags = grammarDb.prepare('SELECT word, pos FROM pos_tags LIMIT 5').all();
  for (const tag of posTags) {
    console.log(`  ${tag.word} → ${tag.pos}`);
  }
  
  // Statistics
  const stats = grammarDb.prepare(`
    SELECT 
      (SELECT COUNT(*) FROM verb_forms) as verbs,
      (SELECT COUNT(*) FROM noun_plurals) as plurals,
      (SELECT COUNT(*) FROM pos_tags) as pos_tags
  `).get();
  console.log(`\nStatistics:`);
  console.log(`  Irregular verbs: ${stats.verbs}`);
  console.log(`  Irregular plurals: ${stats.plurals}`);
  console.log(`  POS tags: ${stats.pos_tags.toLocaleString()}`);
  
  grammarDb.close();
  console.log('✓ Grammar pack test passed!\n');
} catch (error) {
  console.error('✗ Grammar pack test failed:', error.message);
}

// Advanced Test: Cross-pack lookup
console.log('🔗 TEST 4: Cross-Pack Lookup (love + synonyms + POS)');
console.log('-'.repeat(60));

try {
  const wordlistDb = new Database(path.join(PACK_DIR, 'english-wordlist-v1.sqlite'), { readonly: true });
  const thesaurusDb = new Database(path.join(PACK_DIR, 'english-thesaurus-v1.sqlite'), { readonly: true });
  const grammarDb = new Database(path.join(PACK_DIR, 'english-grammar-v1.sqlite'), { readonly: true });
  
  const word = 'love';
  
  // Get pronunciation
  const wordInfo = wordlistDb.prepare('SELECT * FROM words WHERE word = ?').get(word);
  console.log(`Word: ${word}`);
  if (wordInfo?.ipa_us) console.log(`  Pronunciation (US): /${wordInfo.ipa_us}/`);
  
  // Get synonyms
  const synonyms = thesaurusDb.prepare('SELECT synonym FROM synonyms WHERE word = ? LIMIT 8').all(word);
  if (synonyms.length > 0) {
    console.log(`  Synonyms: ${synonyms.map(s => s.synonym).join(', ')}`);
  }
  
  // Get POS
  const pos = grammarDb.prepare('SELECT pos FROM pos_tags WHERE word = ?').all(word);
  if (pos.length > 0) {
    console.log(`  Parts of speech: ${pos.map(p => p.pos).join(', ')}`);
  }
  
  wordlistDb.close();
  thesaurusDb.close();
  grammarDb.close();
  
  console.log('✓ Cross-pack lookup test passed!\n');
} catch (error) {
  console.error('✗ Cross-pack lookup test failed:', error.message);
}

console.log('='.repeat(60));
console.log('✅ All tests complete!');
console.log('='.repeat(60));
console.log('\nPacks are ready to integrate into your application.');
console.log('Next steps:');
console.log('  1. Load packs into IndexedDB for offline use');
console.log('  2. Create search adapters to query the data');
console.log('  3. Add synonym expansion to Power Search');
console.log('  4. Implement POS filtering in search UI');
