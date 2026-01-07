import { readFileSync, writeFileSync } from 'fs';
import { resolve, basename } from 'path';
import Database from 'better-sqlite3';
import { SourceManifest, VerseData } from '../types.js';

export async function buildPack(manifestPath: string, options: { output?: string }): Promise<void> {
  console.log(`Building pack from: ${manifestPath}`);
  
  try {
    // Use workspace root if provided, otherwise use current directory
    const workspaceRoot = process.env.WORKSPACE_ROOT || process.cwd();
    const resolvedManifestPath = resolve(workspaceRoot, manifestPath);
    
    // Read the manifest
    const manifestContent = readFileSync(resolvedManifestPath, 'utf-8');
    const manifest = JSON.parse(manifestContent) as SourceManifest;
    
    console.log(`Pack ID: ${manifest.id}`);
    console.log(`Pack Type: ${manifest.type}`);
    
    // Determine output path
    const outputPath = options.output || `${manifest.id}-${manifest.version}.sqlite`;
    const resolvedOutput = resolve(workspaceRoot, outputPath);
    
    console.log(`Output: ${resolvedOutput}`);
    
    // Build based on type
    if (manifest.type === 'text') {
      await buildTextPack(manifest, resolvedOutput);
    } else if (manifest.type === 'lexicon') {
      await buildLexiconPack(manifest, resolvedOutput);
    } else {
      throw new Error(`Unknown pack type: ${manifest.type}`);
    }
    
    console.log('✅ Pack built successfully');
    
  } catch (error) {
    console.error('❌ Error building pack:', error);
    process.exit(1);
  }
}

async function buildTextPack(manifest: SourceManifest, outputPath: string): Promise<void> {
  const db = new Database(outputPath);
  
  try {
    // Create schema
    db.exec(`
      CREATE TABLE IF NOT EXISTS metadata (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
      
      CREATE TABLE IF NOT EXISTS verses (
        book TEXT NOT NULL,
        chapter INTEGER NOT NULL,
        verse INTEGER NOT NULL,
        text TEXT NOT NULL,
        PRIMARY KEY (book, chapter, verse)
      );
      
      CREATE INDEX IF NOT EXISTS idx_verses_book ON verses(book);
      CREATE INDEX IF NOT EXISTS idx_verses_book_chapter ON verses(book, chapter);
    `);
    
    // Insert metadata
    const insertMeta = db.prepare('INSERT OR REPLACE INTO metadata (key, value) VALUES (?, ?)');
    insertMeta.run('pack_id', manifest.id);
    insertMeta.run('version', manifest.version);
    insertMeta.run('type', manifest.type);
    insertMeta.run('translation_id', manifest.translationId || '');
    insertMeta.run('translation_name', manifest.translationName || '');
    insertMeta.run('license', manifest.license);
    insertMeta.run('attribution', manifest.attribution || '');
    
    // Insert verses from source data
    if (manifest.sourceData) {
      console.log(`Inserting verses from embedded data...`);
      const insertVerse = db.prepare('INSERT OR REPLACE INTO verses (book, chapter, verse, text) VALUES (?, ?, ?, ?)');
      
      const insertMany = db.transaction((verses: VerseData[]) => {
        for (const v of verses) {
          insertVerse.run(v.book, v.chapter, v.verse, v.text);
        }
      });
      
      insertMany(manifest.sourceData);
      console.log(`   Inserted ${manifest.sourceData.length} verses`);
    }
    
    // Optimize
    db.exec('PRAGMA optimize;');
    
  } finally {
    db.close();
  }
}

async function buildLexiconPack(manifest: SourceManifest, outputPath: string): Promise<void> {
  const db = new Database(outputPath);
  
  try {
    // Create schema for lexicon
    db.exec(`
      CREATE TABLE IF NOT EXISTS metadata (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
      
      CREATE TABLE IF NOT EXISTS lexicon (
        strong_id TEXT PRIMARY KEY,
        lemma TEXT,
        definition TEXT,
        part_of_speech TEXT
      );
    `);
    
    // Insert metadata
    const insertMeta = db.prepare('INSERT OR REPLACE INTO metadata (key, value) VALUES (?, ?)');
    insertMeta.run('pack_id', manifest.id);
    insertMeta.run('version', manifest.version);
    insertMeta.run('type', manifest.type);
    insertMeta.run('license', manifest.license);
    
    console.log('Lexicon pack schema created (no sample data yet)');
    
  } finally {
    db.close();
  }
}
