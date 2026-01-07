# Biblical Places and Geography System

## Overview

The places system provides geographic information about biblical locations, including:

- **Place names** (primary and alternate names)
- **Geographic coordinates** (latitude/longitude for mapping)
- **Verse references** (where places are mentioned in Scripture)
- **Search capabilities** (find places by name or verse)

## Architecture

### Core Interface

Located in `packages/core/src/interfaces.ts`:

```typescript
interface PlaceInfo {
  id: string; // Unique identifier
  name: string; // Primary name (e.g., "Jerusalem")
  altNames?: string[]; // Alternate names (e.g., ["Jebus", "City of David"])
  latitude?: number; // Geographic latitude
  longitude?: number; // Geographic longitude
  verses?: BCV[]; // Verses mentioning this place
}
```

### PlaceStore Interface

```typescript
interface PlaceStore {
  // Get place by ID
  getPlace(placeId: string): Promise<PlaceInfo | null>;

  // Find places mentioned in a specific verse
  getPlacesForVerse(reference: BCV): Promise<PlaceInfo[]>;

  // Search places by name
  searchPlaces(query: string): Promise<PlaceInfo[]>;
}
```

### IndexedDB Implementation

**Database Version:** 4

**Object Store:**

- **places** (keyPath: `id`)
  - Index: `name` (for faster name-based lookups)
  - Stores: Geographic and biblical reference data for places

**Database Types:**

```typescript
interface DBPlace {
  id: string;
  name: string;
  altNames?: string; // JSON string array
  latitude?: number;
  longitude?: number;
  verses?: string; // JSON string array of BCV objects
}
```

## Usage Examples

### Get Place by ID

```typescript
import { IndexedDBPlaceStore } from "./adapters";

const placeStore = new IndexedDBPlaceStore();

// Get information about Jerusalem
const jerusalem = await placeStore.getPlace("jerusalem");
console.log(jerusalem?.name); // "Jerusalem"
console.log(jerusalem?.altNames); // ["Jebus", "City of David", "Zion"]
console.log(jerusalem?.latitude); // 31.7683
console.log(jerusalem?.longitude); // 35.2137
console.log(jerusalem?.verses); // [{ book: "Genesis", chapter: 14, verse: 18 }, ...]
```

### Search Places by Name

```typescript
// Find all places with "beth" in the name
const bethPlaces = await placeStore.searchPlaces("beth");

for (const place of bethPlaces) {
  console.log(place.name);
  // "Bethlehem", "Bethany", "Bethel", "Bethsaida", etc.
}

// Search is case-insensitive and matches alternate names
const results = await placeStore.searchPlaces("city of david");
// Returns Jerusalem (matches altNames)
```

### Find Places in a Verse

```typescript
// What places are mentioned in John 11:1?
const places = await placeStore.getPlacesForVerse({
  book: "John",
  chapter: 11,
  verse: 1,
});

console.log(places.map((p) => p.name));
// ["Bethany", "Jerusalem"]
```

## Data Sources

### OpenBible.info Places Dataset

- **Source:** https://github.com/openbibleinfo/Bible-Geocoding-Data
- **Coverage:** 1,700+ places mentioned in Scripture
- **Data:** Names, coordinates, verse references
- **License:** CC BY-SA 4.0

### Blue Letter Bible Geography

- **Source:** Blue Letter Bible place data
- **Coverage:** Major biblical locations with detailed info
- **Data:** Multiple name variants, historical context

### Biblical Archaeology Society

- **Source:** Archaeological site locations
- **Coverage:** Confirmed archaeological sites
- **Data:** Modern coordinates, historical names

## Example Places Data

```json
{
  "id": "jerusalem",
  "name": "Jerusalem",
  "altNames": ["Jebus", "City of David", "Zion", "Salem"],
  "latitude": 31.7683,
  "longitude": 35.2137,
  "verses": [
    { "book": "Genesis", "chapter": 14, "verse": 18 },
    { "book": "Joshua", "chapter": 10, "verse": 1 },
    { "book": "2 Samuel", "chapter": 5, "verse": 5 },
    { "book": "1 Kings", "chapter": 11, "verse": 13 }
  ]
}

{
  "id": "bethlehem",
  "name": "Bethlehem",
  "altNames": ["Ephrath", "Ephratah", "Beth-lehem Judah"],
  "latitude": 31.7054,
  "longitude": 35.2024,
  "verses": [
    { "book": "Genesis", "chapter": 35, "verse": 19 },
    { "book": "Ruth", "chapter": 1, "verse": 1 },
    { "book": "Micah", "chapter": 5, "verse": 2 },
    { "book": "Matthew", "chapter": 2, "verse": 1 }
  ]
}

{
  "id": "sea-of-galilee",
  "name": "Sea of Galilee",
  "altNames": ["Lake of Gennesaret", "Sea of Tiberias", "Sea of Chinnereth"],
  "latitude": 32.8008,
  "longitude": 35.5942,
  "verses": [
    { "book": "Numbers", "chapter": 34, "verse": 11 },
    { "book": "Matthew", "chapter": 4, "verse": 18 },
    { "book": "John", "chapter": 6, "verse": 1 },
    { "book": "John", "chapter": 21, "verse": 1 }
  ]
}
```

## Pack Building

Place data is distributed as SQLite packs:

### Build Places Pack

```bash
# Build biblical places pack from OpenBible data
node scripts/build-places-pack.mjs
```

Output: `places-bible.pack`

**Pack Schema:**

```sql
CREATE TABLE places (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  alt_names TEXT,      -- JSON array
  latitude REAL,
  longitude REAL,
  verses TEXT          -- JSON array of {book, chapter, verse}
);

CREATE INDEX idx_places_name ON places(name);
```

## Pack Import

Import place packs into the PWA:

```typescript
import { importPackFromSQLite, IndexedDBPlaceStore } from "./adapters";

// Import places pack
const placesFile = await fetch("/packs/places-bible.pack");
const placesBuffer = await placesFile.arrayBuffer();
await importPackFromSQLite(placesBuffer);

// Now places are available
const placeStore = new IndexedDBPlaceStore();
const nazareth = await placeStore.getPlace("nazareth");
```

## UI Integration Ideas

### 1. Verse Context Panel

Show places mentioned in current verse with map preview:

```typescript
const currentVerse = { book: "Luke", chapter: 2, verse: 4 };
const places = await placeStore.getPlacesForVerse(currentVerse);

// Display: "Nazareth → Bethlehem" with map pins
```

### 2. Interactive Map View

Display all places on an interactive map, clickable to see verses:

```typescript
const allPlaces = await placeStore.searchPlaces("");
// Render markers on map with coordinates
```

### 3. Place Search

Autocomplete search for biblical locations:

```typescript
const results = await placeStore.searchPlaces(userInput);
// Show matching places with verse counts
```

### 4. Reading Mode Enhancement

Link place names in verse text to their information:

```html
<span class="place" data-place-id="bethlehem">Bethlehem</span>
```

## Performance Notes

- **Name Index:** Enables fast search by place name
- **In-Memory Search:** All places loaded for `searchPlaces()` - acceptable for ~2,000 places
- **Caching:** Consider caching frequently accessed places (Jerusalem, Bethlehem, etc.)
- **Lazy Loading:** Load coordinates only when showing map view

## Future Enhancements

1. **Distance Calculations**

   - Calculate distances between places
   - "Journey" view showing travel distances in biblical narratives

2. **Timeline Integration**

   - Show places on historical timeline
   - Different locations in different eras (e.g., Babylon in OT vs NT period)

3. **Map Overlays**

   - Ancient vs modern borders
   - Tribal territories
   - Roman provinces

4. **Photo Integration**

   - Modern photos of archaeological sites
   - Historical illustrations

5. **Related Places**

   - "Near" relationships (places within X km)
   - "Contains" relationships (cities within regions)

6. **Journey Tracking**
   - Paul's missionary journeys
   - Exodus route
   - Jesus' travels

## Related Documentation

- [CROSS-REFERENCES.md](./CROSS-REFERENCES.md) - Linking related verses
- [LEXICON.md](./LEXICON.md) - Word study system
- [USER-DATA.md](./USER-DATA.md) - User annotations
- [ARCHITECTURE.md](./ARCHITECTURE.md) - Overall system design
