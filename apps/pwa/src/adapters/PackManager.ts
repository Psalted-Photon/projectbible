import type { PackManager, PackInfo } from '@projectbible/core';
import { readTransaction, writeTransaction, batchWriteTransaction, type DBPack, type DBVerse } from './db.js';

export class IndexedDBPackManager implements PackManager {
  async listInstalled(): Promise<PackInfo[]> {
    try {
      const db = await import('./db.js').then(m => m.openDB());
      
      return new Promise((resolve, reject) => {
        const transaction = db.transaction('packs', 'readonly');
        const store = transaction.objectStore('packs');
        const request = store.getAll();
        
        request.onsuccess = () => {
          const dbPacks = request.result as DBPack[];
          const packs: PackInfo[] = dbPacks.map(p => ({
            id: p.id,
            version: p.version,
            type: p.type,
            translationId: p.translationId,
            translationName: p.translationName,
            license: p.license,
            size: p.size,
            installedAt: new Date(p.installedAt)
          }));
          
          resolve(packs);
        };
        
        request.onerror = () => reject(request.error);
      });
    } catch (error) {
      console.error('Error listing packs:', error);
      return [];
    }
  }

  async install(source: string | File): Promise<void> {
    if (typeof source === 'string') {
      throw new Error('URL-based pack installation not yet implemented');
    }
    
    // For File objects, we'll implement import from SQLite
    throw new Error('Pack installation requires importPackFromSQLite helper - see pack-import.ts');
  }

  async remove(packId: string): Promise<void> {
    try {
      // Get the pack to find its translationId
      const pack = await readTransaction<DBPack | undefined>(
        'packs',
        (store) => store.get(packId)
      );
      
      if (!pack) {
        throw new Error(`Pack ${packId} not found`);
      }
      
      // Remove pack metadata
      await writeTransaction(
        'packs',
        (store) => store.delete(packId)
      );
      
      // Remove all verses for this translation (if it's a text pack)
      if (pack.type === 'text' && pack.translationId) {
        const db = await import('./db.js').then(m => m.openDB());
        
        await new Promise<void>((resolve, reject) => {
          const transaction = db.transaction('verses', 'readwrite');
          const store = transaction.objectStore('verses');
          const index = store.index('translationId');
          
          const range = IDBKeyRange.only(pack.translationId);
          const request = index.openCursor(range);
          
          request.onsuccess = () => {
            const cursor = request.result;
            if (cursor) {
              cursor.delete();
              cursor.continue();
            }
          };
          
          transaction.oncomplete = () => resolve();
          transaction.onerror = () => reject(transaction.error);
        });
      }
      
      console.log(`Pack ${packId} removed successfully`);
    } catch (error) {
      console.error('Error removing pack:', error);
      throw error;
    }
  }

  async isInstalled(packId: string): Promise<boolean> {
    try {
      const pack = await readTransaction<DBPack | undefined>(
        'packs',
        (store) => store.get(packId)
      );
      
      return !!pack;
    } catch (error) {
      console.error('Error checking if pack is installed:', error);
      return false;
    }
  }
}
