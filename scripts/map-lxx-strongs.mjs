#!/usr/bin/env node
/**
 * Map LXX Greek lemmas to Strong's G-numbers using STEPBible Greek lexicon
 * This script creates a mapping from Greek lemmas to Strong's numbers for the LXX
 */

import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';

const LEXICON_PATH = 'data-sources/stepbible/STEPBible-Data-master/Lexicons/TBESG - Translators Brief lexicon of Extended Strongs for Greek - STEPBible.org CC BY.txt';
const LXX_PACK = 'packs/lxx-greek.sqlite';

// Parse the Greek Strong's lexicon
console.log('📖 Parsing STEPBible Greek Strong\'s lexicon...');
const lexiconText = fs.readFileSync(LEXICON_PATH, 'utf-8');

// Build lemma → Strong's mapping
const lemmaToStrongs = new Map();
let lxxStrongsCount = 0;
let ntStrongsCount = 0;

// Parse TSV-style data (lines starting with G followed by digits)
const lines = lexiconText.split('\n');
for (const line of lines) {
  // Match lines like: G0001   G0001 = G0001   Ἀβιληνή...
  // or: G0012   G0012 = G0012   ἄβυσσος abussos G:N-F   abyss
  const match = line.match(/^(G\d+)\s+G\d+\s*=\s*(?:.*?\s+)?(G\d+)\s+([\u0370-\u03FF\u1F00-\u1FFF]+)\s/u);
  
  if (match) {
    const strongsNum = match[1];
    const greekWord = match[3];
    
    // Normalize Greek: lowercase + remove diacritics for matching
    const normalized = greekWord.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    
    // Track LXX vs NT Strong's numbers
    const num = parseInt(strongsNum.substring(1));
    if (num >= 6100 && num <= 9979) {
      lxxStrongsCount++;
    } else if (num >= 1 && num <= 5624) {
      ntStrongsCount++;
    }
    
    // Store both normalized and original forms
    if (!lemmaToStrongs.has(normalized)) {
      lemmaToStrongs.set(normalized, []);
    }
    lemmaToStrongs.get(normalized).push({
      strongs: strongsNum,
      lemma: greekWord,
      num: num
    });
    
    // Also store the original form with diacritics
    const original = greekWord.toLowerCase();
    if (original !== normalized) {
      if (!lemmaToStrongs.has(original)) {
        lemmaToStrongs.set(original, []);
      }
      lemmaToStrongs.get(original).push({
        strongs: strongsNum,
        lemma: greekWord,
        num: num
      });
    }
  }
}

console.log(`✅ Loaded ${lemmaToStrongs.size} unique Greek lemmas from lexicon`);
console.log(`   - NT Strong's numbers (G1-G5624): ${ntStrongsCount}`);
console.log(`   - LXX Strong's numbers (G6100-G9979): ${lxxStrongsCount}`);

// Open LXX database
console.log(`\n📂 Opening LXX pack: ${LXX_PACK}`);
const db = new Database(LXX_PACK);

// Check if strongs column exists
const tableInfo = db.prepare('PRAGMA table_info(words)').all();
const hasStrongsColumn = tableInfo.some(col => col.name === 'strongs');

if (!hasStrongsColumn) {
  console.log('➕ Adding strongs column to words table...');
  db.prepare('ALTER TABLE words ADD COLUMN strongs TEXT').run();
}

// Check if gloss_en column exists
const hasGlossColumn = tableInfo.some(col => col.name === 'gloss_en');
if (!hasGlossColumn) {
  console.log('➕ Adding gloss_en column to words table...');
  db.prepare('ALTER TABLE words ADD COLUMN gloss_en TEXT').run();
}

// Get all unique lemmas from LXX
console.log('\n🔍 Analyzing LXX lemmas...');
const lxxLemmas = db.prepare('SELECT DISTINCT lemma FROM words WHERE lemma IS NOT NULL').all();
console.log(`Found ${lxxLemmas.length} unique lemmas in LXX pack`);

// Helper function to generate lemma variants for better matching
function getLemmaVariants(lemma) {
  const variants = new Set();
  const normalized = lemma.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const original = lemma.toLowerCase();
  
  variants.add(normalized);
  variants.add(original);
  
  // Try removing final sigma variants (ς vs σ)
  variants.add(normalized.replace(/ς/g, 'σ'));
  variants.add(original.replace(/ς/g, 'σ'));
  
  // Try -ω verb endings (many Greek verbs end in -ω in lexical form)
  if (!normalized.endsWith('ω')) {
    variants.add(normalized + 'ω');
    variants.add(original + 'ω');
  }
  
  // Try -ομαι for middle/passive verbs
  if (!normalized.endsWith('ομαι')) {
    variants.add(normalized.replace(/ω$/, 'ομαι'));
    variants.add(original.replace(/ω$/, 'ομαι'));
  }
  
  return Array.from(variants);
}

// Map LXX lemmas to Strong's numbers
let matchedCount = 0;
let unmatchedLemmas = [];
const lemmaStrongsMap = new Map();

for (const { lemma } of lxxLemmas) {
  if (!lemma) continue;
  
  // Try various normalization strategies
  const variants = getLemmaVariants(lemma);
  let strongsMatches = null;
  
  for (const variant of variants) {
    strongsMatches = lemmaToStrongs.get(variant);
    if (strongsMatches && strongsMatches.length > 0) break;
  }
  
  if (strongsMatches && strongsMatches.length > 0) {
    // Prefer LXX-specific Strong's numbers (G6100-G9979) if available
    const lxxMatch = strongsMatches.find(m => m.num >= 6100 && m.num <= 9979);
    const ntMatch = strongsMatches.find(m => m.num >= 1 && m.num <= 5624);
    
    const bestMatch = lxxMatch || ntMatch || strongsMatches[0];
    lemmaStrongsMap.set(lemma, bestMatch.strongs);
    matchedCount++;
  } else {
    unmatchedLemmas.push(lemma);
  }
}

console.log(`\n📊 Matching results:`);
console.log(`   ✅ Matched: ${matchedCount} lemmas (${((matchedCount / lxxLemmas.length) * 100).toFixed(1)}%)`);
console.log(`   ❌ Unmatched: ${unmatchedLemmas.length} lemmas (${((unmatchedLemmas.length / lxxLemmas.length) * 100).toFixed(1)}%)`);

if (unmatchedLemmas.length > 0 && unmatchedLemmas.length <= 20) {
  console.log(`\nUnmatched lemmas (sample):`);
  unmatchedLemmas.slice(0, 20).forEach(l => console.log(`   - ${l}`));
}

// Update words table with Strong's numbers
console.log(`\n💾 Updating LXX words table with Strong's numbers...`);
db.prepare('BEGIN TRANSACTION').run();

const updateStmt = db.prepare('UPDATE words SET strongs = ? WHERE lemma = ? AND strongs IS NULL');
let updatedWords = 0;

for (const [lemma, strongs] of lemmaStrongsMap.entries()) {
  const result = updateStmt.run(strongs, lemma);
  updatedWords += result.changes;
}

db.prepare('COMMIT').run();

console.log(`✅ Updated ${updatedWords} words with Strong's numbers`);

// Verify the update
const totalWords = db.prepare('SELECT COUNT(*) as count FROM words').get().count;
const wordsWithStrongs = db.prepare('SELECT COUNT(*) as count FROM words WHERE strongs IS NOT NULL').get().count;

console.log(`\n📈 LXX pack statistics:`);
console.log(`   Total words: ${totalWords.toLocaleString()}`);
console.log(`   Words with Strong's: ${wordsWithStrongs.toLocaleString()} (${((wordsWithStrongs / totalWords) * 100).toFixed(1)}%)`);

// Show sample
console.log(`\n📝 Sample LXX words with Strong's:`);
const sampleWords = db.prepare(`
  SELECT book, chapter, verse, text, lemma, strongs
  FROM words
  WHERE book = 'Genesis' AND chapter = 1 AND verse = 1
  ORDER BY word_order
  LIMIT 10
`).all();

sampleWords.forEach(w => {
  console.log(`   ${w.text} (${w.lemma}) → ${w.strongs}`);
});

db.close();
console.log(`\n✅ LXX Strong's mapping complete!`);
console.log(`\nNext step: Run add-strongs-glosses.mjs to add English glosses from Strong's dictionary`);
