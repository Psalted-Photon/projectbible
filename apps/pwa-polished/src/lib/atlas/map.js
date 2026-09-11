/**
 * The map itself: the drawing, not the furniture.
 *
 * Lifted from the lab's entry file with one change of shape. The lab was a
 * module that reached for elements by id; this is a factory that takes a
 * container and a set of callbacks, so the same code can run twice on one
 * screen — the full map in its window, and the bare one in the encyclopedia —
 * without either knowing anything about the other's controls.
 *
 * A factory rather than a class on purpose. The lab's state lived in module
 * variables that dozens of functions closed over, and a closure keeps that
 * exactly as it was; converting each one to `this.x` would have touched every
 * line of a 1,700-line port for no gain, and this codebase has already lost an
 * afternoon to an identifier that silently became a global.
 *
 * Two ideas hold it together, both carried over unchanged:
 *
 *   The map is a map first. Nothing floats on its surface — every control lives
 *   in the navbar above it — and the basemap stands on its own with no overlay
 *   switched on.
 *
 *   Overlays ride on top and must be self-sufficient. Each registers what it
 *   draws, what colour it is and what a tap on it means, so the timeline is
 *   just the first of them rather than something the map is built around.
 */

import L from 'leaflet';
import { OverlayHost, TimelineOverlay } from './overlays.js';
import { LabelEngine } from './labels.js';
import { BiblicalPlaces, haversine, bookName } from './places.js';
import { parsePassage, placesInPassage, eraForBook } from './reading.js';

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

export const TILE_BASEMAPS = {
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

/** The drawn basemap: real polygons, in draw order, swapped by zoom. */
const DRAWN_ORDER = [
  ['ocean', 'ocean'], ['land', 'land'], ['terrain', 'terrain'],
  ['lakes', 'lakes'], ['rivers', 'rivers'], ['coastline', 'coast'],
];

/** At the finest level these are not drawn at all; see sourceFor. */
const NOT_AT_FINEST = new Set([
  // The parchment ground is the land, so the sea is painted over it and the
  // shoreline comes from the accurate side of the pair.
  'land',
  // The sea's own edge is the shoreline. A separate coarse stroke would run a
  // kilometre away from it and read as two coasts.
  'coastline',
]);

/** Plain-English notes for the feature codes people actually meet. */
const FEATURE_NOTE = {
  BAY: 'bay', GULF: 'gulf', LK: 'lake', SEA: 'sea', STM: 'river', CHN: 'channel',
  SD: 'sound', LGN: 'lagoon', RSV: 'reservoir', SPNG: 'spring', FLLS: 'falls',
  MT: 'mountain', PK: 'peak', RDGE: 'ridge', VAL: 'valley', ISL: 'island',
  CAPE: 'cape', PEN: 'peninsula', DSRT: 'desert', PLN: 'plain', HLL: 'hill',
  PPLC: 'capital', PPLA: 'admin capital', RGN: 'region', PRK: 'park',
};

/**
 * Sources, and what each one actually asks for.
 *
 * Natural Earth is public domain and explicitly says crediting is unnecessary,
 * so nothing is stamped on the map for it. Only Esri's tiles and the historical
 * data carry real conditions, and those are shown on request rather than
 * permanently occupying a corner of the map.
 */
export const SOURCES = {
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
  dare: {
    name: 'Digital Atlas of the Roman Empire',
    terms: 'CC BY-SA 3.0 — attribution required.',
    url: 'https://imperium.ahlfeldt.se/',
  },
  osm: {
    name: 'OpenStreetMap contributors',
    terms: 'ODbL 1.0 — attribution required.',
    url: 'https://www.openstreetmap.org/copyright',
  },
  openbible: {
    name: 'OpenBible.info',
    terms: 'CC BY 4.0 — attribution required.',
    url: 'https://www.openbible.info/geo/',
  },
  geonames: {
    name: 'GeoNames',
    terms: 'CC BY 4.0 — attribution required.',
    url: 'https://www.geonames.org/',
  },
};

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

/**
 * A point to put a name at.
 *
 * Polygons get the middle of their largest ring rather than an average of every
 * vertex, which for a country with many small islands lands in the sea.
 */
function centroid(geom) {
  if (!geom) return null;
  const rings = geom.type === 'Polygon' ? [geom.coordinates[0]]
    : geom.type === 'MultiPolygon' ? geom.coordinates.map((p) => p[0])
    : geom.type === 'LineString' ? [geom.coordinates]
    : geom.type === 'MultiLineString' ? geom.coordinates
    : geom.type === 'Point' ? [[geom.coordinates]]
    : [];
  if (!rings.length) return null;

  let best = null;
  let bestSize = -1;
  for (const ring of rings) {
    if (!ring?.length) continue;
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const [x, y] of ring) {
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
    const size = (maxX - minX) * (maxY - minY);
    if (size > bestSize) {
      bestSize = size;
      best = [(minY + maxY) / 2, (minX + maxX) / 2];
    }
  }
  return best;
}

/**
 * Build a map into `container`.
 *
 * Everything the caller needs to know comes back through callbacks; nothing
 * here writes to the page outside the container it was given.
 *
 * @param {HTMLElement} container
 * @param {object} options
 * @param {(key: string) => Promise<any>} options.getJson   one layer, by id
 * @param {object} options.index                            what exists
 * @param {(q: string, n: number) => Promise<any[]>} [options.searchModern]
 * @param {(b: object, o: object) => Promise<any[]>} [options.placesInBounds]
 * @param {boolean} [options.slim]  no overlays, dots or lettering — just the map
 */
export function createAtlasMap(container, options = {}) {
  const {
    getJson,
    index,
    placesInBounds = async () => [],
    slim = false,
    center = [31.8, 35.2],
    zoom = 5,
  } = options;

  /** Every callback is optional; a missing one simply means nobody is looking. */
  const emit = {
    status: (text, busy = false) => options.onStatus?.(text, busy),
    basemap: (kind) => options.onBasemap?.(kind),
    era: (era) => options.onEra?.(era),
    layers: () => options.onLayers?.(),
    place: (info) => options.onPlace?.(info),
    point: (info) => options.onPoint?.(info),
    view: () => options.onView?.(map.getCenter(), map.getZoom()),
  };

  // ----------------------------------------------------------------- the map

  const map = L.map(container, {
    center,
    zoom,
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

  for (const [name, z] of PANES) {
    map.createPane(name);
    map.getPane(name).style.zIndex = String(z);
  }
  map.getPane('labels').style.pointerEvents = 'none';
  map.getPane('overlay-labels').style.pointerEvents = 'none';

  /**
   * A Leaflet canvas renderer lives in a single pane, so sharing one instance
   * across layers quietly ignores their `pane` option and draws them all in one
   * place. That put the city dots outside the label pane, so fading the basemap
   * removed the names and left the dots behind — the unlabelled specks. It also
   * meant the pane z-order above was decorative rather than real.
   */
  const renderers = new Map();
  const rendererFor = (pane) => {
    if (!renderers.has(pane)) renderers.set(pane, L.canvas({ padding: 0.35, pane }));
    return renderers.get(pane);
  };

  /**
   * The paper grain and the ink wobble.
   *
   * Both belong to the map rather than to whatever is hosting it, so both are
   * built here. The lab had them in its page, which is why they were the two
   * things that would have gone missing in the move.
   */
  const grain = document.createElement('div');
  grain.className = 'atlas-grain';
  grain.style.cssText =
    'position:absolute;inset:0;pointer-events:none;z-index:450;opacity:0;transition:opacity .4s ease';
  container.appendChild(grain);

  const filterId = `ink-displace-${Math.random().toString(36).slice(2, 8)}`;
  const filterSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  filterSvg.setAttribute('width', '0');
  filterSvg.setAttribute('height', '0');
  filterSvg.style.cssText = 'position:absolute;width:0;height:0';
  filterSvg.innerHTML =
    `<filter id="${filterId}">` +
    '<feTurbulence type="fractalNoise" baseFrequency="0.018" numOctaves="3" seed="7" result="noise"/>' +
    `<feDisplacementMap in="SourceGraphic" in2="noise" scale="0" xChannelSelector="R" yChannelSelector="G"/>` +
    '</filter>';
  container.appendChild(filterSvg);
  const displaceNode = filterSvg.querySelector('feDisplacementMap');
  for (const name of ['overlay-line', 'overlay-fill']) {
    map.getPane(name).dataset.inkFilter = `url(#${filterId})`;
  }

  // ------------------------------------------------------------ map state

  let fineWaterBoxes = index?.detail1Coverage?.boxes ?? [];
  let basemapKind = 'parchment';
  let basemapOpacity = 1;
  /** Lettering fades separately from the geography it sits on. */
  let basemapTextOpacity = 1;
  let showLabels = !slim;
  let tileLayer = null;
  const drawnLayers = new Map();   // "kind@detail" -> Leaflet layer
  let loadedDetail = null;

  /** Every name on the map goes through one placement pass. */
  const labels = new LabelEngine(map);
  /** How much lettering fitted, and how much had to be held back to stay legible. */
  let labelStats = { placed: 0, dropped: 0 };

  let cities = null;
  let peaks = null;
  let ancientNames = null;
  let biblical = null;
  let photos = {};
  let showBiblical = !slim;

  let townDots = null;
  let dotsToken = 0;
  let townRows = [];
  let showEveryPlace = false;

  let ridgeLayer = null;
  let searchPin = null;
  let readingLayer = null;
  let host = null;
  let timeline = null;
  let destroyed = false;

  // ---------------------------------------------------------- which detail

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
  function detailFor(z) {
    if (z < 4.5) return 110;
    if (z < 7) return 50;
    // Close in, Natural Earth's kilometre-accurate shoreline is the thing you
    // notice — it puts Capernaum in the Sea of Galilee — so where OpenStreetMap
    // has been harvested, use that instead.
    if (z >= 10 && fineWaterBoxes.length && fineWaterCovers(map.getBounds())) return 1;
    return 10;
  }

  /**
   * Where a layer's shapes come from at a given level.
   *
   * Only water was wrong, so only water is redrawn at the finest level. Relief
   * and rivers fall back to the coarse copy, and land is not drawn at all.
   */
  function sourceFor(kind, detail) {
    const own = index.basemap[kind]?.[detail];
    if (own) return own;
    if (detail !== 1) return null;
    return NOT_AT_FINEST.has(kind) ? null : (index.basemap[kind]?.[10] ?? null);
  }

  // ------------------------------------------------------ basemap rendering

  function clearDrawn() {
    for (const layer of drawnLayers.values()) map.removeLayer(layer);
    drawnLayers.clear();
    loadedDetail = null;
    // The finest level borrows the ground as its land; hand it back, or a switch
    // to satellite would leave parchment showing through the tiles' edges.
    container.style.background = '';
  }

  async function drawParchment(detail) {
    if (loadedDetail === detail) return;
    const wanted = detail;

    const built = [];
    for (const [kind, pane] of DRAWN_ORDER) {
      const entry = sourceFor(kind, detail);
      if (!entry) continue;
      const geojson = await getJson(entry.file);
      if (destroyed) return;
      if (wanted !== detailFor(map.getZoom())) return;   // reader moved on
      built.push([kind, pane, geojson]);
    }

    clearDrawn();
    for (const [kind, pane, geojson] of built) {
      const layer = L.geoJSON(geojson, {
        pane, renderer: rendererFor(pane), style: PARCHMENT[kind], interactive: false,
      });
      layer.setStyle({
        ...PARCHMENT[kind],
        opacity: (PARCHMENT[kind].opacity ?? 1) * basemapOpacity,
        fillOpacity: (PARCHMENT[kind].fillOpacity ?? 0) * basemapOpacity,
      });
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
    container.style.background = detail === 1 ? PARCHMENT.land.fillColor : '';

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
    if (tileLayer) { map.removeLayer(tileLayer); tileLayer = null; }
    clearDrawn();

    if (kind === 'parchment') {
      emit.status('drawing the world…', true);
      await drawParchment(detailFor(map.getZoom()));
      await drawLabels();
      emit.status('ready');
    } else {
      tileLayer = TILE_BASEMAPS[kind].build().addTo(map);
      emit.status('ready');
    }
    applyBasemapOpacity();
    emit.basemap(kind);
  }

  /** Only what's actually on screen right now. */
  function activeSources() {
    const out = [];
    if (basemapKind === 'parchment') out.push(SOURCES.naturalEarth, SOURCES.osm);
    else out.push(SOURCES.esri);
    if (timeline?.enabled) out.push(SOURCES.awmc, SOURCES.dare, SOURCES.openbible);
    if (townRows.length) out.push(SOURCES.geonames);
    return out;
  }

  // --------------------------------------------------------------- the dots

  /**
   * How many people a place needs before it earns a dot.
   *
   * Pulled all the way out the map would otherwise try to draw every hamlet on
   * the planet; right in, the hamlets are the point.
   */
  function placeFloorFor(z) {
    if (showEveryPlace) return 0;
    if (z < 7) return 50000;
    if (z < 8) return 15000;
    if (z < 9) return 5000;
    if (z < 10) return 1000;
    return 0;
  }

  async function drawTownDots(bounds, z) {
    const token = ++dotsToken;
    const floor = placeFloorFor(z);
    const limit = showEveryPlace ? 700 : 180;

    let rows = [];
    try {
      rows = await placesInBounds(
        {
          west: bounds.getWest(), south: bounds.getSouth(),
          east: bounds.getEast(), north: bounds.getNorth(),
        },
        { limit, minPopulation: floor }
      );
    } catch {
      townRows = [];
      return;
    }
    if (token !== dotsToken || destroyed) return;          // the reader moved on
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
        `<strong>${r.name}</strong>${note}<br>${[
          r.admin1, r.country, r.population ? `${r.population.toLocaleString()} people` : null,
        ].filter(Boolean).join('<br>')}`
      );
      townDots.addLayer(dot);
    }
  }

  // ------------------------------------------------------------- lettering

  async function drawLabels() {
    if (slim) return;
    labels.reset();
    if (!showLabels && !timeline?.enabled) { labels.render(); return; }

    const z = map.getZoom();
    const bounds = map.getBounds();
    const detail = detailFor(z);
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
        if (z < minZoom) continue;
        const entry = index.basemap[layerKind]?.[detail];
        if (!entry) continue;
        const fc = await getJson(entry.file);
        if (destroyed) return;
        for (const f of fc.features) {
          const name = f.properties?.name ?? f.properties?.NAME;
          if (!name) continue;
          const c = centroid(f.geometry);
          if (!c || !inView(c[0], c[1])) continue;
          labels.add({ lat: c[0], lon: c[1], text: name, kind, priority, shape: 'area' });
        }
      }

      // Ranges, deserts and plains, so no sepia shape is left unexplained.
      if (z >= 4.5) {
        const entry = index.basemap.terrain?.[detail];
        if (entry) {
          const fc = await getJson(entry.file);
          if (destroyed) return;
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
      if (z >= 3.5 && z < 6) {
        cities ??= await getJson(index.points.city.file);
        if (destroyed) return;
        const limit = z < 5 ? 2 : 4;
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
      // cities. Every place in view gets a clickable dot, and as many as will
      // fit also get their name — a dot you have to hover to identify is a last
      // resort, not the normal case.
      if (z >= 6) {
        await drawTownDots(bounds, z);
        if (destroyed) return;
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

      if (z >= 5 && agedness() < 0.35) {
        peaks ??= await getJson(index.points.peak.file);
        if (destroyed) return;
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
      if (destroyed) return;
      const era = timeline.era;
      const mid = (era.year_start + era.year_end) / 2;
      for (const n of ancientNames) {
        // Null bounds mean undated rather than never — keep those throughout.
        if (n.a != null && n.b != null && (mid < n.a || mid > n.b)) continue;
        if (!inView(n.y, n.x)) continue;
        if (n.k === 'mountain' && z < 5.5) continue;
        if (n.k === 'island' && z < 5) continue;
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
      for (const c of ov.labelCandidates(z, inView)) labels.add(c);
    }

    // Biblical places are drawn last so their markers sit above the basemap's
    // dots, and they carry the taps that open Scripture.
    const shownBiblical = biblical?.draw(z, bounds) ?? [];
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
    await drawRidges(z, bounds);
    if (destroyed) return;

    const { placed, dropped } = labels.render();
    labelStats = { placed, dropped };

    // Natural Earth is a world-scale dataset: 1,319 lakes and 1,473 rivers for
    // the whole planet. Past about zoom 9 it has no local water or terrain left
    // to draw, so a named creek is a name with nothing under it. Better to say
    // so than to let it look like a bug.
    const thin = basemapKind === 'parchment' && z >= 9.5;
    const note = thin ? ' · drawn map has no local detail this close' : '';
    emit.status((dropped ? `${placed} names · ${dropped} held back` : `${placed} names`) + note);
  }

  // ---------------------------------------------------------- the aged look

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
    displaceNode?.setAttribute('scale', (age * 3.2).toFixed(2));
    for (const name of ['overlay-line', 'overlay-fill']) {
      const pane = map.getPane(name);
      if (!pane) continue;
      pane.style.filter = age > 0.05 ? pane.dataset.inkFilter : '';
    }
    grain.style.opacity = (age * 0.55).toFixed(3);
  }

  /**
   * Mountains the way an old atlas draws them.
   *
   * A modern map marks a peak with a dot and a height. An old one draws little
   * hachured ridges, so the early eras get those instead — the same 711 surveyed
   * peaks, drawn in the idiom of their century.
   */
  async function drawRidges(z, bounds) {
    if (ridgeLayer) { map.removeLayer(ridgeLayer); ridgeLayer = null; }
    const age = agedness();
    if (age < 0.35 || z < 4.5) return;

    peaks ??= await getJson(index.points.peak.file);
    if (destroyed) return;
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

  // ------------------------------------------------------- what you tapped

  /** Everything known about a place, handed over for someone else to render. */
  function openPlace(place) {
    emit.place({
      kind: 'place',
      place,
      photo: photos[place.id] ?? null,
      verses: place.v ?? [],
    });
  }

  function openPeak(pk) {
    const near = biblical?.nearest(pk.lat, pk.lon, 70);
    emit.point({
      kind: 'peak',
      name: pk.name,
      subtitle: pk.elevation ? `${Math.round(pk.elevation).toLocaleString()} m` : 'Peak',
      lat: pk.lat,
      lon: pk.lon,
      lines: [],
      nearest: near ? { place: near.place, km: near.km } : null,
    });
  }

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
      if (hit.kind === 'territory') lines.push({ label: 'Inside', value: hit.label });
      else if (hit.kind === 'land') lines.push({ label: 'In the land of', value: hit.label });
    }
    if (near) {
      lines.push({ label: 'Nearest biblical place', value: `${near.place.n}, ${near.km.toFixed(0)} km` });
    }
    if (town && town.km < 60) {
      const r = town.row;
      lines.push({
        label: 'Nearest today',
        value: [r.name, r.admin1, r.country].filter(Boolean).join(', '),
      });
    }

    emit.point({
      kind: 'spot',
      name: 'This spot',
      subtitle: `${latlng.lat.toFixed(4)}, ${latlng.lng.toFixed(4)}`,
      lat: latlng.lat,
      lon: latlng.lng,
      lines,
      nearest: near ? { place: near.place, km: near.km } : null,
    });
  }

  // -------------------------------------------------------------- movement

  function dropPin(lat, lon, popupHtml) {
    if (searchPin) map.removeLayer(searchPin);
    searchPin = L.marker([lat, lon], { pane: 'pins', icon: PIN_ICON }).addTo(map);
    if (popupHtml) searchPin.bindPopup(popupHtml);
    return searchPin;
  }

  function goToPlace(place) {
    dropPin(place.lat, place.lon,
      `<strong>${place.name}</strong><br>${[
        place.country,
        place.population ? `${place.population.toLocaleString()} people` : null,
      ].filter(Boolean).join('<br>')}`);
    map.flyTo([place.lat, place.lon], 9, { duration: 1.1 });
    searchPin.openPopup();
  }

  /**
   * Land on a place Scripture names, and open what the app knows about it.
   *
   * A modern search drops a pin and stops there. This one opens the same panel
   * a tap on the map opens — the verses, the encyclopedia article — because
   * finding Capernaum and being told only that it exists would be a wasted
   * answer.
   */
  function goToScripture(entry) {
    dropPin(entry.lat, entry.lon);
    map.flyTo([entry.lat, entry.lon], entry.kind === 'ancient' ? 7 : 11, { duration: 1.1 });
    if (entry.kind === 'biblical' && entry.place) openPlace(entry.place);
    else {
      emit.point({
        kind: 'ancient',
        name: entry.name,
        subtitle: entry.type ?? 'Ancient name',
        lat: entry.lat,
        lon: entry.lon,
        lines: [],
        nearest: null,
      });
    }
  }

  /** Pull all the way out, for getting un-lost after zooming deep. */
  function wholeWorld() {
    map.flyTo([20, 10], 2, { duration: 1.2 });
  }

  // ------------------------------------------------ reading along with you

  async function followPassage(text) {
    const parsed = parsePassage(text);
    if (readingLayer) { map.removeLayer(readingLayer); readingLayer = null; }

    if (!parsed) {
      if (String(text ?? '').trim()) emit.status(`don't recognise "${String(text).trim()}"`);
      return null;
    }

    const hits = placesInPassage(biblical?.places ?? [], parsed);
    const label = parsed.chapter ? `${bookName(parsed.book)} ${parsed.chapter}` : bookName(parsed.book);

    if (!hits.length) {
      emit.status(`${label} names no places on the map`);
      return { label, hits: 0 };
    }

    // Move the timeline to the era this book witnesses, so the borders on screen
    // are the ones the passage happened under.
    const era = eraForBook(index.eras, parsed.book);
    if (era && timeline) {
      const i = index.eras.findIndex((e) => e.id === era.id);
      if (i >= 0 && i !== timeline.index) {
        if (!timeline.enabled) {
          await host.setEnabled('timeline', true);
          emit.layers();
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

    emit.status(`${label}: ${hits.length} place${hits.length === 1 ? '' : 's'}${era ? ` · ${era.title}` : ''}`);
    await drawLabels();
    return { label, hits: hits.length, era };
  }

  function clearPassage() {
    if (readingLayer) { map.removeLayer(readingLayer); readingLayer = null; }
  }

  // ----------------------------------------------------- redraw scheduling

  let redrawTimer = null;
  function scheduleRedraw() {
    clearTimeout(redrawTimer);
    redrawTimer = setTimeout(async () => {
      if (destroyed) return;
      emit.view();
      // A tile basemap draws its own lettering; only the drawn map needs a pass.
      if (basemapKind !== 'parchment' && !timeline?.enabled) return;
      const detail = detailFor(map.getZoom());
      if (detail !== loadedDetail) {
        emit.status(`detail ${detail}m…`, true);
        await drawParchment(detail);
        applyBasemapOpacity();
      }
      // drawLabels reports the placement count itself; don't overwrite it.
      await drawLabels();
    }, 160);
  }
  map.on('moveend zoomend', scheduleRedraw);
  if (!slim) map.on('click', (e) => openPoint(e.latlng));

  // ------------------------------------------------------------ the timeline

  /**
   * Real calendar time, eased. Without the easing the two millennia before
   * Persia swallow the slider and the crowded centuries after it collapse to a
   * few pixels.
   */
  function eraPos(era, eras) {
    const mid = (e) => (e.year_start + e.year_end) / 2;
    const first = mid(eras[0]);
    const last = mid(eras[eras.length - 1]);
    const raw = (mid(era) - first) / (last - first);
    return Math.pow(raw, 0.62);
  }

  /** Where the approximate bands give way to surveyed borders. */
  function firstSurveyedIndex() {
    return timeline ? timeline.eras.findIndex((e) => e.confidence === 'attested') : -1;
  }

  /** Frame the era's full extent, so Rome's reach is one tap away. */
  function frameEra() {
    if (!timeline) return;
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

  // ----------------------------------------------------------------- start

  async function start() {
    await setBasemap('parchment');
    if (slim) return api;

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

    // A photograph for three quarters of the places Scripture names. Only URLs
    // — Wikimedia serves the pictures — so this is half a megabyte, not fifty.
    try {
      photos = await getJson(index.placePhotos.file);
    } catch {
      photos = {};
    }

    const overlayPlaces = await getJson(index.overlayPlaces.file);
    timeline = host.register(new TimelineOverlay({ eras: index.eras, places: overlayPlaces }));
    timeline.onEraChange = (era) => emit.era(era);

    emit.layers();
    return api;
  }

  // ------------------------------------------------------------------- api

  const api = {
    map,
    start,

    get basemapKind() { return basemapKind; },
    get basemapOpacity() { return basemapOpacity; },
    get basemapTextOpacity() { return basemapTextOpacity; },
    get showLabels() { return showLabels; },
    get showBiblical() { return showBiblical; },
    get showEveryPlace() { return showEveryPlace; },
    get timeline() { return timeline; },
    get host() { return host; },
    get overlays() { return host?.list() ?? []; },
    get biblicalPlaces() { return biblical?.places ?? []; },
    get labelPlacement() { return labelStats; },
    get sources() { return activeSources(); },
    get eras() { return index.eras; },
    get firstSurveyedIndex() { return firstSurveyedIndex(); },

    setBasemap,
    setBasemapOpacity(value) {
      basemapOpacity = value;
      applyBasemapOpacity();
    },
    setBasemapTextOpacity(value) {
      basemapTextOpacity = value;
      applyBasemapTextOpacity();
    },
    setLayerOpacity(value) {
      if (!host || !timeline) return;
      host.setOpacity('timeline', Math.max(0, Math.min(1, value)));
    },
    setLayerTextOpacity(value) {
      if (!host || !timeline) return;
      host.setTextOpacity('timeline', Math.max(0, Math.min(1, value)));
    },
    async setShowLabels(on) {
      showLabels = on;
      await drawLabels();
    },
    async setShowBiblical(on) {
      showBiblical = on;
      if (biblical) biblical.visible = on;
      await drawLabels();
    },
    async setShowEveryPlace(on) {
      showEveryPlace = on;
      await drawLabels();
    },

    async setOverlayEnabled(id, on) {
      await host?.setEnabled(id, on);
      emit.layers();
      await drawLabels();
    },
    async setEra(i) {
      if (timeline) await timeline.setEra(i);
    },
    eraPosition(era) { return eraPos(era, index.eras); },
    frameEra,

    goToPlace,
    goToScripture,
    openPlace,
    wholeWorld,
    followPassage,
    clearPassage,

    /** A single marker and nothing else — what the encyclopedia's tab wants. */
    markPlace(lat, lon, label) {
      dropPin(lat, lon, label ? `<strong>${label}</strong>` : null);
      map.setView([lat, lon], Math.max(map.getZoom(), 9));
    },

    /** Leaflet never watches its own container; the host has to say when. */
    resize() { map.invalidateSize(); },

    destroy() {
      destroyed = true;
      clearTimeout(redrawTimer);
      map.off();
      map.remove();
      grain.remove();
      filterSvg.remove();
      renderers.clear();
      drawnLayers.clear();
    },
  };

  return api;
}
