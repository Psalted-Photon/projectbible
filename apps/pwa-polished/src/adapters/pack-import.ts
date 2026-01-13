import type { DBPack, DBVerse } from './db.js';
import { batchWriteTransaction, writeTransaction } from './db.js';

/**
 * Import a pack from a SQLite file into IndexedDB
 * Uses sql.js (WASM SQLite) to read the pack file
 */
export async function importPackFromSQLite(file: File): Promise<void> {
  console.log(`Importing pack from ${file.name}...`);

  // Dynamically import sql.js
  const sqlJsModule = await import('sql.js');
  console.log('sql.js module:', sqlJsModule);
  console.log('sql.js keys:', Object.keys(sqlJsModule));
  const initSqlJs = sqlJsModule.default || sqlJsModule;
  console.log('initSqlJs type:', typeof initSqlJs, initSqlJs);
  const SQL = await initSqlJs({
    // Use public directory for WASM file (works in both dev and production)
    locateFile: (file: string) => `/${file}`
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
      version: metadata.pack_version || metadata.version || metadata.packVersion || '1.0',
      type: (metadata.pack_type || metadata.type || metadata.packType) as 'text' | 'lexicon' | 'places' | 'map' | 'cross-references' | 'morphology' | 'original-language',
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
      
      // Check if pack has morphology data (words table)
      const wordsTableCheck = db.exec("SELECT name FROM sqlite_master WHERE type='table' AND name='words'");
      const hasWords = wordsTableCheck.length > 0 && wordsTableCheck[0].values.length > 0;

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
        // Check if heading column exists
        const tableInfo = db.exec("PRAGMA table_info(verses)");
        const hasHeading = tableInfo.length > 0 && tableInfo[0].values.some(row => row[1] === 'heading');
        
        const query = hasHeading 
          ? 'SELECT book, chapter, verse, text, heading FROM verses'
          : 'SELECT book, chapter, verse, text FROM verses';
        const verseRows = db.exec(query);

        if (!verseRows.length || !verseRows[0].values.length) {
          console.warn('No verses found in text pack');
          return;
        }

        const verses: DBVerse[] = verseRows[0].values.map((row) => {
          const [book, chapter, verse, text, heading] = row;
          const translationId = packInfo.translationId!;
          return {
            id: `${translationId}:${book}:${chapter}:${verse}`,
            translationId,
            book: book as string,
            chapter: chapter as number,
            verse: verse as number,
            text: text as string,
            heading: hasHeading ? (heading as string | null) : null
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
      
      // Import morphology data if available (words table)
      if (hasWords) {
        console.log('Importing morphology data from words table...');
        const wordsRows = db.exec(`
          SELECT book, chapter, verse, word_order, text, lemma, morph_code, 
                 strongs, gloss_en, transliteration
          FROM words
        `);
        
        if (wordsRows.length && wordsRows[0].values.length) {
          const morphologyData = wordsRows[0].values.map(([book, chapter, verse, wordOrder, text, lemma, morphCode, strongs, gloss, transliteration]) => ({
            id: `${packInfo.translationId}:${book}:${chapter}:${verse}:${wordOrder}`,
            translationId: packInfo.translationId!,
            book: book as string,
            chapter: chapter as number,
            verse: verse as number,
            wordPosition: wordOrder as number,
            text: text as string,
            lemma: lemma as string,
            strongsId: strongs as string | undefined,
            gloss: gloss as string | undefined,
            transliteration: transliteration as string | undefined,
            parsing: morphCode as string // Store raw morph code
          }));
          
          console.log(`Importing ${morphologyData.length} morphology entries...`);
          
          // Batch insert morphology
          const CHUNK_SIZE = 500;
          for (let i = 0; i < morphologyData.length; i += CHUNK_SIZE) {
            const chunk = morphologyData.slice(i, i + CHUNK_SIZE);
            await batchWriteTransaction('morphology', (store) => {
              chunk.forEach(m => store.put(m));
            });
            console.log(`Imported ${Math.min(i + CHUNK_SIZE, morphologyData.length)}/${morphologyData.length} morphology entries`);
          }
          
          console.log(`✅ Morphology data imported: ${morphologyData.length} entries`);
        }
      }
      
      // Import Strong's dictionary if available (strongs_entries table)
      const strongsTableCheck = db.exec("SELECT name FROM sqlite_master WHERE type='table' AND name='strongs_entries'");
      const hasStrongsEntries = strongsTableCheck.length > 0 && strongsTableCheck[0].values.length > 0;
      
      if (hasStrongsEntries) {
        console.log('Importing Strong\'s dictionary entries...');
        const strongsRows = db.exec(`
          SELECT id, lemma, transliteration, definition, shortDefinition, 
                 partOfSpeech, language, derivation, kjvUsage, occurrences
          FROM strongs_entries
        `);
        
        if (strongsRows.length && strongsRows[0].values.length) {
          const strongsData = strongsRows[0].values.map(([id, lemma, transliteration, definition, shortDef, pos, language, derivation, kjvUsage, occurrences]) => ({
            id: id as string,
            lemma: lemma as string,
            transliteration: transliteration as string | undefined,
            definition: definition as string,
            shortDefinition: shortDef as string | undefined,
            partOfSpeech: pos as string,
            language: (language as string || 'greek') as 'greek' | 'hebrew' | 'aramaic',
            derivation: derivation as string | undefined,
            kjvUsage: kjvUsage as string | undefined,
            occurrences: occurrences as number | undefined
          }));
          
          console.log(`Importing ${strongsData.length} Strong's entries...`);
          
          // Batch insert Strong's entries
          const CHUNK_SIZE = 500;
          for (let i = 0; i < strongsData.length; i += CHUNK_SIZE) {
            const chunk = strongsData.slice(i, i + CHUNK_SIZE);
            await batchWriteTransaction('strongs_entries', (store) => {
              chunk.forEach(s => store.put(s));
            });
            console.log(`Imported ${Math.min(i + CHUNK_SIZE, strongsData.length)}/${strongsData.length} Strong's entries`);
          }
          
          console.log(`✅ Strong's dictionary imported: ${strongsData.length} entries`);
        }
      }
    } else if (packInfo.type === 'places') {
      // Import Pleiades places pack
      console.log('Importing Pleiades places pack...');

      // Check which schema this pack uses
      const tables = db.exec("SELECT name FROM sqlite_master WHERE type='table'");
      const tableNames = tables.length > 0 ? tables[0].values.map(row => row[0] as string) : [];
      console.log('Pack tables:', tableNames);

      // Import Pleiades places if available (pleiades.sqlite format)
      if (tableNames.includes('place_names') && tableNames.includes('place_locations')) {
        // Import places table
        const placesRows = db.exec(`
          SELECT id, title, uri, place_type, description, year_start, year_end, 
                 created, modified, bbox
          FROM places
        `);

        if (placesRows.length && placesRows[0].values.length) {
          console.log(`Importing ${placesRows[0].values.length} Pleiades places...`);

          // Get first location for each place to extract primary coordinates
          const locationRows = db.exec(`
            SELECT place_id, latitude, longitude 
            FROM place_locations 
            WHERE latitude IS NOT NULL 
            GROUP BY place_id
          `);

          const locationMap = new Map<string, { latitude: number; longitude: number }>();
          if (locationRows.length && locationRows[0].values.length) {
            locationRows[0].values.forEach(([placeId, lat, lon]) => {
              locationMap.set(placeId as string, {
                latitude: lat as number,
                longitude: lon as number
              });
            });
          }

          const places = placesRows[0].values.map(([id, title, uri, placeType, description, yearStart, yearEnd, created, modified, bbox]) => {
            const coords = locationMap.get(id as string);
            return {
              id: id as string,
              title: title as string,
              uri: uri as string | undefined,
              placeType: placeType as string | undefined,
              description: description as string | undefined,
              yearStart: yearStart as number | undefined,
              yearEnd: yearEnd as number | undefined,
              created: created as string | undefined,
              modified: modified as string | undefined,
              bbox: bbox as string | undefined,
              latitude: coords?.latitude,
              longitude: coords?.longitude
            };
          });

          // Batch insert places
          const CHUNK_SIZE = 500;
          for (let i = 0; i < places.length; i += CHUNK_SIZE) {
            const chunk = places.slice(i, i + CHUNK_SIZE);
            await batchWriteTransaction('pleiades_places', (store) => {
              chunk.forEach(place => store.put(place));
            });
            console.log(`  Imported ${Math.min(i + CHUNK_SIZE, places.length)}/${places.length} places...`);
          }

          console.log(`✅ Imported ${places.length} Pleiades places`);
        }

        // Import place names
        const namesRows = db.exec(`
          SELECT place_id, name, language, romanized, name_type, time_period, certainty
          FROM place_names
        `);

        if (namesRows.length && namesRows[0].values.length) {
          console.log(`Importing ${namesRows[0].values.length} place names...`);

          const names = namesRows[0].values.map(([placeId, name, language, romanized, nameType, timePeriod, certainty]) => ({
            placeId: placeId as string,
            name: name as string,
            language: language as string | undefined,
            romanized: romanized as string | undefined,
            nameType: nameType as string | undefined,
            timePeriod: timePeriod as string | undefined,
            certainty: certainty as string | undefined
          }));

          // Batch insert names
          const CHUNK_SIZE = 1000;
          for (let i = 0; i < names.length; i += CHUNK_SIZE) {
            const chunk = names.slice(i, i + CHUNK_SIZE);
            await batchWriteTransaction('pleiades_names', (store) => {
              chunk.forEach(name => store.put(name));
            });
          }

          console.log(`✅ Imported ${names.length} place names`);
        }

        // Import place locations
        const locationsRows = db.exec(`
          SELECT place_id, title, geometry_type, coordinates, latitude, longitude, certainty, time_period
          FROM place_locations
        `);

        if (locationsRows.length && locationsRows[0].values.length) {
          console.log(`Importing ${locationsRows[0].values.length} place locations...`);

          const locations = locationsRows[0].values.map(([placeId, title, geometryType, coordinates, latitude, longitude, certainty, timePeriod]) => ({
            placeId: placeId as string,
            title: title as string | undefined,
            geometryType: geometryType as string | undefined,
            coordinates: coordinates as string | undefined,
            latitude: latitude as number | undefined,
            longitude: longitude as number | undefined,
            certainty: certainty as string | undefined,
            timePeriod: timePeriod as string | undefined
          }));

          // Batch insert locations
          const CHUNK_SIZE = 1000;
          for (let i = 0; i < locations.length; i += CHUNK_SIZE) {
            const chunk = locations.slice(i, i + CHUNK_SIZE);
            await batchWriteTransaction('pleiades_locations', (store) => {
              chunk.forEach(location => store.put(location));
            });
          }

          console.log(`✅ Imported ${locations.length} place locations`);
        }

        console.log(`✅ Pleiades pack complete: ${placesRows[0].values.length} places with names and locations`);
      }

      // Import OpenBible places if available (openbible.sqlite format)
      if (tableNames.includes('ancient_places') && tableNames.includes('modern_locations')) {
        console.log('Importing OpenBible biblical places pack...');

        // Import modern locations (these have the coordinates)
        const modernRows = db.exec(`
          SELECT id, friendly_id, longitude, latitude, geometry_type, class, type,
                 precision_meters, thumbnail_file, thumbnail_credit, thumbnail_url
          FROM modern_locations
          WHERE latitude IS NOT NULL
        `);

        if (modernRows.length && modernRows[0].values.length) {
          console.log(`Importing ${modernRows[0].values.length} modern locations...`);

          const locations = modernRows[0].values.map(([id, friendlyId, lon, lat, geomType, cls, type, precisionM, thumbFile, thumbCredit, thumbUrl]) => ({
            id: id as string,
            friendlyId: friendlyId as string,
            longitude: lon as number,
            latitude: lat as number,
            geometryType: geomType as string,
            class: cls as string,
            type: type as string,
            precisionMeters: precisionM as number | undefined,
            thumbnailFile: thumbFile as string | undefined,
            thumbnailCredit: thumbCredit as string | undefined,
            thumbnailUrl: thumbUrl as string | undefined
          }));

          // Batch insert modern locations
          const CHUNK_SIZE = 500;
          for (let i = 0; i < locations.length; i += CHUNK_SIZE) {
            const chunk = locations.slice(i, i + CHUNK_SIZE);
            await batchWriteTransaction('openbible_locations', (store) => {
              chunk.forEach(location => store.put(location));
            });
            console.log(`  Imported ${Math.min(i + CHUNK_SIZE, locations.length)}/${locations.length} locations...`);
          }

          console.log(`✅ Imported ${locations.length} OpenBible modern locations`);
        }

        // Import ancient places (biblical names with verse references)
        const ancientRows = db.exec(`
          SELECT id, friendly_id, type, class, verse_count
          FROM ancient_places
        `);

        if (ancientRows.length && ancientRows[0].values.length) {
          console.log(`Importing ${ancientRows[0].values.length} ancient places...`);

          const places = ancientRows[0].values.map(([id, friendlyId, type, cls, verseCount]) => ({
            id: id as string,
            friendlyId: friendlyId as string,
            type: type as string | undefined,
            class: cls as string | undefined,
            verseCount: verseCount as number
          }));

          // Batch insert ancient places
          const CHUNK_SIZE = 500;
          for (let i = 0; i < places.length; i += CHUNK_SIZE) {
            const chunk = places.slice(i, i + CHUNK_SIZE);
            await batchWriteTransaction('openbible_places', (store) => {
              chunk.forEach(place => store.put(place));
            });
          }

          console.log(`✅ Imported ${places.length} OpenBible ancient places`);
        }

        // Import place identifications (linking ancient -> modern with confidence)
        const identRows = db.exec(`
          SELECT ancient_place_id, modern_location_id, time_total, vote_total, class, modifier
          FROM place_identifications
          WHERE modern_location_id IS NOT NULL AND time_total > 0
        `);

        if (identRows.length && identRows[0].values.length) {
          console.log(`Importing ${identRows[0].values.length} place identifications...`);

          const identifications = identRows[0].values.map(([ancientId, modernId, timeTotal, voteTotal, cls, modifier]) => ({
            ancientPlaceId: ancientId as string,
            modernLocationId: modernId as string,
            confidence: timeTotal as number,
            voteTotal: voteTotal as number,
            class: cls as string | undefined,
            modifier: modifier as string | undefined
          }));

          // Batch insert identifications
          const CHUNK_SIZE = 500;
          for (let i = 0; i < identifications.length; i += CHUNK_SIZE) {
            const chunk = identifications.slice(i, i + CHUNK_SIZE);
            await batchWriteTransaction('openbible_identifications', (store) => {
              chunk.forEach(ident => store.put(ident));
            });
          }

          console.log(`✅ Imported ${identifications.length} place identifications`);
        }

        console.log(`✅ OpenBible pack complete: ${ancientRows[0].values.length} biblical places`);
      }

      console.log(`✅ Places pack ${packInfo.id} imported`);
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
      if (tableNames.includes('places') && !tableNames.includes('place_names')) {
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
    } else if (packInfo.type === 'lexicon') {
      // Import lexicon data (Strong's dictionaries, etc.)
      console.log('Importing lexicon pack...');
      
      const tables = db.exec("SELECT name FROM sqlite_master WHERE type='table'");
      const tableNames = tables.length > 0 ? tables[0].values.map(row => row[0] as string) : [];
      
      // Import Strong's entries
      if (tableNames.includes('strongs_entries')) {
        console.log('Importing Strong\'s dictionary entries...');
        const strongsRows = db.exec(`
          SELECT id, lemma, transliteration, definition, shortDefinition, 
                 partOfSpeech, language, derivation, kjvUsage, occurrences
          FROM strongs_entries
        `);
        
        if (strongsRows.length && strongsRows[0].values.length) {
          const strongsData = strongsRows[0].values.map(([id, lemma, transliteration, definition, shortDef, pos, language, derivation, kjvUsage, occurrences]) => ({
            id: id as string,
            lemma: lemma as string,
            transliteration: transliteration as string | undefined,
            definition: definition as string,
            shortDefinition: shortDef as string | undefined,
            partOfSpeech: pos as string,
            language: (language as string || 'greek') as 'greek' | 'hebrew' | 'aramaic',
            derivation: derivation as string | undefined,
            kjvUsage: kjvUsage as string | undefined,
            occurrences: occurrences as number | undefined
          }));
          
          console.log(`Importing ${strongsData.length} Strong's entries...`);
          
          // Batch insert Strong's entries
          const CHUNK_SIZE = 500;
          for (let i = 0; i < strongsData.length; i += CHUNK_SIZE) {
            const chunk = strongsData.slice(i, i + CHUNK_SIZE);
            await batchWriteTransaction('strongs_entries', (store) => {
              chunk.forEach(s => store.put(s));
            });
            console.log(`Imported ${Math.min(i + CHUNK_SIZE, strongsData.length)}/${strongsData.length} Strong's entries`);
          }
          
          console.log(`✅ Strong's dictionary imported: ${strongsData.length} entries`);
        }
      }
      
      console.log(`✅ Lexicon pack ${packInfo.id} imported`);
    }

  } finally {
    db.close();
  }
}

/**
 * Import a pack from a URL
 */
export async function importPackFromUrl(url: string): Promise<void> {
  console.log(`Fetching pack from ${url}...`);
  
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch pack: ${response.statusText}`);
  }
  
  const blob = await response.blob();
  const file = new File([blob], url.split('/').pop() || 'pack.sqlite');
  
  await importPackFromSQLite(file);
}

/**
 * Export pack data from IndexedDB to SQLite file (future feature)
 */
export async function exportPackToSQLite(packId: string): Promise<Blob> {
  throw new Error('Pack export not yet implemented');
}
