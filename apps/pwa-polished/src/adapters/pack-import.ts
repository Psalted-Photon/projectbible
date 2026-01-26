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
    let packType = (metadata.pack_type || metadata.type || metadata.packType) as string;
    // Normalize 'original-language' to 'text' for storage
    if (packType === 'original-language') packType = 'text';
    // Normalize 'translation' to 'text' for consolidated packs
    if (packType === 'translation') packType = 'text';
    
    const packInfo: DBPack = {
      id: metadata.pack_id || metadata.packId || metadata.id,
      version: metadata.pack_version || metadata.version || metadata.packVersion || '1.0',
      type: packType as 'text' | 'lexicon' | 'places' | 'map' | 'cross-references' | 'morphology' | 'audio' | 'commentary',
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
    } else if (packInfo.type === 'commentary') {
      // Import commentary entries
      console.log('Importing commentary pack...');
      
      const commentaryRows = db.exec(`
        SELECT book, chapter, verse_start, verse_end, author, title, text, source, year
        FROM commentary_entries
      `);

      if (commentaryRows.length && commentaryRows[0].values.length) {
        const entries = commentaryRows[0].values.map(([book, chapter, verseStart, verseEnd, author, title, text, source, year]) => ({
          id: `${book}:${chapter}:${verseStart}:${author}`,
          book: book as string,
          chapter: chapter as number,
          verseStart: verseStart as number,
          verseEnd: verseEnd as number | undefined,
          author: author as string,
          title: title as string | undefined,
          text: text as string,
          source: source as string | undefined,
          year: year as number | undefined
        }));

        console.log(`Importing ${entries.length} commentary entries...`);

        // Batch insert commentary entries
        const CHUNK_SIZE = 500;
        for (let i = 0; i < entries.length; i += CHUNK_SIZE) {
          const chunk = entries.slice(i, i + CHUNK_SIZE);
          await batchWriteTransaction('commentary_entries', (store) => {
            chunk.forEach(entry => store.put(entry));
          });
          
          if ((i / CHUNK_SIZE + 1) % 10 === 0) {
            console.log(`  Progress: ${i + chunk.length}/${entries.length} (${((i + chunk.length) / entries.length * 100).toFixed(1)}%)`);
          }
        }

        console.log(`✅ Commentary pack imported: ${entries.length} entries`);
      }
    } else if (packInfo.type === 'text') {
      // Check if this is a multi-edition pack
      const tableCheck = db.exec("SELECT name FROM sqlite_master WHERE type='table' AND name='editions'");
      const hasEditions = tableCheck.length > 0 && tableCheck[0].values.length > 0;
      
      // Check if this is a multi-translation consolidated pack
      const translationsTableCheck = db.exec("SELECT name FROM sqlite_master WHERE type='table' AND name='translations'");
      const hasTranslationsTable = translationsTableCheck.length > 0 && translationsTableCheck[0].values.length > 0;
      
      // Check if pack has morphology data (words table)
      const wordsTableCheck = db.exec("SELECT name FROM sqlite_master WHERE type='table' AND name='words'");
      const hasWords = wordsTableCheck.length > 0 && wordsTableCheck[0].values.length > 0;

      if (hasTranslationsTable) {
        // Multi-translation consolidated pack
        console.log('Detected multi-translation consolidated pack, importing translations...');

        const translationsRows = db.exec('SELECT id, name, language, description FROM translations');
        if (!translationsRows.length || !translationsRows[0].values.length) {
          throw new Error('Multi-translation pack has no translations table data');
        }

        // Import each translation as a separate virtual pack
        for (const [translationId, translationName, language, description] of translationsRows[0].values) {
          const translationPackId = `${packInfo.id}-${translationId}`;

          // Create a pack entry for this translation WITH ALL REQUIRED FIELDS
          const translationPack: DBPack = {
            id: translationPackId,
            version: packInfo.version,
            type: 'text', // CRITICAL: canonical classification for TextStore filtering
            translationId: translationId as string,
            translationName: translationName as string,
            language: language as string, // CRITICAL: required for language routing
            license: packInfo.license,
            attribution: packInfo.attribution,
            size: 0, // Will be estimated
            installedAt: packInfo.installedAt,
            description: description as string
          };

          await writeTransaction('packs', (store) => store.put(translationPack));
          console.log(`  Translation pack created: ${translationId} (${translationName})`);
        }

        // Import all verses (check column names - may be translation_id or translationId)
        const versesTableInfo = db.exec('PRAGMA table_info(verses)');
        const versesColumns = versesTableInfo.length > 0 && versesTableInfo[0].values
          ? versesTableInfo[0].values.map(row => row[1] as string)
          : [];
        
        console.log(`  Verses table columns: ${versesColumns.join(', ')}`);
        
        const hasHeading = versesColumns.includes('heading');
        const translationIdCol = versesColumns.includes('translation_id') ? 'translation_id' : 'translationId';
        
        const versesQuery = hasHeading
          ? `SELECT ${translationIdCol}, book, chapter, verse, text, heading FROM verses`
          : `SELECT ${translationIdCol}, book, chapter, verse, text FROM verses`;
        
        const versesRows = db.exec(versesQuery);
        if (versesRows.length && versesRows[0].values.length) {
          const verses = versesRows[0].values.map((row) => {
            const [translationId, book, chapter, verse, text, heading] = row;
            return {
              id: `${translationId}:${book}:${chapter}:${verse}`,
              translationId: translationId as string,
              book: book as string,
              chapter: chapter as number,
              verse: verse as number,
              text: text as string,
              heading: hasHeading ? (heading as string | null) : null
            };
          });

          console.log(`Importing ${verses.length} verses from ${translationsRows[0].values.length} translations...`);

          // Batch insert verses
          const CHUNK_SIZE = 500;
          for (let i = 0; i < verses.length; i += CHUNK_SIZE) {
            const chunk = verses.slice(i, i + CHUNK_SIZE);
            await batchWriteTransaction('verses', (store) => {
              chunk.forEach(v => store.put(v));
            });
            console.log(`Imported ${Math.min(i + CHUNK_SIZE, verses.length)}/${verses.length} verses`);
          }

          console.log(`✅ Consolidated pack ${packInfo.id} imported: ${verses.length} verses`);
        }
      } else if (hasEditions) {
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
        
        try {
          // Check which columns are available in the words table
          const wordsTableInfo = db.exec('PRAGMA table_info(words)');
          const columns = wordsTableInfo.length > 0 && wordsTableInfo[0].values 
            ? wordsTableInfo[0].values.map(row => row[1] as string) 
            : [];
          const hasGlossEn = columns.includes('gloss_en');
          const hasTransliteration = columns.includes('transliteration');
        
        console.log(`  Words table columns: ${columns.join(', ')}`);
        
        // Build SELECT query based on available columns
        let selectQuery = 'SELECT book, chapter, verse, word_order, text, lemma, morph_code, strongs';
        if (hasGlossEn) selectQuery += ', gloss_en';
        if (hasTransliteration) selectQuery += ', transliteration';
        selectQuery += ' FROM words';
        
        const wordsRows = db.exec(selectQuery);
        
        if (wordsRows.length && wordsRows[0].values.length) {
          const morphologyData = wordsRows[0].values.map((row) => {
            const [book, chapter, verse, wordOrder, text, lemma, morphCode, strongs, ...optional] = row;
            let gloss: string | undefined;
            let transliteration: string | undefined;
            
            // Extract optional fields based on which columns exist
            if (hasGlossEn && hasTransliteration) {
              [gloss, transliteration] = optional as [string, string];
            } else if (hasGlossEn) {
              [gloss] = optional as [string];
            } else if (hasTransliteration) {
              [transliteration] = optional as [string];
            }
            
            // Determine language from translation ID
            const language = packInfo.translationId?.startsWith('LXX') || 
                           packInfo.translationId === 'BYZ' || 
                           packInfo.translationId === 'TR' 
              ? 'greek' 
              : packInfo.translationId === 'WLC' 
              ? 'hebrew' 
              : 'greek'; // default to greek for original language packs
            
            return {
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
              parsing: morphCode as string,
              language: language as 'greek' | 'hebrew' | 'aramaic'
            };
          });
          
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
        } catch (morphError) {
          console.error('Error importing morphology data:', morphError);
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
      // Import lexicon data (Strong's dictionaries, lemmas, morphology, etc.)
      console.log('Importing lexicon pack...');
      
      const tables = db.exec("SELECT name FROM sqlite_master WHERE type='table'");
      const tableNames = tables.length > 0 ? tables[0].values.map(row => row[0] as string) : [];
      console.log('Available tables:', tableNames);
      
      const CHUNK_SIZE = 500;
      
      // Import Greek Strong's entries
      if (tableNames.includes('greek_strongs_entries')) {
        console.log('Importing Greek Strong\'s entries...');
        const rows = db.exec(`
          SELECT id, lemma, transliteration, definition, shortDefinition, 
                 partOfSpeech, language, derivation, kjvUsage
          FROM greek_strongs_entries
        `);
        
        if (rows.length && rows[0].values.length) {
          const data = rows[0].values.map(([id, lemma, trans, def, shortDef, pos, lang, deriv, kjv]) => ({
            id: id as string,
            lemma: lemma as string,
            transliteration: trans as string | null,
            definition: def as string,
            shortDefinition: shortDef as string | null,
            partOfSpeech: pos as string | null,
            language: lang as string | null,
            derivation: deriv as string | null,
            kjvUsage: kjv as string | null
          }));
          
          for (let i = 0; i < data.length; i += CHUNK_SIZE) {
            const chunk = data.slice(i, i + CHUNK_SIZE);
            await batchWriteTransaction('greek_strongs_entries', (store) => {
              chunk.forEach(entry => store.put(entry));
            });
            console.log(`Imported ${Math.min(i + CHUNK_SIZE, data.length)}/${data.length} Greek Strong's entries`);
          }
          console.log(`✅ Greek Strong's imported: ${data.length} entries`);
        }
      }
      
      // Import Hebrew Strong's entries
      if (tableNames.includes('hebrew_strongs_entries')) {
        console.log('Importing Hebrew Strong\'s entries...');
        const rows = db.exec(`
          SELECT id, lemma, transliteration, definition, shortDefinition, 
                 partOfSpeech, language, derivation, kjvUsage
          FROM hebrew_strongs_entries
        `);
        
        if (rows.length && rows[0].values.length) {
          const data = rows[0].values.map(([id, lemma, trans, def, shortDef, pos, lang, deriv, kjv]) => ({
            id: id as string,
            lemma: lemma as string,
            transliteration: trans as string | null,
            definition: def as string,
            shortDefinition: shortDef as string | null,
            partOfSpeech: pos as string | null,
            language: lang as string | null,
            derivation: deriv as string | null,
            kjvUsage: kjv as string | null
          }));
          
          for (let i = 0; i < data.length; i += CHUNK_SIZE) {
            const chunk = data.slice(i, i + CHUNK_SIZE);
            await batchWriteTransaction('hebrew_strongs_entries', (store) => {
              chunk.forEach(entry => store.put(entry));
            });
            console.log(`Imported ${Math.min(i + CHUNK_SIZE, data.length)}/${data.length} Hebrew Strong's entries`);
          }
          console.log(`✅ Hebrew Strong's imported: ${data.length} entries`);
        }
      }
      
      // Import lexicon entries (lemmas)
      if (tableNames.includes('lexicon_entries')) {
        console.log('Importing lexicon entries...');
        const rows = db.exec(`
          SELECT id, lemma, transliteration, pronunciation, definition, language
          FROM lexicon_entries
        `);
        
        if (rows.length && rows[0].values.length) {
          const data = rows[0].values.map(([id, lemma, trans, pron, def, lang]) => ({
            id: id as string,
            lemma: lemma as string,
            transliteration: trans as string | null,
            pronunciation: pron as string | null,
            definition: def as string,
            language: lang as string | null
          }));
          
          for (let i = 0; i < data.length; i += CHUNK_SIZE) {
            const chunk = data.slice(i, i + CHUNK_SIZE);
            await batchWriteTransaction('lexicon_entries', (store) => {
              chunk.forEach(entry => store.put(entry));
            });
            console.log(`Imported ${Math.min(i + CHUNK_SIZE, data.length)}/${data.length} lexicon entries`);
          }
          console.log(`✅ Lexicon entries imported: ${data.length} entries`);
        }
      }
      
      // Import morphology data
      if (tableNames.includes('morphology')) {
        console.log('Importing morphology data...');
        const rows = db.exec(`
          SELECT translation_id, book, chapter, verse, word_order, word, lemma, strongs_id, morph_code
          FROM morphology
        `);
        
        if (rows.length && rows[0].values.length) {
          const data = rows[0].values.map(([trans, book, ch, v, order, word, lemma, strongs, morph]) => ({
            id: `${trans}:${book}:${ch}:${v}:${order}`,
            translation_id: trans as string,
            book: book as string,
            chapter: ch as number,
            verse: v as number,
            word_order: order as number,
            word: word as string,
            lemma: lemma as string | null,
            strongs_id: strongs as string | null,
            morph_code: morph as string | null
          }));
          
          for (let i = 0; i < data.length; i += CHUNK_SIZE) {
            const chunk = data.slice(i, i + CHUNK_SIZE);
            await batchWriteTransaction('morphology', (store) => {
              chunk.forEach(entry => store.put(entry));
            });
            console.log(`Imported ${Math.min(i + CHUNK_SIZE, data.length)}/${data.length} morphology entries`);
          }
          console.log(`✅ Morphology data imported: ${data.length} entries`);
        }
      }
      
      // Import English words
      if (tableNames.includes('english_words')) {
        console.log('Importing English word data...');
        const rows = db.exec(`
          SELECT id, word, ipa_us, ipa_uk, pos
          FROM english_words
        `);
        
        if (rows.length && rows[0].values.length) {
          const data = rows[0].values.map(([id, word, ipaUs, ipaUk, pos]) => ({
            id: id as string,
            word: word as string,
            ipa_us: ipaUs as string | null,
            ipa_uk: ipaUk as string | null,
            pos: pos as string | null
          }));
          
          for (let i = 0; i < data.length; i += CHUNK_SIZE) {
            const chunk = data.slice(i, i + CHUNK_SIZE);
            await batchWriteTransaction('english_words', (store) => {
              chunk.forEach(entry => store.put(entry));
            });
            console.log(`Imported ${Math.min(i + CHUNK_SIZE, data.length)}/${data.length} English words`);
          }
          console.log(`✅ English words imported: ${data.length} entries`);
        }
      }
      
      // Import English synonyms
      if (tableNames.includes('english_synonyms')) {
        console.log('Importing English synonyms...');
        const rows = db.exec(`SELECT word, synonym, relationship FROM english_synonyms`);
        
        if (rows.length && rows[0].values.length) {
          const data = rows[0].values.map(([word, syn, rel]) => ({
            id: `${word}:${syn}`,
            word: word as string,
            synonym: syn as string,
            relationship: rel as string | null
          }));
          
          for (let i = 0; i < data.length; i += CHUNK_SIZE) {
            const chunk = data.slice(i, i + CHUNK_SIZE);
            await batchWriteTransaction('english_synonyms', (store) => {
              chunk.forEach(entry => store.put(entry));
            });
          }
          console.log(`✅ English synonyms imported: ${data.length} entries`);
        }
      }
      
      // Import thesaurus synonyms
      if (tableNames.includes('thesaurus_synonyms')) {
        console.log('Importing thesaurus synonyms...');
        const rows = db.exec(`SELECT word, synonym FROM thesaurus_synonyms`);
        
        if (rows.length && rows[0].values.length) {
          const data = rows[0].values.map(([word, syn]) => ({
            id: `${word}:${syn}`,
            word: word as string,
            synonym: syn as string
          }));
          
          const LARGE_CHUNK = 2000; // Larger chunks for massive datasets
          for (let i = 0; i < data.length; i += LARGE_CHUNK) {
            const chunk = data.slice(i, i + LARGE_CHUNK);
            await batchWriteTransaction('thesaurus_synonyms', (store) => {
              chunk.forEach(entry => store.put(entry));
            });
            if (i % 100000 === 0) {
              console.log(`Imported ${Math.min(i + LARGE_CHUNK, data.length)}/${data.length} thesaurus synonyms`);
            }
          }
          console.log(`✅ Thesaurus synonyms imported: ${data.length} entries`);
        }
      }
      
      // Import thesaurus antonyms
      if (tableNames.includes('thesaurus_antonyms')) {
        console.log('Importing thesaurus antonyms...');
        const rows = db.exec(`SELECT word, antonym FROM thesaurus_antonyms`);
        
        if (rows.length && rows[0].values.length) {
          const data = rows[0].values.map(([word, ant]) => ({
            id: `${word}:${ant}`,
            word: word as string,
            antonym: ant as string
          }));
          
          for (let i = 0; i < data.length; i += CHUNK_SIZE) {
            const chunk = data.slice(i, i + CHUNK_SIZE);
            await batchWriteTransaction('thesaurus_antonyms', (store) => {
              chunk.forEach(entry => store.put(entry));
            });
          }
          console.log(`✅ Thesaurus antonyms imported: ${data.length} entries`);
        }
      }
      
      // Import English grammar
      if (tableNames.includes('english_grammar')) {
        console.log('Importing English grammar data...');
        const rows = db.exec(`SELECT word, base_form, inflection_type FROM english_grammar`);
        
        if (rows.length && rows[0].values.length) {
          const data = rows[0].values.map(([word, base, inflection]) => ({
            id: `${word}:${inflection || 'base'}`,
            word: word as string,
            base_form: base as string | null,
            inflection_type: inflection as string | null
          }));
          
          for (let i = 0; i < data.length; i += CHUNK_SIZE) {
            const chunk = data.slice(i, i + CHUNK_SIZE);
            await batchWriteTransaction('english_grammar', (store) => {
              chunk.forEach(entry => store.put(entry));
            });
          }
          console.log(`✅ English grammar imported: ${data.length} entries`);
        }
      }
      
      console.log(`✅ Lexicon pack ${packInfo.id} imported`);
    } else if (packInfo.type === 'dictionary') {
      // Import dictionary data (modern Wiktionary + historic GCIDE definitions)
      console.log('Importing dictionary pack...');
      
      const tables = db.exec("SELECT name FROM sqlite_master WHERE type='table'");
      const tableNames = tables.length > 0 ? tables[0].values.map(row => row[0] as string) : [];
      console.log('Available tables:', tableNames);
      
      const CHUNK_SIZE = 2000; // Larger chunks for massive definition datasets
      
      // Import modern definitions (Wiktionary)
      if (tableNames.includes('english_definitions_modern')) {
        console.log('Importing modern definitions (Wiktionary)...');
        const rows = db.exec(`
          SELECT id, word_id, pos, sense_number, definition_order, definition, 
                 example, etymology, raw_etymology, tags, search_tokens, source, source_url
          FROM english_definitions_modern
        `);
        
        if (rows.length && rows[0].values.length) {
          const data = rows[0].values.map(([id, wordId, pos, senseNum, defOrder, def, ex, etym, rawEtym, tags, tokens, src, url]) => ({
            id: id as number,
            word_id: wordId as number,
            pos: pos as string | null,
            sense_number: senseNum as string | null,
            definition_order: defOrder as number,
            definition: def as string,
            example: ex as string | null,
            etymology: etym as string | null,
            raw_etymology: rawEtym as string | null,
            tags: tags as string | null,
            search_tokens: tokens as string | null,
            source: (src as string) || 'wiktionary',
            source_url: url as string | null
          }));
          
          for (let i = 0; i < data.length; i += CHUNK_SIZE) {
            const chunk = data.slice(i, i + CHUNK_SIZE);
            await batchWriteTransaction('english_definitions_modern', (store) => {
              chunk.forEach(entry => store.put(entry));
            });
            
            // Progress logging every 500k entries
            if (i % 500000 === 0 || i + CHUNK_SIZE >= data.length) {
              const progress = Math.min(i + CHUNK_SIZE, data.length);
              const percent = Math.round((progress / data.length) * 100);
              console.log(`Imported ${progress.toLocaleString()}/${data.length.toLocaleString()} modern definitions (${percent}%)`);
            }
          }
          console.log(`✅ Modern definitions imported: ${data.length.toLocaleString()} entries`);
        }
      }
      
      // Import historic definitions (GCIDE/Webster 1913)
      if (tableNames.includes('english_definitions_historic')) {
        console.log('Importing historic definitions (GCIDE/Webster 1913)...');
        const rows = db.exec(`
          SELECT id, word_id, pos, sense_number, definition_order, definition, 
                 example, search_tokens, source, source_url
          FROM english_definitions_historic
        `);
        
        if (rows.length && rows[0].values.length) {
          const data = rows[0].values.map(([id, wordId, pos, senseNum, defOrder, def, ex, tokens, src, url]) => ({
            id: id as number,
            word_id: wordId as number,
            pos: pos as string | null,
            sense_number: senseNum as string | null,
            definition_order: defOrder as number,
            definition: def as string,
            example: ex as string | null,
            search_tokens: tokens as string | null,
            source: (src as string) || 'gcide',
            source_url: url as string | null
          }));
          
          const HISTORIC_CHUNK = 1000; // Smaller chunks for historic definitions
          for (let i = 0; i < data.length; i += HISTORIC_CHUNK) {
            const chunk = data.slice(i, i + HISTORIC_CHUNK);
            await batchWriteTransaction('english_definitions_historic', (store) => {
              chunk.forEach(entry => store.put(entry));
            });
            console.log(`Imported ${Math.min(i + HISTORIC_CHUNK, data.length).toLocaleString()}/${data.length.toLocaleString()} historic definitions`);
          }
          console.log(`✅ Historic definitions imported: ${data.length.toLocaleString()} entries`);
        }
      }
      
      // Import word mapping (lemma → word_id)
      if (tableNames.includes('word_mapping')) {
        console.log('Importing word mapping...');
        const rows = db.exec(`SELECT lemma, word_id FROM word_mapping`);
        
        if (rows.length && rows[0].values.length) {
          const data = rows[0].values.map(([lemma, wordId]) => ({
            lemma: lemma as string,
            word_id: wordId as number
          }));

          // Word mapping can be large, use larger chunks
          for (let i = 0; i < data.length; i += CHUNK_SIZE) {
            const chunk = data.slice(i, i + CHUNK_SIZE);
            await batchWriteTransaction('word_mapping', (store) => {
              chunk.forEach(entry => store.put(entry));
            });

            if (i % 500000 === 0 || i + CHUNK_SIZE >= data.length) {
              const progress = Math.min(i + CHUNK_SIZE, data.length);
              const percent = Math.round((progress / data.length) * 100);
              console.log(`Imported ${progress.toLocaleString()}/${data.length.toLocaleString()} word mappings (${percent}%)`);
            }
          }
          console.log(`✅ Word mapping imported: ${data.length.toLocaleString()} entries`);
        }
      }
      
      console.log(`✅ Dictionary pack ${packInfo.id} imported`);
    } else if (packInfo.type === 'study') {
      // Import study tools data (cross-references, chronological ordering, etc.)
      console.log('Importing study tools pack...');
      
      const tables = db.exec("SELECT name FROM sqlite_master WHERE type='table'");
      const tableNames = tables.length > 0 ? tables[0].values.map(row => row[0] as string) : [];
      console.log('Available tables:', tableNames);
      
      const CHUNK_SIZE = 500;
      
      // Import chronological ordering
      if (tableNames.includes('chronological_order')) {
        console.log('Importing chronological ordering...');
        const rows = db.exec(`
          SELECT book, chapter, verse, order_index
          FROM chronological_order
        `);
        
        if (rows.length && rows[0].values.length) {
          const data = rows[0].values.map(([book, chapter, verse, order]) => ({
            id: `${book}:${chapter}:${verse}`,
            book: book as string,
            chapter: chapter as number,
            verse: verse as number,
            order_index: order as number
          }));
          
          for (let i = 0; i < data.length; i += CHUNK_SIZE) {
            const chunk = data.slice(i, i + CHUNK_SIZE);
            await batchWriteTransaction('chronological_order', (store) => {
              chunk.forEach(entry => store.put(entry));
            });
            console.log(`Imported ${Math.min(i + CHUNK_SIZE, data.length)}/${data.length} chronological entries`);
          }
          console.log(`✅ Chronological ordering imported: ${data.length} entries`);
        }
      }
      
      // Import cross-references
      if (tableNames.includes('cross_references')) {
        console.log('Importing cross-references...');
        const columnInfo = db.exec('PRAGMA table_info(cross_references)');
        const columnNames = columnInfo.length > 0
          ? columnInfo[0].values.map((row) => row[1] as string)
          : [];
        const hasToVerseStart = columnNames.includes('to_verse_start');
        const hasToVerseEnd = columnNames.includes('to_verse_end');
        const hasToVerse = columnNames.includes('to_verse');
        const hasWeight = columnNames.includes('weight');
        const hasSource = columnNames.includes('source');
        const hasDescription = columnNames.includes('description');

        const selectedColumns = [
          'from_book',
          'from_chapter',
          'from_verse',
          'to_book',
          'to_chapter',
          hasToVerseStart ? 'to_verse_start' : (hasToVerse ? 'to_verse' : null),
          hasToVerseEnd ? 'to_verse_end' : null,
          hasWeight ? 'weight' : null,
          hasSource ? 'source' : null,
          hasDescription ? 'description' : null,
        ].filter(Boolean) as string[];

        if (selectedColumns.length === 0 || (!hasToVerseStart && !hasToVerse)) {
          console.warn('Cross-references table missing verse columns, skipping import.');
        } else {
          const rows = db.exec(`
            SELECT ${selectedColumns.join(', ')}
            FROM cross_references
          `);
          
          if (rows.length && rows[0].values.length) {
            const columnIndex = (name: string) => selectedColumns.indexOf(name);
            const getValue = (row: unknown[], name: string) => {
              const idx = columnIndex(name);
              return idx >= 0 ? row[idx] : undefined;
            };

            const data = rows[0].values.map((row) => {
              const fromBook = getValue(row, 'from_book') as string;
              const fromChapter = getValue(row, 'from_chapter') as number;
              const fromVerse = getValue(row, 'from_verse') as number;
              const toBook = getValue(row, 'to_book') as string;
              const toChapter = getValue(row, 'to_chapter') as number;
              const toVerseStart = (hasToVerseStart
                ? getValue(row, 'to_verse_start')
                : getValue(row, 'to_verse')) as number;
              const toVerseEnd = hasToVerseEnd
                ? (getValue(row, 'to_verse_end') as number | undefined)
                : undefined;
              const weight = hasWeight ? (getValue(row, 'weight') as number) : 0;
              const source = hasSource ? (getValue(row, 'source') as string) : 'curated';
              const description = hasDescription
                ? (getValue(row, 'description') as string | undefined)
                : undefined;

              return {
                id: `${fromBook}:${fromChapter}:${fromVerse}-${toBook}:${toChapter}:${toVerseStart}`,
                fromBook,
                fromChapter,
                fromVerse,
                toBook,
                toChapter,
                toVerseStart,
                toVerseEnd,
                description,
                source: (source || 'curated') as 'curated' | 'user' | 'ai',
                votes: Number.isFinite(weight) ? weight : 0
              };
            });
          
            for (let i = 0; i < data.length; i += CHUNK_SIZE) {
              const chunk = data.slice(i, i + CHUNK_SIZE);
              await batchWriteTransaction('cross_references', (store) => {
                chunk.forEach(entry => store.put(entry));
              });
              console.log(`Imported ${Math.min(i + CHUNK_SIZE, data.length)}/${data.length} cross-references`);
            }
            console.log(`✅ Cross-references imported: ${data.length} entries`);
          }
        }
      }
      
      // Import places (if not already imported from map pack)
      if (tableNames.includes('places')) {
        console.log('Importing places data...');
        const placeColumnInfo = db.exec('PRAGMA table_info(places)');
        const placeColumns = placeColumnInfo.length > 0
          ? placeColumnInfo[0].values.map((row) => row[1] as string)
          : [];
        const hasDescription = placeColumns.includes('description');
        const hasType = placeColumns.includes('type');

        const selectedPlaceColumns = [
          'id',
          'name',
          hasDescription ? 'description' : null,
          'latitude',
          'longitude',
          hasType ? 'type' : null
        ].filter(Boolean) as string[];

        const rows = db.exec(`
          SELECT ${selectedPlaceColumns.join(', ')}
          FROM places
        `);
        
        if (rows.length && rows[0].values.length) {
          const columnIndex = (name: string) => selectedPlaceColumns.indexOf(name);
          const getValue = (row: unknown[], name: string) => {
            const idx = columnIndex(name);
            return idx >= 0 ? row[idx] : undefined;
          };

          const data = rows[0].values.map((row) => ({
            id: getValue(row, 'id') as string,
            name: getValue(row, 'name') as string,
            description: (hasDescription ? getValue(row, 'description') : null) as string | null,
            latitude: getValue(row, 'latitude') as number,
            longitude: getValue(row, 'longitude') as number,
            type: (hasType ? getValue(row, 'type') : null) as string | null
          }));
          
          for (let i = 0; i < data.length; i += CHUNK_SIZE) {
            const chunk = data.slice(i, i + CHUNK_SIZE);
            await batchWriteTransaction('places', (store) => {
              chunk.forEach(entry => store.put(entry));
            });
          }
          console.log(`✅ Places imported: ${data.length} entries`);
        }
      }

      // Import OpenBible data (if present)
      if (tableNames.includes('openbible_locations') && tableNames.includes('openbible_places')) {
        console.log('Importing OpenBible data...');

        const locationsRows = db.exec(`
          SELECT id, friendly_id, longitude, latitude, geometry_type, class, type,
                 precision_meters, thumbnail_file, thumbnail_credit, thumbnail_url
          FROM openbible_locations
        `);

        if (locationsRows.length && locationsRows[0].values.length) {
          const locations = locationsRows[0].values.map(([id, friendlyId, lon, lat, geomType, cls, type, precisionM, thumbFile, thumbCredit, thumbUrl]) => ({
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

          for (let i = 0; i < locations.length; i += CHUNK_SIZE) {
            const chunk = locations.slice(i, i + CHUNK_SIZE);
            await batchWriteTransaction('openbible_locations', (store) => {
              chunk.forEach(entry => store.put(entry));
            });
          }
          console.log(`✅ OpenBible locations imported: ${locations.length} entries`);
        }

        const placesRows = db.exec(`
          SELECT id, friendly_id, type, class, verse_count
          FROM openbible_places
        `);

        if (placesRows.length && placesRows[0].values.length) {
          const places = placesRows[0].values.map(([id, friendlyId, type, cls, verseCount]) => ({
            id: id as string,
            friendlyId: friendlyId as string,
            type: type as string | undefined,
            class: cls as string | undefined,
            verseCount: verseCount as number
          }));

          for (let i = 0; i < places.length; i += CHUNK_SIZE) {
            const chunk = places.slice(i, i + CHUNK_SIZE);
            await batchWriteTransaction('openbible_places', (store) => {
              chunk.forEach(entry => store.put(entry));
            });
          }
          console.log(`✅ OpenBible places imported: ${places.length} entries`);
        }

        if (tableNames.includes('openbible_identifications')) {
          const identRows = db.exec(`
            SELECT ancient_place_id, modern_location_id, time_total, vote_total, class, modifier
            FROM openbible_identifications
          `);

          if (identRows.length && identRows[0].values.length) {
            const idents = identRows[0].values.map(([ancientId, modernId, timeTotal, voteTotal, cls, modifier]) => ({
              ancientPlaceId: ancientId as string,
              modernLocationId: modernId as string,
              confidence: timeTotal as number,
              voteTotal: voteTotal as number,
              class: cls as string | undefined,
              modifier: modifier as string | undefined
            }));

            for (let i = 0; i < idents.length; i += CHUNK_SIZE) {
              const chunk = idents.slice(i, i + CHUNK_SIZE);
              await batchWriteTransaction('openbible_identifications', (store) => {
                chunk.forEach(entry => store.put(entry));
              });
            }
            console.log(`✅ OpenBible identifications imported: ${idents.length} entries`);
          }
        }
      }

      // Import Pleiades data (if present)
      if (tableNames.includes('pleiades_places')) {
        console.log('Importing Pleiades data...');

        const placesRows = db.exec(`
          SELECT id, title, uri, place_type, description, year_start, year_end, created, modified, bbox, latitude, longitude
          FROM pleiades_places
        `);

        if (placesRows.length && placesRows[0].values.length) {
          const places = placesRows[0].values.map(([id, title, uri, placeType, description, yearStart, yearEnd, created, modified, bbox, lat, lon]) => ({
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
            latitude: lat as number | undefined,
            longitude: lon as number | undefined
          }));

          for (let i = 0; i < places.length; i += CHUNK_SIZE) {
            const chunk = places.slice(i, i + CHUNK_SIZE);
            await batchWriteTransaction('pleiades_places', (store) => {
              chunk.forEach(entry => store.put(entry));
            });
          }
          console.log(`✅ Pleiades places imported: ${places.length} entries`);
        }

        if (tableNames.includes('pleiades_names')) {
          const namesRows = db.exec(`
            SELECT place_id, name, language, romanized, name_type, time_period, certainty
            FROM pleiades_names
          `);

          if (namesRows.length && namesRows[0].values.length) {
            const names = namesRows[0].values.map(([placeId, name, language, romanized, nameType, timePeriod, certainty]) => ({
              placeId: placeId as string,
              name: name as string,
              language: language as string | undefined,
              romanized: romanized as string | undefined,
              nameType: nameType as string | undefined,
              timePeriod: timePeriod as string | undefined,
              certainty: certainty as string | undefined
            }));

            for (let i = 0; i < names.length; i += CHUNK_SIZE) {
              const chunk = names.slice(i, i + CHUNK_SIZE);
              await batchWriteTransaction('pleiades_names', (store) => {
                chunk.forEach(entry => store.put(entry));
              });
            }
            console.log(`✅ Pleiades names imported: ${names.length} entries`);
          }
        }

        if (tableNames.includes('pleiades_locations')) {
          const locationsRows = db.exec(`
            SELECT place_id, title, geometry_type, coordinates, latitude, longitude, certainty, time_period
            FROM pleiades_locations
          `);

          if (locationsRows.length && locationsRows[0].values.length) {
            const locations = locationsRows[0].values.map(([placeId, title, geometryType, coordinates, lat, lon, certainty, timePeriod]) => ({
              placeId: placeId as string,
              title: title as string | undefined,
              geometryType: geometryType as string | undefined,
              coordinates: coordinates as string | undefined,
              latitude: lat as number | undefined,
              longitude: lon as number | undefined,
              certainty: certainty as string | undefined,
              timePeriod: timePeriod as string | undefined
            }));

            for (let i = 0; i < locations.length; i += CHUNK_SIZE) {
              const chunk = locations.slice(i, i + CHUNK_SIZE);
              await batchWriteTransaction('pleiades_locations', (store) => {
                chunk.forEach(entry => store.put(entry));
              });
            }
            console.log(`✅ Pleiades locations imported: ${locations.length} entries`);
          }
        }
      }
      
      console.log(`✅ Study tools pack ${packInfo.id} imported`);
    } else if (packInfo.type === 'audio') {
      // Import audio pack metadata
      console.log('Importing audio pack...');
      
      const audioRows = db.exec('SELECT book, chapter, file_path, format FROM audio_chapters');
      
      if (!audioRows.length || !audioRows[0].values.length) {
        console.warn('No audio chapters found in audio pack');
        return;
      }
      
      const audioChapters = audioRows[0].values.map(([book, chapter, filePath, format]) => ({
        id: `${packInfo.translationId}:${book}:${chapter}`,
        translationId: packInfo.translationId!,
        book: book as string,
        chapter: chapter as number,
        filePath: filePath as string,
        format: format as string
      }));
      
      console.log(`Importing ${audioChapters.length} audio chapters...`);
      
      // Batch insert audio metadata
      const CHUNK_SIZE = 500;
      for (let i = 0; i < audioChapters.length; i += CHUNK_SIZE) {
        const chunk = audioChapters.slice(i, i + CHUNK_SIZE);
        await batchWriteTransaction('audio_chapters', (store) => {
          chunk.forEach(audio => store.put(audio));
        });
      }
      
      console.log(`✅ Audio pack ${packInfo.id} imported: ${audioChapters.length} chapters`);
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
