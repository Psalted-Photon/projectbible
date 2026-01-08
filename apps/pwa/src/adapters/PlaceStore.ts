import type { PlaceStore, PlaceInfo, BCV, PlaceAppearance, BoundingBox } from '@projectbible/core';
import { readTransaction, writeTransaction } from './db';
import type { DBPlace, DBPlaceNameLink } from './db';

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
          
          // Check historical names
          if (place.historicalNames) {
            const historicalNames = typeof place.historicalNames === 'string'
              ? JSON.parse(place.historicalNames)
              : place.historicalNames;
            
            return historicalNames.some((h: any) =>
              h.name.toLowerCase().includes(lowerQuery)
            );
          }
          
          return false;
        });
        
        resolve(matches.map(p => this.dbToPlace(p)));
      }).catch(reject);
    });
  }

  /**
   * Get place by exact name match (checks all historical names)
   * @param name - Exact place name
   * @param period - Optional time period filter
   */
  async getPlaceByName(name: string, period?: string): Promise<PlaceInfo | null> {
    const lowerName = name.toLowerCase();
    
    // First try to find via place_name_links for fast lookup
    try {
      const db = await import('./db.js').then(m => m.openDB());
      
      const link = await new Promise<DBPlaceNameLink | undefined>((resolve, reject) => {
        const transaction = db.transaction('place_name_links', 'readonly');
        const store = transaction.objectStore('place_name_links');
        const index = store.index('normalizedWord');
        
        const range = IDBKeyRange.only(lowerName);
        const request = index.get(range);
        
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      
      if (link) {
        return this.getPlace(link.placeId);
      }
    } catch (error) {
      console.error('Error looking up place name link:', error);
    }
    
    // Fallback to searching all places
    const places = await this.searchPlaces(name);
    return places.find(p => p.name.toLowerCase() === lowerName) || null;
  }

  /**
   * Get all places within a bounding box (for map view)
   * @param bounds - Geographic bounding box
   */
  async getPlacesInBounds(bounds: BoundingBox): Promise<PlaceInfo[]> {
    return new Promise((resolve, reject) => {
      readTransaction<DBPlace[]>(
        'places',
        (store) => store.getAll()
      ).then(allPlaces => {
        const matches = allPlaces.filter(place => {
          if (!place.latitude || !place.longitude) return false;
          
          return place.latitude >= bounds.south &&
                 place.latitude <= bounds.north &&
                 place.longitude >= bounds.west &&
                 place.longitude <= bounds.east;
        });
        
        resolve(matches.map(p => this.dbToPlace(p)));
      }).catch(reject);
    });
  }

  /**
   * Get places by type (cities, mountains, rivers, etc.)
   * @param type - Place type filter
   */
  async getPlacesByType(type: PlaceInfo['type']): Promise<PlaceInfo[]> {
    try {
      const db = await import('./db.js').then(m => m.openDB());
      
      return new Promise((resolve, reject) => {
        const transaction = db.transaction('places', 'readonly');
        const store = transaction.objectStore('places');
        const index = store.index('type');
        
        const range = IDBKeyRange.only(type);
        const request = index.getAll(range);
        
        request.onsuccess = () => {
          const dbPlaces = request.result as DBPlace[];
          resolve(dbPlaces.map(p => this.dbToPlace(p)));
        };
        
        request.onerror = () => reject(request.error);
      });
    } catch (error) {
      console.error('Error getting places by type:', error);
      return [];
    }
  }

  /**
   * Get place appearances for a specific time period
   * @param placeId - Place identifier
   * @param period - Time period
   */
  async getPlaceAppearance(placeId: string, period: string): Promise<PlaceAppearance | null> {
    try {
      const place = await this.getPlace(placeId);
      if (!place || !place.appearances) return null;
      
      const appearance = place.appearances.find(a => a.period === period);
      return appearance || null;
    } catch (error) {
      console.error('Error getting place appearance:', error);
      return null;
    }
  }

  // ===== Conversion helpers =====

  private dbToPlace(db: DBPlace): PlaceInfo {
    return {
      id: db.id,
      name: db.name,
      altNames: db.altNames ? JSON.parse(db.altNames) : undefined,
      latitude: db.latitude,
      longitude: db.longitude,
      modernCity: db.modernCity,
      modernCountry: db.modernCountry,
      region: db.region,
      historicalNames: db.historicalNames ? JSON.parse(db.historicalNames) : undefined,
      appearances: db.appearances ? JSON.parse(db.appearances) : undefined,
      verses: db.verses ? JSON.parse(db.verses) : undefined,
      firstMention: db.firstMention ? JSON.parse(db.firstMention) : undefined,
      significance: db.significance,
      events: db.events ? JSON.parse(db.events) : undefined,
      people: db.people ? JSON.parse(db.people) : undefined,
      type: db.type,
      elevation: db.elevation,
      description: db.description
    };
  }
}
