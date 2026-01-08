#!/usr/bin/env node

/**
 * Build Enhanced Places Pack
 * 
 * Creates an SQLite pack with comprehensive place data:
 * - Biblical places with modern equivalents
 * - Historical names in different languages/periods
 * - Place appearances (what it looked like in different eras)
 * - Place name links (word -> place entity mapping)
 * - Events and people associated with each place
 * 
 * Data sources:
 * - OpenBible.info (CC BY 4.0)
 * - Custom curated data
 * 
 * Usage:
 *   node scripts/build-places-pack.mjs
 */

import Database from 'better-sqlite3';
import { readFileSync, existsSync, mkdirSync } from 'fs';

const PACK_OUTPUT = 'packs/places-biblical.sqlite';

// Sample comprehensive place data
// In production, load from data-sources/places/
const SAMPLE_PLACES = [
  {
    id: 'bethel',
    name: 'Bethel',
    altNames: ['Luz', 'Beitin'],
    type: 'city',
    latitude: 31.9308,
    longitude: 35.2206,
    modernCity: 'Beitin',
    modernCountry: 'Palestinian Territories',
    region: 'Samaria',
    historicalNames: [
      { name: 'בֵּית־אֵל', language: 'hebrew', period: 'OT', strongsId: 'H1008' },
      { name: 'Bethel', language: 'english', period: 'Modern' },
      { name: 'Luz', language: 'hebrew', period: 'OT' }
    ],
    appearances: [
      {
        period: 'Patriarchs',
        description: 'Small Canaanite settlement where Jacob had his dream of the ladder',
        significance: "Renamed from Luz by Jacob after God's promise",
        population: 500
      },
      {
        period: 'United Kingdom',
        description: 'Significant religious center',
        population: 2000
      },
      {
        period: 'Divided Kingdom',
        description: 'One of two golden calf shrines established by Jeroboam I',
        significance: 'Northern Kingdom worship center, competing with Jerusalem'
      }
    ],
    firstMention: { book: 'Genesis', chapter: 12, verse: 8 },
    significance: 'Place of Jacob\'s ladder dream; later became a center of idolatry',
    events: [
      "Jacob's dream of the ladder",
      "Jeroboam's golden calf shrine",
      "Amos prophesied against"
    ],
    people: ['Jacob', 'Jeroboam I', 'Amos'],
    elevation: 880,
    description: 'Ancient city north of Jerusalem, site of Jacob\'s vision'
  },
  {
    id: 'jerusalem',
    name: 'Jerusalem',
    altNames: ['Jebus', 'City of David', 'Zion', 'Al-Quds'],
    type: 'city',
    latitude: 31.7683,
    longitude: 35.2137,
    modernCity: 'Jerusalem',
    modernCountry: 'Israel',
    region: 'Judea',
    historicalNames: [
      { name: 'יְרוּשָׁלַיִם', language: 'hebrew', period: 'OT', strongsId: 'H3389' },
      { name: 'Ἱεροσόλυμα', language: 'greek', period: 'NT', strongsId: 'G2414' },
      { name: 'Yebus', language: 'hebrew', period: 'OT' },
      { name: 'Jerusalem', language: 'english', period: 'Modern' }
    ],
    appearances: [
      {
        period: 'Patriarchs',
        description: 'Canaanite city-state called Salem, ruled by Melchizedek',
        significance: 'Melchizedek blessed Abraham here',
        population: 1000
      },
      {
        period: 'Judges',
        description: 'Jebusite stronghold on a hill',
        population: 2000
      },
      {
        period: 'United Kingdom',
        description: 'Capital city with Solomon\'s Temple',
        significance: 'Political and religious center of Israel',
        population: 25000
      },
      {
        period: 'NT',
        description: 'Major city under Roman rule with rebuilt Temple',
        significance: 'Site of Jesus\' crucifixion and resurrection',
        population: 80000
      }
    ],
    firstMention: { book: 'Genesis', chapter: 14, verse: 18 },
    significance: 'Holy city, site of the Temple, center of Jewish worship',
    events: [
      'Melchizedek blessed Abraham',
      'David captured from Jebusites',
      'Solomon built the Temple',
      'Babylonian destruction',
      'Jesus crucified and resurrected',
      'Early church began'
    ],
    people: ['Melchizedek', 'David', 'Solomon', 'Jesus', 'Peter', 'Paul'],
    elevation: 754,
    description: 'The holy city, center of Jewish faith and site of Jesus\' ministry'
  },
  {
    id: 'mount-sinai',
    name: 'Mount Sinai',
    altNames: ['Horeb', 'Mountain of God', 'Jebel Musa'],
    type: 'mountain',
    latitude: 28.5392,
    longitude: 33.9752,
    modernCountry: 'Egypt',
    region: 'Sinai Peninsula',
    historicalNames: [
      { name: 'סִינַי', language: 'hebrew', period: 'OT', strongsId: 'H5514' },
      { name: 'חֹרֵב', language: 'hebrew', period: 'OT', strongsId: 'H2722' },
      { name: 'Mount Sinai', language: 'english', period: 'Modern' }
    ],
    appearances: [
      {
        period: 'Exodus',
        description: 'Sacred mountain where God gave the Law to Moses',
        significance: 'Site of the covenant between God and Israel',
        population: 0
      }
    ],
    firstMention: { book: 'Exodus', chapter: 19, verse: 2 },
    significance: 'Where God gave Moses the Ten Commandments',
    events: [
      'God gave the Ten Commandments',
      'Golden calf incident',
      'Elijah fled here from Jezebel'
    ],
    people: ['Moses', 'Aaron', 'Joshua', 'Elijah'],
    elevation: 2285,
    description: 'Sacred mountain where the Law was given'
  }
];

function buildPlacesPack() {
  console.log('📍 Building Biblical Places Pack...\n');
  
  // Ensure packs directory exists
  if (!existsSync('packs')) {
    mkdirSync('packs', { recursive: true });
  }
  
  const db = new Database(PACK_OUTPUT);
  
  // Create schema
  console.log('Creating schema...');
  db.exec(`
    -- Pack metadata
    CREATE TABLE IF NOT EXISTS metadata (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    
    -- Places
    CREATE TABLE IF NOT EXISTS places (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      alt_names TEXT,
      type TEXT,
      latitude REAL,
      longitude REAL,
      modern_city TEXT,
      modern_country TEXT,
      region TEXT,
      historical_names TEXT,
      appearances TEXT,
      verses TEXT,
      first_mention TEXT,
      significance TEXT,
      events TEXT,
      people TEXT,
      elevation INTEGER,
      description TEXT
    );
    
    CREATE INDEX IF NOT EXISTS idx_places_name ON places(name);
    CREATE INDEX IF NOT EXISTS idx_places_type ON places(type);
    CREATE INDEX IF NOT EXISTS idx_places_region ON places(region);
    CREATE INDEX IF NOT EXISTS idx_places_country ON places(modern_country);
    
    -- Place name links (for word -> place entity mapping)
    CREATE TABLE IF NOT EXISTS place_name_links (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      word TEXT NOT NULL,
      normalized_word TEXT NOT NULL,
      place_id TEXT NOT NULL,
      language TEXT NOT NULL,
      strongs_id TEXT,
      FOREIGN KEY (place_id) REFERENCES places(id)
    );
    
    CREATE INDEX IF NOT EXISTS idx_links_normalized ON place_name_links(normalized_word);
    CREATE INDEX IF NOT EXISTS idx_links_place ON place_name_links(place_id);
    CREATE INDEX IF NOT EXISTS idx_links_strongs ON place_name_links(strongs_id);
  `);
  
  // Insert metadata
  const insertMeta = db.prepare('INSERT OR REPLACE INTO metadata (key, value) VALUES (?, ?)');
  insertMeta.run('packId', 'biblical-places-v1');
  insertMeta.run('packVersion', '1.0.0');
  insertMeta.run('packType', 'places');
  insertMeta.run('license', 'CC BY 4.0');
  insertMeta.run('attribution', 'OpenBible.info + custom curated data');
  insertMeta.run('description', 'Comprehensive biblical places with historical context');
  insertMeta.run('createdAt', new Date().toISOString());
  
  console.log('✅ Schema created\n');
  
  // Insert places
  console.log('Adding places...');
  const insertPlace = db.prepare(`
    INSERT OR REPLACE INTO places 
    (id, name, alt_names, type, latitude, longitude, modern_city, modern_country, region,
     historical_names, appearances, first_mention, significance, events, people, elevation, description)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  
  const insertLink = db.prepare(`
    INSERT INTO place_name_links (word, normalized_word, place_id, language, strongs_id)
    VALUES (?, ?, ?, ?, ?)
  `);
  
  for (const place of SAMPLE_PLACES) {
    // Insert place
    insertPlace.run(
      place.id,
      place.name,
      JSON.stringify(place.altNames || []),
      place.type,
      place.latitude,
      place.longitude,
      place.modernCity,
      place.modernCountry,
      place.region,
      JSON.stringify(place.historicalNames || []),
      JSON.stringify(place.appearances || []),
      JSON.stringify(place.firstMention),
      place.significance,
      JSON.stringify(place.events || []),
      JSON.stringify(place.people || []),
      place.elevation,
      place.description
    );
    
    // Create name links for fast lookups
    // Main name
    insertLink.run(place.name, place.name.toLowerCase(), place.id, 'english', null);
    
    // Alternate names
    if (place.altNames) {
      for (const altName of place.altNames) {
        insertLink.run(altName, altName.toLowerCase(), place.id, 'english', null);
      }
    }
    
    // Historical names
    if (place.historicalNames) {
      for (const hist of place.historicalNames) {
        insertLink.run(
          hist.name,
          hist.name.toLowerCase(),
          place.id,
          hist.language,
          hist.strongsId || null
        );
      }
    }
    
    console.log(`  ✅ ${place.name}`);
  }
  
  // Summary
  const placeCount = db.prepare('SELECT COUNT(*) as count FROM places').get();
  const linkCount = db.prepare('SELECT COUNT(*) as count FROM place_name_links').get();
  const dbSize = db.prepare("SELECT page_count * page_size as size FROM pragma_page_count(), pragma_page_size()").get();
  
  console.log(`\n📊 Pack Summary:`);
  console.log(`   Places: ${placeCount.count}`);
  console.log(`   Name links: ${linkCount.count}`);
  console.log(`   Size: ${(dbSize.size / 1024).toFixed(1)} KB`);
  console.log(`   Output: ${PACK_OUTPUT}`);
  
  db.close();
  
  console.log('\n✅ Places pack built successfully!');
  console.log('\n💡 Next steps:');
  console.log('   1. Import pack into PWA');
  console.log('   2. Test place lookups by name');
  console.log('   3. Test clicking place names in Bible text');
  console.log('   4. Add more places from OpenBible.info data\n');
}

buildPlacesPack();
