import type { DBPack, DBVerse } from './db.js';
import { batchWriteTransaction, writeTransaction } from './db.js';

/**
 * Import a pack from a SQLite file into IndexedDB
 * Uses sql.js (WASM SQLite) to read the pack file
 */
export async function importPackFromSQLite(file: File): Promise<void> {
  console.log(`Importing pack from ${file.name}...`);
  
  // Dynamically import sql.js (will be added as dependency)
  const initSqlJs = await import('sql.js').then(m => m.default);
  const SQL = await initSqlJs({
    locateFile: (file: string) => `https://sql.js.org/dist/${file}`
  });
  
  // Read the SQLite file
  const arrayBuffer = await file.arrayBuffer();
  const uint8Array = new Uint8Array(arrayBuffer);
  const db = new SQL.Database(uint8Array);
  
  try {
    // Read metadata
    const metadataRows = db.exec('SELECT key, value FROM metadata');
    if (!metadataRows.length || !metadataRows[0].values.length) {
      throw new Error('Invalid pack: no metadata found');
    }
    
    const metadata: Record<string, string> = {};
    metadataRows[0].values.forEach(([key, value]) => {
      metadata[key as string] = value as string;
    });
    
    // Create pack info
    const packInfo: DBPack = {
      id: metadata.pack_id,
      version: metadata.version,
      type: metadata.type as 'text' | 'lexicon' | 'places' | 'map',
      translationId: metadata.translation_id,
      translationName: metadata.translation_name,
      license: metadata.license,
      attribution: metadata.attribution,
      size: file.size,
      installedAt: Date.now()
    };
    
    // Store pack metadata
    await writeTransaction('packs', (store) => store.put(packInfo));
    
    console.log(`Pack metadata stored: ${packInfo.id}`);
    
    // Import verses if this is a text pack
    if (packInfo.type === 'text') {
      const verseRows = db.exec('SELECT book, chapter, verse, text FROM verses');
      
      if (!verseRows.length || !verseRows[0].values.length) {
        console.warn('No verses found in text pack');
        return;
      }
      
      const verses: DBVerse[] = verseRows[0].values.map(([book, chapter, verse, text]) => {
        const translationId = packInfo.translationId!;
        return {
          id: `${translationId}:${book}:${chapter}:${verse}`,
          translationId,
          book: book as string,
          chapter: chapter as number,
          verse: verse as number,
          text: text as string
        };
      });
      
      console.log(`Importing ${verses.length} verses...`);
      
      // Batch insert verses (chunk to avoid transaction timeout)
      const CHUNK_SIZE = 500;
      for (let i = 0; i < verses.length; i += CHUNK_SIZE) {
        const chunk = verses.slice(i, i + CHUNK_SIZE);
        await batchWriteTransaction('verses', (store) => {
          chunk.forEach(v => store.put(v));
        });
        console.log(`Imported ${Math.min(i + CHUNK_SIZE, verses.length)}/${verses.length} verses`);
      }
      
      console.log(`✅ Pack ${packInfo.id} imported successfully`);
    }
    
  } finally {
    db.close();
  }
}

/**
 * Export pack data from IndexedDB to SQLite file (future feature)
 */
export async function exportPackToSQLite(packId: string): Promise<Blob> {
  throw new Error('Pack export not yet implemented');
}
