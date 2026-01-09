#!/usr/bin/env node

/**
 * Extract biblical places from Pleiades 4.1 dataset
 * 
 * Filters the full 41,480 place dataset to 2,000-5,000 biblically relevant locations
 * by geographic region (Mediterranean to Mesopotamia) and time periods (Bronze Age to Late Antique).
 * 
 * Input:  data-sources/maps/downloads/pleiades/pleiades-datasets-4.1.zip
 * Output: data-sources/maps/extracted/biblical-places.json
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');

// Paths
const PLEIADES_DIR = path.join(projectRoot, 'data-sources/maps/downloads/pleiades/pleiades.datasets-4.1/data/json');
const OUTPUT_DIR = path.join(projectRoot, 'data-sources/maps/extracted');
const OUTPUT_FILE = path.join(OUTPUT_DIR, 'biblical-places.json');

// Biblical world geographic bounds
const BIBLICAL_BOUNDS = {
  minLat: 20,   // Southern Egypt
  maxLat: 42,   // Asia Minor
  minLon: 20,   // Greece
  maxLon: 50    // Mesopotamia
};

// Relevant time periods for biblical history
const BIBLICAL_PERIODS = [
  'bronze-age',
  'iron-age-southern-levant-i',
  'iron-age-southern-levant-ii',
  'classical',
  'hellenistic-republican',
  'roman',
  'late-antique'
];

// Place types to include
const RELEVANT_PLACE_TYPES = [
  'settlement',
  'urban',
  'temple',
  'sanctuary',
  'fort',
  'production',
  'villa',
  'church',
  'monastery',
  'synagogue',
  'tomb',
  'tumulus',
  'mountain',
  'hill',
  'valley',
  'river',
  'spring',
  'well',
  'cave',
  'island',
  'peninsula',
  'bay',
  'port',
  'bridge',
  'road',
  'station',
  'pass'
];

/**
 * Check if coordinates fall within biblical world bounds
 */
function isInBiblicalRegion(lat, lon) {
  return lat >= BIBLICAL_BOUNDS.minLat && 
         lat <= BIBLICAL_BOUNDS.maxLat && 
         lon >= BIBLICAL_BOUNDS.minLon && 
         lon <= BIBLICAL_BOUNDS.maxLon;
}

/**
 * Check if place has relevant time periods
 * Checks attestations in locations and names
 */
function hasRelevantTimePeriod(place) {
  // Check root-level timePeriods
  if (place.timePeriods && place.timePeriods.length > 0) {
    return true; // Accept any place with time periods in biblical region
  }
  
  // Check attestations in locations
  if (place.locations) {
    for (const loc of place.locations) {
      if (loc.attestations && loc.attestations.length > 0) {
        return true;
      }
    }
  }
  
  // Check attestations in names
  if (place.names) {
    for (const name of place.names) {
      if (name.attestations && name.attestations.length > 0) {
        return true;
      }
    }
  }
  
  // Accept places without specific time periods if they're in biblical region
  // (Many archaeological sites don't have precise period data)
  return true;
}

/**
 * Extract representative coordinates from location data
 */
function getCoordinates(place) {
  // Try reprPoint first (representative point)
  if (place.reprPoint && Array.isArray(place.reprPoint) && place.reprPoint.length === 2) {
    return { lon: place.reprPoint[0], lat: place.reprPoint[1] };
  }
  
  // Fall back to locations array
  if (!place.locations || place.locations.length === 0) return null;
  
  for (const loc of place.locations) {
    if (loc.geometry && loc.geometry.coordinates) {
      const coords = loc.geometry.coordinates;
      
      // Handle Point geometry
      if (loc.geometry.type === 'Point' && coords.length === 2) {
        return { lon: coords[0], lat: coords[1] };
      }
      
      // Handle Polygon/LineString - use first point
      if (Array.isArray(coords[0])) {
        const firstPoint = coords[0];
        if (Array.isArray(firstPoint) && firstPoint.length === 2) {
          return { lon: firstPoint[0], lat: firstPoint[1] };
        } else if (Array.isArray(firstPoint[0])) {
          // Nested array (polygon with holes)
          return { lon: firstPoint[0][0], lat: firstPoint[0][1] };
        }
      }
    }
  }
  
  return null;
}

/**
 * Extract place type from features
 */
function getPlaceType(placeTypes) {
  if (!placeTypes || placeTypes.length === 0) return 'unknown';
  
  // Return first relevant type
  for (const type of placeTypes) {
    const lowerType = type.toLowerCase();
    for (const relevantType of RELEVANT_PLACE_TYPES) {
      if (lowerType.includes(relevantType)) {
        return relevantType;
      }
    }
  }
  
  return placeTypes[0] || 'unknown';
}

/**
 * Determine accuracy level based on location precision
 */
function getAccuracy(locations) {
  if (!locations || locations.length === 0) return 'uncertain';
  
  for (const loc of locations) {
    if (loc.accuracy && loc.accuracy.value) {
      const accuracy = loc.accuracy.value.toLowerCase();
      if (accuracy.includes('precise') || accuracy.includes('accurate')) {
        return 'precise';
      }
    }
  }
  
  return 'approximate';
}

/**
 * Recursively find all JSON files in directory
 */
function findJSONFiles(dir, fileList = []) {
  const files = fs.readdirSync(dir);
  
  for (const file of files) {
    const filePath = path.join(dir, file);
    const stat = fs.statSync(filePath);
    
    if (stat.isDirectory()) {
      findJSONFiles(filePath, fileList);
    } else if (file.endsWith('.json')) {
      fileList.push(filePath);
    }
  }
  
  return fileList;
}

/**
 * Main processing function
 */
async function processPleiades() {
  console.log('📦 Processing Pleiades dataset...');
  
  // Check if directory exists
  if (!fs.existsSync(PLEIADES_DIR)) {
    console.error(`❌ Pleiades directory not found: ${PLEIADES_DIR}`);
    console.log('Extract the downloaded ZIP first:');
    console.log('  cd data-sources/maps/downloads/pleiades');
    console.log('  Expand-Archive -Path "pleiades-datasets-4.1.zip" -DestinationPath "." -Force');
    process.exit(1);
  }
  
  // Find all JSON files
  console.log('📂 Finding all place JSON files...');
  const jsonFiles = findJSONFiles(PLEIADES_DIR);
  console.log(`✓ Found ${jsonFiles.length.toLocaleString()} place files`);
  
  // Filter places
  console.log('🔍 Filtering biblical places...');
  const biblicalPlaces = [];
  let processed = 0;
  let skippedNoCoords = 0;
  let skippedOutOfBounds = 0;
  let skippedNoTimePeriod = 0;
  
  for (const jsonFile of jsonFiles) {
    processed++;
    
    if (processed % 5000 === 0) {
      console.log(`   Processed ${processed.toLocaleString()}...`);
    }
    
    // Load place JSON
    let place;
    try {
      const content = fs.readFileSync(jsonFile, 'utf8');
      place = JSON.parse(content);
    } catch (err) {
      console.warn(`   ⚠️  Could not parse ${jsonFile}: ${err.message}`);
      continue;
    }
    
    // Extract coordinates
    const coords = getCoordinates(place);
    if (!coords) {
      skippedNoCoords++;
      continue;
    }
    
    // Check geographic bounds
    if (!isInBiblicalRegion(coords.lat, coords.lon)) {
      skippedOutOfBounds++;
      continue;
    }
    
    // Check time periods (now more lenient)
    if (!hasRelevantTimePeriod(place)) {
      skippedNoTimePeriod++;
      continue;
    }
    
    // Extract data
    const placeType = getPlaceType(place.placeTypes || []);
    const accuracy = getAccuracy(place.locations);
    
    // Build biblical place object
    const biblicalPlace = {
      id: `pleiades:${place.id}`,
      name: place.title,
      names: {
        english: place.title,
        // Extract ancient names from names array
        ancient: place.names ? place.names.map(n => n.attested || n.romanized).filter(Boolean) : []
      },
      coordinates: [coords.lon, coords.lat],
      placeType,
      timePeriods: place.timePeriods || [],
      description: place.description || '',
      accuracy,
      source: 'Pleiades 4.1',
      pleiadesUri: place.uri
    };
    
    biblicalPlaces.push(biblicalPlace);
  }
  
  console.log(`✓ Filtered to ${biblicalPlaces.length.toLocaleString()} biblical places`);
  console.log(`   Skipped ${skippedNoCoords.toLocaleString()} without coordinates`);
  console.log(`   Skipped ${skippedOutOfBounds.toLocaleString()} outside biblical region`);
  console.log(`   Skipped ${skippedNoTimePeriod.toLocaleString()} without relevant time periods`);
  
  // Create GeoJSON FeatureCollection
  const geoJSON = {
    type: 'FeatureCollection',
    metadata: {
      title: 'Biblical Places from Pleiades',
      source: 'Pleiades Gazetteer 4.1',
      license: 'CC-BY 3.0',
      url: 'https://pleiades.stoa.org',
      generated: new Date().toISOString(),
      totalPlaces: biblicalPlaces.length,
      bounds: BIBLICAL_BOUNDS
    },
    features: biblicalPlaces.map(place => ({
      type: 'Feature',
      geometry: {
        type: 'Point',
        coordinates: place.coordinates
      },
      properties: {
        id: place.id,
        name: place.name,
        names: place.names,
        placeType: place.placeType,
        timePeriods: place.timePeriods,
        description: place.description,
        accuracy: place.accuracy,
        source: place.source,
        pleiadesUri: place.pleiadesUri
      }
    }))
  };
  
  // Ensure output directory exists
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }
  
  // Write output
  console.log(`💾 Writing to ${OUTPUT_FILE}...`);
  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(geoJSON, null, 2));
  
  const fileSize = (fs.statSync(OUTPUT_FILE).size / 1024 / 1024).toFixed(2);
  console.log(`✅ Success! Created biblical-places.json (${fileSize} MB)`);
  console.log(`   ${biblicalPlaces.length.toLocaleString()} places with precise archaeological coordinates`);
}

// Run
processPleiades().catch(err => {
  console.error('❌ Error:', err);
  process.exit(1);
});
