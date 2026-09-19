/**
 * The map's data, read out of the installed pack.
 *
 * The lab fetches loose JSON off the dev server and hands each layer to the
 * drawing code as a parsed object. Nothing else in the lab knows or cares where
 * those bytes came from, which is the whole reason the lift is possible: this
 * module presents the same two things — an index describing what exists, and a
 * getter that turns a key into JSON — over IndexedDB instead of HTTP.
 *
 * Keys used to be filenames. They are layer ids now. Nothing that reads them
 * ever looked inside one, so the swap is invisible above this line.
 *
 * Geometry is stored gzipped and inflated here on demand. Inflating all 53
 * layers would be 67 MB held for a map that draws six of them at a time, so
 * each is inflated when first asked for and then kept — a layer costs a few
 * milliseconds once, and the reader pans back and forth constantly.
 */

import { openDB, readTransaction } from '../../adapters/db';

/** One drawn layer, as the index describes it. */
export interface AtlasLayerRef {
  /** The layer id. Historically a filename, and still opaque to every reader. */
  file: string;
  title: string;
  bytes: number;
}

export interface AtlasEra {
  id: string;
  title: string;
  subtitle: string | null;
  year_start: number;
  year_end: number;
  sort_order: number;
  confidence: string;
  blurb: string | null;
  dating_note: string | null;
  books: string | null;
}

export interface AtlasOverlayRef {
  id: string;
  kind: string;
  title: string;
  file: string;
}

export interface AtlasIndex {
  /** kind → detail → the layer at that detail. Detail 0 for the graticule. */
  basemap: Record<string, Record<number, AtlasLayerRef>>;
  points: Record<string, { file: string; count: number }>;
  eras: AtlasEra[];
  /** era id → its overlays, with `_always` for the ones on every era. */
  overlays: Record<string, AtlasOverlayRef[]>;
  basemapAttribution: string;
  overlayAttribution: string;
  detail1Coverage: { file: string; boxes: number[][] };
  overlayPlaces: { file: string; count: number };
  biblicalPlaces: { file: string; count: number };
  ancientNames: { file: string; count: number };
  placePhotos: { file: string; count: number };
  journeys: { file: string; count: number };
}

/**
 * Keys that are not geometry.
 *
 * The lab had a file for each of these; here each is assembled from its own
 * object store. Named as constants because both the index and the getter have
 * to agree on them, and a typo would simply return nothing.
 */
const POINTS_CITY = 'points-city';
const POINTS_PEAK = 'points-peak';
const BIBLICAL_PLACES = 'biblical-places';
const ANCIENT_NAMES = 'ancient-names';
const PLACE_PHOTOS = 'place-photos';
const OVERLAY_PLACES = 'overlay-places';
const JOURNEYS = 'journeys';
const DETAIL1_COVERAGE = 'base-detail1-coverage.json';

const DERIVED = new Set([
  POINTS_CITY, POINTS_PEAK, BIBLICAL_PLACES, ANCIENT_NAMES,
  PLACE_PHOTOS, OVERLAY_PLACES, JOURNEYS, DETAIL1_COVERAGE,
]);

/** Parsed layers are immutable, so one cache serves every redraw. */
let cache = new Map<string, Promise<any>>();
let indexPromise: Promise<AtlasIndex> | null = null;

/**
 * Drop everything held in memory.
 *
 * Called when the map pane closes. Without it a reader who opens the map once
 * carries its geometry for the rest of the session, on top of the reader's own
 * text and whatever else is loaded.
 */
export function releaseAtlas(): void {
  cache = new Map();
  indexPromise = null;
}

/** Is the map pack installed and complete enough to draw? */
export async function atlasInstalled(): Promise<boolean> {
  try {
    const db = await openDB();
    if (!db.objectStoreNames.contains('atlas_layers')) return false;
    const count = await readTransaction<number>('atlas_geometry', (store) => store.count());
    return count > 0;
  } catch {
    return false;
  }
}

/** Everything in one store, as an array. */
function all<T>(storeName: string): Promise<T[]> {
  return readTransaction<T[]>(storeName, (store) => store.getAll() as IDBRequest<T[]>);
}

/**
 * Inflate one gzipped blob.
 *
 * Streamed rather than read whole: the blob goes straight through
 * DecompressionStream into a Response, so the 7 MB coastline is never held
 * compressed and expanded at the same time.
 */
async function inflate(data: Blob): Promise<string> {
  const stream = data.stream().pipeThrough(new DecompressionStream('gzip'));
  return new Response(stream).text();
}

/**
 * What the map can draw, and where each piece lives.
 *
 * Built once per pane. Everything here is small — the catalogue, the eras, the
 * coverage boxes — so it is read whole rather than queried.
 */
export async function loadAtlasIndex(): Promise<AtlasIndex> {
  if (indexPromise) return indexPromise;

  indexPromise = (async () => {
    const [metaRows, eraRows, layerRows] = await Promise.all([
      all<{ key: string; value: string }>('atlas_meta'),
      all<any>('atlas_eras'),
      all<any>('atlas_layers'),
    ]);

    const meta = Object.fromEntries(metaRows.map((r) => [r.key, r.value]));

    // The lab reads era fields in the shape the source database wrote them, and
    // the modules that move across still do. Converting here rather than there
    // keeps the lift to a move.
    const eras: AtlasEra[] = eraRows
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((e) => ({
        id: e.id,
        title: e.title,
        subtitle: e.subtitle ?? null,
        year_start: e.yearStart,
        year_end: e.yearEnd,
        sort_order: e.sortOrder,
        confidence: e.confidence,
        blurb: e.blurb ?? null,
        dating_note: e.datingNote ?? null,
        books: e.books ?? null,
      }));

    const basemap: AtlasIndex['basemap'] = {};
    const overlays: AtlasIndex['overlays'] = {};

    for (const row of layerRows.sort((a, b) => (a.sortOrder - b.sortOrder) || a.id.localeCompare(b.id))) {
      if (row.group === 'basemap') {
        (basemap[row.kind] ??= {})[row.detail] = {
          file: row.id,
          title: row.title,
          bytes: row.rawBytes,
        };
      } else {
        // An overlay with no era of its own shows on all of them.
        const key = row.eraId ?? '_always';
        (overlays[key] ??= []).push({
          id: row.id,
          kind: row.kind,
          title: row.title,
          file: row.id,
        });
      }
    }

    let boxes: number[][] = [];
    try {
      boxes = JSON.parse(meta.detail1_coverage ?? '[]');
    } catch {
      // A build that never harvested the fine shorelines simply stays on the
      // coarse ones. Not an error — just no gain.
      boxes = [];
    }

    return {
      basemap,
      points: {
        city: { file: POINTS_CITY, count: 0 },
        peak: { file: POINTS_PEAK, count: 0 },
      },
      eras,
      overlays,
      basemapAttribution: 'Map data from Natural Earth (public domain).',
      overlayAttribution: meta.attribution ?? '',
      detail1Coverage: { file: DETAIL1_COVERAGE, boxes },
      overlayPlaces: { file: OVERLAY_PLACES, count: 0 },
      biblicalPlaces: { file: BIBLICAL_PLACES, count: 0 },
      ancientNames: { file: ANCIENT_NAMES, count: 0 },
      placePhotos: { file: PLACE_PHOTOS, count: 0 },
      journeys: { file: JOURNEYS, count: 0 },
    };
  })();

  return indexPromise;
}

/**
 * One layer, or one of the small derived tables, by key.
 *
 * The drop-in for the lab's getJson: same signature, same cached-promise
 * behaviour, same parsed result.
 */
export function getAtlasJson(key: string): Promise<any> {
  if (!cache.has(key)) cache.set(key, build(key));
  return cache.get(key)!;
}

async function build(key: string): Promise<any> {
  if (DERIVED.has(key)) return buildDerived(key);

  const row = await readTransaction<any>('atlas_geometry', (store) => store.get(key));
  if (!row) throw new Error(`Map layer "${key}" is not installed`);

  // Packs written before the blob change, and anything that arrives as raw
  // bytes, still have to inflate.
  const data: Blob = row.data instanceof Blob ? row.data : new Blob([row.data]);
  return JSON.parse(await inflate(data));
}

async function buildDerived(key: string): Promise<any> {
  switch (key) {
    case DETAIL1_COVERAGE: {
      const index = await loadAtlasIndex();
      return { boxes: index.detail1Coverage.boxes };
    }

    case POINTS_CITY:
    case POINTS_PEAK: {
      const kind = key === POINTS_CITY ? 'city' : 'peak';
      const rows = await readTransaction<any[]>('atlas_points', (store) =>
        store.index('kind').getAll(kind) as IDBRequest<any[]>
      );
      return rows.map((r) => ({
        name: r.name,
        lat: r.lat,
        lon: r.lon,
        elevation: r.elevation ?? null,
        country: r.country ?? null,
        population: r.population ?? null,
        rank: r.rank ?? null,
      }));
    }

    case BIBLICAL_PLACES: {
      const rows = await all<any>('atlas_biblical_places');
      // Back into the compact shape the places module reads: n(ame), y/x for
      // lat/lon, t(ype), m(odern), v(erses).
      return rows.map((r) => ({
        id: r.id,
        n: r.name,
        y: r.lat,
        x: r.lon,
        t: r.kind ?? undefined,
        m: r.modern ?? undefined,
        v: safeParse(r.verses, []),
      }));
    }

    case ANCIENT_NAMES: {
      const rows = await all<any>('atlas_ancient_names');
      return rows.map((r) => ({
        n: r.name,
        k: r.kind ?? undefined,
        y: r.lat,
        x: r.lon,
        a: r.yearStart ?? undefined,
        b: r.yearEnd ?? undefined,
      }));
    }

    case PLACE_PHOTOS: {
      const rows = await all<any>('atlas_place_photos');
      const out: Record<string, any> = {};
      for (const r of rows) {
        out[r.place] = {
          t: r.thumbUrl,
          f: r.fullUrl,
          a: r.author ?? undefined,
          l: r.license ?? undefined,
          u: r.pageUrl ?? undefined,
          d: r.caption ?? undefined,
          p: r.palette ?? undefined,
        };
      }
      return out;
    }

    case OVERLAY_PLACES: {
      const rows = await all<any>('atlas_era_places');
      return rows.map((r) => ({
        era_id: r.eraId,
        name: r.name,
        lat: r.lat,
        lon: r.lon,
        kind: r.kind ?? null,
        verses: r.verses ?? 0,
      }));
    }

    case JOURNEYS: {
      // Three stores into the shape the overlay reads. The column names are
      // deliberately not the overlay's names — the table says `traveller`,
      // which is the correct spelling, and the overlay says `traveler`, which
      // is what it was written with. This is where the two meet.
      const [journeyRows, stopRows, geometryRows] = await Promise.all([
        all<any>('atlas_journeys'),
        all<any>('atlas_journey_stops'),
        all<any>('atlas_journey_geometry'),
      ]);
      if (!journeyRows.length) return [];

      // Every stop's verses come from its gazetteer row, so a verse is recorded
      // once and a journey cannot drift from the place it passes through.
      // Fetched by key rather than by reading all 1,278 places: a hundred-odd
      // stops name far fewer places than the gazetteer holds.
      const placeIds = [...new Set<string>(stopRows.map((s) => s.placeId))];
      const places = new Map<string, any>(
        (await Promise.all(
          placeIds.map((id) =>
            readTransaction<any>('atlas_biblical_places', (store) => store.get(id))
          )
        ))
          .filter(Boolean)
          .map((p) => [p.id, p])
      );

      // Inflated up front rather than per journey: all seventeen legs together
      // are 23 KB, and the overlay draws every shown route in one pass.
      const legs = new Map<string, number[][][]>();
      for (const row of geometryRows) {
        const data: Blob = row.data instanceof Blob ? row.data : new Blob([row.data]);
        legs.set(row.id, safeParse(await inflate(data), [] as number[][][]));
      }

      const byJourney = new Map<string, any[]>();
      for (const stop of stopRows) {
        if (!byJourney.has(stop.journeyId)) byJourney.set(stop.journeyId, []);
        byJourney.get(stop.journeyId)!.push(stop);
      }

      // sortOrder restarts at 1 in each testament — it is a position within a
      // group, not a rank across all seventeen — so testament sorts first, or
      // the two halves interleave.
      return journeyRows
        .sort((a, b) =>
          (a.testament === b.testament ? 0 : a.testament === 'old' ? -1 : 1) ||
          (a.sortOrder - b.sortOrder) ||
          a.id.localeCompare(b.id)
        )
        .map((j) => ({
          id: j.id,
          name: j.name,
          traveler: j.traveller,
          dates: j.dates,
          description: j.description ?? null,
          km: j.km,
          colour: j.colour,
          testament: j.testament,
          // One array per leg, already in travel order. Not joined into one
          // path: the gaps are open water the source never drew, so phase 5
          // draws each leg separately.
          legs: legs.get(j.id) ?? [],
          stops: (byJourney.get(j.id) ?? [])
            .sort((a, b) => a.seq - b.seq)
            .map((s) => {
              const place = places.get(s.placeId);
              // [label, osisRef] pairs. The label is what a reader sees; the
              // ref is OSIS, so a stop can hand off into the reader.
              //
              // Every verse the place is named in, not a chosen few: the
              // gazetteer records where a place is mentioned, not which
              // mentions belong to this journey, and there is nothing here
              // that could tell them apart. That makes the count wildly
              // uneven — a median of 7, but 955 for Jerusalem and 658 for
              // Egypt — so whatever draws these has to cut them down. That
              // decision is the popup's, in phase 5, and this hands it
              // everything rather than choosing on its behalf.
              const verses: [string, string][] = place ? safeParse(place.verses, []) : [];
              return {
                n: s.name,
                y: s.lat,
                x: s.lon,
                by: s.travelMethod,
                km: s.kmFromPrevious ?? 0,
                placeId: s.placeId,
                note: s.note ?? null,
                events: verses.map(([what, ref]) => ({ what, ref })),
              };
            }),
        }));
    }

    default:
      throw new Error(`Unknown atlas key "${key}"`);
  }
}

function safeParse<T>(text: string, fallback: T): T {
  try {
    return JSON.parse(text) as T;
  } catch {
    return fallback;
  }
}
