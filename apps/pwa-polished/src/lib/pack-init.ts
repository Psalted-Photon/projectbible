/**
 * Pack Initialization for Polished App
 * 
 * Handles first-run setup: extracts bundled packs to IndexedDB storage.
 * After first run, packs are loaded from IndexedDB.
 */

export interface BundledPack {
  id: string;
  name: string;
  filename: string;
  url: string;
  type: 'translation' | 'lexicon' | 'maps' | 'commentary';
  required: boolean;
  isLexical?: boolean; // For English lexical packs (handled separately)
}

// List of packs bundled with the polished app
const BUNDLED_PACKS: BundledPack[] = [
  {
    id: 'kjv',
    name: 'King James Version',
    filename: 'kjv.sqlite',
    url: '/kjv.sqlite',
    type: 'translation',
    required: true
  },
  {
    id: 'web',
    name: 'World English Bible',
    filename: 'web.sqlite',
    url: '/web.sqlite',
    type: 'translation',
    required: true
  },
  {
    id: 'maps',
    name: 'Biblical Maps & Places',
    filename: 'maps.sqlite',
    url: '/maps.sqlite',
    type: 'maps',
    required: true
  },
  // English lexical packs disabled for faster initial load
  // These can be manually installed later through the pack manager
  // {
  //   id: 'english-wordlist',
  //   name: 'English Dictionary (440k words + IPA)',
  //   filename: 'english-wordlist-v1.sqlite',
  //   url: '/english-wordlist-v1.sqlite',
  //   type: 'lexicon',
  //   required: false,
  //   isLexical: true
  // },
  // {
  //   id: 'english-thesaurus',
  //   name: 'English Thesaurus (3.5M synonyms)',
  //   filename: 'english-thesaurus-v1.sqlite',
  //   url: '/english-thesaurus-v1.sqlite',
  //   type: 'lexicon',
  //   required: false,
  //   isLexical: true
  // },
  // {
  //   id: 'english-grammar',
  //   name: 'English Grammar (POS tags, verb forms)',
  //   filename: 'english-grammar-v1.sqlite',
  //   url: '/english-grammar-v1.sqlite',
  //   type: 'lexicon',
  //   required: false,
  //   isLexical: true
  // }
];

const INIT_FLAG_KEY = 'projectbible_polished_initialized';
const PACK_VERSION_KEY = 'projectbible_pack_version';
const CURRENT_PACK_VERSION = '1.0.0';

/**
 * Check if app has been initialized with bundled packs
 */
export function isInitialized(): boolean {
  const initialized = localStorage.getItem(INIT_FLAG_KEY);
  const version = localStorage.getItem(PACK_VERSION_KEY);
  
  // Re-initialize if version changed
  return initialized === 'true' && version === CURRENT_PACK_VERSION;
}

/**
 * Initialize app by extracting bundled packs to IndexedDB
 */
export async function initializePolishedApp(
  onProgress?: (message: string, percent: number) => void
): Promise<void> {
  
  if (isInitialized()) {
    console.log('App already initialized, skipping pack extraction');
    return;
  }

  console.log('First run detected - initializing bundled packs...');
  
  try {
    // Open IndexedDB
    const db = await openPackDB();
    
    // Separate regular packs from lexical packs
    const regularPacks = BUNDLED_PACKS.filter(p => !p.isLexical);
    const lexicalPacks = BUNDLED_PACKS.filter(p => p.isLexical);
    
    let completed = 0;
    const total = BUNDLED_PACKS.length;
    
    // Install regular packs first (Bible translations, maps, etc.)
    for (const pack of regularPacks) {
      const progress = Math.round((completed / total) * 100);
      onProgress?.(`Installing ${pack.name}...`, progress);
      
      try {
        // Check if pack already exists
        const existing = await getPackFromDB(db, pack.id);
        if (existing) {
          console.log(`Pack ${pack.id} already exists, skipping`);
          completed++;
          continue;
        }
        
        // Fetch the bundled pack file
        console.log(`Fetching ${pack.url}...`);
        const response = await fetch(pack.url);
        
        if (!response.ok) {
          console.warn(`Pack ${pack.filename} not found at ${pack.url}, skipping`);
          completed++;
          continue;
        }
        
        const blob = await response.blob();
        
        // Store in IndexedDB
        await storePackInDB(db, pack.id, blob, {
          name: pack.name,
          type: pack.type,
          version: CURRENT_PACK_VERSION,
          installedAt: new Date().toISOString()
        });
        
        console.log(`✓ Installed ${pack.name}`);
        completed++;
        
      } catch (error) {
        console.error(`Error installing pack ${pack.id}:`, error);
        if (pack.required) {
          throw error; // Fail if required pack can't be installed
        }
        completed++;
      }
    }
    
    // Install English lexical packs (these go into a separate IndexedDB)
    if (lexicalPacks.length > 0) {
      try {
        const { englishLexicalPackLoader } = await Promise.race([
          import('../../../../packages/core/src/search/englishLexicalPackLoader'),
          new Promise((_, reject) => setTimeout(() => reject(new Error('Import timeout')), 5000))
        ]) as any;
      
      for (const pack of lexicalPacks) {
        const progress = Math.round((completed / total) * 100);
        onProgress?.(`Installing ${pack.name}...`, progress);
        
        try {
          // Load lexical pack using the specialized loader
          console.log(`Loading lexical pack: ${pack.url}...`);
          
          if (pack.id === 'english-wordlist') {
            await englishLexicalPackLoader.loadWordlistPack(pack.url, (loadProgress) => {
              const currentProgress = Math.round((completed / total) * 100);
              const packProgress = Math.round(loadProgress.progress * 0.01 * (1 / total) * 100);
              onProgress?.(loadProgress.message, currentProgress + packProgress);
            });
          } else if (pack.id === 'english-thesaurus') {
            await englishLexicalPackLoader.loadThesaurusPack(pack.url, (loadProgress) => {
              const currentProgress = Math.round((completed / total) * 100);
              const packProgress = Math.round(loadProgress.progress * 0.01 * (1 / total) * 100);
              onProgress?.(loadProgress.message, currentProgress + packProgress);
            });
          } else if (pack.id === 'english-grammar') {
            await englishLexicalPackLoader.loadGrammarPack(pack.url, (loadProgress) => {
              const currentProgress = Math.round((completed / total) * 100);
              const packProgress = Math.round(loadProgress.progress * 0.01 * (1 / total) * 100);
              onProgress?.(loadProgress.message, currentProgress + packProgress);
            });
          }
          
          console.log(`✓ Installed ${pack.name}`);
          completed++;
          
        } catch (error) {
          console.error(`Error installing lexical pack ${pack.id}:`, error);
          // Lexical packs are optional, don't fail the whole initialization
          completed++;
        }
      }
      } catch (importError) {
        console.warn('Failed to load English lexical pack loader, skipping lexical packs:', importError);
        // Skip lexical packs but continue with initialization
      }
    }
    
    // Mark as initialized
    localStorage.setItem(INIT_FLAG_KEY, 'true');
    localStorage.setItem(PACK_VERSION_KEY, CURRENT_PACK_VERSION);
    
    onProgress?.('Initialization complete!', 100);
    console.log('✓ All bundled packs initialized');
    
  } catch (error) {
    console.error('Failed to initialize polished app:', error);
    throw error;
  }
}

/**
 * Open IndexedDB for pack storage
 */
function openPackDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('ProjectBible_Packs', 1);
    
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
    
    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      
      if (!db.objectStoreNames.contains('packs')) {
        db.createObjectStore('packs', { keyPath: 'id' });
      }
    };
  });
}

/**
 * Get pack from IndexedDB
 */
function getPackFromDB(db: IDBDatabase, packId: string): Promise<any> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction('packs', 'readonly');
    const store = tx.objectStore('packs');
    const request = store.get(packId);
    
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/**
 * Store pack in IndexedDB
 */
function storePackInDB(
  db: IDBDatabase, 
  packId: string, 
  blob: Blob, 
  metadata: any
): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction('packs', 'readwrite');
    const store = tx.objectStore('packs');
    
    const packData = {
      id: packId,
      blob: blob,
      metadata: metadata
    };
    
    const request = store.put(packData);
    
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

/**
 * Get list of all bundled packs (for UI display)
 */
export function getBundledPacks(): BundledPack[] {
  return BUNDLED_PACKS;
}

/**
 * Reset initialization (for development/testing only)
 */
export function resetInitialization(): void {
  localStorage.removeItem(INIT_FLAG_KEY);
  localStorage.removeItem(PACK_VERSION_KEY);
  console.warn('Initialization reset - app will re-extract packs on next load');
}
