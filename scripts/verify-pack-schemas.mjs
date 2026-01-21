#!/usr/bin/env node
/**
 * Verify Pack Schemas
 * 
 * Validates source packs before consolidation:
 * - Check morphology tables exist in ancient language packs
 * - Verify Strong's IDs are present
 * - Validate schema compatibility
 */

import Database from 'better-sqlite3';
import { existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = join(__dirname, '..');

console.log('🔍 Verifying Pack Schemas...\n');

function checkPack(packPath, packName, checks) {
  console.log(`\n📦 ${packName}`);
  
  if (!existsSync(packPath)) {
    console.log('   ❌ Pack not found');
    return false;
  }
  
  try {
    const db = new Database(packPath, { readonly: true });
    
    // Get all tables
    const tables = db.prepare(`
      SELECT name FROM sqlite_master 
      WHERE type='table' 
      ORDER BY name
    `).all().map(r => r.name);
    
    console.log(`   Tables: ${tables.join(', ')}`);
    
    // Run custom checks
    let allPassed = true;
    for (const check of checks) {
      try {
        const result = check.fn(db, tables);
        if (result) {
          console.log(`   ✅ ${check.name}`);
        } else {
          console.log(`   ❌ ${check.name}`);
          allPassed = false;
        }
      } catch (e) {
        console.log(`   ⚠️  ${check.name}: ${e.message}`);
        allPassed = false;
      }
    }
    
    db.close();
    return allPassed;
    
  } catch (error) {
    console.log(`   ❌ Error: ${error.message}`);
    return false;
  }
}

// Check 1: Hebrew pack
checkPack(
  join(repoRoot, 'packs/hebrew-oshb.sqlite'),
  'Hebrew (OSHB)',
  [
    {
      name: 'Has morphology table',
      fn: (db, tables) => tables.some(t => t.toLowerCase().includes('morph'))
    },
    {
      name: 'Has Strong\'s IDs',
      fn: (db) => {
        const sample = db.prepare('SELECT * FROM morphology LIMIT 1').get();
        return sample && 'strongs_id' in sample;
      }
    },
    {
      name: 'Morphology count > 0',
      fn: (db) => {
        const count = db.prepare('SELECT COUNT(*) as c FROM morphology').get();
        console.log(`      (${count.c.toLocaleString()} morphology records)`);
        return count.c > 0;
      }
    }
  ]
);

// Check 2: Greek Byzantine
checkPack(
  join(repoRoot, 'packs/byz-full.sqlite'),
  'Greek Byzantine',
  [
    {
      name: 'Has morphology table',
      fn: (db, tables) => tables.some(t => t.toLowerCase().includes('morph'))
    },
    {
      name: 'Has Strong\'s IDs',
      fn: (db) => {
        const sample = db.prepare('SELECT * FROM morphology LIMIT 1').get();
        return sample && 'strongs_id' in sample;
      }
    }
  ]
);

// Check 3: LXX Greek
checkPack(
  join(repoRoot, 'packs/lxx-greek.sqlite'),
  'LXX Greek',
  [
    {
      name: 'Has morphology table',
      fn: (db, tables) => tables.some(t => t.toLowerCase().includes('morph'))
    },
    {
      name: 'Has verses table',
      fn: (db, tables) => tables.includes('verses')
    }
  ]
);

// Check 4: Strong's Greek
checkPack(
  join(repoRoot, 'packs/strongs-greek.sqlite'),
  'Strong\'s Greek',
  [
    {
      name: 'Has entries table',
      fn: (db, tables) => tables.some(t => t.toLowerCase().includes('entries') || t.toLowerCase().includes('lexicon'))
    },
    {
      name: 'Has Strong\'s IDs',
      fn: (db) => {
        const sample = db.prepare('SELECT * FROM entries LIMIT 1').get();
        return sample && ('strongs' in sample || 'id' in sample);
      }
    },
    {
      name: 'Entry count > 0',
      fn: (db) => {
        const count = db.prepare('SELECT COUNT(*) as c FROM entries').get();
        console.log(`      (${count.c.toLocaleString()} Greek entries)`);
        return count.c > 0;
      }
    }
  ]
);

// Check 5: Strong's Hebrew
checkPack(
  join(repoRoot, 'packs/strongs-hebrew.sqlite'),
  'Strong\'s Hebrew',
  [
    {
      name: 'Has entries table',
      fn: (db, tables) => tables.some(t => t.toLowerCase().includes('entries') || t.toLowerCase().includes('lexicon'))
    },
    {
      name: 'Entry count > 0',
      fn: (db) => {
        const count = db.prepare('SELECT COUNT(*) as c FROM entries').get();
        console.log(`      (${count.c.toLocaleString()} Hebrew entries)`);
        return count.c > 0;
      }
    }
  ]
);

// Check 6: Translation packs have verses
for (const trans of ['kjv', 'web', 'bsb', 'net', 'lxx2012-english']) {
  checkPack(
    join(repoRoot, `packs/${trans}.sqlite`),
    trans.toUpperCase(),
    [
      {
        name: 'Has verses table',
        fn: (db, tables) => tables.includes('verses')
      },
      {
        name: 'Verse count > 0',
        fn: (db) => {
          const count = db.prepare('SELECT COUNT(*) as c FROM verses').get();
          console.log(`      (${count.c.toLocaleString()} verses)`);
          return count.c > 30000; // Bible should have ~31k verses
        }
      }
    ]
  );
}

// Check 7: Polished packs
for (const pack of ['english-wordlist-v1', 'english-thesaurus-v1', 'english-grammar-v1']) {
  checkPack(
    join(repoRoot, `packs/polished/${pack}.sqlite`),
    pack,
    [
      {
        name: 'Pack exists and opens',
        fn: () => true
      }
    ]
  );
}

console.log('\n✅ Schema verification complete!\n');
