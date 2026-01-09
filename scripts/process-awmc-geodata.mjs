#!/usr/bin/env node

/**
 * Process AWMC geodata shapefiles to GeoJSON
 * 
 * Converts Ancient World Mapping Center geographic features (coastlines, rivers, roads)
 * from shapefiles to GeoJSON format for use in biblical maps.
 * 
 * Input:  data-sources/maps/downloads/awmc/geodata/
 * Output: data-sources/maps/extracted/awmc-*.geojson
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');

// Paths
const AWMC_DIR = path.join(projectRoot, 'data-sources/maps/downloads/awmc/geodata');
const OUTPUT_DIR = path.join(projectRoot, 'data-sources/maps/extracted');

// Biblical world bounds (for clipping)
const BIBLICAL_BOUNDS = {
  minLat: 20,
  maxLat: 42,
  minLon: 20,
  maxLon: 50
};

/**
 * Find shapefile directories in AWMC geodata
 */
function findShapefiles() {
  if (!fs.existsSync(AWMC_DIR)) {
    console.error(`❌ AWMC directory not found: ${AWMC_DIR}`);
    console.log('Clone the AWMC geodata repository first:');
    console.log('  cd data-sources/maps/downloads/awmc');
    console.log('  git clone https://github.com/AWMC/geodata.git');
    process.exit(1);
  }
  
  const shapefiles = [];
  const features = [
    { name: 'coastlines', pattern: /coast/i },
    { name: 'rivers', pattern: /river/i },
    { name: 'roads', pattern: /road/i },
    { name: 'islands', pattern: /island/i }
  ];
  
  function searchDir(dir) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      
      if (entry.isDirectory()) {
        searchDir(fullPath);
      } else if (entry.name.endsWith('.shp')) {
        // Determine feature type
        for (const feature of features) {
          if (feature.pattern.test(entry.name)) {
            shapefiles.push({
              type: feature.name,
              path: fullPath,
              name: entry.name
            });
            break;
          }
        }
      }
    }
  }
  
  searchDir(AWMC_DIR);
  return shapefiles;
}

/**
 * Convert shapefile to GeoJSON using ogr2ogr (GDAL)
 * Falls back to creating placeholder if ogr2ogr not available
 */
async function convertToGeoJSON(shapefile) {
  const outputFile = path.join(OUTPUT_DIR, `awmc-${shapefile.type}.geojson`);
  
  console.log(`   Converting ${shapefile.name}...`);
  
  try {
    // Try using ogr2ogr (part of GDAL)
    const cmd = `ogr2ogr -f GeoJSON "${outputFile}" "${shapefile.path}" -clipdst ${BIBLICAL_BOUNDS.minLon} ${BIBLICAL_BOUNDS.minLat} ${BIBLICAL_BOUNDS.maxLon} ${BIBLICAL_BOUNDS.maxLat}`;
    await execAsync(cmd);
    console.log(`   ✓ Created ${path.basename(outputFile)}`);
    return true;
  } catch (err) {
    // GDAL not available - create placeholder
    console.warn(`   ⚠️  ogr2ogr not available, creating placeholder`);
    console.warn(`   Install GDAL to process shapefiles: https://gdal.org/download.html`);
    
    const placeholder = {
      type: 'FeatureCollection',
      metadata: {
        title: `AWMC ${shapefile.type} (Placeholder)`,
        source: 'AWMC Geodata',
        license: 'ODbL-1.0',
        note: 'This is a placeholder. Install GDAL/ogr2ogr to process actual shapefiles.',
        originalFile: shapefile.name
      },
      features: []
    };
    
    fs.writeFileSync(outputFile, JSON.stringify(placeholder, null, 2));
    console.log(`   ✓ Created placeholder ${path.basename(outputFile)}`);
    return false;
  }
}

/**
 * Main processing function
 */
async function processAWMC() {
  console.log('📦 Processing AWMC Geodata...');
  
  // Find shapefiles
  console.log('📂 Searching for shapefiles...');
  const shapefiles = findShapefiles();
  
  if (shapefiles.length === 0) {
    console.warn('⚠️  No relevant shapefiles found');
    console.log('AWMC geodata may not contain expected files.');
    process.exit(0);
  }
  
  console.log(`✓ Found ${shapefiles.length} shapefiles:`);
  shapefiles.forEach(sf => console.log(`   - ${sf.type}: ${sf.name}`));
  
  // Ensure output directory exists
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }
  
  // Convert each shapefile
  console.log('\n🔄 Converting to GeoJSON...');
  let converted = 0;
  let placeholders = 0;
  
  for (const shapefile of shapefiles) {
    const success = await convertToGeoJSON(shapefile);
    if (success) {
      converted++;
    } else {
      placeholders++;
    }
  }
  
  console.log(`\n✅ Conversion complete!`);
  console.log(`   ${converted} shapefiles converted`);
  if (placeholders > 0) {
    console.log(`   ${placeholders} placeholders created (install GDAL to process)`);
  }
  
  // List output files
  const outputs = fs.readdirSync(OUTPUT_DIR).filter(f => f.startsWith('awmc-') && f.endsWith('.geojson'));
  console.log(`\n📁 Output files in ${OUTPUT_DIR}:`);
  outputs.forEach(file => {
    const size = (fs.statSync(path.join(OUTPUT_DIR, file)).size / 1024).toFixed(2);
    console.log(`   - ${file} (${size} KB)`);
  });
}

// Run
processAWMC().catch(err => {
  console.error('❌ Error:', err);
  process.exit(1);
});
