/**
 * Fix missing metadata in existing packs
 */

import Database from 'better-sqlite3';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { readdirSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const packsDir = join(__dirname, '..', 'packs');

const fixes = {
  'byz-full.sqlite': {
    pack_id: 'byz-full',
    translation_id: 'BYZ',
    translation_name: 'Byzantine Majority Text'
  },
  'web.sqlite': {
    version: '1.0.0'
  },
  'tr-full.sqlite': {
    pack_id: 'tr-full',
    translation_id: 'TR',
    translation_name: 'Textus Receptus'
  },
  'lxx-greek.sqlite': {
    pack_id: 'lxx-greek',
    type: 'original-language',
    translation_id: 'LXX',
    translation_name: 'Septuagint (Greek)',
    version: '1.0.0'
  },
  'maps-biblical.sqlite': {
    pack_id: 'maps-biblical',
    type: 'map',
    version: '1.0.0'
  },
  'maps.sqlite': {
    pack_id: 'maps',
    type: 'map',
    version: '1.0.0'
  },
  'places-biblical.sqlite': {
    pack_id: 'places-biblical',
    type: 'places',
    version: '1.0.0'
  },
  'places.sqlite': {
    pack_id: 'places',
    type: 'places',
    version: '1.0.0'
  }
};

console.log('🔧 Fixing pack metadata...\n');

for (const [filename, metadata] of Object.entries(fixes)) {
  const packPath = join(packsDir, filename);
  
  try {
    const db = new Database(packPath);
    
    // Check if metadata table exists
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='metadata'").all();
    
    if (tables.length === 0) {
      console.log(`⚠️  ${filename}: No metadata table, creating one...`);
      db.exec(`
        CREATE TABLE metadata (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL
        );
      `);
    }
    
    // Insert or update metadata
    const insertMeta = db.prepare('INSERT OR REPLACE INTO metadata (key, value) VALUES (?, ?)');
    
    for (const [key, value] of Object.entries(metadata)) {
      insertMeta.run(key, value);
    }
    
    console.log(`✅ ${filename}: ${Object.keys(metadata).join(', ')}`);
    
    db.close();
  } catch (error) {
    console.error(`❌ ${filename}: ${error.message}`);
  }
}

console.log('\n✅ Pack metadata fixes complete!');
