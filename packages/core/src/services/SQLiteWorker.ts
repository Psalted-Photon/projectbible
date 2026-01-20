/**
 * SQLite Worker - Single Global Worker for All SQLite Operations
 * 
 * Architecture:
 * - ONE persistent sql.js WASM instance
 * - Multiple database handles managed in worker context
 * - Simple message router for query dispatch
 * - NO worker pool (SQLite is single-threaded internally)
 * 
 * Benefits:
 * - Faster initialization (WASM loaded once)
 * - Lower memory footprint
 * - Simpler concurrency model
 * - No main thread blocking
 */

import type { Database as SQLiteDatabase } from 'sql.js';

// Extended database interface with methods that sql.js has but aren't in types
interface ExtendedDatabase extends SQLiteDatabase {
  prepare(sql: string): any;
  export(): Uint8Array;
}

interface WorkerMessage {
  id: string;
  action: 'init' | 'open' | 'query' | 'exec' | 'close' | 'extractPack';
  dbId?: string;
  data?: any;
}

interface WorkerResponse {
  id: string;
  success: boolean;
  data?: any;
  error?: string;
}

// Worker-side state
let SQL: any = null;
const databases = new Map<string, SQLiteDatabase>();

// Initialize sql.js WASM
async function initialize(): Promise<void> {
  if (SQL) return; // Already initialized
  
  const initSqlJs = (await import('sql.js')).default;
  SQL = await initSqlJs({
    locateFile: (file: string) => `/${file}`
  });
}

// Open or create a database
function openDatabase(dbId: string, data?: Uint8Array): void {
  if (databases.has(dbId)) {
    return; // Already open
  }
  
  const db = data ? new SQL.Database(data) : new SQL.Database();
  databases.set(dbId, db as ExtendedDatabase);
}

// Execute a query
function executeQuery(dbId: string, sql: string, params?: any[]): any[] {
  const db = databases.get(dbId) as ExtendedDatabase | undefined;
  if (!db) {
    throw new Error(`Database ${dbId} not open`);
  }
  
  const stmt = db.prepare(sql);
  if (params) {
    stmt.bind(params);
  }
  
  const results: any[] = [];
  while (stmt.step()) {
    results.push(stmt.getAsObject());
  }
  stmt.free();
  
  return results;
}

// Execute SQL without returning results
function executeExec(dbId: string, sql: string): void {
  const db = databases.get(dbId) as ExtendedDatabase | undefined;
  if (!db) {
    throw new Error(`Database ${dbId} not open`);
  }
  
  db.exec(sql);
}

// Close a database
function closeDatabase(dbId: string): void {
  const db = databases.get(dbId) as ExtendedDatabase | undefined;
  if (db) {
    db.close();
    databases.delete(dbId);
  }
}

// Extract pack data to IndexedDB-ready format
async function extractPack(dbId: string, packType: string): Promise<any> {
  const db = databases.get(dbId) as ExtendedDatabase | undefined;
  if (!db) {
    throw new Error(`Database ${dbId} not open`);
  }
  
  const extraction: any = {
    metadata: {},
    data: {}
  };
  
  // Extract metadata
  const metadataStmt = db.prepare('SELECT key, value FROM metadata');
  while (metadataStmt.step()) {
    const row = metadataStmt.getAsObject();
    extraction.metadata[row.key as string] = row.value;
  }
  metadataStmt.free();
  
  // Extract data based on pack type
  switch (packType) {
    case 'translation': {
      // Extract verses
      const verses: any[] = [];
      const verseStmt = db.prepare('SELECT * FROM verses ORDER BY book, chapter, verse');
      while (verseStmt.step()) {
        verses.push(verseStmt.getAsObject());
      }
      verseStmt.free();
      extraction.data.verses = verses;
      
      // Extract morphology if exists
      try {
        const morphology: any[] = [];
        const morphStmt = db.prepare('SELECT * FROM morphology ORDER BY book, chapter, verse, word_order');
        while (morphStmt.step()) {
          morphology.push(morphStmt.getAsObject());
        }
        morphStmt.free();
        extraction.data.morphology = morphology;
      } catch (e) {
        // No morphology table, that's ok
      }
      break;
    }
    
    case 'lexicon': {
      // Extract lexical entries
      const entries: any[] = [];
      const entryStmt = db.prepare('SELECT * FROM entries');
      while (entryStmt.step()) {
        entries.push(entryStmt.getAsObject());
      }
      entryStmt.free();
      extraction.data.entries = entries;
      break;
    }
    
    case 'maps': {
      // Extract map data
      const layers: any[] = [];
      const layerStmt = db.prepare('SELECT * FROM historical_layers');
      while (layerStmt.step()) {
        layers.push(layerStmt.getAsObject());
      }
      layerStmt.free();
      extraction.data.layers = layers;
      break;
    }
    
    case 'cross-references': {
      // Extract cross-references
      const refs: any[] = [];
      const refStmt = db.prepare('SELECT * FROM cross_references');
      while (refStmt.step()) {
        refs.push(refStmt.getAsObject());
      }
      refStmt.free();
      extraction.data.crossReferences = refs;
      break;
    }
  }
  
  return extraction;
}

// Message handler
self.onmessage = async (e: MessageEvent<WorkerMessage>) => {
  const { id, action, dbId, data } = e.data;
  
  try {
    let result: any;
    
    switch (action) {
      case 'init':
        await initialize();
        result = { ready: true };
        break;
        
      case 'open':
        await initialize();
        openDatabase(dbId!, data);
        result = { opened: true };
        break;
        
      case 'query':
        result = executeQuery(dbId!, data.sql, data.params);
        break;
        
      case 'exec':
        executeExec(dbId!, data.sql);
        result = { executed: true };
        break;
        
      case 'close':
        closeDatabase(dbId!);
        result = { closed: true };
        break;
        
      case 'extractPack':
        result = await extractPack(dbId!, data.packType);
        break;
        
      default:
        throw new Error(`Unknown action: ${action}`);
    }
    
    const response: WorkerResponse = {
      id,
      success: true,
      data: result
    };
    
    self.postMessage(response);
    
  } catch (error) {
    const response: WorkerResponse = {
      id,
      success: false,
      error: error instanceof Error ? error.message : String(error)
    };
    
    self.postMessage(response);
  }
};

// Export types for main thread
export type { WorkerMessage, WorkerResponse };
