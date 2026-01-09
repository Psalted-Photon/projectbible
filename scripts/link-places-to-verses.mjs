#!/usr/bin/env node

/**
 * Link biblical places to specific verse references
 * 
 * Creates comprehensive verse-to-place correlations by:
 * 1. Loading all Bible text from existing packs
 * 2. Matching place names in verses to Pleiades coordinates
 * 3. Building bidirectional index (place→verses and verse→places)
 * 
 * This enables clicking any place name in a verse to show it on the map.
 * 
 * Input:  data-sources/maps/extracted/biblical-places.json + Bible packs
 * Output: data-sources/maps/extracted/place-verse-links.json
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import Database from 'better-sqlite3';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');

const PLACES_FILE = path.join(projectRoot, 'data-sources/maps/extracted/biblical-places.json');
const OUTPUT_DIR = path.join(projectRoot, 'data-sources/maps/extracted');
const OUTPUT_FILE = path.join(OUTPUT_DIR, 'place-verse-links.json');
const PACKS_DIR = path.join(projectRoot, 'packs');

// Common place names that appear in the Bible
// We'll match these against both Pleiades data and Bible text
const KNOWN_BIBLICAL_PLACES = [
  'Jerusalem', 'Bethlehem', 'Nazareth', 'Capernaum', 'Jericho', 'Babylon',
  'Egypt', 'Damascus', 'Tyre', 'Sidon', 'Samaria', 'Galilee', 'Judea',
  'Rome', 'Athens', 'Corinth', 'Ephesus', 'Antioch', 'Thessalonica',
  'Philippi', 'Cyprus', 'Crete', 'Macedonia', 'Achaia', 'Asia',
  'Bethany', 'Bethsaida', 'Cana', 'Emmaus', 'Gethsemane', 'Golgotha',
  'Jordan', 'Kidron', 'Nile', 'Euphrates', 'Tigris', 'Mediterranean',
  'Red Sea', 'Dead Sea', 'Sea of Galilee', 'Mount Sinai', 'Mount Zion',
  'Mount of Olives', 'Mount Carmel', 'Mount Tabor', 'Wilderness', 'Desert',
  'Beersheba', 'Hebron', 'Shechem', 'Shiloh', 'Bethel', 'Dan', 'Gaza',
  'Ashkelon', 'Ashdod', 'Ekron', 'Gath', 'Nineveh', 'Ur', 'Haran',
  'Sodom', 'Gomorrah', 'Zoar', 'Salem', 'Ai', 'Gibeon', 'Joppa',
  'Caesarea', 'Tiberias', 'Magdala', 'Chorazin', 'Decapolis', 'Perea',
  'Idumea', 'Phoenicia', 'Syria', 'Arabia', 'Mesopotamia', 'Canaan',
  'Israel', 'Judah', 'Benjamin', 'Ephraim', 'Manasseh', 'Reuben',
  'Moab', 'Edom', 'Ammon', 'Philistia', 'Aram', 'Assyria', 'Persia',
  'Greece', 'Spain', 'Libya', 'Ethiopia', 'Media', 'Elam', 'Tarshish'
];

/**
 * Load biblical places data
 */
function loadPlaces() {
  console.log('📂 Loading biblical places...');
  
  if (!fs.existsSync(PLACES_FILE)) {
    console.error(`❌ Places file not found: ${PLACES_FILE}`);
    console.log('Run: node scripts/process-pleiades-data.mjs');
    process.exit(1);
  }
  
  const data = JSON.parse(fs.readFileSync(PLACES_FILE, 'utf8'));
  console.log(`✓ Loaded ${data.features.length.toLocaleString()} places`);
  
  return data.features;
}

/**
 * Find Bible packs in packs directory
 */
function findBiblePacks() {
  if (!fs.existsSync(PACKS_DIR)) {
    console.warn('⚠️  No packs directory found');
    return [];
  }
  
  const packs = fs.readdirSync(PACKS_DIR)
    .filter(f => f.endsWith('.sqlite') && !f.includes('map') && !f.includes('places'))
    .map(f => path.join(PACKS_DIR, f));
  
  return packs;
}

/**
 * Extract all verse text from a Bible pack
 */
function getVersesFromPack(packPath) {
  try {
    const db = new Database(packPath, { readonly: true });
    
    // Check if pack has verses table
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
    const hasVerses = tables.some(t => t.name === 'verses');
    
    if (!hasVerses) {
      db.close();
      return [];
    }
    
    // Get all verses
    const verses = db.prepare('SELECT book, chapter, verse, text FROM verses').all();
    db.close();
    
    return verses;
  } catch (err) {
    console.warn(`   ⚠️  Could not read ${path.basename(packPath)}: ${err.message}`);
    return [];
  }
}

/**
 * Normalize place name for matching
 */
function normalizePlaceName(name) {
  return name
    .toLowerCase()
    .replace(/[''']/g, '') // Remove apostrophes
    .replace(/\s+/g, ' ')  // Normalize spaces
    .trim();
}

/**
 * Check if a place name is likely a real place (not a common word)
 */
function isLikelyPlaceName(name) {
  const lower = name.toLowerCase();
  
  // Filter out common words that are definitely not places
  const commonWords = [
    'this', 'that', 'these', 'those', 'same', 'side', 'say', 'sin',
    'for', 'from', 'with', 'into', 'upon', 'over', 'under', 'after',
    'before', 'while', 'during', 'through', 'by', 'at', 'on', 'in',
    'the', 'and', 'or', 'but', 'if', 'then', 'when', 'where', 'why',
    'who', 'what', 'which', 'how', 'all', 'some', 'any', 'many',
    'much', 'few', 'more', 'most', 'less', 'least', 'other', 'another',
    'each', 'every', 'both', 'either', 'neither', 'such', 'own',
    'very', 'just', 'only', 'also', 'even', 'still', 'yet', 'already',
    'soon', 'now', 'here', 'there', 'everywhere', 'nowhere', 'somewhere'
  ];
  
  if (commonWords.includes(lower)) return false;
  
  // Filter out very short names (< 3 chars) - too many false positives
  if (name.length < 3) return false;
  
  // Filter out names with question marks or slashes (uncertain names)
  if (name.includes('?') || name.includes('/')) return false;
  
  // Filter out archaeological survey areas and regions (not specific places)
  if (lower.includes('survey') || lower.includes('area')) return false;
  
  // Filter out names that are all lowercase (likely common words)
  // Real place names typically have capital letters
  if (name === lower) return false;
  
  // Must start with a capital letter
  if (!/^[A-Z]/.test(name)) return false;
  
  return true;
}

/**
 * Find place mentions in verse text
 */
function findPlacesInVerse(verseText, placeIndex) {
  const mentions = [];
  const normalizedText = normalizePlaceName(verseText);
  
  // Check each known place
  for (const [normalizedName, placeData] of placeIndex.entries()) {
    // Skip unlikely place names
    if (!isLikelyPlaceName(placeData.name)) continue;
    
    // Escape regex special characters
    const escaped = normalizedName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    
    // Simple word boundary check
    const regex = new RegExp(`\\b${escaped}\\b`, 'i');
    if (regex.test(normalizedText)) {
      mentions.push({
        placeName: placeData.name,
        placeId: placeData.id,
        coordinates: placeData.coordinates
      });
    }
  }
  
  return mentions;
}

/**
 * Build place name index for fast lookup
 */
function buildPlaceIndex(places) {
  const index = new Map();
  
  for (const place of places) {
    const props = place.properties;
    
    // Index by English name
    const normalizedName = normalizePlaceName(props.name);
    if (!index.has(normalizedName)) {
      index.set(normalizedName, {
        id: props.id,
        name: props.name,
        coordinates: place.geometry.coordinates
      });
    }
    
    // Index by ancient names
    if (props.names && props.names.ancient) {
      for (const ancientName of props.names.ancient) {
        if (ancientName) {
          const normalized = normalizePlaceName(ancientName);
          if (!index.has(normalized)) {
            index.set(normalized, {
              id: props.id,
              name: props.name,
              coordinates: place.geometry.coordinates
            });
          }
        }
      }
    }
  }
  
  console.log(`✓ Built index with ${index.size.toLocaleString()} searchable place names`);
  return index;
}

/**
 * Main linking function
 */
async function linkPlacesToVerses() {
  console.log('🔗 Linking places to verses...\n');
  
  // Load places
  const places = loadPlaces();
  const placeIndex = buildPlaceIndex(places);
  
  // Find Bible packs
  console.log('📂 Searching for Bible packs...');
  const packs = findBiblePacks();
  
  if (packs.length === 0) {
    console.warn('⚠️  No Bible packs found. Creating place index only.');
    console.log('Build Bible packs with: npm run build:kjv');
  } else {
    console.log(`✓ Found ${packs.length} pack(s): ${packs.map(p => path.basename(p)).join(', ')}\n`);
  }
  
  // Process verses from all packs
  const verseToPlaces = new Map(); // "Gen.1.1" → [placeIds]
  const placeToVerses = new Map(); // placeId → [verses]
  let totalVerses = 0;
  let versesWithPlaces = 0;
  
  for (const packPath of packs) {
    console.log(`📖 Processing ${path.basename(packPath)}...`);
    const verses = getVersesFromPack(packPath);
    
    if (verses.length === 0) continue;
    
    totalVerses += verses.length;
    let packMatches = 0;
    
    for (const verse of verses) {
      const verseRef = `${verse.book}.${verse.chapter}.${verse.verse}`;
      const placeMentions = findPlacesInVerse(verse.text, placeIndex);
      
      if (placeMentions.length > 0) {
        // Store verse → places mapping
        if (!verseToPlaces.has(verseRef)) {
          verseToPlaces.set(verseRef, []);
          versesWithPlaces++;
        }
        
        for (const mention of placeMentions) {
          verseToPlaces.get(verseRef).push(mention.placeId);
          
          // Store place → verses mapping
          if (!placeToVerses.has(mention.placeId)) {
            placeToVerses.set(mention.placeId, []);
          }
          placeToVerses.get(mention.placeId).push(verseRef);
          
          packMatches++;
        }
      }
    }
    
    console.log(`   ✓ Found ${packMatches.toLocaleString()} place mentions in ${verses.length.toLocaleString()} verses`);
  }
  
  console.log(`\n✓ Total: ${versesWithPlaces.toLocaleString()} verses mention places (${totalVerses.toLocaleString()} total verses)`);
  console.log(`✓ ${placeToVerses.size.toLocaleString()} unique places referenced in Scripture`);
  
  // Build output structure
  const output = {
    metadata: {
      title: 'Place-Verse Correlations',
      description: 'Bidirectional links between Bible verses and geographic locations',
      generated: new Date().toISOString(),
      totalPlaces: places.length,
      placesReferencedInBible: placeToVerses.size,
      totalVerses: totalVerses,
      versesWithPlaces: versesWithPlaces,
      sourcePacks: packs.map(p => path.basename(p))
    },
    
    // Verse → Places index
    verseToPlaces: Object.fromEntries(
      Array.from(verseToPlaces.entries()).map(([verse, placeIds]) => [
        verse,
        [...new Set(placeIds)] // Remove duplicates
      ])
    ),
    
    // Place → Verses index
    placeToVerses: Object.fromEntries(
      Array.from(placeToVerses.entries()).map(([placeId, verses]) => [
        placeId,
        [...new Set(verses)] // Remove duplicates
      ])
    ),
    
    // Place metadata for quick lookup
    placeMetadata: Object.fromEntries(
      places.map(p => [
        p.properties.id,
        {
          name: p.properties.name,
          coordinates: p.geometry.coordinates,
          type: p.properties.placeType,
          modernName: p.properties.modernName
        }
      ])
    )
  };
  
  // Write output
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }
  
  console.log(`\n💾 Writing to ${OUTPUT_FILE}...`);
  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(output, null, 2));
  
  const fileSize = (fs.statSync(OUTPUT_FILE).size / 1024 / 1024).toFixed(2);
  console.log(`✅ Success! Created place-verse-links.json (${fileSize} MB)`);
  console.log(`\n📊 Statistics:`);
  console.log(`   ${versesWithPlaces.toLocaleString()} verses → ${placeToVerses.size.toLocaleString()} places`);
  console.log(`   ${placeToVerses.size.toLocaleString()} places → ${versesWithPlaces.toLocaleString()} verses`);
  console.log(`\n   This enables clicking any place name to show its location on the map! 🗺️`);
}

// Run
linkPlacesToVerses().catch(err => {
  console.error('❌ Error:', err);
  process.exit(1);
});
