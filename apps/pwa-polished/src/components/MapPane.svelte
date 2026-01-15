<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import L from 'leaflet';
  import initSqlJs from 'sql.js';
  
  export let windowId: string | undefined = undefined;
  
  let mapContainer: HTMLDivElement;
  let map: L.Map | null = null;
  let db: any = null;
  let historicalLayers: any[] = [];
  let currentLayerId: number | null = null;
  let currentOverlay: L.GeoJSON | null = null;
  let loading = true;
  let error: string | null = null;
  
  $: void windowId;
  
  onMount(async () => {
    try {
      // Initialize Leaflet map
      map = L.map(mapContainer, {
        center: [31.7683, 35.2137], // Jerusalem
        zoom: 7,
        zoomControl: true
      });
      
      // Add OpenStreetMap tiles
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap contributors',
        maxZoom: 18
      }).addTo(map);
      
      // Load map database
      await loadMapDatabase();
      
      // Load historical layers
      await loadHistoricalLayers();
      
      loading = false;
    } catch (err) {
      console.error('Map initialization error:', err);
      error = err.message || 'Failed to initialize map';
      loading = false;
    }
  });
  
  onDestroy(() => {
    if (map) {
      map.remove();
      map = null;
    }
    if (db) {
      db.close();
      db = null;
    }
  });
  
  async function loadMapDatabase() {
    try {
      // Initialize SQL.js
      const SQL = await initSqlJs({
        locateFile: file => `https://sql.js.org/dist/${file}`
      });
      
      // Try to load maps.sqlite from IndexedDB
      const packDb = await openIndexedDB();
      const blob = await getPackFromDB(packDb, 'maps.sqlite');
      
      if (!blob) {
        throw new Error('maps.sqlite not found in IndexedDB');
      }
      
      const buffer = await blob.arrayBuffer();
      db = new SQL.Database(new Uint8Array(buffer));
      
      console.log('✓ Loaded maps.sqlite');
    } catch (err) {
      console.warn('Could not load maps.sqlite:', err);
      // Continue without database - show basic map
    }
  }
  
  async function loadHistoricalLayers() {
    if (!db) return;
    
    try {
      const result = db.exec(`
        SELECT id, name, year_start, year_end, description 
        FROM historical_layers 
        ORDER BY year_start
      `);
      
      if (result.length > 0 && result[0].values.length > 0) {
        historicalLayers = result[0].values.map((row: any[]) => ({
          id: row[0],
          name: row[1],
          yearStart: row[2],
          yearEnd: row[3],
          description: row[4]
        }));
        
        console.log(`✓ Loaded ${historicalLayers.length} historical layers`);
        
        // Load first layer by default
        if (historicalLayers.length > 0) {
          await showHistoricalLayer(historicalLayers[0].id);
        }
      }
    } catch (err) {
      console.error('Error loading historical layers:', err);
    }
  }
  
  async function showHistoricalLayer(layerId: number) {
    if (!db || !map) return;
    
    try {
      // Remove current overlay
      if (currentOverlay) {
        map.removeLayer(currentOverlay);
        currentOverlay = null;
      }
      
      // Get GeoJSON for this layer
      const result = db.exec(`
        SELECT geojson FROM historical_layers WHERE id = ?
      `, [layerId]);
      
      if (result.length > 0 && result[0].values.length > 0) {
        const geojsonStr = result[0].values[0][0];
        const geojson = JSON.parse(geojsonStr);
        
        // Add to map
        currentOverlay = L.geoJSON(geojson, {
          style: {
            color: '#ff7800',
            weight: 2,
            opacity: 0.8,
            fillOpacity: 0.1
          },
          onEachFeature: (feature, layer) => {
            if (feature.properties && feature.properties.name) {
              layer.bindPopup(`<strong>${feature.properties.name}</strong>`);
            }
          }
        }).addTo(map);
        
        currentLayerId = layerId;
        console.log(`✓ Displayed layer ${layerId}`);
      }
    } catch (err) {
      console.error('Error showing historical layer:', err);
    }
  }
  
  function openIndexedDB(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open('ProjectBible_Packs', 1);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
    });
  }
  
  function getPackFromDB(db: IDBDatabase, packId: string): Promise<Blob | null> {
    return new Promise((resolve, reject) => {
      const tx = db.transaction('packs', 'readonly');
      const store = tx.objectStore('packs');
      const request = store.get(packId);
      
      request.onsuccess = () => {
        const result = request.result;
        resolve(result ? result.blob : null);
      };
      request.onerror = () => reject(request.error);
    });
  }
</script>

<div class="map-pane">
  {#if loading}
    <div class="loading">
      <h2>🗺️ Loading Map...</h2>
      <p>Initializing Leaflet and loading biblical geography</p>
    </div>
  {:else if error}
    <div class="error">
      <h2>⚠️ Map Error</h2>
      <p>{error}</p>
      <p class="hint">Basic map functionality may still work</p>
    </div>
  {/if}
  
  <div class="map-container" bind:this={mapContainer}></div>
  
  {#if historicalLayers.length > 0 && !loading}
    <div class="layer-selector">
      <h3>Time Period</h3>
      <select bind:value={currentLayerId} on:change={(e) => showHistoricalLayer(Number(e.target.value))}>
        {#each historicalLayers as layer}
          <option value={layer.id}>
            {layer.name} ({layer.yearStart} - {layer.yearEnd})
          </option>
        {/each}
      </select>
    </div>
  {/if}
</div>

<style>
  .map-pane {
    width: 100%;
    height: 100%;
    background: #1a1a1a;
    position: relative;
  }

  .loading, .error {
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    text-align: center;
    color: #888;
    z-index: 1000;
    padding: 20px;
    background: rgba(26, 26, 26, 0.95);
    border-radius: 8px;
  }

  .loading h2, .error h2 {
    font-size: 24px;
    margin-bottom: 12px;
  }

  .loading p, .error p {
    font-size: 14px;
    color: #666;
  }

  .map-container {
    width: 100%;
    height: 100%;
  }

  .layer-selector {
    position: absolute;
    top: 10px;
    right: 10px;
    background: rgba(42, 42, 42, 0.95);
    padding: 12px;
    border-radius: 4px;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
    z-index: 1000;
    min-width: 300px;
  }

  .layer-selector h3 {
    font-size: 14px;
    color: #f0f0f0;
    margin-bottom: 8px;
  }

  .layer-selector select {
    width: 100%;
    padding: 8px;
    background: #1a1a1a;
    color: #e0e0e0;
    border: 1px solid #444;
    border-radius: 4px;
    font-size: 13px;
    cursor: pointer;
  }

  .layer-selector select:focus {
    outline: none;
    border-color: #666;
  }

  /* Import Leaflet CSS */
  :global(.leaflet-container) {
    background: #1a1a1a;
  }
</style>
