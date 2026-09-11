/**
 * Atlas lab — the workshop for the map.
 *
 * This is the real thing, not a mockup: the same data, detail and behaviour the
 * app will ship with. It gets lifted into the map panel once it's right.
 *
 * Two ideas hold the whole file together:
 *
 *   The map is a map first. Nothing floats on its surface — every control lives
 *   in the navbar above it — and the basemap stands on its own with no overlay
 *   switched on.
 *
 *   Overlays ride on top and must be self-sufficient. Each one registers what it
 *   draws, what colour it is and what a tap on it means, so the timeline is just
 *   the first of them rather than something the map is built around.
 */
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { OverlayHost, TimelineOverlay } from './atlas-overlays.js';
import { LabelEngine } from './atlas-labels.js';
import { PlaceSearch, ScriptureSearch } from './atlas-search.js';
import { BiblicalPlaces, groupByBook, bookName, haversine } from './atlas-places.js';
import { parsePassage, placesInPassage, eraForBook } from './atlas-reading.js';
import { getBookColor } from './src/lib/bibleData.js';

const ATLAS = '/atlas';

// ---------------------------------------------------------------- utilities

const $ = (id) => document.getElementById(id);
const status = (text, busy = false) => {
  $('status-text').textContent = text;
  $('status').classList.toggle('idle', !busy);
};

/** Fetched layers are immutable, so one cache serves every redraw. */
const cache = new Map();
async function getJson(file) {
  if (!cache.has(file)) {
    cache.set(file, fetch(`${ATLAS}/${file}`).then((r) => {
      if (!r.ok) throw new Error(`${file}: HTTP ${r.status}`);
      return r.json();
    }));
  }
  return cache.get(file);
}

// ------------------------------------------------------------------- the map

const map = L.map('map', {
  center: [31.8, 35.2],
  zoom: 5,
  zoomControl: false,
  attributionControl: false,
  worldCopyJump: true,
  minZoom: 2,
  maxZoom: 12,
  zoomSnap: 0.25,
  // Scroll wheel and pinch are how people zoom now; the +/- buttons are gone,
  // but Leaflet keeps the keyboard shortcuts working for anyone who needs them.
  keyboard: true,
});

/** Draw order. Leaflet panes are the only reliable way to keep it. */
const PANES = [
  ['ocean', 300], ['land', 320], ['terrain', 340], ['lakes', 360],
  ['rivers', 380], ['coast', 400], ['graticule', 420],
  ['overlay-sea', 480], ['overlay-fill', 500], ['overlay-line', 520],
  // The overlay letters into its own pane. Sharing one with the basemap's
  // labels would mean two owners of a single opacity, so fading the basemap
  // would silently fade the overlay's names with it.
  ['overlay-labels', 560],
  ['pins', 600], ['labels', 640],
];
for (const [name, z] of PANES) {
  map.createPane(name);
  map.getPane(name).style.zIndex = String(z);
}
map.getPane('labels').style.pointerEvents = 'none';
 map.getPane('overlay-labels').style.pointerEvents = 'none';

/**
 * One canvas per pane, not one canvas for everything.
 *
 * A Leaflet canvas renderer lives in a single pane, so sharing one instance
 * across layers quietly ignores their `pane` option and draws them all in one
 * place. That put the city dots outside the label pane, so fading the basemap
 * removed the names and left the dots behind — the unlabelled specks. It also
 * meant the pane z-order below was decorative rather than real.
 */
const renderers = new Map();
const rendererFor = (pane) => {
  if (!renderers.has(pane)) renderers.set(pane, L.canvas({ padding: 0.35, pane }));
  return renderers.get(pane);
};

// ------------------------------------------------------------ basemap styles

const PARCHMENT = {
  ocean:     { fillColor: '#a9c4cf', fillOpacity: 1, color: '#8fadba', weight: 0.4 },
  land:      { fillColor: '#ece1c8', fillOpacity: 1, color: '#b3a281', weight: 0.7 },
  lakes:     { fillColor: '#a9c4cf', fillOpacity: 1, color: '#8fadba', weight: 0.5 },
  rivers:    { color: '#8fadba', weight: 1, opacity: 0.9, fill: false },
  coastline: { color: '#8a7a5c', weight: 0.8, opacity: 0.7, fill: false },
  // Ranges and deserts read as a hint of relief under everything, not as shapes
  // competing with borders — and they get named, so no blob is unexplained.
  terrain:   { fillColor: '#ddcca6', fillOpacity: 0.28, color: '#ccb896', weight: 0 },
  graticule: { color: '#8a7a5c', weight: 0.4, opacity: 0.28, fill: false, dashArray: '3 4' },
};

/**
 * Ground where the finest water is available: the cells holding a place
 * Scripture names, which is where anybody zooms deep. Each entry is
 * [west, south, east, north].
 */
let fineWaterBoxes = [];

/**
 * True only when the whole view sits inside one covered box.
 *
 * The centre is not enough. At this level the sea is drawn rather than the
 * land, so beyond the edge of a box there would be no sea to draw and the
 * Mediterranean would come out the colour of parchment.
 */
function fineWaterCovers(bounds) {
  const w = bounds.getWest(), e = bounds.getEast();
  const s = bounds.getSouth(), n = bounds.getNorth();
  return fineWaterBoxes.some((b) => w >= b[0] && e <= b[2] && s >= b[1] && n <= b[3]);
}

/** Which generalisation to draw at a given zoom. */
function detailFor(zoom) {
  if (zoom < 4.5) return 110;
  if (zoom < 7) return 50;
  // Close in, Natural Earth's kilometre-accurate shoreline is the thing you
  // notice — it puts Capernaum in the Sea of Galilee — so where OpenStreetMap
  // has been harvested, use that instead.
  if (zoom >= 10 && fineWaterBoxes.length && fineWaterCovers(map.getBounds())) return 1;
  return 10;
}

/**
 * Where a layer's shapes come from at a given level.
 *
 * Only water was wrong, so only water is redrawn at the finest level. Relief
 * and rivers fall back to the coarse copy, and land is not drawn at all: the
 * parchment ground already is the land, and painting the sea over it takes the
 * shoreline from the accurate side of the pair.
 */
/** At the finest level these are not drawn at all; see sourceFor. */
const NOT_AT_FINEST = new Set([
  // The parchment ground is the land, so the sea is painted over it and the
  // shoreline comes from the accurate side of the pair.
  'land',
  // The sea's own edge is the shoreline. A separate coarse stroke would run a
  // kilometre away from it and read as two coasts.
  'coastline',
]);

function sourceFor(kind, detail) {
  const own = index.basemap[kind]?.[detail];
  if (own) return own;
  if (detail !== 1) return null;
  return NOT_AT_FINEST.has(kind) ? null : (index.basemap[kind]?.[10] ?? null);
}

const TILE_BASEMAPS = {
  satellite: {
    label: 'Satellite', online: true,
    build: () => L.layerGroup([
      L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { maxZoom: 19 }),
      L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}', { maxZoom: 19 }),
    ]),
    credit: 'Tiles © Esri',
  },
  topographic: {
    label: 'Topographic', online: true,
    build: () => L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}', { maxZoom: 19 }),
    credit: 'Tiles © Esri',
  },
  streets: {
    label: 'Streets', online: true,
    build: () => L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}', { maxZoom: 19 }),
    credit: 'Tiles © Esri',
  },
  natgeo: {
    label: 'National Geographic', online: true,
    build: () => L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/NatGeo_World_Map/MapServer/tile/{z}/{y}/{x}', { maxZoom: 16 }),
    credit: 'Tiles © Esri — National Geographic',
  },
};

// --------------------------------------------------------- basemap rendering

let index = null;
let basemapKind = 'parchment';
let basemapOpacity = 1;
/** Lettering fades separately from the geography it sits on. */
let basemapTextOpacity = 1;
let showLabels = true;
let tileLayer = null;
let drawnLayers = new Map();   // "kind@detail" -> Leaflet layer
let loadedDetail = null;

/** Every name on the map goes through one placement pass. */
const labels = new LabelEngine(map);
let labelStats = { placed: 0, dropped: 0 };

/** Plain-English notes for the feature codes people actually meet. */
const FEATURE_NOTE = {
  BAY: 'bay', GULF: 'gulf', LK: 'lake', SEA: 'sea', STM: 'river', CHN: 'channel',
  SD: 'sound', LGN: 'lagoon', RSV: 'reservoir', SPNG: 'spring', FLLS: 'falls',
  MT: 'mountain', PK: 'peak', RDGE: 'ridge', VAL: 'valley', ISL: 'island',
  CAPE: 'cape', PEN: 'peninsula', DSRT: 'desert', PLN: 'plain', HLL: 'hill',
  PPLC: 'capital', PPLA: 'admin capital', RGN: 'region', PRK: 'park',
};
/** AWMC's ancient region and people names, with the periods they belong to. */
let ancientNames = null;

/** The 1,278 places Scripture names, with their verses and articles. */
let biblical = null;

/** Search over those places and the Barrington's ancient names. */
let scripture = null;

/** A Wikimedia photograph per place, keyed by place id. */
let photos = {};
let showBiblical = true;

/** The drawn basemap: real polygons, in draw order, swapped by zoom. */
const DRAWN_ORDER = [
  ['ocean', 'ocean'], ['land', 'land'], ['terrain', 'terrain'],
  ['lakes', 'lakes'], ['rivers', 'rivers'], ['coastline', 'coast'],
];

function clearDrawn() {
  for (const layer of drawnLayers.values()) map.removeLayer(layer);
  drawnLayers.clear();
  loadedDetail = null;
  // The finest level borrows the ground as its land; hand it back, or a switch
  // to satellite would leave parchment showing through the tiles' edges.
  $('map').style.background = '';
}

async function drawParchment(detail) {
  if (loadedDetail === detail) return;
  const wanted = detail;

  const built = [];
  for (const [kind, pane] of DRAWN_ORDER) {
    const entry = sourceFor(kind, detail);
    if (!entry) continue;
    const geojson = await getJson(entry.file);
    if (wanted !== detailFor(map.getZoom())) return;   // reader moved on
    built.push([kind, pane, geojson]);
  }

  clearDrawn();
  for (const [kind, pane, geojson] of built) {
    const layer = L.geoJSON(geojson, {
      pane, renderer: rendererFor(pane), style: PARCHMENT[kind], interactive: false,
    });
    layer.setStyle({ ...PARCHMENT[kind], opacity: (PARCHMENT[kind].opacity ?? 1) * basemapOpacity,
                     fillOpacity: (PARCHMENT[kind].fillOpacity ?? 0) * basemapOpacity });
    layer.addTo(map);
    drawnLayers.set(`${kind}@${detail}`, layer);
  }

  const grat = index.basemap.graticule?.[0];
  if (grat) {
    const geojson = await getJson(grat.file);
    const layer = L.geoJSON(geojson, {
      pane: 'graticule', renderer: rendererFor('graticule'), interactive: false,
      style: { ...PARCHMENT.graticule, opacity: PARCHMENT.graticule.opacity * basemapOpacity },
    }).addTo(map);
    drawnLayers.set('graticule@0', layer);
  }

  /**
   * At the finest level there is no land polygon — the sea is painted over the
   * ground instead — so the ground has to become the land colour, or crossing
   * into that level would shift every shore from parchment to the slightly
   * darker backing behind the map.
   */
  $('map').style.background = detail === 1 ? PARCHMENT.land.fillColor : '';

  loadedDetail = detail;
}

function applyBasemapOpacity() {
  if (tileLayer) {
    const set = (l) => l.setOpacity?.(basemapOpacity);
    tileLayer.eachLayer ? tileLayer.eachLayer(set) : set(tileLayer);
  }
  for (const [key, layer] of drawnLayers) {
    const kind = key.split('@')[0];
    const base = kind === 'graticule' ? PARCHMENT.graticule : PARCHMENT[kind];
    if (!base) continue;
    layer.setStyle({
      ...base,
      opacity: (base.opacity ?? 1) * basemapOpacity,
      fillOpacity: (base.fillOpacity ?? 0) * basemapOpacity,
    });
  }
}

/** Basemap lettering, faded independently of the map under it. */
function applyBasemapTextOpacity() {
  map.getPane('labels').style.opacity = String(basemapTextOpacity);
}

async function setBasemap(kind) {
  basemapKind = kind;
  $('basemap-name').textContent = kind === 'parchment' ? 'Parchment' : TILE_BASEMAPS[kind].label;

  if (tileLayer) { map.removeLayer(tileLayer); tileLayer = null; }
  clearDrawn();

  if (kind === 'parchment') {
    status('drawing the world…', true);
    await drawParchment(detailFor(map.getZoom()));
    await drawLabels();
    status('ready');
  } else {
    tileLayer = TILE_BASEMAPS[kind].build().addTo(map);
    status('ready');
  }
  applyBasemapOpacity();
  renderBasemapPanel();
}

/**
 * Sources, and what each one actually asks for.
 *
 * Natural Earth is public domain and explicitly says crediting is unnecessary,
 * so nothing is stamped on the map for it. Only Esri's tiles and the historical
 * data carry real conditions, and those are shown on request rather than
 * permanently occupying a corner of the map.
 */
const SOURCES = {
  naturalEarth: {
    name: 'Natural Earth',
    terms: 'Public domain — no attribution required.',
    free: true,
  },
  esri: {
    name: 'Esri basemap tiles',
    terms: 'Attribution required by Esri’s terms of use.',
  },
  awmc: {
    name: 'Ancient World Mapping Center — Barrington Atlas',
    terms: 'ODbL 1.0 — attribution required.',
    url: 'https://awmc.unc.edu/',
  },
  openbible: {
    name: 'OpenBible.info',
    terms: 'CC BY 4.0 — attribution required.',
    url: 'https://www.openbible.info/geo/',
  },
};

/** Only what's actually on screen right now. */
function activeSources() {
  const out = [];
  if (basemapKind === 'parchment') out.push(SOURCES.naturalEarth);
  else out.push(SOURCES.esri);
  if (timeline?.enabled) out.push(SOURCES.awmc, SOURCES.openbible);
  return out;
}

function renderCreditPanel() {
  $('credit-panel').innerHTML = activeSources().map((s) => `
    <div class="credit-item">
      <div class="credit-src">${s.url ? `<a href="${s.url}" target="_blank" rel="noopener">${s.name}</a>` : s.name}</div>
      <div class="credit-terms ${s.free ? 'credit-free' : ''}">${s.terms}</div>
    </div>`).join('');
}

// ------------------------------------------------------------------- labels

let cities = null;
let peaks = null;


/** Rough visual centre of a polygon — good enough to hang a name on. */
function centroid(geom) {
  const polys = geom.type === 'Polygon' ? [geom.coordinates]
              : geom.type === 'MultiPolygon' ? geom.coordinates : [];
  let best = null, bestArea = 0;
  for (const poly of polys) {
    const ring = poly[0];
    if (!ring || ring.length < 4) continue;
    let a = 0, x = 0, y = 0;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const cross = ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
      a += cross; x += (ring[j][0] + ring[i][0]) * cross; y += (ring[j][1] + ring[i][1]) * cross;
    }
    a /= 2;
    if (a !== 0 && Math.abs(a) > bestArea) { bestArea = Math.abs(a); best = [y / (6 * a), x / (6 * a)]; }
  }
  return best;
}

/**
 * Dots for every town in view, named or not.
 *
 * The gazetteer knows 10.7 million places and the map can only letter a fraction
 * of them, so the rest are drawn as plain dots you can click. They're real
 * places and clicking says what they are, which is the only thing an unlabelled
 * speck needs to earn its spot.
 */
let townDots = null;
let dotsToken = 0;
/** What the last viewport fetch returned, so the lettering can name them. */
let townRows = [];
/** Off by default: the crowded view is opt-in. */
let showEveryPlace = false;

/**
 * The floor a place has to clear to be drawn, by zoom.
 *
 * A map that shows everything shows nothing: at world scale a hamlet is noise,
 * and up close it's the thing you came for. Dropping the floor as the reader
 * comes in keeps roughly the same number of dots on screen at every zoom, which
 * is how a paper atlas behaves. Search is untouched — all 10.7 million places
 * stay findable by name however few are drawn.
 */
function placeFloorFor(zoom) {
  if (showEveryPlace) return 0;
  if (zoom < 7) return 50000;
  if (zoom < 8) return 15000;
  if (zoom < 9) return 4000;
  if (zoom < 10) return 800;
  if (zoom < 11) return 100;
  return 0;                       // right in: the hamlets earn their place
}

async function drawTownDots(bounds, zoom) {
  const token = ++dotsToken;
  const floor = placeFloorFor(zoom);
  const limit = showEveryPlace ? 700 : 180;

  let rows = [];
  try {
    const bbox = [bounds.getWest(), bounds.getSouth(), bounds.getEast(), bounds.getNorth()].join(',');
    const res = await fetch(`/api/atlas-places?bbox=${bbox}&limit=${limit}&minpop=${floor}`);
    rows = (await res.json()).results ?? [];
  } catch {
    townRows = [];
    return;
  }
  if (token !== dotsToken) return;          // the reader moved on
  townRows = rows;

  if (townDots) map.removeLayer(townDots);
  townDots = L.layerGroup([], { pane: 'pins' }).addTo(map);

  for (const r of rows) {
    const water = r.fclass === 'H';
    const dot = L.circleMarker([r.lat, r.lon], {
      pane: 'pins', radius: r.population > 100000 ? 3.4 : 2.2,
      fillColor: water ? '#4a7286' : '#6b5a3e', fillOpacity: 0.75,
      color: '#ece1c8', weight: 0.9, interactive: true, bubblingMouseEvents: false,
    });
    const note = FEATURE_NOTE[r.fcode] ? ` (${FEATURE_NOTE[r.fcode]})` : '';
    dot.bindTooltip(r.name + note, { direction: 'top', offset: [0, -4] });
    dot.bindPopup(
      `<strong>${r.name}</strong>${note}<br>${[r.admin1, r.country, r.population ? `${r.population.toLocaleString()} people` : null]
        .filter(Boolean).join('<br>')}`
    );
    townDots.addLayer(dot);
  }
}

/**
 * Lettering thins out as you pull back, so the world view carries a handful of
 * names and a close view carries many. Everything is filtered to the viewport,
 * because a label off-screen still costs a DOM node.
 */
async function drawLabels() {
  labels.reset();
  if (!showLabels && !timeline?.enabled) { labels.render(); return; }

  const zoom = map.getZoom();
  const bounds = map.getBounds();
  const detail = detailFor(zoom);
  const pad = 0.35;
  const inView = (lat, lon) =>
    lat > bounds.getSouth() - pad && lat < bounds.getNorth() + pad &&
    lon > bounds.getWest() - pad && lon < bounds.getEast() + pad;

  // Basemap lettering. Skipped entirely on a tile basemap, which draws its own.
  if (showLabels && basemapKind === 'parchment') {
    // Seas and countries, from whatever generalisation is on screen.
    for (const [layerKind, kind, minZoom, priority] of [
      ['marine', 'sea', 3, 70],
      ['countries', 'country', 3.5, 60],
    ]) {
      if (zoom < minZoom) continue;
      const entry = index.basemap[layerKind]?.[detail];
      if (!entry) continue;
      const fc = await getJson(entry.file);
      for (const f of fc.features) {
        const name = f.properties?.name ?? f.properties?.NAME;
        if (!name) continue;
        const c = centroid(f.geometry);
        if (!c || !inView(c[0], c[1])) continue;
        labels.add({ lat: c[0], lon: c[1], text: name, kind, priority, shape: 'area' });
      }
    }

    // Ranges, deserts and plains, so no sepia shape is left unexplained.
    if (zoom >= 4.5) {
      const entry = index.basemap.terrain?.[detail];
      if (entry) {
        const fc = await getJson(entry.file);
        for (const f of fc.features) {
          const name = f.properties?.NAME;
          if (!name) continue;
          const c = centroid(f.geometry);
          if (!c || !inView(c[0], c[1])) continue;
          labels.add({ lat: c[0], lon: c[1], text: name, kind: 'terrain', priority: 20, shape: 'area' });
        }
      }
    }

    // Natural Earth's notable cities carry the middle zooms; past zoom 6 the
    // gazetteer below covers the same ground with far more places, so running
    // both would only label everything twice.
    if (zoom >= 3.5 && zoom < 6) {
      cities ??= await getJson(index.points.city.file);
      const limit = zoom < 5 ? 2 : 4;
      for (const c of cities) {
        if (c.rank > limit || !inView(c.lat, c.lon)) continue;
        labels.add({
          lat: c.lat, lon: c.lon, text: c.name, kind: 'city', shape: 'point',
          // Bigger places win a contested spot, and every rank beats the peaks.
          priority: 30 + Math.min(20, Math.log10((c.population ?? 1) + 10) * 4) - c.rank * 0.5,
          dot: { fill: '#3d3427', stroke: '#ece1c8', radius: 2.6 },
        });
      }
    }

    // Close in, the gazetteer takes over from Natural Earth's 7,342 notable
    // cities. Every place in view gets a clickable dot, and as many as will fit
    // also get their name — a dot you have to hover to identify is a last
    // resort, not the normal case.
    if (zoom >= 6) {
      await drawTownDots(bounds, zoom);
      for (const r of townRows) {
        if (!inView(r.lat, r.lon)) continue;
        const water = r.fclass === 'H';
        labels.add({
          lat: r.lat, lon: r.lon, text: r.name,
          kind: water ? 'water-point' : 'city',
          shape: 'point',
          // Somewhere named and lived-in outranks an unnamed creek, but a
          // labelled feature of any kind beats leaving a bare dot.
          priority: 26 + Math.min(18, Math.log10((r.population ?? 0) + 10) * 4) + (water ? 1 : 0),
        });
      }
    }

    if (zoom >= 5 && agedness() < 0.35) {
      peaks ??= await getJson(index.points.peak.file);
      for (const pk of peaks) {
        if (!inView(pk.lat, pk.lon)) continue;
        const text = pk.elevation ? `▲ ${pk.name} ${Math.round(pk.elevation)}m` : `▲ ${pk.name}`;
        labels.add({
          lat: pk.lat, lon: pk.lon, text, kind: 'peak', shape: 'point',
          priority: 10 + (pk.elevation ?? 0) / 2000,
        });
      }
    }
  }

  // Ancient names, filtered to the era on screen.
  //
  // Without these, any era with no biblical books attached to it — Alexander,
  // the Hasmoneans, the Roman centuries — drew a border and nothing else. AWMC
  // dates each name, so Phrygia and Bithynia appear when they existed.
  if (timeline?.enabled) {
    ancientNames ??= await getJson(index.ancientNames.file);
    const era = timeline.era;
    const mid = (era.year_start + era.year_end) / 2;
    for (const n of ancientNames) {
      // Null bounds mean undated rather than never — keep those throughout.
      if (n.a != null && n.b != null && (mid < n.a || mid > n.b)) continue;
      if (!inView(n.y, n.x)) continue;
      if (n.k === 'mountain' && zoom < 5.5) continue;
      if (n.k === 'island' && zoom < 5) continue;
      labels.add({
        lat: n.y, lon: n.x, text: n.n,
        kind: n.k === 'water' ? 'sea' : n.k === 'people' ? 'people' : 'ancient',
        pane: 'overlay-labels', shape: 'area',
        priority: n.k === 'region' ? 85 : n.k === 'people' ? 65 : 45,
      });
    }
  }

  // Overlay lettering competes in the same pass, or the two sets would be laid
  // out blind to each other and collide however careful each was alone.
  for (const ov of host?.list() ?? []) {
    if (!ov.enabled || !ov.labelCandidates) continue;
    for (const c of ov.labelCandidates(zoom, inView)) labels.add(c);
  }

  // Biblical places are drawn last so their markers sit above the basemap's
  // dots, and they carry the taps that open Scripture.
  const shownBiblical = biblical?.draw(zoom, bounds) ?? [];
  if (biblical?.visible) {
    for (const bp of shownBiblical) {
      labels.add({
        lat: bp.y, lon: bp.x, text: bp.n, kind: 'biblical', shape: 'point',
        // Weight of attestation, so Jerusalem outranks a place named once.
        priority: 75 + Math.min(25, bp.v.length / 8),
      });
    }
  }

  applyAgeing();
  await drawRidges(zoom, bounds);

  const { placed, dropped } = labels.render();
  labelStats = { placed, dropped };

  // Natural Earth is a world-scale dataset: 1,319 lakes and 1,473 rivers for the
  // whole planet. Past about zoom 9 it has no local water or terrain left to
  // draw, so a named creek is a name with nothing under it. Better to say so
  // than to let it look like a bug.
  const thin = basemapKind === 'parchment' && zoom >= 9.5;
  const note = thin ? ' · drawn map has no local detail this close' : '';
  // Worth seeing while tuning: how much lettering fits, and how much had to be
  // held back to keep it legible.
  status((dropped ? `${placed} names · ${dropped} held back` : `${placed} names`) + note);
}

// ------------------------------------------------------- zoom / view changes

let redrawTimer = null;
function scheduleRedraw() {
  clearTimeout(redrawTimer);
  redrawTimer = setTimeout(async () => {
    // A tile basemap draws its own lettering; only the drawn map needs a pass.
    if (basemapKind !== 'parchment' && !timeline?.enabled) return;
    const detail = detailFor(map.getZoom());
    if (detail !== loadedDetail) {
      status(`detail ${detail}m…`, true);
      await drawParchment(detail);
      applyBasemapOpacity();
    }
    // drawLabels reports the placement count itself; don't overwrite it.
    await drawLabels();
  }, 160);
}
map.on('moveend zoomend', scheduleRedraw);

// -------------------------------------------------------------- the navbar

function closePanels(except) {
  for (const id of ['basemap-panel', 'layers-panel', 'credit-panel', 'results']) {
    if (id !== except) $(id).hidden = true;
  }
  $('basemap-btn').setAttribute('aria-expanded', String(except === 'basemap-panel'));
  $('layers-btn').setAttribute('aria-expanded', String(except === 'layers-panel'));
}

function togglePanel(id, anchorEl) {
  const panel = $(id);
  const open = panel.hidden;
  closePanels(open ? id : null);
  panel.hidden = !open;
  if (!open || !anchorEl) return;

  // Line the panel up with its button, but never let it run off the edge —
  // the buttons on the right would otherwise open a panel half off-screen.
  panel.style.left = '0px';
  const navWidth = $('nav').clientWidth;
  const width = panel.offsetWidth;
  const wanted = anchorEl.offsetLeft;
  panel.style.left = `${Math.max(8, Math.min(wanted, navWidth - width - 8))}px`;
}

function renderBasemapPanel() {
  const panel = $('basemap-panel');
  // A tick, not a switch. Picking a basemap is one choice out of several —
  // a switch would say each style could be on or off independently.
  const tick = '<span class="tickmark">✓</span>';
  const rows = [
    `<h4>Basemap</h4>`,
    `<button class="opt ${basemapKind === 'parchment' ? 'on' : ''}" data-basemap="parchment">
       <span class="swatch" style="background:#ece1c8"></span>Parchment${tick}</button>`,
    ...Object.entries(TILE_BASEMAPS).map(([key, b]) =>
      `<button class="opt ${basemapKind === key ? 'on' : ''}" data-basemap="${key}">
         <span class="swatch" style="background:#4a5560"></span>${b.label}
         <span class="offline-note">needs internet</span></button>`),
    // Worth knowing before someone concludes the map is broken up close.
    `<div class="panel-note">Parchment is drawn from world-scale data and thins
       out below about 5&nbsp;km. For local streets, lakes and creeks, use
       Topographic or Satellite.</div>`,
    // The basemap's own fade lives in the navbar; what's left to tune here is
    // how loud its lettering is over whatever sits on top.
    `<h4>Place names</h4>`,
    `<div class="row"><label>Text</label>
       <input type="range" id="text-opacity-range" min="0" max="100" value="${Math.round(basemapTextOpacity * 100)}" />
       <span class="val" id="text-opacity-val">${Math.round(basemapTextOpacity * 100)}%</span></div>`,
  ];
  panel.innerHTML = rows.join('');

  panel.querySelectorAll('[data-basemap]').forEach((el) => {
    el.addEventListener('click', () => { setBasemap(el.dataset.basemap); closePanels(); });
  });
  const range = panel.querySelector('#text-opacity-range');
  range?.addEventListener('input', () => setBasemapTextOpacity(Number(range.value) / 100));
}

/**
 * Flip one row without rebuilding the panel.
 *
 * Re-rendering the whole list on every toggle threw away the scroll position
 * and the focused row, which is what made changing three layers feel like the
 * dropdown had closed and reopened underneath you.
 */
function setRowState(el, on) {
  if (!el) return;
  el.classList.toggle('on', on);
  el.setAttribute('aria-pressed', String(on));
}

function renderLayersPanel() {
  const panel = $('layers-panel');
  const rows = [
    `<h4>Map</h4>`,
    `<button class="opt ${showLabels ? 'on' : ''}" id="toggle-labels" aria-pressed="${showLabels}">
       <span class="swatch" style="background:#8a7a5c"></span>Place names<span class="switch"></span></button>`,
    `<button class="opt ${showBiblical ? 'on' : ''}" id="toggle-biblical" aria-pressed="${showBiblical}">
       <span class="swatch" style="background:#8c4a3f"></span>Biblical places<span class="switch"></span></button>`,
    `<button class="opt ${showEveryPlace ? 'on' : ''}" id="toggle-every" aria-pressed="${showEveryPlace}">
       <span class="swatch" style="background:#6b5a3e"></span>Show every place<span class="switch"></span></button>`,
    `<h4>Overlays</h4>`,
  ];

  for (const ov of host?.list() ?? []) {
    rows.push(`<button class="opt ${ov.enabled ? 'on' : ''}" data-overlay="${ov.id}" aria-pressed="${ov.enabled}">
        <span class="swatch" style="background:${ov.colour}"></span>${ov.title}<span class="switch"></span></button>`);
    if (ov.enabled) {
      rows.push(`<div class="row"><label>Text</label>
          <input type="range" data-text="${ov.id}" min="0" max="100" value="${Math.round(ov.textOpacity * 100)}" />
          <span class="val">${Math.round(ov.textOpacity * 100)}%</span></div>`);
    }
  }

  if (timeline?.enabled) {
    rows.push(`<button class="opt ${timeline.showAgeing ? 'on' : ''}" id="toggle-ageing" aria-pressed="${timeline.showAgeing}">
        <span class="swatch" style="background:#6b4f2a"></span>Age the map<span class="switch"></span></button>`);
  }

  panel.innerHTML = rows.join('');

  panel.querySelector('#toggle-labels')?.addEventListener('click', async (e) => {
    showLabels = !showLabels;
    setRowState(e.currentTarget, showLabels);
    await drawLabels();
  });

  panel.querySelector('#toggle-every')?.addEventListener('click', async (e) => {
    showEveryPlace = !showEveryPlace;
    setRowState(e.currentTarget, showEveryPlace);
    await drawLabels();
  });

  panel.querySelector('#toggle-biblical')?.addEventListener('click', async (e) => {
    showBiblical = !showBiblical;
    if (biblical) biblical.visible = showBiblical;
    setRowState(e.currentTarget, showBiblical);
    await drawLabels();
  });

  panel.querySelectorAll('[data-overlay]').forEach((el) => {
    el.addEventListener('click', async () => {
      const ov = host.get(el.dataset.overlay);
      setRowState(el, !ov.enabled);
      status('drawing…', true);
      await host.setEnabled(ov.id, !ov.enabled);
      status('ready');
      syncTimelineUi();

      // This one does have to rebuild: switching an overlay on adds its opacity
      // slider and switching it off takes it away. Keeping the scroll position
      // means the row you just touched is still under your finger.
      const scroll = panel.scrollTop;
      renderLayersPanel();
      panel.scrollTop = scroll;
    });
  });

  panel.querySelectorAll('[data-text]').forEach((el) => {
    el.addEventListener('input', () => {
      host.setTextOpacity(el.dataset.text, Number(el.value) / 100);
      el.parentElement.querySelector('.val').textContent = `${el.value}%`;
    });
  });

  panel.querySelector('#toggle-ageing')?.addEventListener('click', async (e) => {
    timeline.showAgeing = !timeline.showAgeing;
    setRowState(e.currentTarget, timeline.showAgeing);
    await timeline.draw();
  });
}

/** One source of truth for basemap opacity, wherever it's changed from. */
function setBasemapOpacity(value) {
  basemapOpacity = Math.max(0, Math.min(1, value));
  const pct = Math.round(basemapOpacity * 100);
  const nav = $('nav-opacity');
  if (nav && Number(nav.value) !== pct) nav.value = String(pct);
  $('nav-opacity-val').textContent = `${pct}%`;
  const panelRange = $('opacity-range');
  if (panelRange && Number(panelRange.value) !== pct) panelRange.value = String(pct);
  const panelVal = $('opacity-val');
  if (panelVal) panelVal.textContent = `${pct}%`;
  applyBasemapOpacity();
}

function setBasemapTextOpacity(value) {
  basemapTextOpacity = Math.max(0, Math.min(1, value));
  const pct = Math.round(basemapTextOpacity * 100);
  const range = $('text-opacity-range');
  if (range && Number(range.value) !== pct) range.value = String(pct);
  const val = $('text-opacity-val');
  if (val) val.textContent = `${pct}%`;
  applyBasemapTextOpacity();
}

/** The active overlay's fade, mirrored between the navbar and its panel. */
function setLayerOpacity(value) {
  if (!timeline) return;
  const v = Math.max(0, Math.min(1, value));
  host.setOpacity('timeline', v);
  const pct = Math.round(v * 100);
  const nav = $('nav-layer-opacity');
  if (nav && Number(nav.value) !== pct) nav.value = String(pct);
  $('nav-layer-opacity-val').textContent = `${pct}%`;
}

$('nav-opacity').addEventListener('input', (e) => setBasemapOpacity(Number(e.target.value) / 100));
$('nav-layer-opacity').addEventListener('input', (e) => setLayerOpacity(Number(e.target.value) / 100));

$('basemap-btn').addEventListener('click', () => { renderBasemapPanel(); togglePanel('basemap-panel', $('basemap-btn')); });
$('layers-btn').addEventListener('click', () => { renderLayersPanel(); togglePanel('layers-panel', $('layers-btn')); });
$('credit-btn').addEventListener('click', () => { renderCreditPanel(); togglePanel('credit-panel', null); });
$('world-btn').addEventListener('click', () => { map.setView([20, 10], 2, { animate: true }); closePanels(); });

document.addEventListener('click', (e) => {
  if (!e.target.closest('#nav')) closePanels();
});

// ---------------------------------------------------------------- search

const searchExpander = $('search-expander');
const searchInput = $('search-input');
let searchPin = null;

$('search-btn').addEventListener('click', () => {
  const open = !searchExpander.classList.contains('open');
  searchExpander.classList.toggle('open', open);
  if (open) setTimeout(() => searchInput.focus(), 60);
  else { $('results').hidden = true; }
});
searchInput.addEventListener('focus', () => $('search-inner').classList.add('focused'));
searchInput.addEventListener('blur', () => $('search-inner').classList.remove('focused'));
$('search-clear').addEventListener('click', () => {
  searchInput.value = '';
  $('results').hidden = true;
  searchInput.focus();
});

let searchTimer = null;
searchInput.addEventListener('input', () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(runSearch, 180);
});
searchInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') runSearch(); });

/** How an ancient name's dates read in a result row. */
function eraNote(from, to) {
  const year = (y) => (y < 0 ? `${Math.abs(y)} BC` : `AD ${y}`);
  if (from == null && to == null) return '';
  if (from != null && to != null) return `${year(from)} – ${year(to)}`;
  return year(from ?? to);
}

/**
 * Search Scripture first, then the modern world.
 *
 * This is a Bible atlas, so someone typing "Capernaum" wants the town by the
 * lake, not a street in Illinois named after it. Scripture's own places are
 * held in memory and answer instantly; the gazetteer is asked over the wire and
 * fills in below. Both are shown, because "Antioch" is a fair question about
 * either world.
 */
async function runSearch() {
  const raw = searchInput.value.trim();
  const box = $('results');
  if (raw.length < 2) { box.hidden = true; return; }

  const sacred = scripture?.search(raw, 12) ?? [];

  let hits = [];
  try {
    const res = await fetch(`/api/atlas-search?q=${encodeURIComponent(raw)}&limit=40`);
    hits = (await res.json()).results ?? [];
  } catch {
    hits = [];
  }

  box.style.left = `${$('search-btn').offsetLeft}px`;

  if (!sacred.length && !hits.length) {
    box.innerHTML = `<div class="res-empty">Nothing found for “${raw}”.</div>`;
    box.hidden = false;
    return;
  }

  const rows = [];
  if (sacred.length) {
    rows.push('<div class="res-head">In Scripture</div>');
    rows.push(...sacred.map((e, i) => {
      const note = e.kind === 'biblical'
        ? [e.verses ? `${e.verses} verse${e.verses === 1 ? '' : 's'}` : null, e.modern ? `now ${e.modern}` : null]
        : [e.type, eraNote(e.from, e.to)];
      return `
      <button class="res" data-s="${i}">
        <div class="n">${e.name}${e.kind === 'ancient' ? '<span class="kindtag">ancient name</span>' : ''}</div>
        <div class="m">${note.filter(Boolean).join(' · ')}</div>
      </button>`;
    }));
  }
  if (hits.length) {
    if (sacred.length) rows.push('<div class="res-head">On the modern map</div>');
    rows.push(...hits.map((c, i) => `
      <button class="res" data-i="${i}">
        <div class="n">${c.name}${FEATURE_NOTE[c.fcode] ? `<span class="kindtag">${FEATURE_NOTE[c.fcode]}</span>` : ''}</div>
        <div class="m">${[c.admin1, c.country, c.population ? `${c.population.toLocaleString()} people` : null]
          .filter(Boolean).join(' · ')}</div>
      </button>`));
  }
  box.innerHTML = rows.join('');

  for (const el of box.querySelectorAll('.res[data-i]')) {
    el.addEventListener('click', () => goToPlace(hits[Number(el.dataset.i)]));
  }
  for (const el of box.querySelectorAll('.res[data-s]')) {
    el.addEventListener('click', () => goToScripture(sacred[Number(el.dataset.s)]));
  }
  box.hidden = false;
}

/**
 * Land on a place Scripture names, and open what the app knows about it.
 *
 * A modern search drops a pin and stops there. This one opens the same panel a
 * tap on the map opens — the verses, the encyclopedia article — because finding
 * Capernaum and being told only that it exists would be a wasted answer.
 */
function goToScripture(entry) {
  if (searchPin) map.removeLayer(searchPin);
  searchPin = L.marker([entry.lat, entry.lon], { pane: 'pins', icon: PIN_ICON }).addTo(map);
  map.flyTo([entry.lat, entry.lon], entry.kind === 'ancient' ? 7 : 11, { duration: 1.1 });
  $('results').hidden = true;

  if (entry.kind === 'biblical' && entry.place) {
    openPlace(entry.place);
  } else {
    searchPin.bindPopup(
      `<strong>${entry.name}</strong><br>${[entry.type, eraNote(entry.from, entry.to)].filter(Boolean).join('<br>')}`
    ).openPopup();
  }
}

/** Leaflet's default marker points at image files a bundler won't resolve, so
 *  the pin is drawn rather than loaded. */
const PIN_ICON = L.divIcon({
  className: '',
  html: '<div style="width:14px;height:14px;border-radius:50% 50% 50% 0;transform:rotate(-45deg);'
      + 'background:#fb7185;border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.5)"></div>',
  iconSize: [14, 14],
  iconAnchor: [7, 14],
  popupAnchor: [0, -14],
});

function goToPlace(place) {
  if (searchPin) map.removeLayer(searchPin);
  searchPin = L.marker([place.lat, place.lon], { pane: 'pins', icon: PIN_ICON }).addTo(map);
  searchPin.bindPopup(
    `<strong>${place.name}</strong><br>${[place.country, place.population ? place.population.toLocaleString() + ' people' : null].filter(Boolean).join('<br>')}`
  );
  map.flyTo([place.lat, place.lon], 9, { duration: 1.1 });
  searchPin.openPopup();
  $('results').hidden = true;
}

// ------------------------------------------------------- the photograph viewer

/**
 * A photograph, full screen, inside the app.
 *
 * This mirrors the app's art viewer, which is what it becomes when the map moves
 * across: black ground, pan and zoom, and the credit as a caption link. The one
 * rule it exists to keep is that opening a picture never navigates anywhere —
 * biblical art originally sent people out to the source and had to be fixed, and
 * this does not repeat it.
 */
const photoViewer = {
  k: 1, tx: 0, ty: 0, dragging: false, lastX: 0, lastY: 0,
};

function paintPhoto() {
  const img = $('photo-img');
  img.style.transform = `translate(${photoViewer.tx}px, ${photoViewer.ty}px) scale(${photoViewer.k})`;
  $('photo-stage').classList.toggle('zoomed', photoViewer.k > 1.02);
}

function resetPhoto() {
  photoViewer.k = 1;
  photoViewer.tx = 0;
  photoViewer.ty = 0;
  paintPhoto();
}

function openPhoto(shot, title) {
  const img = $('photo-img');
  const cap = $('photo-caption');

  img.classList.remove('ready');
  $('photo-state').hidden = false;
  $('photo-state').textContent = 'Loading…';
  resetPhoto();

  img.onload = () => { img.classList.add('ready'); $('photo-state').hidden = true; };
  img.onerror = () => { $('photo-state').hidden = false; $('photo-state').textContent = 'Couldn’t open this photograph.'; };
  img.src = shot.f || shot.t;
  img.alt = title || '';

  cap.querySelector('.cap-title').textContent = title || '';
  cap.querySelector('.cap-meta').textContent = shot.d || '';
  cap.querySelector('.cap-licence').textContent = [shot.a, shot.l].filter(Boolean).join(' · ');
  const link = cap.querySelector('.cap-source');
  link.href = shot.u || '';
  link.hidden = !shot.u;

  $('photo-viewer').hidden = false;
}

function closePhoto() {
  $('photo-viewer').hidden = true;
  $('photo-img').src = '';
}

$('photo-close').addEventListener('click', closePhoto);

// The ground closes; the picture and the caption do not, so a mis-aimed tap
// while reading the credit doesn't throw the photograph away.
$('photo-stage').addEventListener('click', (e) => {
  if (e.target === $('photo-stage') && photoViewer.k <= 1.02) closePhoto();
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !$('photo-viewer').hidden) closePhoto();
});

/** Wheel and pinch zoom, capped so a photograph can't be lost off-screen. */
$('photo-stage').addEventListener('wheel', (e) => {
  e.preventDefault();
  const next = Math.min(6, Math.max(1, photoViewer.k * (e.deltaY < 0 ? 1.15 : 1 / 1.15)));
  if (next === 1) { resetPhoto(); return; }
  photoViewer.k = next;
  paintPhoto();
}, { passive: false });

$('photo-img').addEventListener('dblclick', () => {
  const img = $('photo-img');
  img.classList.add('animating');
  setTimeout(() => img.classList.remove('animating'), 220);
  if (photoViewer.k > 1.02) resetPhoto();
  else { photoViewer.k = 2.5; paintPhoto(); }
});

$('photo-stage').addEventListener('pointerdown', (e) => {
  if (photoViewer.k <= 1.02) return;
  photoViewer.dragging = true;
  photoViewer.lastX = e.clientX;
  photoViewer.lastY = e.clientY;
  $('photo-stage').setPointerCapture(e.pointerId);
});

$('photo-stage').addEventListener('pointermove', (e) => {
  if (!photoViewer.dragging) return;
  photoViewer.tx += e.clientX - photoViewer.lastX;
  photoViewer.ty += e.clientY - photoViewer.lastY;
  photoViewer.lastX = e.clientX;
  photoViewer.lastY = e.clientY;
  paintPhoto();
});

for (const ev of ['pointerup', 'pointercancel']) {
  $('photo-stage').addEventListener(ev, () => { photoViewer.dragging = false; });
}

// -------------------------------------------------------- the ageing look

/**
 * How aged the map should look right now.
 *
 * 1 at the oldest era, 0 once the timeline reaches the present or is switched
 * off entirely — the ageing belongs to the overlay, not to the map.
 */
function agedness() {
  if (!timeline?.enabled || !timeline.showAgeing) return 0;
  return 1 - timeline.progress;
}

/**
 * Put the age on the page.
 *
 * The wobble is a displacement filter over the overlay's ink, so coastlines
 * drawn from survey coordinates read as though a hand drew them. Only the
 * overlay is filtered: the basemap underneath stays a straight reference.
 */
function applyAgeing() {
  const age = agedness();

  const displace = document.getElementById('ink-displace');
  if (displace) displace.setAttribute('scale', (age * 3.2).toFixed(2));

  for (const name of ['overlay-line', 'overlay-fill']) {
    map.getPane(name)?.classList.toggle('aged', age > 0.05);
  }

  const grain = $('grain');
  if (grain) grain.style.opacity = (age * 0.55).toFixed(3);
}

/**
 * Mountains the way an old atlas draws them.
 *
 * A modern map marks a peak with a dot and a height. An old one draws little
 * hachured ridges, so the early eras get those instead — the same 711 surveyed
 * peaks, drawn in the idiom of their century.
 */
let ridgeLayer = null;
async function drawRidges(zoom, bounds) {
  if (ridgeLayer) { map.removeLayer(ridgeLayer); ridgeLayer = null; }
  const age = agedness();
  if (age < 0.35 || zoom < 4.5) return;

  peaks ??= await getJson(index.points.peak.file);
  ridgeLayer = L.layerGroup([], { pane: 'overlay-labels' }).addTo(map);

  let n = 0;
  for (const pk of peaks) {
    if (!bounds.contains([pk.lat, pk.lon])) continue;
    // Taller peaks get a wider ridge, so the drawing still carries information.
    const w = pk.elevation > 3000 ? 22 : pk.elevation > 1500 ? 17 : 13;
    const h = Math.round(w * 0.5);
    const ink = `rgba(92,63,28,${(0.5 + age * 0.4).toFixed(2)})`;
    const marker = L.marker([pk.lat, pk.lon], {
      pane: 'overlay-labels',
      // A drawn mountain with no name is only useful if it answers when asked,
      // so the ridge is clickable even though the lettering is suppressed here.
      interactive: true,
      icon: L.divIcon({
        className: 'ridge',
        html: `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" fill="none"
                 stroke="${ink}" stroke-width="1.1" stroke-linecap="round">
                 <path d="M1 ${h - 1} L${w * 0.32} 2 L${w * 0.52} ${h - 1}
                          L${w * 0.68} ${h * 0.35} L${w - 1} ${h - 1}" />
                 <path d="M${w * 0.32} 2 L${w * 0.26} ${h - 3}" stroke-width="0.7" />
                 <path d="M${w * 0.68} ${h * 0.35} L${w * 0.63} ${h - 3}" stroke-width="0.7" />
               </svg>`,
        iconSize: [w, h], iconAnchor: [w / 2, h],
      }),
    });
    marker.bindTooltip(
      pk.elevation ? `${pk.name} · ${Math.round(pk.elevation).toLocaleString()} m` : pk.name,
      { direction: 'top', offset: [0, -4] }
    );
    marker.on('click', (e) => { L.DomEvent.stop(e); openPeak(pk); });
    ridgeLayer.addLayer(marker);
    if (++n > 70) break;
  }
}

/**
 * The panel for a peak.
 *
 * Answers with its height, and with whatever Scripture names nearby — a
 * mountain in the biblical world is usually near something the text mentions.
 */
function openPeak(pk) {
  const near = biblical?.nearest(pk.lat, pk.lon, 70);
  $('info-body').innerHTML = `
    <div class="info-name">${pk.name}</div>
    <div class="info-sub">${pk.elevation ? `${Math.round(pk.elevation).toLocaleString()} m` : 'Peak'}</div>
    <div class="info-where">
      ${pk.lat.toFixed(4)}, ${pk.lon.toFixed(4)}
      ${near ? `<br>Nearest biblical place: <b>${near.place.n}</b>, ${near.km.toFixed(0)} km` : ''}
    </div>`;

  if (near) {
    const btn = document.createElement('button');
    btn.className = 'vb-ref';
    btn.style.borderLeftColor = '#8c4a3f';
    btn.style.marginTop = '12px';
    btn.innerHTML = `<span class="vb-ref-label" style="color:#c98b7a">${near.place.n}</span>` +
      `<span class="vb-ref-text">${near.place.v.length} reference` +
      `${near.place.v.length === 1 ? '' : 's'} in Scripture</span>`;
    btn.addEventListener('click', () => openPlace(near.place));
    $('info-body').appendChild(btn);
  }
  $('info').hidden = false;
}

// ---------------------------------------------------- reading along with you

/** Places the current passage names, highlighted over everything else. */
let readingLayer = null;
let readingPassage = null;

/**
 * Follow a passage.
 *
 * Frames the places it names and moves the timeline to the era those books
 * belong to, so the map shows the world the passage happens in.
 */
async function followPassage(text) {
  const parsed = parsePassage(text);
  if (readingLayer) { map.removeLayer(readingLayer); readingLayer = null; }

  if (!parsed) {
    readingPassage = null;
    if (text.trim()) status(`don't recognise "${text.trim()}"`);
    return;
  }

  readingPassage = parsed;
  const hits = placesInPassage(biblical?.places ?? [], parsed);
  const label = parsed.chapter ? `${bookName(parsed.book)} ${parsed.chapter}` : bookName(parsed.book);

  if (!hits.length) {
    status(`${label} names no places on the map`);
    return;
  }

  // Move the timeline to the era this book witnesses, so the borders on screen
  // are the ones the passage happened under.
  const era = eraForBook(index.eras, parsed.book);
  if (era && timeline) {
    const i = index.eras.findIndex((e) => e.id === era.id);
    if (i >= 0 && i !== timeline.index) {
      if (!timeline.enabled) {
        await host.setEnabled('timeline', true);
        syncTimelineUi();
        renderLayersPanel();
      }
      await timeline.setEra(i);
    }
  }

  readingLayer = L.layerGroup([], { pane: 'pins' }).addTo(map);
  for (const { place, count } of hits) {
    readingLayer.addLayer(L.circleMarker([place.y, place.x], {
      pane: 'pins', radius: 5 + Math.min(5, count),
      fillColor: '#fb7185', fillOpacity: 0.25,
      color: '#fb7185', weight: 2, interactive: false,
    }));
  }

  map.flyToBounds(L.latLngBounds(hits.map((h) => [h.place.y, h.place.x])), {
    padding: [70, 70], maxZoom: 9, duration: 1,
  });

  status(`${label}: ${hits.length} place${hits.length === 1 ? '' : 's'}${era ? ` · ${era.title}` : ''}`);
  await drawLabels();
}

const readingExpander = $('reading-expander');
const readingInput = $('reading-input');

$('reading-btn').addEventListener('click', () => {
  const open = !readingExpander.classList.contains('open');
  readingExpander.classList.toggle('open', open);
  $('reading-btn').classList.toggle('on', open);
  if (open) setTimeout(() => readingInput.focus(), 60);
  else if (readingLayer) { map.removeLayer(readingLayer); readingLayer = null; readingPassage = null; }
});
readingInput.addEventListener('focus', () => $('reading-inner').classList.add('focused'));
readingInput.addEventListener('blur', () => $('reading-inner').classList.remove('focused'));

let readingTimer = null;
readingInput.addEventListener('input', () => {
  clearTimeout(readingTimer);
  readingTimer = setTimeout(() => followPassage(readingInput.value), 400);
});
readingInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { clearTimeout(readingTimer); followPassage(readingInput.value); }
});

// ------------------------------------------------------ what you tapped

/**
 * Open the panel for a biblical place.
 *
 * The verse list groups by book in canonical order and colours each row by the
 * book's category, matching the word study and the encyclopedia — a verse list
 * should read the same wherever you meet one.
 */
/**
 * The photograph on a place panel.
 *
 * A thumbnail, the photographer under it, and the whole picture one tap away.
 * The average colours OpenBible ships hold the space while the picture loads,
 * so the panel does not jump as it arrives.
 */
function photoBlock(place) {
  const shot = photos[place.id];
  if (!shot) return '';
  const ground = (shot.p || '').split(',')[0] || '#cfc4a8';
  return `
    <div class="info-photo" data-photo="${place.id}" style="background:${ground}"
         role="button" tabindex="0" title="Open the photograph">
      <img src="${shot.t}" alt="${place.n}" loading="lazy" />
      <div class="shot-credit">${[shot.a, shot.l].filter(Boolean).join(' · ')}</div>
    </div>`;
}

function openPlace(place) {
  const groups = groupByBook(place.v);
  const where = [place.m && `Modern: <b>${place.m}</b>`, place.t].filter(Boolean).join('<br>');

  $('info-body').innerHTML = `
    <div class="info-name">${place.n}</div>
    <div class="info-sub">${place.v.length} reference${place.v.length === 1 ? '' : 's'} in Scripture</div>
    ${where ? `<div class="info-where">${where}</div>` : ''}
    ${photoBlock(place)}
    ${place.lead ? `<div class="info-lead">${place.lead}${place.lead.length >= 419 ? '…' : ''}</div>` : ''}
    <div class="info-h">Where it appears</div>
    ${groups.map((g) => {
      const colour = getBookColor(bookName(g.book));
      return `
      <div class="vb-group" data-book="${g.book}">
        <button class="vb-header">
          <span class="vb-caret" style="color:${colour}">&#9654;</span>
          <span class="vb-name" style="color:${colour}">${bookName(g.book)}</span>
          <span class="vb-count">(${g.refs.length})</span>
        </button>
        <div class="vb-refs">
          ${g.refs.map((r) => `
            <button class="vb-ref" data-osis="${r.osis}" style="border-left-color:${colour}">
              <span class="vb-ref-label" style="color:${colour}">${r.readable}</span>
            </button>`).join('')}
        </div>
      </div>`;
    }).join('')}`;

  for (const head of $('info-body').querySelectorAll('.vb-header')) {
    head.addEventListener('click', () => {
      const group = head.parentElement;
      group.classList.toggle('open');
      head.querySelector('.vb-caret').innerHTML =
        group.classList.contains('open') ? '&#9660;' : '&#9654;';
    });
  }
  // In the app this navigates the reader; in the lab it reports the reference
  // so the wiring can be checked without the reader present.
  for (const ref of $('info-body').querySelectorAll('.vb-ref')) {
    ref.addEventListener('click', () => status(`would open ${ref.textContent.trim()}`));
  }

  for (const el of $('info-body').querySelectorAll('[data-photo]')) {
    const open = () => {
      const shot = photos[el.dataset.photo];
      if (shot) openPhoto(shot, place.n);
    };
    el.addEventListener('click', open);
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); }
    });
  }

  // The first book opens, so the panel never lands as a wall of closed rows.
  const first = $('info-body').querySelector('.vb-group');
  if (first) {
    first.classList.add('open');
    first.querySelector('.vb-caret').innerHTML = '&#9660;';
  }
  $('info').hidden = false;
}

/**
 * Open the panel for a bare point on the map.
 *
 * Answers from the packs, offline: what era territory or land you're inside,
 * the nearest biblical place, and the nearest modern town.
 */
function openPoint(latlng) {
  const found = host?.identify(latlng) ?? [];
  const near = biblical?.nearest(latlng.lat, latlng.lng, 80);

  let town = null;
  for (const r of townRows) {
    const km = haversine(latlng.lat, latlng.lng, r.lat, r.lon);
    if (!town || km < town.km) town = { km, row: r };
  }

  const lines = [];
  for (const hit of found) {
    if (hit.kind === 'territory') lines.push(`Inside <b>${hit.label}</b>`);
    else if (hit.kind === 'land') lines.push(`In the land of <b>${hit.label}</b>`);
  }
  if (near) {
    lines.push(`Nearest biblical place: <b>${near.place.n}</b>, ${near.km.toFixed(0)} km`);
  }
  if (town && town.km < 60) {
    const r = town.row;
    lines.push(`Nearest today: <b>${r.name}</b>${r.admin1 ? `, ${r.admin1}` : ''}${r.country ? `, ${r.country}` : ''}`);
  }
  if (!lines.length) lines.push('Nothing known at this point.');

  $('info-body').innerHTML = `
    <div class="info-name">This spot</div>
    <div class="info-sub">${latlng.lat.toFixed(4)}, ${latlng.lng.toFixed(4)}</div>
    <div class="info-where">${lines.join('<br>')}</div>
    ${near ? '<div class="info-h">Nearby</div>' : ''}`;

  if (near) {
    const btn = document.createElement('button');
    btn.className = 'vb-ref';
    btn.style.borderLeftColor = '#8c4a3f';
    btn.innerHTML = `<span class="vb-ref-label" style="color:#c98b7a">${near.place.n}</span>` +
      `<span class="vb-ref-text">${near.place.v.length} reference` +
      `${near.place.v.length === 1 ? '' : 's'} in Scripture</span>`;
    btn.addEventListener('click', () => openPlace(near.place));
    $('info-body').appendChild(btn);
  }
  $('info').hidden = false;
}

$('info-close').addEventListener('click', () => { $('info').hidden = true; });
map.on('click', (e) => openPoint(e.latlng));

// ------------------------------------------------------- overlays & timeline

let host = null;
let timeline = null;

/**
 * Real calendar time, eased. Without the easing the two millennia before Persia
 * swallow the slider and the crowded centuries after it collapse to a few pixels.
 */
function eraPos(era, eras) {
  const mid = (e) => (e.year_start + e.year_end) / 2;
  const years = eras.map(mid);
  const lo = Math.min(...years);
  const hi = Math.max(...years);
  return Math.pow((mid(era) - lo) / (hi - lo), 0.62);
}

function buildTimelineUi() {
  const track = $('tl-track');
  const eras = timeline.eras;
  track.innerHTML = '<div id="tl-rail"></div><div id="tl-knob"></div>';

  const firstAttested = eras.findIndex((e) => e.confidence === 'attested');
  if (firstAttested > 0) {
    $('tl-rail').style.setProperty('--split', `${(eraPos(eras[firstAttested], eras) * 100).toFixed(1)}%`);
  }

  eras.forEach((era, i) => {
    const pct = eraPos(era, eras) * 100;
    const tick = document.createElement('div');
    tick.className = 'tl-tick';
    tick.style.left = `${pct}%`;
    tick.dataset.i = String(i);
    track.appendChild(tick);

    const lab = document.createElement('div');
    lab.className = 'tl-lab';
    lab.style.left = `${pct}%`;
    lab.dataset.i = String(i);
    lab.textContent = era.year_start < 0 ? `${Math.abs(era.year_start)} BC` : `AD ${era.year_start}`;
    track.appendChild(lab);
  });

  const nearest = (clientX) => {
    const r = track.getBoundingClientRect();
    const t = Math.max(0, Math.min(1, (clientX - r.left) / r.width));
    let best = 0;
    let bd = Infinity;
    eras.forEach((e, i) => {
      const d = Math.abs(eraPos(e, eras) - t);
      if (d < bd) { bd = d; best = i; }
    });
    return best;
  };

  let dragging = false;
  track.addEventListener('pointerdown', (e) => {
    dragging = true;
    track.setPointerCapture(e.pointerId);
    timeline.setEra(nearest(e.clientX));
  });
  track.addEventListener('pointermove', (e) => { if (dragging) timeline.setEra(nearest(e.clientX)); });
  track.addEventListener('pointerup', () => { dragging = false; });
  track.addEventListener('pointercancel', () => { dragging = false; });
  track.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowRight') { timeline.setEra(timeline.index + 1); e.preventDefault(); }
    if (e.key === 'ArrowLeft') { timeline.setEra(timeline.index - 1); e.preventDefault(); }
  });

  let playTimer = null;
  $('tl-play').addEventListener('click', function play() {
    if (playTimer) {
      clearInterval(playTimer);
      playTimer = null;
      this.innerHTML = '&#9654;';
      return;
    }
    this.innerHTML = '&#10073;&#10073;';
    if (timeline.index >= timeline.eras.length - 1) timeline.setEra(0);
    playTimer = setInterval(() => {
      if (timeline.index >= timeline.eras.length - 1) {
        clearInterval(playTimer);
        playTimer = null;
        this.innerHTML = '&#9654;';
        return;
      }
      timeline.setEra(timeline.index + 1);
    }, 1700);
  });

  // The caption doubles as "frame this era", so the Roman Empire's full extent
  // is one tap away instead of a hunt.
  $('tl-caption').addEventListener('click', frameEra);
}

function frameEra() {
  const bounds = L.latLngBounds([]);
  for (const layer of timeline.layers) {
    if (!layer.getBounds) continue;
    try {
      const b = layer.getBounds();
      if (b.isValid()) bounds.extend(b);
    } catch { /* layer groups of labels have no bounds; skip them */ }
  }
  if (bounds.isValid()) map.flyToBounds(bounds, { padding: [50, 50], maxZoom: 8, duration: 1 });
}

function syncTimelineUi() {
  const on = Boolean(timeline?.enabled);
  $('timeline-bar').hidden = !on;
  $('timeline-btn').classList.toggle('on', on);
  $('nav-layer-fade').hidden = !on;
  if (on) {
    const pct = Math.round(timeline.opacity * 100);
    $('nav-layer-opacity').value = String(pct);
    $('nav-layer-opacity-val').textContent = `${pct}%`;
  }
  if (on) renderEraCaption();
  // Switching the timeline off takes the soft shapes away with it, so the key
  // that explains them has to go at the same moment — renderEraCaption is not
  // called on the way out.
  else $('approx-key').hidden = true;
}

/**
 * The first era whose borders are actually known.
 *
 * Everything before it shows the lands its books name; everything from it on
 * shows surveyed frontiers. Crossing that line changes what the map is
 * claiming, which is worth one sentence.
 */
function firstSurveyedIndex() {
  return timeline.eras.findIndex((e) => e.confidence === 'attested');
}

function renderEraCaption() {
  const era = timeline.era;
  const yr = (y) => (y < 0 ? `${Math.abs(y)} BC` : `AD ${y}`);

  // The key belongs to the map, not to the hover card: the soft shapes are on
  // screen whether or not anybody opens the era's details.
  const approximate = timeline.enabled && era.confidence !== 'attested';
  $('approx-key').hidden = !approximate;
  // One line in the bar, the rest on hover — the bar shouldn't eat the map.
  $('tl-caption').innerHTML = `
    <div class="tl-title">${era.title}</div>
    <div class="tl-years">
      <span class="tl-dot ${era.confidence}"></span>${yr(era.year_start)} – ${yr(era.year_end)}
    </div>
    <div class="tl-more">
      ${era.subtitle ? `<div class="tl-title">${era.subtitle}</div>` : ''}
      <div class="tl-blurb">${era.blurb ?? ''}</div>
      ${era.dating_note ? `<div class="tl-note">${era.dating_note}</div>` : ''}
      <span class="tl-tag ${era.confidence}">${era.confidence === 'attested'
        ? 'Surveyed borders'
        : 'Approximate · lands named in Scripture'}</span>
      ${timeline.index === firstSurveyedIndex()
        ? `<div class="tl-seam">From here the borders are known. Everything earlier
             shows the lands its books name, drawn as approximate — nobody knows
             where Assyria's frontier ran.</div>`
        : ''}
      <div class="tl-hint">Click to frame this era on the map</div>
    </div>`;

  for (const el of $('tl-track').querySelectorAll('.tl-tick, .tl-lab')) {
    el.classList.toggle('on', Number(el.dataset.i) === timeline.index);
  }
  const knob = $('tl-knob');
  if (knob) knob.style.left = `${eraPos(timeline.era, timeline.eras) * 100}%`;
}

$('timeline-btn').addEventListener('click', async () => {
  status('drawing…', true);
  await host.setEnabled('timeline', !timeline.enabled);
  status('ready');
  syncTimelineUi();
  renderLayersPanel();
});

// ------------------------------------------------------------------- start

(async function start() {
  try {
    index = await getJson('index.json');

    // Which ground has the fine water. Absent on a build that has not harvested
    // it, and the map simply stays on the coarse copy — no error, just no gain.
    try {
      fineWaterBoxes = (await getJson('base-detail1-coverage.json')).boxes ?? [];
    } catch {
      fineWaterBoxes = [];
    }

    await setBasemap('parchment');

    // Any overlay appearing, vanishing or changing era reshuffles the lettering,
    // because all of it is laid out in one pass.
    host = new OverlayHost(map, {
      rendererFor, getJson, index,
      onChange: () => { drawLabels(); },
    });
    host.onLabelsChanged = () => { drawLabels(); };

    const biblicalRows = await getJson(index.biblicalPlaces.file);
    biblical = new BiblicalPlaces(map, { places: biblicalRows });
    biblical.visible = showBiblical;
    biblical.onOpen = openPlace;

    // Search over Scripture's own places, so "Capernaum" and "Golgotha" find
    // something. The ancient names are fetched here rather than left to the
    // timeline's lazy load — 120 KB, and search should know Phrygia whether or
    // not anybody has switched the timeline on yet.
    ancientNames ??= await getJson(index.ancientNames.file);
    scripture = new ScriptureSearch(biblicalRows, ancientNames);

    // A photograph for three quarters of the places Scripture names. Only URLs
    // — Wikimedia serves the pictures — so this is half a megabyte, not fifty.
    if (index.placePhotos) {
      try {
        photos = await getJson(index.placePhotos.file);
      } catch {
        photos = {};
      }
    }
    const overlayPlaces = index.overlayPlaces ? await getJson(index.overlayPlaces.file) : [];
    timeline = host.register(new TimelineOverlay({ eras: index.eras, places: overlayPlaces }));
    timeline.onEraChange = renderEraCaption;
    buildTimelineUi();
    syncTimelineUi();

    renderBasemapPanel();
    renderLayersPanel();
    renderCreditPanel();
    $('boot').remove();
  } catch (err) {
    // Say where it broke, not just that it broke. "Cannot read properties of
    // undefined" with no line is a message that costs an hour to act on.
    console.error('[atlas] boot failed', err);
    const where = String(err?.stack ?? '')
      .split('\n').slice(1, 4).map((l) => l.trim()).join('\n');
    $('boot').innerHTML =
      `<div style="max-width:560px;text-align:left;padding:24px">
         <div style="color:#fb7185;margin-bottom:8px;text-align:center">The atlas failed to load.</div>
         <div style="font-size:12.5px;color:#c9c2b4;margin-bottom:10px;text-align:center">${String(err?.message ?? err)}</div>
         <pre style="font-size:11px;color:#8a8a8a;white-space:pre-wrap;margin:0">${where}</pre>
       </div>`;
  }
})();
