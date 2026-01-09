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

    console.log('Pack metadata:', metadata);

    // Create pack info (handle both camelCase and snake_case metadata keys)
    const packInfo: DBPack = {
      id: metadata.pack_id || metadata.packId,
      version: metadata.version || metadata.packVersion,
      type: (metadata.type || metadata.packType) as 'text' | 'lexicon' | 'places' | 'map' | 'cross-references' | 'morphology' | 'original-language',
      translationId: metadata.translation_id || metadata.translationId,
      translationName: metadata.translation_name || metadata.translationName,
      license: metadata.license,
      attribution: metadata.attribution,
      size: file.size,
      installedAt: Date.now(),
      description: metadata.description
    };

    if (!packInfo.id) {
      throw new Error('Pack metadata missing required "pack_id" or "packId" field');
    }

    console.log('Parsed pack info:', packInfo);

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
    } else if (packInfo.type === 'map') {
      // Import map/places data
      console.log('Importing map pack...');

      // Check which schema this pack uses
      const tables = db.exec("SELECT name FROM sqlite_master WHERE type='table'");
      const tableNames = tables.length > 0 ? tables[0].values.map(row => row[0] as string) : [];
      console.log('Pack tables:', tableNames);

      // Try importing historical_layers (standard map pack)
      if (tableNames.includes('historical_layers')) {
        const layersRows = db.exec(`
          SELECT id, name, display_name, period, year_start, year_end, type, 
                 boundaries, overlay_url, opacity, description
          FROM historical_layers
        `);

        if (layersRows.length && layersRows[0].values.length) {
          const columns = layersRows[0].columns;
          console.log('Historical layers columns:', columns);

          const layers = layersRows[0].values.map((row) => {
            const obj: any = {};
            columns.forEach((col, idx) => {
              obj[col] = row[idx];
            });

            const layer = {
              id: obj.id as string,
              name: obj.name as string,
              displayName: obj.display_name as string,
              period: obj.period as string,
              yearStart: obj.year_start as number,
              yearEnd: obj.year_end as number,
              type: obj.type as string,
              boundaries: obj.boundaries ? JSON.parse(obj.boundaries as string) : undefined,
              overlayUrl: obj.overlay_url as string | undefined,
              opacity: obj.opacity as number,
              description: obj.description as string | undefined,
              packId: packInfo.id
            };

            return layer;
          });

          console.log(`Importing ${layers.length} historical layers...`);

          await batchWriteTransaction('historical_layers', (store) => {
            layers.forEach(layer => {
              if (!layer.id) {
                console.error('Layer missing id:', layer);
                throw new Error('Layer missing required id field');
              }
              store.put(layer);
            });
          });

          console.log(`✅ Map pack imported: ${layers.length} layers`);
        }
      }

      // Import map_layers if available (maps-enhanced schema)
      if (tableNames.includes('map_layers')) {
        console.log('Importing map layers from enhanced pack...');
        const layersRows = db.exec(`
          SELECT id, name, layer_type, geojson_data
          FROM map_layers
        `);

        if (layersRows.length && layersRows[0].values.length) {
          const enhancedLayers = layersRows[0].values.map(([id, name, layerType, geojsonData]) => ({
            id: id as string,
            name: name as string,
            displayName: name as string,
            period: layerType as string,
            yearStart: 0,
            yearEnd: 0,
            type: layerType as string,
            boundaries: geojsonData ? JSON.parse(geojsonData as string) : undefined,
            opacity: 0.6,
            packId: packInfo.id
          }));

          console.log(`Importing ${enhancedLayers.length} map layers...`);

          await batchWriteTransaction('historical_layers', (store) => {
            enhancedLayers.forEach(layer => store.put(layer));
          });

          console.log(`✅ Imported ${enhancedLayers.length} map layers from enhanced pack`);
        }
      }

      // Import places if available (maps-enhanced schema)
      if (tableNames.includes('places')) {
        console.log('Importing places from enhanced map pack...');
        const placesRows = db.exec(`
          SELECT id, name, latitude, longitude, place_type, modern_name, 
                 description, time_periods, ancient_names
          FROM places
        `);

        if (placesRows.length && placesRows[0].values.length) {
          console.log(`Found ${placesRows[0].values.length} places, but places import not yet implemented`);
          // TODO: Import places when places store is ready
        }
      }

      console.log(`✅ Map pack ${packInfo.id} imported`);
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
