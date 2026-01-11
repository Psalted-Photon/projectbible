# Biblical Geographic Data Sources - Comprehensive Research

## Executive Summary

For building a high-end biblical geography game/application with rich map features, we have access to **world-class, open-source datasets** that are more comprehensive than Pleiades alone. The **OpenBible.info Geocoding Data** is the gold standard - professionally curated, drawing from 70+ scholarly sources with 400+ citations, and specifically designed for biblical place identification.

---

## 1. OpenBible.info Bible Geocoding Data ⭐ BEST OVERALL

**Status:** PRODUCTION-READY, OPEN SOURCE (CC-BY-4.0)
**Scope:** Every identifiable place in the Protestant Bible
**GitHub:** https://github.com/openbibleinfo/Bible-Geocoding-Data
**Website:** https://www.openbible.info/geo/

### What It Contains

#### Core Data Files (JSON Lines format)
1. **ancient.jsonl** - Ancient places as mentioned in Bible text
   - Every place referenced in Scripture
   - Disambiguated identifications
   - Cataloged by verse reference
   - Confidence scores for modern identifications
   - Links to 70+ scholarly sources

2. **modern.jsonl** - Modern locations matching ancient places
   - Precise coordinates (lon/lat)
   - Coordinate sources documented
   - 1,000+ high-quality photos (512x512 thumbnails)
   - Satellite imagery for locations without photos
   - Accuracy/precision metadata

3. **geometry.jsonl** - Complex geographic features
   - Rivers (with full path geometry)
   - Regions (with boundary polygons)
   - Isobands (confidence-based region boundaries)
   - Simplified geometry for performance

4. **image.jsonl** - Media metadata
   - 1,000+ photos from Wikimedia Commons
   - Satellite imagery (10m/pixel resolution)
   - Licensing information
   - Attribution data

5. **source.jsonl** - Source documentation
   - 70+ modern sources
   - 400+ unique citations
   - Bible dictionaries, encyclopedias, atlases
   - Timestamps for scholarship trends

#### Geographic Features Included

**Natural Features:**
- ✅ **Mountains** (Mount Hermon, Carmel, Tabor, Sinai region, etc.)
- ✅ **Rivers** (Jordan, Nile, Euphrates, Tigris, etc.) - WITH FULL PATH GEOMETRY
- ✅ **Valleys** (Hinnom, Kidron, Jezreel, etc.)
- ✅ **Bodies of Water** (Sea of Galilee, Dead Sea, Mediterranean) - WITH POLYGONS
- ✅ **Springs/Wells** (En Gedi, Beer-sheba, etc.)
- ✅ **Wilderness Regions** (Sinai, Negev, Arabah, etc.) - WITH BOUNDARY POLYGONS
- ✅ **Islands** (Cyprus, Crete, Malta, Patmos, etc.)
- ✅ **Promontories/Capes**
- ✅ **Mountain Passes**
- ✅ **Forests**

**Human Features:**
- ✅ Settlements (cities, towns, villages)
- ✅ Fortifications
- ✅ Gates
- ✅ Temples/Sanctuaries
- ✅ Roads
- ✅ Districts within settlements
- ✅ Archaeological sites

### Data Quality Features

**Confidence Scoring System:**
- Vote-based scoring (range 0-500+)
- Time-weighted scores (tracking scholarship over decades: 1969-, 1970s, 1980s, 1990s, 2000s, 2010+)
- Best-fit linear regression for identification confidence trends
- Multiple identification options when uncertain

**Geographic Precision:**
- Point coordinates
- Path geometry (for rivers, roads)
- Polygon geometry (for regions, bodies of water)
- Simplified geometry (for performance)
- Isoband polygons (confidence-based region boundaries)
- Precision metadata (settlement, region, probability center, etc.)

**Place Type Classification:**
- `class`: "human", "natural", "special"
- `type`: altar, body of water, campsite, canal, cliff, district, field, ford, forest, fortification, garden, gate, hall, hill, island, mine, mountain, mountain pass, mountain range, mountain ridge, natural area, people group, pool, promontory, region, river, road, rock, room, settlement, spring, stone heap, structure, tree, valley, wadi, well

**Modifiers (Spatial Relationships):**
- `<`: place is inside the identification (e.g., East Gate is in Jerusalem)
- `along`: place is along the identified river
- `near`: place is near the location (with quantified radius)
- `on`: place is on a mountain
- `>`: place is a region surrounding the location

### Linked Data / Semantic Web

Each place links to external ontologies:
- **Wikidata** (semantic database)
- **Wikipedia** articles
- **Pleiades** (ancient places)
- **DARE** (Digital Atlas of the Roman Empire)
- **Biblemapper.com**
- **Faithlife Factbook**
- **TIPNR** (Tyndale House StepBible)
- **UBS** (United Bible Societies)

### Downloadable Formats

**KML/KMZ Files (Google Earth compatible):**
- Complete Bible: https://a.openbible.info/geo/kmls/all.kmz
- By book: https://a.openbible.info/geo/kmls/all-books.kmz
- By chapter: https://a.openbible.info/geo/kmls/all-chapters.kmz
- Most-likely locations only: https://a.openbible.info/geo/kmls/all-most-likely.kmz
- Bodies of water: https://a.openbible.info/geo/kmls/water.kml
- Individual books (Genesis-Revelation): Available per book

**Thumbnail Images:**
- https://a.openbible.info/geo/thumbnails.zip (180 MB)
- 512x512 pixels
- ~1,000 professional photos
- Remaining locations have 10m/pixel satellite imagery

**GeoJSON Files:**
- Thousands of GeoJSON files for complex geometry
- River paths
- Region boundaries
- Water body polygons

### Translation Coverage

Data includes place name variations across 10 English Bible translations:
- CSB, ESV, KJV, LEB, NASB, NET, NIV, NKJV, NLT, NRSV

### Scholarly Rigor

**70+ Modern Sources Including:**
- Bible dictionaries (ISBE, Anchor Bible Dictionary, etc.)
- Encyclopedias
- Atlases (Barrington Atlas, etc.)
- Commentaries
- Archaeological reports

**Confidence Tracking:**
- confidence_yes: no substantial doubt
- confidence_likely: identification is likely
- confidence_map: based on map position
- confidence_mostlikely: most likely of options
- confidence_possible: possible or tentative
- confidence_unlikely: unlikely
- confidence_no: wrong

**Authority Tracking:**
- authority_preserved: location preserves place name
- authority_usually: scholars generally agree
- authority_scholar: one scholar makes identification
- authority_traditional: pre-1800 tradition
- authority_parallel: parallel passage supports
- authority_variant: manuscript variant supports

### Example Data Structure

**Ancient Place (Jerusalem):**
```json
{
  "id": "a15257a",
  "friendly_id": "Jerusalem",
  "type": "settlement",
  "verses": [
    {
      "osis": "Gen.14.18",
      "readable": "Genesis 14:18",
      "sort": "01014018",
      "translations": ["esv", "niv", "kjv", ...],
      "instance_types": {"name": 10}
    },
    ...
  ],
  "identifications": [
    {
      "id": "m8ce03f",
      "id_source": "modern",
      "class": "human",
      "description": "<modern id=\"m8ce03f\">Jerusalem</modern>",
      "score": {
        "vote_average": 30,
        "vote_count": 25,
        "vote_total": 750,
        "time_total": 1000
      },
      "resolutions": [
        {
          "lonlat": "35.2285,31.7780",
          "lonlat_type": "point",
          "land_or_water": "land",
          "ancient_geometry": "point",
          "type": "settlement",
          "best_path_score": 750
        }
      ]
    }
  ],
  "linked_data": {
    "wikidata": {"id": "Q1218"},
    "pleiades": {"id": "678378"},
    "wikipedia_article": {"url": "https://en.wikipedia.org/wiki/Jerusalem"}
  }
}
```

**Modern Location (Jerusalem):**
```json
{
  "id": "m8ce03f",
  "friendly_id": "Jerusalem",
  "lonlat": "35.2285,31.7780",
  "class": "human",
  "type": "settlement",
  "geometry": "point",
  "precision": {
    "type": "settlement",
    "meters": 250,
    "description": "point in modern settlement"
  },
  "coordinates_source": {
    "type": "wikidata",
    "id": "Q1218",
    "url": "https://www.wikidata.org/wiki/Q1218"
  },
  "media": {
    "thumbnail": {
      "file": "m8ce03f.i9a2b3c.jpg",
      "credit": "Photographer Name",
      "credit_url": "https://commons.wikimedia.org/...",
      "description": "panorama of <modern id=\"m8ce03f\">Jerusalem</modern>",
      "image_id": "i9a2b3c"
    }
  },
  "names": [
    {"name": "Jerusalem", "type": "ancient"},
    {"name": "Yerushalayim", "type": "modern"},
    {"name": "Al-Quds", "type": "modern"}
  ]
}
```

**Geometry (Jordan River):**
```json
{
  "id": "g4f2a8b",
  "geometry": "path",
  "geojson_file": "data/geometry/g4f2a8b.geojson",
  "simplified_geojson_file": "data/geometry/g4f2a8b_simplified.geojson",
  "suggested": {
    "label_line": [[35.6, 33.2], [35.6, 31.7]],
    "label_line_horizontal": [[35.5, 32.5], [35.7, 32.5]]
  }
}
```

---

## 2. TIPNR (Tyndale House StepBible Data)

**Status:** OPEN SOURCE
**GitHub:** https://github.com/tyndale/STEPBible-Data
**Integration:** Already linked in OpenBible data via `linked_data.tipnr`

### What It Adds

- **Proper Names Database**: All proper names in Bible (people + places)
- **Geolocations**: Linked to OpenBible coordinates
- **Strong's Numbers**: Lexical integration
- **Manuscript Data**: Textual variant information

### Use Case
- Cross-reference people with places
- Link place mentions to lexical data
- Integrate with Strong's numbers for word studies

---

## 3. Digital Atlas of the Roman Empire (DARE)

**Website:** https://imperium.ahlfeldt.se/
**Data:** https://github.com/DARIAH-DE/dare-atlas
**Integration:** Linked in OpenBible data via `linked_data.dare`

### What It Contains
- Roman Empire roads
- Roman settlements
- Imperial boundaries
- Province borders
- Military sites

### Coverage Period
- Primarily 1st-4th century AD (overlaps with NT period)

### Use Case
- NT-era road networks (Paul's journeys)
- Roman administration
- Military presence
- Trade routes

---

## 4. Satellite Bible Atlas (William Schlegel)

**Website:** http://www.satellitebibleatlas.com/
**Format:** High-resolution imagery + overlays
**License:** Educational use (not fully open source)

### What It Contains
- Satellite imagery of biblical regions
- Historical map overlays
- Regional topography
- Natural geography boundaries
- Visual identification of valleys, mountain ranges, wadis

### Use Case
- **Reference for digitizing natural features**
- Verify wilderness boundaries
- Identify mountain ranges visually
- Trace wadi systems
- Create custom vector boundaries

---

## 5. GeoNames

**Website:** http://www.geonames.org/
**API:** http://www.geonames.org/export/web-services.html
**License:** CC-BY-4.0

### What It Contains
- 11+ million place names worldwide
- Modern geography database
- Elevation data
- Population data
- Administrative boundaries

### Use Case for Biblical Maps
- Modern place names
- Elevation profiles
- Find modern equivalents of ancient places
- Cross-reference with OpenBible modern locations

---

## 6. Natural Earth Data

**Website:** https://www.naturalearthdata.com/
**License:** Public Domain

### What It Contains
- Coastlines
- Rivers
- Lakes
- Mountain ranges
- Country boundaries (modern + historical)
- Physical geography vectors

### Use Case
- Base map layers
- Modern coastlines (for comparison with ancient)
- River systems
- Topography

---

## Implementation Strategy for ProjectBible

### Phase 1: Core Biblical Places (IMMEDIATE)
**Source:** OpenBible.info Bible-Geocoding-Data

**Action Items:**
1. Download complete dataset from GitHub
   - ancient.jsonl
   - modern.jsonl
   - geometry.jsonl
   - image.jsonl
   - source.jsonl

2. Build import script: `scripts/build-openbible-pack.mjs`
   ```javascript
   // Parse JSON Lines format
   // Import ancient places with verse references
   // Import modern locations with coordinates
   // Import geometry (rivers, regions, bodies of water)
   // Link to Pleiades via linked_data.pleiades
   ```

3. Create SQLite pack: `packs/openbible.sqlite`
   ```sql
   CREATE TABLE ancient_places (
     id TEXT PRIMARY KEY,
     friendly_id TEXT,
     type TEXT,
     class TEXT,
     description TEXT,
     confidence_score INTEGER,
     -- Verse references
     verse_references TEXT, -- JSON array
     -- Identification data
     identifications TEXT, -- JSON
     -- Links
     pleiades_id TEXT,
     wikidata_id TEXT,
     wikipedia_url TEXT
   );
   
   CREATE TABLE modern_locations (
     id TEXT PRIMARY KEY,
     friendly_id TEXT,
     longitude REAL,
     latitude REAL,
     class TEXT, -- human, natural, region
     type TEXT, -- settlement, mountain, river, etc.
     precision_type TEXT,
     precision_meters INTEGER,
     geometry_type TEXT, -- point, path, polygon
     geometry_id TEXT,
     -- Media
     thumbnail_file TEXT,
     thumbnail_credit TEXT,
     thumbnail_url TEXT,
     -- Links to ancient places
     ancient_associations TEXT -- JSON
   );
   
   CREATE TABLE place_geometry (
     id TEXT PRIMARY KEY,
     geometry_type TEXT, -- path, polygon, rough_boundary, isobands
     geojson TEXT, -- Full GeoJSON
     simplified_geojson TEXT, -- Simplified for rendering
     confidence_level INTEGER -- For isobands
   );
   
   CREATE TABLE place_images (
     id TEXT PRIMARY KEY,
     file_name TEXT,
     credit TEXT,
     credit_url TEXT,
     description TEXT,
     license TEXT,
     width INTEGER,
     height INTEGER
   );
   ```

4. IndexedDB Schema (for PWA)
   ```typescript
   interface DBAncientPlace {
     id: string;
     name: string;
     type: string;
     class: 'human' | 'natural' | 'special';
     confidenceScore: number;
     verseReferences: string[]; // OSIS format
     modernLocations: string[]; // IDs
     pleiadesId?: string;
     wikidataId?: string;
   }
   
   interface DBModernLocation {
     id: string;
     name: string;
     coordinates: [number, number]; // [lon, lat]
     type: string;
     class: 'human' | 'natural' | 'region';
     precisionMeters: number;
     geometryId?: string;
     thumbnailFile?: string;
     ancientPlaces: string[]; // IDs
   }
   
   interface DBPlaceGeometry {
     id: string;
     type: 'point' | 'path' | 'polygon';
     geoJson: any; // GeoJSON object
     simplified?: any; // Simplified GeoJSON
   }
   ```

### Phase 2: Natural Geography Enhancement
**Sources:** OpenBible geometry.jsonl + Natural Earth + Satellite Bible Atlas

**Goals:**
- Complete river path geometry (Jordan, Nile, Euphrates, etc.)
- Water body polygons (Sea of Galilee, Dead Sea, Mediterranean coastline)
- Wilderness region boundaries (Negev, Sinai, Arabah)
- Mountain range outlines
- Valley paths

**Action Items:**
1. Extract geometry from OpenBible geometry.jsonl
2. Supplement with Natural Earth for modern context
3. Use Satellite Bible Atlas as visual reference for digitizing missing features
4. Create unified natural features layer

### Phase 3: Interactive Map Features

**Map Layers:**
1. **Base Layer** (always visible)
   - Modern coastlines (light gray)
   - Major water bodies (light blue)
   - Topographic hillshade (subtle)

2. **Ancient Places Layer** (toggleable)
   - Settlements (circles, sized by importance)
   - Click to show verse references
   - Thumbnail preview on hover

3. **Natural Features Layer** (toggleable)
   - Mountains (triangle icons)
   - Rivers (blue paths with width variation)
   - Valleys (dashed paths)
   - Wilderness regions (hatched polygons)

4. **Journey/Route Layer** (toggleable)
   - Exodus route
   - Paul's journeys
   - Jesus' ministry locations
   - Abraham's travels

5. **Time Period Filters**
   - Patriarchal Period
   - Exodus
   - Conquest
   - United Kingdom
   - Divided Kingdom
   - Exile
   - NT Period

**Interactive Features:**
- **Search**: Search by place name, type, or verse reference
- **Verse Lookup**: Enter reference → show all places mentioned
- **Book/Chapter View**: Show all places in Genesis, Matthew, etc.
- **Confidence Visualization**: Color-code by identification confidence
- **Photo Gallery**: Click place → see thumbnail → full gallery
- **Journey Mode**: Animate Paul's journeys with timeline
- **Comparison Mode**: Side-by-side ancient vs modern views

### Phase 4: Integration with Existing Features

**Link to Bible Text:**
- Place mention in verse → clickable → map highlights location
- Map place click → show all verses mentioning it
- Cross-reference with existing search functionality

**Link to Lexicons:**
- Place name → Strong's number → lexicon entry
- Etymology and name meaning
- Variant spellings across translations

**Link to Cross-References:**
- Place mentions across different books
- Parallel passages
- Thematic connections

---

## Technical Architecture Recommendations

### Data Storage

**SQLite Packs (downloadable):**
```
packs/
  openbible-ancient-places.sqlite    # Ancient places + verse refs
  openbible-modern-locations.sqlite  # Modern coords + thumbnails
  openbible-geometry.sqlite          # Rivers, regions, polygons
  openbible-images.sqlite            # Photo metadata
  natural-earth-base.sqlite          # Base map layers
  tipnr-integration.sqlite           # People + places links
```

### IndexedDB Structure (in-browser)

```typescript
DB_VERSION = 8

Stores:
- ancient_places (id, name, type, verses[], modernIds[])
- modern_locations (id, name, coords, type, geometryId)
- place_geometry (id, type, geoJson)
- place_images (id, file, credit, url)
- place_verse_refs (verseOsisID, placeIds[]) // For fast verse lookup
- place_journey_routes (journeyId, placeIds[], order)
```

### Map Rendering (Leaflet.js)

```typescript
// Base layers
const baseMaps = {
  'Satellite': L.tileLayer(...),
  'Terrain': L.tileLayer(...),
  'Historical': L.tileLayer(...)
};

// Overlay layers
const overlays = {
  'Ancient Cities': ancientPlacesLayer,
  'Mountains': mountainsLayer,
  'Rivers': riversLayer,
  'Valleys': valleysLayer,
  'Wilderness': wildernessLayer,
  'Water Bodies': waterBodiesLayer,
  'Journeys': journeysLayer
};

// Layer control
L.control.layers(baseMaps, overlays).addTo(map);

// GeoJSON rendering
const riversLayer = L.geoJSON(riverGeometry, {
  style: {
    color: '#4A90E2',
    weight: 2,
    opacity: 0.8
  }
});
```

### Search Functionality

```typescript
async function searchPlaces(query: string, options: {
  type?: 'mountain' | 'river' | 'settlement' | 'all',
  class?: 'natural' | 'human' | 'all',
  minConfidence?: number,
  book?: string,
  chapter?: number
}): Promise<Place[]> {
  // Full-text search across ancient_places
  // Filter by type, class, confidence
  // Return with verse references
  // Include modern location coordinates
}
```

---

## Unified Place Type Schema

Based on OpenBible data, here's the complete place type taxonomy:

### Natural Features
```typescript
type NaturalPlaceType =
  | 'mountain'
  | 'mountain range'
  | 'mountain ridge'
  | 'mountain pass'
  | 'hill'
  | 'valley'
  | 'wadi'
  | 'river'
  | 'spring'
  | 'well'
  | 'body of water' // lakes, seas
  | 'island'
  | 'promontory'
  | 'cliff'
  | 'rock'
  | 'natural area' // wilderness, forest
  | 'forest'
  | 'canal'
  | 'ford';
```

### Human Features
```typescript
type HumanPlaceType =
  | 'settlement' // cities, towns, villages
  | 'fortification'
  | 'gate'
  | 'district in settlement'
  | 'structure' // buildings
  | 'altar'
  | 'hall'
  | 'room'
  | 'garden'
  | 'field'
  | 'pool'
  | 'road'
  | 'mine'
  | 'stone heap'
  | 'campsite'
  | 'settlement and spring';
```

### Regional Features
```typescript
type RegionalPlaceType =
  | 'region' // political regions (Judea, Galilee)
  | 'people group'; // ethnic regions
```

---

## File Naming Conventions

```
scripts/
  build-openbible-ancient.mjs       # Import ancient places
  build-openbible-modern.mjs        # Import modern locations
  build-openbible-geometry.mjs      # Import geometry
  build-openbible-images.mjs        # Download/import images
  build-natural-features.mjs        # Merge natural geography
  build-journey-routes.mjs          # Create journey paths

packs/
  openbible-ancient.sqlite          # 7+ character IDs starting with 'a'
  openbible-modern.sqlite           # 7+ character IDs starting with 'm'
  openbible-geometry.sqlite         # 7+ character IDs starting with 'g'
  openbible-images.sqlite           # 7+ character IDs starting with 'i'
  natural-features.sqlite           # Unified natural geography
  journey-routes.sqlite             # Paul, Jesus, Exodus routes

data-sources/
  openbible/
    ancient.jsonl
    modern.jsonl
    geometry.jsonl
    image.jsonl
    source.jsonl
  natural-earth/
    rivers.geojson
    lakes.geojson
    coastlines.geojson
  thumbnails/                       # 180 MB of 512x512 images
    m8ce03f.i9a2b3c.jpg            # Format: modernId.imageId.jpg
```

---

## Download URLs

```bash
# OpenBible Complete Dataset (GitHub)
git clone https://github.com/openbibleinfo/Bible-Geocoding-Data.git

# OpenBible KML Files
wget https://a.openbible.info/geo/kmls/all.kmz
wget https://a.openbible.info/geo/kmls/all-books.kmz
wget https://a.openbible.info/geo/kmls/all-chapters.kmz
wget https://a.openbible.info/geo/kmls/all-most-likely.kmz
wget https://a.openbible.info/geo/kmls/water.kml

# Thumbnail Images (180 MB)
wget https://a.openbible.info/geo/thumbnails.zip

# TIPNR Data
git clone https://github.com/tyndale/STEPBible-Data.git

# Natural Earth Data
wget https://www.naturalearthdata.com/http//www.naturalearthdata.com/download/10m/physical/ne_10m_rivers_lake_centerlines.zip
wget https://www.naturalearthdata.com/http//www.naturalearthdata.com/download/10m/physical/ne_10m_lakes.zip
wget https://www.naturalearthdata.com/http//www.naturalearthdata.com/download/10m/physical/ne_10m_coastline.zip
```

---

## Next Steps: Implementation Roadmap

### Week 1: Data Acquisition
- [ ] Clone OpenBible repo
- [ ] Download all KML files
- [ ] Download thumbnail images
- [ ] Clone TIPNR repo
- [ ] Download Natural Earth data

### Week 2: Build Scripts
- [ ] Create `build-openbible-ancient.mjs`
- [ ] Create `build-openbible-modern.mjs`
- [ ] Create `build-openbible-geometry.mjs`
- [ ] Test imports with sample data

### Week 3: IndexedDB Integration
- [ ] Update DB schema to version 8
- [ ] Create stores for ancient places
- [ ] Create stores for modern locations
- [ ] Create stores for geometry
- [ ] Test import in PWA

### Week 4: Map Visualization
- [ ] Add GeoJSON layer rendering
- [ ] Implement river paths
- [ ] Implement region boundaries
- [ ] Add layer toggles
- [ ] Test performance

### Week 5: Search & Integration
- [ ] Ancient place search
- [ ] Verse reference lookup
- [ ] Link to bible text
- [ ] Link to cross-references
- [ ] Add thumbnails to results

---

## Summary: Why OpenBible.info is Superior

**Compared to Pleiades:**
- ✅ **Biblical Focus**: Every place is from Scripture, not just Greco-Roman world
- ✅ **Verse References**: Linked to every mention in the Bible
- ✅ **Natural Geography**: Mountains, rivers, valleys, wilderness - not just settlements
- ✅ **Confidence Scores**: Scholarly consensus tracked over decades
- ✅ **Photos**: 1,000+ professional images vs. Pleiades' sparse coverage
- ✅ **Geometry**: Full river paths, region boundaries, water polygons
- ✅ **Modern Equivalent**: Links ancient → modern with precision metadata

**Compared to Other Sources:**
- ✅ **Comprehensive**: 70+ scholarly sources integrated
- ✅ **Open Source**: CC-BY-4.0 license, free to use
- ✅ **Maintained**: Active GitHub repository
- ✅ **Structured**: JSON Lines format, easy to parse
- ✅ **Linked Data**: Wikidata, Pleiades, TIPNR integration
- ✅ **Translation Support**: 10 English Bible versions

**For ProjectBible:**
- ✅ **Perfect Fit**: Designed for biblical geography apps
- ✅ **Ready to Use**: Well-structured, documented data
- ✅ **Extensible**: Can layer with other datasets
- ✅ **Rich Media**: Photos, geometry, metadata all included
- ✅ **Professional**: Scholar-reviewed, source-documented

---

## Conclusion

**Yes, build the unified dataset.** OpenBible.info provides everything needed for a premium biblical geography application:

1. **Ancient places** with verse references
2. **Modern locations** with precise coordinates
3. **Natural geography** (mountains, rivers, valleys, wilderness)
4. **High-quality photos** for every location
5. **Full geometry** for complex features
6. **Confidence scores** for scholarly rigor
7. **Open license** for commercial/personal use

This is **production-ready data** from a trusted, academic source. It's far superior to trying to extract biblical geography from general-purpose datasets like Pleiades.

**Recommendation:** Start with OpenBible as the foundation, then enhance with:
- TIPNR for people-place integration
- Natural Earth for base map layers
- Satellite Bible Atlas for visual reference
- Pleiades for archaeological context (link via OpenBible's linked_data field)

You'll have the **best biblical geography application possible** with this approach.
