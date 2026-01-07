import type { PlaceStore, PlaceInfo, BCV } from '@projectbible/core';
import { readTransaction, writeTransaction } from './db';
import type { DBPlace } from './db';

/**
 * IndexedDB implementation of PlaceStore
 * Provides biblical geography and place information
 */
export class IndexedDBPlaceStore implements PlaceStore {
  
  /**
   * Get place information by ID
   * @param placeId - Unique place identifier
   */
  async getPlace(placeId: string): Promise<PlaceInfo | null> {
    const place = await readTransaction<DBPlace>(
      'places',
      (store) => store.get(placeId)
    );
    
    if (!place) return null;
    
    return this.dbToPlace(place);
  }

  /**
   * Find places mentioned in a specific verse
   * @param reference - Bible verse reference
   */
  async getPlacesForVerse(reference: BCV): Promise<PlaceInfo[]> {
    return new Promise((resolve, reject) => {
      readTransaction<DBPlace[]>(
        'places',
        (store) => store.getAll()
      ).then(allPlaces => {
        const matchingPlaces = allPlaces.filter(place => {
          if (!place.verses) return false;
          
          const verses = typeof place.verses === 'string' 
            ? JSON.parse(place.verses) 
            : place.verses;
          
          return verses.some((v: BCV) => 
            v.book === reference.book &&
            v.chapter === reference.chapter &&
            v.verse === reference.verse
          );
        });
        
        resolve(matchingPlaces.map(p => this.dbToPlace(p)));
      }).catch(reject);
    });
  }

  /**
   * Search places by name (case-insensitive, supports partial matches)
   * @param query - Search term
   */
  async searchPlaces(query: string): Promise<PlaceInfo[]> {
    const lowerQuery = query.toLowerCase();
    
    return new Promise((resolve, reject) => {
      readTransaction<DBPlace[]>(
        'places',
        (store) => store.getAll()
      ).then(allPlaces => {
        const matches = allPlaces.filter(place => {
          // Check main name
          if (place.name.toLowerCase().includes(lowerQuery)) {
            return true;
          }
          
          // Check alternate names
          if (place.altNames) {
            const altNames = typeof place.altNames === 'string'
              ? JSON.parse(place.altNames)
              : place.altNames;
            
            return altNames.some((alt: string) => 
              alt.toLowerCase().includes(lowerQuery)
            );
          }
          
          return false;
        });
        
        resolve(matches.map(p => this.dbToPlace(p)));
      }).catch(reject);
    });
  }

  // ===== Conversion helpers =====

  private dbToPlace(db: DBPlace): PlaceInfo {
    return {
      id: db.id,
      name: db.name,
      altNames: db.altNames ? JSON.parse(db.altNames) : undefined,
      latitude: db.latitude,
      longitude: db.longitude,
      verses: db.verses ? JSON.parse(db.verses) : undefined
    };
  }
}
