import type { MapStore, BoundingBox, MapTile, HistoricalMapLayer } from '@projectbible/core';
import { readTransaction, type DBMapTile, type DBHistoricalLayer } from './db.js';

export class IndexedDBMapStore implements MapStore {
  async getBaseTiles(zoom: number, bounds: BoundingBox): Promise<MapTile[]> {
    try {
      const db = await import('./db.js').then(m => m.openDB());
      
      return new Promise((resolve, reject) => {
        const transaction = db.transaction('map_tiles', 'readonly');
        const store = transaction.objectStore('map_tiles');
        const index = store.index('zoom');
        
        const range = IDBKeyRange.only(zoom);
        const request = index.getAll(range);
        
        request.onsuccess = () => {
          const dbTiles = request.result as DBMapTile[];
          
          // Filter tiles within bounds
          // TODO: Implement proper tile coordinate filtering based on bounds
          const tiles: MapTile[] = dbTiles.map(t => ({
            zoom: t.zoom,
            x: t.x,
            y: t.y,
            data: t.tileData
          }));
          
          resolve(tiles);
        };
        
        request.onerror = () => reject(request.error);
      });
    } catch (error) {
      console.error('Error getting base tiles:', error);
      return [];
    }
  }

  async getTile(zoom: number, x: number, y: number): Promise<MapTile | null> {
    try {
      const id = `${zoom}-${x}-${y}`;
      const dbTile = await readTransaction<DBMapTile | undefined>(
        'map_tiles',
        (store) => store.get(id)
      );
      
      if (!dbTile) return null;
      
      return {
        zoom: dbTile.zoom,
        x: dbTile.x,
        y: dbTile.y,
        data: dbTile.tileData
      };
    } catch (error) {
      console.error('Error getting tile:', error);
      return null;
    }
  }

  async getHistoricalLayer(layerId: string): Promise<HistoricalMapLayer | null> {
    try {
      const dbLayer = await readTransaction<DBHistoricalLayer | undefined>(
        'historical_layers',
        (store) => store.get(layerId)
      );
      
      if (!dbLayer) return null;
      
      return this.dbLayerToLayer(dbLayer);
    } catch (error) {
      console.error('Error getting historical layer:', error);
      return null;
    }
  }

  async getTimePeriods(): Promise<HistoricalMapLayer[]> {
    try {
      const db = await import('./db.js').then(m => m.openDB());
      
      return new Promise((resolve, reject) => {
        const transaction = db.transaction('historical_layers', 'readonly');
        const store = transaction.objectStore('historical_layers');
        const request = store.getAll();
        
        request.onsuccess = () => {
          const dbLayers = request.result as DBHistoricalLayer[];
          const layers = dbLayers.map(l => this.dbLayerToLayer(l));
          
          // Sort by year start
          layers.sort((a, b) => a.yearRange.start - b.yearRange.start);
          
          resolve(layers);
        };
        
        request.onerror = () => reject(request.error);
      });
    } catch (error) {
      console.error('Error getting time periods:', error);
      return [];
    }
  }

  async getLayersForPeriod(period: HistoricalMapLayer['period']): Promise<HistoricalMapLayer[]> {
    try {
      const db = await import('./db.js').then(m => m.openDB());
      
      return new Promise((resolve, reject) => {
        const transaction = db.transaction('historical_layers', 'readonly');
        const store = transaction.objectStore('historical_layers');
        const index = store.index('period');
        
        const range = IDBKeyRange.only(period);
        const request = index.getAll(range);
        
        request.onsuccess = () => {
          const dbLayers = request.result as DBHistoricalLayer[];
          const layers = dbLayers.map(l => this.dbLayerToLayer(l));
          resolve(layers);
        };
        
        request.onerror = () => reject(request.error);
      });
    } catch (error) {
      console.error('Error getting layers for period:', error);
      return [];
    }
  }

  async getLayersForYear(year: number): Promise<HistoricalMapLayer[]> {
    try {
      const allLayers = await this.getTimePeriods();
      
      // Filter layers that include this year
      return allLayers.filter(layer => 
        year >= layer.yearRange.start && year <= layer.yearRange.end
      );
    } catch (error) {
      console.error('Error getting layers for year:', error);
      return [];
    }
  }

  async hasOfflineData(): Promise<boolean> {
    try {
      const db = await import('./db.js').then(m => m.openDB());
      
      return new Promise((resolve, reject) => {
        const transaction = db.transaction('map_tiles', 'readonly');
        const store = transaction.objectStore('map_tiles');
        const request = store.count();
        
        request.onsuccess = () => resolve(request.result > 0);
        request.onerror = () => reject(request.error);
      });
    } catch (error) {
      console.error('Error checking offline data:', error);
      return false;
    }
  }

  private dbLayerToLayer(dbLayer: DBHistoricalLayer): HistoricalMapLayer {
    return {
      id: dbLayer.id,
      name: dbLayer.name,
      displayName: dbLayer.displayName,
      period: dbLayer.period as HistoricalMapLayer['period'],
      yearRange: {
        start: dbLayer.yearStart,
        end: dbLayer.yearEnd
      },
      type: dbLayer.type as HistoricalMapLayer['type'],
      boundaries: dbLayer.boundaries,
      overlayUrl: dbLayer.overlayUrl,
      opacity: dbLayer.opacity,
      description: dbLayer.description,
      attribution: dbLayer.attribution
    };
  }
}
