/**
 * Build Cross-References Pack
 * Creates a SQLite database with cross-reference data
 */

import { createRequire } from 'module';
import { mkdirSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const require = createRequire(import.meta.url);
const Database = require('better-sqlite3');

console.log('Starting cross-references builder...');

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const OUTPUT_DIR = join(__dirname, '../packs');
const OUTPUT_FILE = join(OUTPUT_DIR, 'cross-references.sqlite');

// Curated cross-references from well-known biblical connections
const CURATED_CROSS_REFERENCES = [
  // Creation narratives
  { from: 'Genesis 1:1', to: 'John 1:1', description: 'In the beginning - Creation' },
  { from: 'Genesis 1:1', to: 'John 1:3', description: 'Creation through the Word' },
  { from: 'Genesis 1:26', to: 'John 1:14', description: 'Image of God - Word made flesh' },
  
  // God's love and salvation
  { from: 'John 3:16', to: 'Romans 5:8', description: 'God demonstrates his love' },
  { from: 'John 3:16', to: '1 John 4:9', description: 'God sent his Son' },
  { from: 'John 3:16', to: '1 John 4:10', description: 'Propitiation for sins' },
  
  // Greatest commandments
  { from: 'Matthew 22:37', to: 'Deuteronomy 6:5', description: 'Love the LORD' },
  { from: 'Matthew 22:39', to: 'Leviticus 19:18', description: 'Love your neighbor' },
  { from: 'Mark 12:29-31', to: 'Deuteronomy 6:4-5', description: 'Shema Israel' },
  
  // Messianic prophecies
  { from: 'Isaiah 7:14', to: 'Matthew 1:23', description: 'Virgin birth prophecy' },
  { from: 'Isaiah 9:6', to: 'Luke 2:11', description: 'Child born - Mighty God' },
  { from: 'Isaiah 53:5', to: '1 Peter 2:24', description: 'By his wounds' },
  { from: 'Psalm 22:1', to: 'Matthew 27:46', description: 'My God, why forsaken' },
  { from: 'Psalm 22:16', to: 'John 20:25', description: 'Pierced hands and feet' },
  { from: 'Psalm 22:18', to: 'Matthew 27:35', description: 'Cast lots for garments' },
  
  // The Word
  { from: 'John 1:1', to: 'Genesis 1:1', description: 'In the beginning' },
  { from: 'John 1:14', to: 'Isaiah 40:5', description: 'Glory of the LORD revealed' },
  
  // Faith and righteousness
  { from: 'Romans 1:17', to: 'Habakkuk 2:4', description: 'The righteous shall live by faith' },
  { from: 'Romans 4:3', to: 'Genesis 15:6', description: 'Abraham believed God' },
  { from: 'Galatians 3:6', to: 'Genesis 15:6', description: 'Faith credited as righteousness' },
  
  // Resurrection
  { from: '1 Corinthians 15:4', to: 'Psalm 16:10', description: 'Not abandon to the grave' },
  { from: '1 Corinthians 15:4', to: 'Hosea 6:2', description: 'Raised on the third day' },
  
  // New covenant
  { from: 'Hebrews 8:8', to: 'Jeremiah 31:31', description: 'New covenant promised' },
  { from: '1 Corinthians 11:25', to: 'Jeremiah 31:31', description: 'New covenant in my blood' },
  
  // The Law
  { from: 'Matthew 5:17', to: 'Deuteronomy 18:18', description: 'Fulfill the Law' },
  { from: 'Romans 3:20', to: 'Galatians 2:16', description: 'Not justified by works of law' },
  
  // Salvation
  { from: 'Acts 4:12', to: 'Joel 2:32', description: 'No other name for salvation' },
  { from: 'Romans 10:13', to: 'Joel 2:32', description: 'Everyone who calls on the name' },
  { from: 'Ephesians 2:8-9', to: 'Titus 3:5', description: 'Saved by grace through faith' },
  
  // Second coming
  { from: 'Matthew 24:30', to: 'Daniel 7:13', description: 'Son of Man coming on clouds' },
  { from: 'Revelation 1:7', to: 'Daniel 7:13', description: 'Coming with the clouds' },
  { from: '1 Thessalonians 4:16', to: 'Daniel 12:2', description: 'Resurrection of the dead' },
  
  // Suffering servant
  { from: 'Matthew 8:17', to: 'Isaiah 53:4', description: 'Took our infirmities' },
  { from: 'Acts 8:32-33', to: 'Isaiah 53:7-8', description: 'Led like sheep to slaughter' },
  { from: '1 Peter 2:22', to: 'Isaiah 53:9', description: 'No deceit in his mouth' },
  
  // The stone
  { from: 'Matthew 21:42', to: 'Psalm 118:22', description: 'Stone the builders rejected' },
  { from: '1 Peter 2:7', to: 'Psalm 118:22', description: 'Cornerstone' },
  { from: 'Acts 4:11', to: 'Psalm 118:22', description: 'Chief cornerstone' },
];

// Parse reference string like "Genesis 1:1" to components
function parseReference(ref) {
  // Handle "1 Corinthians" style names
  const match = ref.match(/^(\d?\s?[A-Za-z]+)\s+(\d+):(\d+)(?:-(\d+))?$/);
  if (!match) {
    throw new Error(`Invalid reference format: ${ref}`);
  }
  
  const [_, book, chapter, verseStart, verseEnd] = match;
  return {
    book: book.trim(),
    chapter: parseInt(chapter),
    verse_start: parseInt(verseStart),
    verse_end: verseEnd ? parseInt(verseEnd) : parseInt(verseStart)
  };
}

// Create cross-references database
function buildCrossReferencesDatabase() {
  // Ensure output directory exists
  if (!existsSync(OUTPUT_DIR)) {
    mkdirSync(OUTPUT_DIR, { recursive: true });
  }
  
  console.log(`Creating cross-references database at ${OUTPUT_FILE}...`);
  
  const db = new Database(OUTPUT_FILE);
  
  // Create schema
  db.exec(`
    CREATE TABLE IF NOT EXISTS metadata (
      key TEXT PRIMARY KEY,
      value TEXT
    );
    
    CREATE TABLE IF NOT EXISTS cross_references (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      from_book TEXT NOT NULL,
      from_chapter INTEGER NOT NULL,
      from_verse INTEGER NOT NULL,
      to_book TEXT NOT NULL,
      to_chapter INTEGER NOT NULL,
      to_verse_start INTEGER NOT NULL,
      to_verse_end INTEGER,
      votes INTEGER DEFAULT 0,
      source TEXT DEFAULT 'curated',
      description TEXT,
      UNIQUE(from_book, from_chapter, from_verse, to_book, to_chapter, to_verse_start, to_verse_end)
    );
    
    CREATE INDEX IF NOT EXISTS idx_cross_refs_from 
      ON cross_references(from_book, from_chapter, from_verse);
    
    CREATE INDEX IF NOT EXISTS idx_cross_refs_to 
      ON cross_references(to_book, to_chapter, to_verse_start);
  `);
  
  // Insert metadata
  const insertMetadata = db.prepare('INSERT OR REPLACE INTO metadata (key, value) VALUES (?, ?)');
  insertMetadata.run('pack_id', 'cross-references');
  insertMetadata.run('type', 'cross-references');
  insertMetadata.run('name', 'Bible Cross-References');
  insertMetadata.run('version', '1.0.0');
  insertMetadata.run('description', 'Curated cross-references between Bible verses');
  insertMetadata.run('source', 'Curated from well-known biblical cross-references');
  insertMetadata.run('license', 'Public Domain');
  insertMetadata.run('created', new Date().toISOString());
  insertMetadata.run('entry_count', CURATED_CROSS_REFERENCES.length.toString());
  
  // Insert cross-references
  const insertRef = db.prepare(`
    INSERT OR IGNORE INTO cross_references 
    (from_book, from_chapter, from_verse, to_book, to_chapter, to_verse_start, to_verse_end, source, description)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  
  const insertMany = db.transaction((refs) => {
    for (const ref of refs) {
      try {
        const from = parseReference(ref.from);
        const to = parseReference(ref.to);
        
        // Insert forward reference
        insertRef.run(
          from.book,
          from.chapter,
          from.verse_start,
          to.book,
          to.chapter,
          to.verse_start,
          to.verse_end,
          'curated',
          ref.description
        );
        
        // Insert backward reference for bidirectional navigation
        insertRef.run(
          to.book,
          to.chapter,
          to.verse_start,
          from.book,
          from.chapter,
          from.verse_start,
          from.verse_end,
          'curated',
          ref.description + ' (reverse)'
        );
      } catch (error) {
        console.error(`Error parsing reference: ${ref.from} -> ${ref.to}`, error.message);
      }
    }
  });
  
  insertMany(CURATED_CROSS_REFERENCES);
  
  // Get statistics
  const stats = db.prepare('SELECT COUNT(*) as count FROM cross_references').get();
  
  db.close();
  
  console.log(`✅ Created cross-references database`);
  console.log(`   ${stats.count} cross-reference entries`);
  console.log(`   ${CURATED_CROSS_REFERENCES.length} source references (bidirectional)`);
  console.log(`   📄 ${OUTPUT_FILE}`);
}

// Run if called directly
buildCrossReferencesDatabase();

export { buildCrossReferencesDatabase };
