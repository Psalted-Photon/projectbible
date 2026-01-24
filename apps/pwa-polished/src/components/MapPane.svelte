<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import L from 'leaflet';
  import type { PlaceInfo } from '@projectbible/core';
  import { openDB } from '../adapters/db';
  import { IndexedDBPlaceStore } from '../adapters/PlaceStore';
  
  export let windowId: string | undefined = undefined;
  
  let mapContainer: HTMLDivElement;
  let searchContainer: HTMLDivElement;
  let map: L.Map | null = null;
  let db: IDBDatabase | null = null;
  let historicalLayers: any[] = [];
  let currentLayerId: number | null = null;
  let currentOverlay: L.GeoJSON | null = null;
  let baseLayers: Record<string, L.Layer> | null = null;
  let baseLayerControl: L.Control.Layers | null = null;
  let placeMarkers: L.LayerGroup | null = null;
  let placeSearchQuery = '';
  let placeSearchStatus = 'Search biblical & ancient places';
  let placeSearchResults: MapPlaceResult[] = [];
  let searchingPlaces = false;
  let loading = true;
  let error: string | null = null;

  type MapPlaceResult = {
    id: string;
    name: string;
    latitude: number;
    longitude: number;
    source: 'study-tools' | 'openbible' | 'pleiades';
    modernName?: string;
    description?: string;
    placeType?: string;
    confidence?: number;
  };

  const placeStore = new IndexedDBPlaceStore();
  
  $: void windowId;
  
  onMount(async () => {
    try {
      // Initialize Leaflet map
      map = L.map(mapContainer, {
        center: [31.7683, 35.2137], // Jerusalem
        zoom: 7,
        zoomControl: true
      });
      
      // Add Esri base layers (matching workbench)
      setupBaseLayers();
      
      if (searchContainer) {
        L.DomEvent.disableClickPropagation(searchContainer);
        L.DomEvent.disableScrollPropagation(searchContainer);
        L.DomEvent.on(searchContainer, 'mousedown touchstart dblclick', L.DomEvent.stopPropagation);
      }

      await loadHistoricalLayers();
      
      loading = false;
    } catch (err) {
      console.error('Map initialization error:', err);
      error = (err instanceof Error ? err.message : String(err)) || 'Failed to initialize map';
      loading = false;
    }
  });
  
  onDestroy(() => {
    if (map) {
      map.remove();
      map = null;
    }
    db = null;
  });
  
  async function loadHistoricalLayers() {
    try {
      db = await openDB();
      if (!db.objectStoreNames.contains('historical_layers')) return;

      const layers = await new Promise<any[]>((resolve, reject) => {
        const tx = db!.transaction('historical_layers', 'readonly');
        const store = tx.objectStore('historical_layers');
        const request = store.getAll();
        request.onsuccess = () => resolve(request.result || []);
        request.onerror = () => reject(request.error);
      });

      historicalLayers = layers
        .map((layer) => ({
          id: layer.id,
          name: layer.displayName || layer.name,
          yearStart: layer.yearStart ?? 0,
          yearEnd: layer.yearEnd ?? 0,
          description: layer.description,
          boundaries: layer.boundaries
        }))
        .sort((a, b) => (a.yearStart ?? 0) - (b.yearStart ?? 0));

      if (historicalLayers.length > 0) {
        await showHistoricalLayer(historicalLayers[0].id);
      }
    } catch (err) {
      console.error('Error loading historical layers:', err);
    }
  }
  
  async function showHistoricalLayer(layerId: number) {
    if (!map) return;
    
    try {
      // Remove current overlay
      if (currentOverlay) {
        map.removeLayer(currentOverlay);
        currentOverlay = null;
      }
      
      // Get GeoJSON for this layer
      const layer = historicalLayers.find((l) => l.id === layerId);
      if (layer?.boundaries) {
        const geojson = layer.boundaries;
        
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
        updateLayerControl();
        console.log(`✓ Displayed layer ${layerId}`);
      }
    } catch (err) {
      console.error('Error showing historical layer:', err);
    }
  }

  function setupBaseLayers() {
    if (!map) return;

    const esriSatellite = L.tileLayer(
      'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
      {
        attribution: 'Tiles © Esri',
        maxZoom: 19
      }
    );

    const esriLabels = L.tileLayer(
      'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}',
      {
        attribution: '',
        maxZoom: 19
      }
    );

    const esriTopo = L.tileLayer(
      'https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}',
      {
        attribution: 'Tiles © Esri — Source: Esri, DeLorme, NAVTEQ, TomTom, Intermap, iPC, USGS, FAO, NPS, NRCAN, GeoBase, Kadaster NL, Ordnance Survey, Esri Japan, METI, Esri China (Hong Kong), and the GIS User Community',
        maxZoom: 19
      }
    );

    const esriStreets = L.tileLayer(
      'https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}',
      {
        attribution: 'Tiles © Esri — Source: Esri, DeLorme, NAVTEQ, USGS, Intermap, iPC, NRCAN, Esri Japan, METI, Esri China (Hong Kong), and the GIS User Community',
        maxZoom: 19
      }
    );

    const esriNatGeo = L.tileLayer(
      'https://server.arcgisonline.com/ArcGIS/rest/services/NatGeo_World_Map/MapServer/tile/{z}/{y}/{x}',
      {
        attribution: 'Tiles © Esri — Source: Esri, i-cubed, USDA, USGS, AEX, GeoEye, Getmapping, Aerogrid, IGN, IGP, UPR-EGP, and the GIS User Community',
        maxZoom: 16
      }
    );

    const satelliteGroup = L.layerGroup([esriSatellite, esriLabels]);

    baseLayers = {
      '🛰️ Satellite': satelliteGroup,
      '🗺️ Topographic': esriTopo,
      '🏙️ Streets': esriStreets,
      '🌍 National Geographic': esriNatGeo
    };

    satelliteGroup.addTo(map);
    updateLayerControl();
  }

  function ensurePlaceMarkers() {
    if (!map) return;
    if (!placeMarkers) {
      placeMarkers = L.layerGroup().addTo(map);
    }
  }

  async function performPlaceSearch() {
    const query = placeSearchQuery.trim();

    if (query.length < 2) {
      placeSearchResults = [];
      placeSearchStatus = 'Enter at least 2 characters';
      return;
    }

    searchingPlaces = true;
    placeSearchStatus = 'Searching biblical & ancient places...';
    console.log('🗺️ Place search started:', { query });
    await logPlaceStoreStats();

    try {
      const [studyTools, openBible, pleiades] = await Promise.all([
        searchStudyToolsPlaces(query),
        searchOpenBiblePlaces(query),
        searchPleiadesPlaces(query)
      ]);

      placeSearchResults = [...studyTools, ...openBible, ...pleiades].slice(0, 50);
      console.log('🗺️ Place search results:', {
        query,
        studyTools: studyTools.length,
        openBible: openBible.length,
        pleiades: pleiades.length,
        total: placeSearchResults.length
      });

      if (placeSearchResults.length === 0) {
        placeSearchStatus = 'No places found. Make sure the Study Tools pack is installed.';
      } else {
        const studyToolsCount = studyTools.length;
        const openBibleCount = openBible.length;
        const pleiadesCount = pleiades.length;
        placeSearchStatus = `Found ${studyToolsCount} study + ${openBibleCount} biblical + ${pleiadesCount} ancient places`;
      }
    } catch (err) {
      console.error('Place search error:', err);
      placeSearchStatus = 'Search failed. Have you imported place packs?';
      placeSearchResults = [];
    } finally {
      searchingPlaces = false;
    }
  }

  async function searchPleiadesPlaces(query: string): Promise<MapPlaceResult[]> {
    const database = await openDB();
    if (!database.objectStoreNames.contains('pleiades_places')) return [];

    const queryLower = query.toLowerCase();
    console.log('🗺️ Pleiades search:', { query, store: 'pleiades_places' });
    return new Promise((resolve) => {
      const tx = database.transaction('pleiades_places', 'readonly');
      const store = tx.objectStore('pleiades_places');
      const index = store.index('title');
      const results: MapPlaceResult[] = [];

      const request = index.openCursor();
      request.onsuccess = (event) => {
        const cursor = (event.target as IDBRequest).result as IDBCursorWithValue | null;
        if (cursor && results.length < 50) {
          const place = cursor.value;
          if (place.title && place.title.toLowerCase().includes(queryLower)) {
            if (place.latitude != null && place.longitude != null) {
              results.push({
                id: place.id,
                name: place.title,
                latitude: place.latitude,
                longitude: place.longitude,
                source: 'pleiades',
                description: place.description,
                placeType: place.placeType
              });
            }
          }
          cursor.continue();
        } else {
          console.log('🗺️ Pleiades search complete:', { count: results.length });
          resolve(results);
        }
      };
      request.onerror = () => resolve(results);
    });
  }

  async function searchStudyToolsPlaces(query: string): Promise<MapPlaceResult[]> {
    try {
      console.log('🗺️ Study tools search:', { query, store: 'places' });
      const places = await placeStore.searchPlaces(query);
      console.log('🗺️ Study tools search complete:', { count: places.length });
      return places
        .filter((place) => place.latitude != null && place.longitude != null)
        .slice(0, 50)
        .map((place) => mapPlaceInfo(place));
    } catch (err) {
      console.warn('Study tools place search unavailable:', err);
      return [];
    }
  }

  function mapPlaceInfo(place: PlaceInfo): MapPlaceResult {
    return {
      id: place.id,
      name: place.name,
      latitude: place.latitude ?? 0,
      longitude: place.longitude ?? 0,
      source: 'study-tools',
      modernName: place.modernCity || place.modernCountry
        ? [place.modernCity, place.modernCountry].filter(Boolean).join(', ')
        : undefined,
      description: place.description,
      placeType: place.type
    };
  }

  async function searchOpenBiblePlaces(query: string): Promise<MapPlaceResult[]> {
    const database = await openDB();
    if (!database.objectStoreNames.contains('openbible_places')) return [];
    if (!database.objectStoreNames.contains('openbible_locations')) return [];
    if (!database.objectStoreNames.contains('openbible_identifications')) return [];

    const queryLower = query.toLowerCase();
    console.log('🗺️ OpenBible search:', { query, store: 'openbible_places' });

    return new Promise((resolve) => {
      const tx = database.transaction(
        ['openbible_places', 'openbible_locations', 'openbible_identifications'],
        'readonly'
      );
      const placesStore = tx.objectStore('openbible_places');
      const identsStore = tx.objectStore('openbible_identifications');
      const locationsStore = tx.objectStore('openbible_locations');
      const placesIndex = placesStore.index('friendlyId');
      const identsIndex = identsStore.index('ancientPlaceId');

      const results: MapPlaceResult[] = [];

      const request = placesIndex.openCursor();
      request.onsuccess = async (event) => {
        const cursor = (event.target as IDBRequest).result as IDBCursorWithValue | null;
        if (cursor && results.length < 25) {
          const place = cursor.value;
          if (place.friendlyId && place.friendlyId.toLowerCase().includes(queryLower)) {
            const idents = await new Promise<any[]>((res) => {
              const identsReq = identsIndex.getAll(place.id);
              identsReq.onsuccess = () => res(identsReq.result || []);
              identsReq.onerror = () => res([]);
            });

            const bestIdent = idents.sort((a, b) => (b.confidence || 0) - (a.confidence || 0))[0];
            if (bestIdent) {
              const location = await new Promise<any | undefined>((res) => {
                const locReq = locationsStore.get(bestIdent.modernLocationId);
                locReq.onsuccess = () => res(locReq.result);
                locReq.onerror = () => res(undefined);
              });

              if (location && location.latitude != null && location.longitude != null) {
                results.push({
                  id: place.id,
                  name: place.friendlyId,
                  latitude: location.latitude,
                  longitude: location.longitude,
                  source: 'openbible',
                  modernName: location.friendlyId,
                  confidence: bestIdent.confidence
                });
              }
            }
          }
          cursor.continue();
        } else {
          console.log('🗺️ OpenBible search complete:', { count: results.length });
          resolve(results);
        }
      };
      request.onerror = () => resolve(results);
    });
  }

  function zoomToPlace(place: MapPlaceResult) {
    if (!map || place.latitude == null || place.longitude == null) return;
    console.log('🗺️ Zooming to place:', place);

    ensurePlaceMarkers();
    if (!placeMarkers) return;

    placeMarkers.clearLayers();

    const marker = L.marker([place.latitude, place.longitude]);
    marker.addTo(placeMarkers);

    const details: string[] = [];
    if (place.modernName) {
      details.push(`<div>${place.modernName}</div>`);
    }
    if (place.placeType) {
      details.push(`<div><em>${place.placeType}</em></div>`);
    }
    if (place.description) {
      details.push(`<div style="margin-top: 6px;">${place.description}</div>`);
    }
    if (place.confidence != null) {
      details.push(`<div style="margin-top: 6px;">Confidence: ${place.confidence}</div>`);
    }

    marker.bindPopup(`
      <div style="min-width: 180px;">
        <strong>${place.name}</strong>
        ${details.join('')}
      </div>
    `);

    map.flyTo([place.latitude, place.longitude], 11, { animate: true, duration: 1.2 });
    marker.openPopup();
  }

  function updateLayerControl() {
    if (!map || !baseLayers) return;

    if (baseLayerControl) {
      baseLayerControl.remove();
    }

    const overlays: Record<string, L.Layer> = {};
    if (currentOverlay) {
      overlays['📍 Ancient Boundaries'] = currentOverlay;
    }

    baseLayerControl = L.control.layers(baseLayers, overlays, {
      position: 'topright',
      collapsed: false
    }).addTo(map);
  }

  async function logPlaceStoreStats() {
    try {
      const database = await openDB();
      const storeNames = Array.from(database.objectStoreNames);
      const hasPlaces = storeNames.includes('places');
      const hasOpenBible = storeNames.includes('openbible_places');
      const hasPleiades = storeNames.includes('pleiades_places');

      const counts = {
        places: hasPlaces ? await countStore(database, 'places') : null,
        openbible_places: hasOpenBible ? await countStore(database, 'openbible_places') : null,
        pleiades_places: hasPleiades ? await countStore(database, 'pleiades_places') : null
      };

      console.log('🗺️ Place store stats:', {
        storeNames,
        counts
      });
    } catch (err) {
      console.warn('🗺️ Failed to read place store stats:', err);
    }
  }

  function countStore(database: IDBDatabase, storeName: string): Promise<number> {
    return new Promise((resolve, reject) => {
      const tx = database.transaction(storeName, 'readonly');
      const store = tx.objectStore(storeName);
      const request = store.count();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }
  
</script>

<div class="map-pane">
  {#if loading}
    <div class="loading">
      <h2><span class="emoji">🗺️</span> Loading Map...</h2>
      <p>Initializing Leaflet and loading biblical geography</p>
    </div>
  {:else if error}
    <div class="error">
      <h2><span class="emoji">⚠️</span> Map Error</h2>
      <p>{error}</p>
      <p class="hint">Basic map functionality may still work</p>
    </div>
  {/if}
  
  <div class="map-container" bind:this={mapContainer}></div>

  <div
    class="place-search"
    bind:this={searchContainer}
    on:mousedown|stopPropagation
    on:click|stopPropagation
    on:touchstart|stopPropagation
  >
    <div class="place-search-bar">
      <input
        type="text"
        placeholder="Search a place (e.g., Jerusalem)"
        bind:value={placeSearchQuery}
        on:keydown={(e) => e.key === 'Enter' && performPlaceSearch()}
      />
      <button on:click={performPlaceSearch} disabled={searchingPlaces}>
        <span class="emoji">🔍</span>
      </button>
    </div>
    <div class="place-search-status">{placeSearchStatus}</div>
    {#if placeSearchResults.length > 0}
      <div class="place-search-results">
        {#each placeSearchResults as place}
          <button class="place-result" on:click={() => zoomToPlace(place)}>
            <div class="place-result-name">{place.name}</div>
            {#if place.modernName || place.placeType}
              <div class="place-result-meta">
                {[place.modernName, place.placeType].filter(Boolean).join(' • ')}
              </div>
            {/if}
          </button>
        {/each}
      </div>
    {/if}
  </div>
  
  {#if historicalLayers.length > 0 && !loading}
    <div class="layer-selector">
      <h3>Time Period</h3>
      <select
        bind:value={currentLayerId}
        on:change={(e) => showHistoricalLayer(Number((e.currentTarget as HTMLSelectElement).value))}
      >
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

  .place-search {
    position: absolute;
    top: 10px;
    left: 10px;
    background: rgba(26, 26, 26, 0.95);
    border: 1px solid rgba(255, 255, 255, 0.08);
    padding: 12px;
    border-radius: 8px;
    box-shadow: 0 6px 16px rgba(0, 0, 0, 0.35);
    z-index: 1000;
    width: min(360px, 90vw);
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .place-search-bar {
    display: flex;
    gap: 8px;
  }

  .place-search-bar input {
    flex: 1;
    background: #1d1d1d;
    border: 1px solid #333;
    color: #e6e6e6;
    padding: 8px 10px;
    border-radius: 6px;
    font-size: 14px;
  }

  .place-search-bar input:focus {
    outline: none;
    border-color: #667eea;
  }

  .place-search-bar button {
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    border: none;
    color: white;
    padding: 8px 12px;
    border-radius: 6px;
    cursor: pointer;
    font-size: 16px;
  }

  .place-search-bar button:disabled {
    opacity: 0.6;
    cursor: default;
  }

  .place-search-status {
    font-size: 12px;
    color: #b0b0b0;
  }

  .place-search-results {
    max-height: 240px;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .place-result {
    text-align: left;
    background: #202020;
    border: 1px solid rgba(255, 255, 255, 0.08);
    color: #f0f0f0;
    padding: 8px 10px;
    border-radius: 6px;
    cursor: pointer;
  }

  .place-result:hover {
    border-color: #667eea;
  }

  .place-result-name {
    font-size: 14px;
    font-weight: 600;
  }

  .place-result-meta {
    font-size: 12px;
    color: #9a9a9a;
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
