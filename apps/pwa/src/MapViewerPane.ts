/**
 * MapViewerPane.ts
 * 
 * Divider Pane (DP) component for displaying interactive maps.
 * 
 * Features:
 * - Loads maps-enhanced.sqlite pack from IndexedDB
 * - Renders Leaflet maps with biblical places, journeys, and POIs
 * - Shows place details on click with verse references
 * - Supports journey route visualization with waypoints
 * - Displays ancient empire/province boundaries
 * - Static viewport on pane resize (map doesn't pan)
 * - Max 2 map panes can be open simultaneously
 */

import L from 'leaflet';

interface MapViewerOptions {
  container: HTMLElement;
  initialView?: {
    center: [number, number];
    zoom: number;
  };
  placeId?: string;
  journeyId?: string;
  showJourneys?: boolean;
  showPOIs?: boolean;
  showEmpires?: boolean;
}

interface Place {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  place_type: string | null;
  modern_name: string | null;
  description: string | null;
}

interface PlaceVerse {
  verse_ref: string;
}

interface Journey {
  id: string;
  name: string;
  description: string;
  traveler: string;
}

interface Waypoint {
  sequence: number;
  place_name: string;
  latitude: number;
  longitude: number;
  icon: string | null;
}

interface POI {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  poi_type: string;
  icon: string | null;
  significance: string | null;
}

export class MapViewerPane {
  private map: L.Map | null = null;
  private container: HTMLElement;
  private db: any = null;
  private markers: L.Marker[] = [];
  private journeyLayers: L.LayerGroup[] = [];
  
  constructor(options: MapViewerOptions) {
    this.container = options.container;
    this.initializeMap(options);
  }
  
  /**
   * Initialize Leaflet map
   */
  private async initializeMap(options: MapViewerOptions) {
    // Create map container
    const mapDiv = document.createElement('div');
    mapDiv.style.width = '100%';
    mapDiv.style.height = '100%';
    mapDiv.style.position = 'relative';
    this.container.appendChild(mapDiv);
    
    // Initialize map
    const defaultView = options.initialView || {
      center: [31.7683, 35.2137] as [number, number], // Jerusalem
      zoom: 7
    };
    
    this.map = L.map(mapDiv).setView(defaultView.center, defaultView.zoom);
    
    // Add OpenStreetMap tile layer
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap contributors',
      maxZoom: 18
    }).addTo(this.map);
    
    // Load database
    await this.loadDatabase();
    
    // Load content based on options
    if (options.placeId) {
      await this.showPlace(options.placeId);
    } else if (options.journeyId) {
      await this.showJourney(options.journeyId);
    } else {
      // Default: show overview
      await this.showOverview(options);
    }
    
    // Add controls
    this.addMapControls();
  }
  
  /**
   * Load maps-enhanced.sqlite from IndexedDB
   */
  private async loadDatabase() {
    // TODO: Implement IndexedDB loading
    // For now, this is a placeholder
    console.log('Loading maps-enhanced.sqlite from IndexedDB...');
    
    // In production, this would:
    // 1. Open IndexedDB connection
    // 2. Retrieve maps-enhanced.sqlite blob
    // 3. Initialize SQL.js with the blob
    // 4. Store db reference for queries
  }
  
  /**
   * Show a specific place on the map
   */
  private async showPlace(placeId: string) {
    if (!this.map || !this.db) return;
    
    // Query place data
    const place = await this.getPlace(placeId);
    if (!place) {
      console.error(`Place ${placeId} not found`);
      return;
    }
    
    // Center map on place
    this.map.setView([place.latitude, place.longitude], 12);
    
    // Add marker
    const marker = L.marker([place.latitude, place.longitude])
      .addTo(this.map)
      .bindPopup(this.createPlacePopup(place));
    
    this.markers.push(marker);
    
    // Open popup
    marker.openPopup();
  }
  
  /**
   * Show a journey route on the map
   */
  private async showJourney(journeyId: string) {
    if (!this.map || !this.db) return;
    
    // Query journey data
    const journey = await this.getJourney(journeyId);
    if (!journey) {
      console.error(`Journey ${journeyId} not found`);
      return;
    }
    
    const waypoints = await this.getJourneyWaypoints(journeyId);
    
    // Create layer group for journey
    const journeyLayer = L.layerGroup().addTo(this.map);
    this.journeyLayers.push(journeyLayer);
    
    // Add waypoint markers
    const coords: [number, number][] = [];
    for (const wp of waypoints) {
      coords.push([wp.latitude, wp.longitude]);
      
      const icon = wp.icon || '📍';
      const marker = L.marker([wp.latitude, wp.longitude], {
        icon: L.divIcon({
          html: `<div style="font-size: 24px;">${icon}</div>`,
          className: 'journey-waypoint-icon',
          iconSize: [30, 30]
        })
      })
        .addTo(journeyLayer)
        .bindPopup(`
          <strong>${wp.place_name}</strong><br>
          <em>Waypoint ${wp.sequence} of ${waypoints.length}</em>
        `);
      
      this.markers.push(marker);
    }
    
    // Draw route line
    if (coords.length > 1) {
      L.polyline(coords, {
        color: '#3388ff',
        weight: 3,
        opacity: 0.7,
        dashArray: '10, 5'
      }).addTo(journeyLayer);
    }
    
    // Fit map to journey bounds
    if (coords.length > 0) {
      this.map.fitBounds(L.latLngBounds(coords), { padding: [50, 50] });
    }
  }
  
  /**
   * Show overview with POIs, journeys, and empire boundaries
   */
  private async showOverview(options: MapViewerOptions) {
    if (!this.map || !this.db) return;
    
    if (options.showPOIs) {
      await this.loadPOIs();
    }
    
    if (options.showJourneys) {
      await this.loadAllJourneys();
    }
    
    if (options.showEmpires) {
      await this.loadMapLayers();
    }
  }
  
  /**
   * Load and display all POIs
   */
  private async loadPOIs() {
    if (!this.map || !this.db) return;
    
    const pois = await this.getAllPOIs();
    
    for (const poi of pois) {
      const icon = poi.icon || '⭐';
      const marker = L.marker([poi.latitude, poi.longitude], {
        icon: L.divIcon({
          html: `<div style="font-size: 28px;">${icon}</div>`,
          className: 'poi-icon',
          iconSize: [35, 35]
        })
      })
        .addTo(this.map)
        .bindPopup(this.createPOIPopup(poi));
      
      this.markers.push(marker);
    }
  }
  
  /**
   * Load all journey routes
   */
  private async loadAllJourneys() {
    const journeys = await this.getAllJourneys();
    
    for (const journey of journeys) {
      await this.showJourney(journey.id);
    }
  }
  
  /**
   * Load and display ancient empire/province boundaries
   */
  private async loadMapLayers() {
    if (!this.map || !this.db) return;
    
    const layers = await this.getMapLayers();
    
    for (const layer of layers) {
      try {
        const geojson = JSON.parse(layer.geojson_data);
        
        L.geoJSON(geojson, {
          style: {
            color: '#ff7800',
            weight: 2,
            opacity: 0.6,
            fillOpacity: 0.1
          },
          onEachFeature: (feature, layer) => {
            if (feature.properties && feature.properties.name) {
              layer.bindPopup(`<strong>${feature.properties.name}</strong>`);
            }
          }
        }).addTo(this.map);
      } catch (err) {
        console.error(`Error loading layer: ${layer.name}`, err);
      }
    }
  }
  
  /**
   * Create popup HTML for a place
   */
  private createPlacePopup(place: Place): string {
    let html = `<div class="place-popup">`;
    html += `<h3>${place.name}</h3>`;
    
    if (place.modern_name) {
      html += `<p><em>Modern: ${place.modern_name}</em></p>`;
    }
    
    if (place.description) {
      html += `<p>${place.description}</p>`;
    }
    
    // Add verse references
    const verses = this.getPlaceVerses(place.id);
    if (verses.length > 0) {
      html += `<p><strong>Mentioned in:</strong><br>`;
      html += verses.slice(0, 5).map(v => `<a href="#" data-verse="${v.verse_ref}">${v.verse_ref}</a>`).join(', ');
      if (verses.length > 5) {
        html += ` <em>and ${verses.length - 5} more...</em>`;
      }
      html += `</p>`;
    }
    
    html += `</div>`;
    return html;
  }
  
  /**
   * Create popup HTML for a POI
   */
  private createPOIPopup(poi: POI): string {
    let html = `<div class="poi-popup">`;
    html += `<h3>${poi.name}</h3>`;
    html += `<p><em>${poi.poi_type}</em></p>`;
    
    if (poi.significance) {
      html += `<p>${poi.significance}</p>`;
    }
    
    html += `</div>`;
    return html;
  }
  
  /**
   * Add map control buttons
   */
  private addMapControls() {
    if (!this.map) return;
    
    // Add custom control for toggling layers
    const LayerControl = L.Control.extend({
      onAdd: () => {
        const div = L.DomUtil.create('div', 'map-layer-control');
        div.innerHTML = `
          <button class="layer-btn" data-layer="places">Places</button>
          <button class="layer-btn" data-layer="journeys">Journeys</button>
          <button class="layer-btn" data-layer="pois">POIs</button>
          <button class="layer-btn" data-layer="empires">Empires</button>
        `;
        return div;
      }
    });
    
    new LayerControl({ position: 'topright' }).addTo(this.map);
  }
  
  /**
   * Handle pane resize - keep viewport static
   */
  public handleResize() {
    if (this.map) {
      // Get current center before resize
      const center = this.map.getCenter();
      const zoom = this.map.getZoom();
      
      // Invalidate size (tells Leaflet to recalculate dimensions)
      this.map.invalidateSize({ pan: false });
      
      // Restore center and zoom (prevents map from panning)
      this.map.setView(center, zoom, { animate: false });
    }
  }
  
  /**
   * Cleanup when pane is closed
   */
  public destroy() {
    if (this.map) {
      this.map.remove();
      this.map = null;
    }
    
    this.markers = [];
    this.journeyLayers = [];
  }
  
  // Database query methods (placeholders - will be implemented with SQL.js)
  
  private async getPlace(placeId: string): Promise<Place | null> {
    // TODO: Query database
    return null;
  }
  
  private getPlaceVerses(placeId: string): PlaceVerse[] {
    // TODO: Query database
    return [];
  }
  
  private async getJourney(journeyId: string): Promise<Journey | null> {
    // TODO: Query database
    return null;
  }
  
  private async getJourneyWaypoints(journeyId: string): Promise<Waypoint[]> {
    // TODO: Query database
    return [];
  }
  
  private async getAllPOIs(): Promise<POI[]> {
    // TODO: Query database
    return [];
  }
  
  private async getAllJourneys(): Promise<Journey[]> {
    // TODO: Query database
    return [];
  }
  
  private async getMapLayers(): Promise<any[]> {
    // TODO: Query database
    return [];
  }
}
