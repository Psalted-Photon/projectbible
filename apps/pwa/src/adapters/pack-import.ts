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
    
    // Import pack-specific data based on type
    if (packInfo.type === 'cross-references') {
      // Import cross-references
      const xrefRows = db.exec(`
        SELECT from_book, from_chapter, from_verse, to_book, to_chapter, 
               to_verse_start, to_verse_end, source, description
        FROM cross_references
      `);
      
      if (xrefRows.length && xrefRows[0].values.length) {
        const crossRefs = xrefRows[0].values.map(([fromBook, fromChapter, fromVerse, toBook, toChapter, toVerseStart, toVerseEnd, source, description]) => ({
          id: `${fromBook}:${fromChapter}:${fromVerse}->${toBook}:${toChapter}:${toVerseStart}`,
          fromBook: fromBook as string,
          fromChapter: fromChapter as number,
          fromVerse: fromVerse as number,
          toBook: toBook as string,
          toChapter: toChapter as number,
          toVerseStart: toVerseStart as number,
          toVerseEnd: toVerseEnd as number | undefined,
          description: description as string | undefined,
          source: (source as string || 'curated') as 'curated' | 'user' | 'ai',
          votes: 0
        }));
        
        console.log(`Importing ${crossRefs.length} cross-references...`);
        
        // Batch insert cross-references
        const CHUNK_SIZE = 500;
        for (let i = 0; i < crossRefs.length; i += CHUNK_SIZE) {
          const chunk = crossRefs.slice(i, i + CHUNK_SIZE);
          await batchWriteTransaction('cross_references', (store) => {
            chunk.forEach(xref => store.put(xref));
          });
        }
        
        console.log(`✅ Cross-references pack imported: ${crossRefs.length} entries`);
      }
    } else if (packInfo.type === 'text' || packInfo.type === 'original-language') {
      // Check if this is a multi-edition pack
      const tableCheck = db.exec("SELECT name FROM sqlite_master WHERE type='table' AND name='editions'");
      const hasEditions = tableCheck.length > 0 && tableCheck[0].values.length > 0;
      
      if (hasEditions) {
        // Multi-edition pack (like greek.sqlite with LXX, Byzantine, TR, OpenGNT)
        console.log('Detected multi-edition pack, importing editions...');
        
        const editionsRows = db.exec('SELECT id, name, testament, description FROM editions');
        if (!editionsRows.length || !editionsRows[0].values.length) {
          throw new Error('Multi-edition pack has no editions table data');
        }
        
        // Import each edition as a separate virtual pack
        for (const [editionId, editionName, testament, description] of editionsRows[0].values) {
          const editionPackId = `${packInfo.id}-${editionId}`;
          
          // Create a pack entry for this edition
          const editionPack: DBPack = {
            id: editionPackId,
            version: packInfo.version,
            type: packInfo.type,
            translationId: editionId as string,
            translationName: editionName as string,
            license: packInfo.license,
            attribution: packInfo.attribution,
            size: 0, // Will be estimated
            installedAt: packInfo.installedAt,
            description: description as string
          };
          
          await writeTransaction('packs', (store) => store.put(editionPack));
          console.log(`  Edition pack created: ${editionId} (${editionName})`);
          
          // Import verses for this edition
          const verseRows = db.exec(`SELECT book, chapter, verse, text FROM verses WHERE edition = ?`, [editionId]);
          
          if (!verseRows.length || !verseRows[0].values.length) {
            console.warn(`  No verses found for edition ${editionId}`);
            continue;
          }
          
          const verses: DBVerse[] = verseRows[0].values.map(([book, chapter, verse, text]) => ({
            id: `${editionId}:${book}:${chapter}:${verse}`,
            translationId: editionId as string,
            book: book as string,
            chapter: chapter as number,
            verse: verse as number,
            text: text as string
          }));
          
          console.log(`  Importing ${verses.length} verses for ${editionId}...`);
          
          // Batch insert verses
          const CHUNK_SIZE = 500;
          for (let i = 0; i < verses.length; i += CHUNK_SIZE) {
            const chunk = verses.slice(i, i + CHUNK_SIZE);
            await batchWriteTransaction('verses', (store) => {
              chunk.forEach(v => store.put(v));
            });
          }
          
          console.log(`  ✅ Edition ${editionId}: ${verses.length} verses imported`);
        }
        
        console.log(`✅ Multi-edition pack ${packInfo.id} imported successfully`);
      } else {
        // Single-edition pack (traditional format)
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
