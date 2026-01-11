# Offline Map Tiles for ProjectBible

**Purpose:** Enable offline access to high-quality biblical geography maps  
**Target Region:** Biblical Lands (Israel, Palestine, Jordan, Lebanon, Syria, Egypt, Iraq, Turkey)  
**Technology:** MBTiles format with Leaflet.js

---

## Overview

The ProjectBible app uses **Esri ArcGIS World Imagery** (satellite) as its primary base map. While this provides excellent quality when online, offline support requires pre-generating and bundling map tiles for the biblical lands region.

### Current Online Map Stack

**Base Maps** (Esri ArcGIS - Free, 2M tiles/month):
- 🛰️ **Satellite** (World Imagery + Labels) - Default
- 🗺️ **Topographic** (World Topo Map)
- 🏙️ **Streets** (World Street Map)
- 🌍 **National Geographic** (Historical aesthetic)

**Overlay Layers**:
- 📖 **Biblical Places** (OpenBible.info - 1,342 places with verse references)
- 🏛️ **Ancient Places** (Pleiades - 41,833 archaeological sites)
- 📍 **Ancient Boundaries** (GeoJSON from AWMC, Pleiades)

---

## Offline Strategy

### Phase 1: MBTiles Generation

Generate offline tile packages for biblical lands region:

**Geographic Bounds:**
- North: 42°N (Southern Turkey)
- South: 24°N (Southern Egypt/Sinai)
- West: 29°E (Nile Delta)
- East: 48°E (Eastern Iraq)

**Zoom Levels:**
- Level 0-4: World context (minimal tiles)
- Level 5-9: Regional overview (biblical lands)
- Level 10-14: City/site detail (Jerusalem, Bethlehem, etc.)
- Level 15-19: Optional high-detail (large file size)

**Recommended Zoom Range:** 5-14 (balance of detail vs. file size)

### Tools for MBTiles Generation

#### Option A: TileMill (Desktop Tool)
**Website:** https://tilemill-project.github.io/tilemill/  
**Pros:** GUI-based, easy to use  
**Cons:** No longer actively maintained

**Steps:**
1. Download TileMill
2. Import Esri World Imagery as source
3. Define biblical lands bounding box
4. Set zoom levels (5-14)
5. Export as MBTiles

#### Option B: mbutil + GDAL (Command Line)
**Website:** https://github.com/mapbox/mbutil  
**Pros:** Scriptable, open source  
**Cons:** Requires technical setup

**Installation:**
```bash
npm install -g mbutil
# or
pip install mbutil
```

**Generate Tiles:**
```bash
# Download region tiles from Esri
gdal_translate -of MBTiles \
  -co TILE_FORMAT=PNG \
  -co ZOOM_LEVEL_STRATEGY=LOWER \
  WMS:"https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer" \
  biblical-lands.mbtiles \
  -projwin 29 42 48 24

# Or use mb-util to convert tile directory to MBTiles
mb-util tiles-directory biblical-lands.mbtiles
```

#### Option C: TileServer GL (Recommended for Production)
**Website:** https://github.com/maptiler/tileserver-gl  
**Pros:** Modern, actively maintained, supports vector + raster tiles  
**Cons:** Requires server setup

**Steps:**
1. Use MapTiler Cloud to generate tiles: https://cloud.maptiler.com/
2. Select Esri World Imagery or similar satellite source
3. Define biblical lands bounding box (29°E-48°E, 24°N-42°N)
4. Set zoom levels 5-14
5. Download MBTiles file
6. Bundle with Electron app or host on CDN

---

## Estimated File Sizes

**Zoom Level 5-14 (Recommended):**
- Satellite imagery: ~500 MB - 1.5 GB (lossy JPEG compression)
- Topographic: ~200 MB - 500 MB (PNG)
- Streets: ~150 MB - 300 MB (PNG)

**Zoom Level 5-16 (High Detail):**
- Satellite imagery: ~3 GB - 8 GB
- Topographic: ~1 GB - 3 GB
- Streets: ~500 MB - 1.5 GB

**Zoom Level 5-19 (Maximum Detail):**
- Satellite imagery: ~15 GB - 50 GB (not recommended)

---

## Implementation in Leaflet.js

### Step 1: Add MBTiles Plugin

Install Leaflet.TileLayer.MBTiles plugin:

```bash
npm install leaflet.tilelayer.mbtiles
```

### Step 2: Load Offline Tiles

```typescript
import 'leaflet.tilelayer.mbtiles';

// Load MBTiles file (bundled with app or downloaded)
const offlineSatellite = L.tileLayer.mbTiles('path/to/biblical-lands-satellite.mbtiles', {
  attribution: 'Tiles © Esri (Offline)',
  minZoom: 5,
  maxZoom: 14
});

// Fallback to online tiles when available
const onlineSatellite = L.tileLayer(
  'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
  {
    attribution: 'Tiles © Esri',
    maxZoom: 19
  }
);

// Check if online, use appropriate layer
if (navigator.onLine) {
  map.addLayer(onlineSatellite);
} else {
  map.addLayer(offlineSatellite);
}

// Switch on connectivity change
window.addEventListener('online', () => {
  map.removeLayer(offlineSatellite);
  map.addLayer(onlineSatellite);
});

window.addEventListener('offline', () => {
  map.removeLayer(onlineSatellite);
  map.addLayer(offlineSatellite);
});
```

### Step 3: Bundle with Electron App

For Electron desktop app, bundle MBTiles in `public/maps/`:

```
apps/electron/public/maps/
  biblical-lands-satellite.mbtiles    (1.2 GB)
  biblical-lands-topo.mbtiles         (400 MB)
  biblical-lands-streets.mbtiles      (250 MB)
```

Load from local filesystem:

```typescript
const { app } = require('electron');
const path = require('path');

const mapPath = path.join(app.getAppPath(), 'public', 'maps', 'biblical-lands-satellite.mbtiles');

const offlineMap = L.tileLayer.mbTiles(mapPath, {
  attribution: 'Tiles © Esri (Offline)',
  minZoom: 5,
  maxZoom: 14
});
```

---

## Offline Map Architecture

```
ProjectBible Map System
│
├─ Online Mode (Default)
│  ├─ Esri World Imagery (Satellite)
│  ├─ Esri World Topo Map
│  ├─ Esri World Street Map
│  └─ Esri National Geographic
│
├─ Offline Mode (Fallback)
│  ├─ Biblical Lands Satellite (MBTiles)
│  ├─ Biblical Lands Topo (MBTiles)
│  └─ Biblical Lands Streets (MBTiles)
│
└─ Overlay Layers (Always Available - from IndexedDB)
   ├─ Biblical Places (OpenBible.info SQLite)
   ├─ Ancient Places (Pleiades SQLite)
   └─ Ancient Boundaries (GeoJSON from packs)
```

---

## Licensing & Legal

### Esri ArcGIS Tiles
**License:** Free for educational/non-commercial use  
**Offline Caching:** Allowed for non-commercial educational apps  
**Attribution Required:** "Tiles © Esri"  
**Terms:** https://developers.arcgis.com/terms/

**Key Points:**
✅ Can cache tiles for offline use  
✅ Educational/religious use permitted  
✅ Must include attribution  
❌ Cannot redistribute tiles separately  
❌ Cannot use for commercial purposes without license

### Alternative: OpenStreetMap Tiles
**License:** Open Database License (ODbL)  
**Offline Caching:** Fully allowed  
**Attribution Required:** "© OpenStreetMap contributors"  
**Self-Hosting:** Allowed and encouraged

---

## Recommended Implementation Timeline

### Phase 1: Online-Only (Current - COMPLETE)
✅ Esri ArcGIS base maps  
✅ Layer control (satellite, topo, streets, natgeo)  
✅ OpenBible + Pleiades overlays  
✅ Place search and zoom

### Phase 2: Offline Preparation (1-2 weeks)
1. Generate MBTiles for biblical lands (zoom 5-14)
2. Test MBTiles with Leaflet.TileLayer.MBTiles plugin
3. Implement online/offline detection and switching
4. Bundle with Electron app

### Phase 3: Hybrid Mode (2-3 weeks)
1. Progressive download: Allow users to download offline tiles
2. Storage in IndexedDB or filesystem (Electron)
3. Cache management UI (view size, delete regions)
4. Automatic sync when online

### Phase 4: Advanced Offline (Future)
1. Custom region selection (user draws bounding box)
2. Multiple zoom level options (file size vs. detail)
3. Background download with progress indicator
4. Differential updates (only download changed tiles)

---

## Storage Considerations

### Browser (PWA)
**IndexedDB Limits:**
- Chrome: ~80% of disk space available
- Firefox: ~50% of disk space available
- Safari: ~1 GB limit (strict)

**Recommendation:** Offer optional offline download, not bundled by default

### Electron Desktop App
**No storage limits** - bundle tiles directly:
- Biblical lands satellite (1.2 GB)
- Biblical lands topo (400 MB)
- Biblical lands streets (250 MB)
- **Total:** ~1.85 GB

**Distribution:**
- Download installer includes maps
- Or: First-run downloads maps in background
- Or: Menu option "Download Offline Maps"

---

## User Experience

### Online Experience (Current)
- High-quality satellite imagery (Esri)
- Smooth panning and zooming
- Multiple base map styles
- Biblical + ancient place overlays

### Offline Experience (Planned)
- Pre-cached satellite tiles (zoom 5-14)
- Biblical lands region fully accessible
- Place search works (data in IndexedDB)
- Slightly lower zoom level than online
- Notification: "Offline mode - using cached maps"

### Hybrid Experience (Future)
- Automatically use cached tiles when offline
- Seamlessly switch to online tiles when connected
- Download additional regions on demand
- Manage cached maps (view size, delete)

---

## Testing Offline Maps

### Chrome DevTools
1. Open DevTools (F12)
2. Network tab → Throttling → Offline
3. Reload app
4. Verify offline tiles load

### Electron
```javascript
// Test offline mode programmatically
app.whenReady().then(() => {
  // Simulate offline
  session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
    if (details.url.includes('arcgisonline.com')) {
      callback({ cancel: true }); // Block online tiles
    } else {
      callback({});
    }
  });
});
```

---

## Next Steps

1. **Generate MBTiles:**
   - Use MapTiler Cloud or TileServer GL
   - Biblical lands region (29°E-48°E, 24°N-42°N)
   - Zoom levels 5-14
   - Output: `biblical-lands-satellite.mbtiles` (~1.2 GB)

2. **Implement Plugin:**
   ```bash
   npm install leaflet.tilelayer.mbtiles
   ```

3. **Add to main.ts:**
   - Load MBTiles when offline
   - Switch layers based on connectivity
   - Show offline indicator

4. **Bundle with Electron:**
   - Place in `public/maps/`
   - Load from local path
   - Update installer size estimates

5. **Test:**
   - Chrome offline mode
   - Electron without internet
   - Verify zoom levels work
   - Check attribution displays

---

## References

- **Leaflet.TileLayer.MBTiles:** https://github.com/Leaflet/Leaflet.TileLayer.MBTiles
- **MBTiles Spec:** https://github.com/mapbox/mbtiles-spec
- **Esri Developer Terms:** https://developers.arcgis.com/terms/
- **MapTiler Cloud:** https://cloud.maptiler.com/
- **TileServer GL:** https://github.com/maptiler/tileserver-gl

---

**Status:** Documentation complete, ready for implementation  
**Priority:** Medium (nice-to-have for Electron app)  
**Estimated Effort:** 1-2 weeks for full offline support
