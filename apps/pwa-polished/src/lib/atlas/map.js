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
// The lettering's own styling. It ships with the engine because Leaflet builds
// those elements itself, out of reach of any host component's styling, and
// because both maps draw names — the docked one and the bare one.
import './labels.css';
import { OverlayHost, ErasOverlay, JourneysOverlay } from './overlays.js';
import { LabelEngine } from './labels.js';
import { BiblicalPlaces, haversine, bookName, miles } from './places.js';
import { Paper } from './paper.js';
import { parsePassage, placesInPassage, eraForBook } from './reading.js';

/** Draw order. Leaflet panes are the only reliable way to keep it. */
const PANES = [
  ['ocean', 300], ['land', 320], ['terrain', 340], ['lakes', 360],
  // Borders have a pane of their own because they have a fade of their own:
  // above the land they divide, below every ancient border laid over them.
  ['rivers', 380], ['coast', 400], ['borders', 410], ['graticule', 420],
  ['overlay-sea', 480], ['overlay-fill', 500], ['overlay-line', 520],
  // The overlay letters into its own pane. Sharing one with the basemap's
  // labels would mean two owners of a single opacity, so fading the basemap
  // would silently fade the overlay's names with it.
  ['overlay-labels', 560],
  ['pins', 600],
  // A place several journeys visit sits above the gazetteer's dots rather than
  // among them. It has to: the wedge marks the same coordinate as the red dot
  // for the city, so in `pins` — let alone in `overlay-labels` below it — the
  // city dot covered the wedge completely and the only time anyone saw it was
  // the split second mid-zoom before the pins pane caught up. A marker's
  // zIndexOffset cannot fix that, because it orders markers within one pane and
  // this is an argument between two.
  ['journey-shared', 620],
  ['labels', 640],
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
  // Today's borders in the atlas's dash-dot, inked like the country names, so
  // no one mistakes one for a river, a coast or a frontier from the timeline.
  borders:   { color: '#4a4032', weight: 0.9, opacity: 0.85, fill: false, dashArray: '7 3 1.5 3' },
  // Disputed, indefinite and ceasefire lines: the same ink, fainter and finer,
  // so the map doesn't settle what the world hasn't.
  bordersUnsettled: { color: '#4a4032', weight: 0.7, opacity: 0.55, fill: false, dashArray: '2 3' },
};

/** Natural Earth marks every settled border this way and every other kind otherwise. */
const borderStyle = (feature) =>
  feature?.properties?.FEATURECLA === 'International boundary (verify)'
    ? PARCHMENT.borders
    : PARCHMENT.bordersUnsettled;

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
  // A pack installed before borders were added simply has none to draw.
  ['borders', 'borders'],
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

/** The gazetteer's dot outline, which counts toward how much room a dot takes. */
const TOWN_STROKE = 0.9;

/**
 * How far past a dot's edge a tap still counts as hitting it, in pixels.
 *
 * A fingertip covers a good thirty pixels and lands somewhere inside that, so
 * a tap has to reach well beyond the dot. A mouse pointer is exact, and a wide
 * reach there would catch places the reader never meant.
 */
const TAP_SLOP_TOUCH = 12;
const TAP_SLOP_MOUSE = 4;

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
 * @param {boolean} [options.slim]  the same map with nothing to operate: no
 *   overlays, no timeline, and no taps. The drawing is identical.
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
    // A spot, a peak or an ancient name is not one of the dots, so whatever was
    // marked as chosen stops being chosen when one of these takes the panel.
    point: (info) => { markSelected(null); options.onPoint?.(info); },
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
    // Deep enough to part a cluster of villages with a fingertip. At 12 the
    // places around the Sea of Galilee still sat on top of one another; every
    // tile basemap goes at least this far, and the drawn map simply gets larger.
    maxZoom: 16,
    zoomSnap: 0.25,
    // Half Leaflet's 60, so a wheel notch covers about twice the distance —
    // otherwise the fourteen levels between the world and a street are a lot of
    // scrolling.
    wheelPxPerZoomLevel: 30,
    // Scroll wheel and pinch are how people zoom now; the +/- buttons are gone,
    // but Leaflet keeps the keyboard shortcuts working for anyone who needs them.
    keyboard: true,
  });

  /**
   * A pinch that travels further than the fingers do.
   *
   * Leaflet maps finger spread to zoom one-to-one, so crossing the whole range
   * took a pinch after a pinch after a pinch. Leaflet has no option for this;
   * its pinch handler asks the map to turn the spread into a zoom level, so
   * that one question is answered with twice the change while a pinch is under
   * way. Every other use of it — fitting bounds, flying — is left alone.
   */
  const PINCH_SPEED = 2;
  const scaleZoom = map.getScaleZoom.bind(map);
  map.getScaleZoom = (scale, fromZoom) => {
    const z = scaleZoom(scale, fromZoom);
    return map.touchZoom?._zooming ? fromZoom + (z - fromZoom) * PINCH_SPEED : z;
  };

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
   * The old paper and the ink wobble.
   *
   * Both belong to the map rather than to whatever is hosting it, so both are
   * built here. The lab had them in its page, which is why they were the two
   * things that would have gone missing in the move.
   */
  const paper = new Paper(map, { getJson, index });

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
  /**
   * So do today's borders. The point of them is to be read against an ancient
   * overlay with the parchment faded down, so the Map dial leaves them alone.
   */
  let bordersOpacity = 1;
  /**
   * Slim takes the controls away, not the map.
   *
   * It first meant "no lettering, no places", which left the encyclopedia's map
   * tab as a blank parchment world — the drawing without a single name on it.
   * What it means is the same map with nothing to operate: no navbar above it,
   * no overlays, no timeline, and nothing that answers back when tapped. So the
   * lettering and the biblical places are on in both, exactly as they are in
   * the window.
   */
  let showLabels = true;
  let tileLayer = null;
  const drawnLayers = new Map();   // "kind@detail" -> Leaflet layer
  let loadedDetail = null;

  /** Every name on the map goes through one placement pass. */
  const labels = new LabelEngine(map);
  // The places Scripture names outrank every other dot, so the others make way.
  labels.avoid = (lat, lon, radius) => biblical?.touches(lat, lon, radius) ?? false;
  /** How much lettering fitted, and how much had to be held back to stay legible. */
  let labelStats = { placed: 0, dropped: 0 };

  let cities = null;
  let peaks = null;
  let ancientNames = null;
  let biblical = null;
  let photos = {};
  let showBiblical = true;

  let townDots = null;
  let dotsToken = 0;
  let townRows = [];
  /** The towns actually drawn: every fetched row except those under a biblical dot. */
  let townShown = [];
  let showEveryPlace = false;

  let ridgeLayer = null;
  let searchPin = null;
  let readingLayer = null;
  let host = null;
  let timeline = null;
  let journeys = null;
  let destroyed = false;

  /**
   * How much of the container something else is sitting on top of.
   *
   * Leaflet has no idea the info panel exists, so its idea of the centre is the
   * middle of the whole container — a strip of which is underneath the panel.
   * The host measures its own furniture and reports it here; the engine never
   * reaches into the DOM to find out.
   */
  const reserved = { right: 0, left: 0, bottom: 0 };

  /** The place whose panel is open, by id, so its dot can be drawn as chosen. */
  let selectedId = null;

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
      if (basemapKind !== 'parchment') return;           // switched to tiles meanwhile
      built.push([kind, pane, geojson]);
    }

    clearDrawn();
    for (const [kind, pane, geojson] of built) {
      // Borders are styled line by line and faded by their pane, so the
      // basemap's opacity is not pressed onto them.
      if (kind === 'borders') {
        const layer = L.geoJSON(geojson, {
          pane, renderer: rendererFor(pane), style: borderStyle, interactive: false,
        }).addTo(map);
        drawnLayers.set(`${kind}@${detail}`, layer);
        continue;
      }
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
      if (destroyed || basemapKind !== 'parchment') return;
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
      // Borders answer to their own dial; see applyBordersOpacity.
      if (kind === 'borders') continue;
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

  /** Today's borders, faded independently of the parchment they are drawn on. */
  function applyBordersOpacity() {
    map.getPane('borders').style.opacity = String(bordersOpacity);
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
      townShown = [];
      return;
    }
    if (token !== dotsToken || destroyed) return;          // the reader moved on
    // Every row still counts for "nearest today", including the hidden ones.
    townRows = rows;

    if (townDots) map.removeLayer(townDots);
    townDots = L.layerGroup([], { pane: 'pins' }).addTo(map);

    // A town under a biblical dot is dropped, name and all: the two mark the
    // same spot, and a name beside a dot that isn't its own reads as a mislabel.
    townShown = rows.filter((r) => !biblical?.touches(r.lat, r.lon, townRadius(r) + TOWN_STROKE / 2));

    for (const r of townShown) {
      const water = r.fclass === 'H';
      const dot = L.circleMarker([r.lat, r.lon], {
        pane: 'pins', radius: townRadius(r),
        fillColor: water ? '#4a7286' : '#6b5a3e', fillOpacity: 0.75,
        color: '#ece1c8', weight: TOWN_STROKE, interactive: true, bubblingMouseEvents: false,
      });
      dot.bindTooltip(r.name + featureNote(r), { direction: 'top', offset: [0, -4] });
      // A popup is something to open and then dismiss, which the bare map has
      // no business doing: there it names what you point at and stops.
      if (!slim) {
        dot.on('click', (e) => {
          L.DomEvent.stop(e);
          if (!pickDotAt(e)) openTown(r);
        });
      }
      townDots.addLayer(dot);
    }
  }

  function townRadius(r) {
    return r.population > 100000 ? 3.4 : 2.2;
  }

  function featureNote(r) {
    return FEATURE_NOTE[r.fcode] ? ` (${FEATURE_NOTE[r.fcode]})` : '';
  }

  function openTown(r) {
    L.popup()
      .setLatLng([r.lat, r.lon])
      .setContent(
        `<strong>${r.name}</strong>${featureNote(r)}<br>${[
          r.admin1, r.country, r.population ? `${r.population.toLocaleString()} people` : null,
        ].filter(Boolean).join('<br>')}`
      )
      .openOn(map);
  }

  // ------------------------------------------------------------- lettering

  async function drawLabels() {
    labels.reset();

    const z = map.getZoom();
    const bounds = map.getBounds();

    // Biblical dots are sized first, because every other dot on the map gets
    // out of their way. Their names still go in last, below. This used to sit
    // after the early return, so with names off the dots stayed where the last
    // pass left them.
    const shownBiblical = biblical?.draw(z, bounds, selectedId) ?? [];

    // Town dots belong to the drawn map with its names on, close in. Nothing
    // took them away when that stopped being true, so zooming out or switching
    // to tiles left the last batch standing — and answering taps.
    if (!(showLabels && basemapKind === 'parchment' && z >= 6)) {
      dotsToken++;
      if (townDots) { map.removeLayer(townDots); townDots = null; }
      townRows = [];
      townShown = [];
    }

    if (!showLabels && !timeline?.enabled) { labels.render(); return; }

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
        for (const r of townShown) {
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

    // Biblical names go in last. Their dots, drawn at the top of the pass, sit
    // in the pin pane above the basemap's and carry the taps that open Scripture.
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
    paper.setStrength(age);
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
    openPlaceWith(place, null);
  }

  /**
   * The place payload, with room for context from whoever opened it.
   *
   * One definition rather than two: a journey stop opens the same panel a city
   * dot does, and the moment the payload is written out twice the two drift.
   * `journey` is the only extra, and everything below it in the panel — the
   * photo, the colour-coded references, the crumb back to the map — is the
   * same code path either way.
   */
  function openPlaceWith(place, journey, { force = false, move = true } = {}) {
    markSelected(place.id);
    emit.place({
      kind: 'place',
      place,
      photo: photos[place.id] ?? null,
      verses: place.v ?? [],
      ...(journey ? { journey } : {}),
    });
    // A tap moves the map only when it has to, so a city already in clear space
    // stays where the reader put it. An arrow always moves — see openJourneyStop.
    //
    // Two frames later, because on the first tap the panel does not exist yet
    // and the host cannot have reported its width; centring now would aim at
    // the whole container and let the panel open over the answer. Two rather
    // than one because the host measures through a resize observer, which
    // reports after the frame the panel was painted in.
    if (!move) return;
    requestAnimationFrame(() => requestAnimationFrame(() => {
      if (!destroyed) centreInView(place.y, place.x, { force });
    }));
  }

  /**
   * Mark which dot is the chosen one, and redraw so it shows.
   *
   * Held as an id rather than as a marker because every biblical dot is thrown
   * away and rebuilt on any pan or zoom — a reference would die on the first
   * pan, while an id is read fresh by each rebuild. The journeys overlay does
   * not redraw itself on a pan, so it is asked directly.
   */
  function markSelected(id) {
    if (selectedId === id) return;
    selectedId = id;
    journeys?.markSelected?.(id);
    if (biblical?.visible) drawLabels();
  }

  /**
   * What the panel says about a stop beyond the place itself.
   *
   * The neighbours are the point of the arrows: a stop is a position in a
   * sequence, and the question a reader has at one is where he went next. They
   * carry their own index so following one is the same call as tapping its dot,
   * and they are null at the ends rather than wrapping, because a journey is
   * not a loop even when it returns to where it started.
   */
  function journeyContext(stop, route, i, visits = null) {
    const at = (n) => {
      const s2 = route.stops[n];
      return s2 ? { n: s2.n, i: n } : null;
    };
    // The journeys sharing this place other than the one being shown. Kept
    // separate from `visits` so the panel can say "also in" without having to
    // filter the journey it is already displaying back out of the list.
    //
    // Matched on the journey rather than on the stop: the row for this journey
    // comes out whichever of its calls is open, so Antioch under Paul's First
    // does not offer "also in Paul's First".
    const others = (visits ?? []).filter((v) => v.routeId !== route.id);
    return {
      /** Every journey through this place, so a tap can offer the choice. */
      visits: visits ?? null,
      others: others.length ? others : null,
      id: route.id,
      name: route.name,
      colour: route.colour,
      traveller: route.traveler ?? route.traveller ?? null,
      dates: route.dates ?? null,
      km: route.km ?? null,
      stop: i + 1,
      total: route.stops.length,
      by: stop.by,
      legKm: i === 0 ? null : stop.km || null,
      note: stop.note ?? null,
      first: i === 0,
      last: i === route.stops.length - 1,
      prev: at(i - 1),
      next: at(i + 1),
    };
  }

  /**
   * Every journey through a stop's place, in the shape the panel reads.
   *
   * Asked of the routes rather than of the drawn dots, because an arrow can
   * land on a place whose dot is not on screen — and because the overlay's own
   * index only covers the journeys currently switched on, which is right for
   * drawing and wrong here: the reader following an arrow should be told the
   * other journey exists even if he has its line turned off.
   */
  function visitsFor(stop) {
    const key = stop.placeId;
    const out = [];
    for (const route of journeys?.routes ?? []) {
      // One row per journey, however many times it calls. Antioch is the case:
      // Paul's First sets out from it and comes home to it, so listing visits
      // would offer "Paul's First Missionary Journey" twice with nothing on the
      // row to say which of the two was which.
      const calls = [];
      route.stops.forEach((s2, n) => {
        const same = key != null
          ? s2.placeId === key
          : Math.abs(s2.y - stop.y) < 1e-4 && Math.abs(s2.x - stop.x) < 1e-4;
        if (same) calls.push(n);
      });
      if (!calls.length) continue;

      const last = route.stops.length - 1;
      out.push({
        routeId: route.id, name: route.name, colour: route.colour,
        // The stop the row opens: the first call, because a journey read in
        // order reaches that one first.
        i: calls[0], stop: calls[0] + 1, total: route.stops.length,
        first: calls.includes(0),
        last: calls.includes(last),
        // Every call, so a row can say "stops 1 and 11" rather than implying
        // the journey passed through once.
        calls: calls.map((n) => n + 1),
        // The return leg, offered separately: at Antioch the reader who wants
        // the homecoming rather than the departure has somewhere to tap.
        again: calls.length > 1 ? calls.slice(1) : null,
      });
    }
    return out.length > 1 || out[0]?.calls.length > 1 ? out : null;
  }

  /**
   * The gazetteer row behind a journey stop's `placeId`.
   *
   * Built once on first use rather than per tap: `biblical.places` is the same
   * array throughout the map's life, and rebuilding a 1,278-entry map for every
   * stop tap would be work done for nothing.
   */
  let placeById = null;
  function biblicalPlaceById(id) {
    if (!placeById) placeById = new Map((biblical?.places ?? []).map((p) => [p.id, p]));
    return placeById.get(id) ?? null;
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
      lines.push({ label: 'Nearest biblical place', value: `${near.place.n}, ${miles(near.km)} miles` });
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

  /**
   * Answer a tap with the dot it meant, or ask which one when it could mean
   * several.
   *
   * Every dot reaches further than it is drawn, so a fingertip that lands
   * beside a village still gets the village. Where places crowd together that
   * reach overlaps, and rather than guess, the map lists what was under the
   * finger. Returns false when no dot was near enough, so the tap can fall
   * through to "this spot".
   */
  function pickDotAt(e) {
    const point = e.containerPoint;
    if (!point) return false;
    // A tap on a dot reports the dot's centre as its position, so the real one
    // comes from the pointer.
    const at = map.containerPointToLatLng(point);
    const pointer = e.originalEvent?.pointerType;
    const touch = pointer ? pointer !== 'mouse' : !!window.matchMedia?.('(pointer: coarse)').matches;
    const slop = touch ? TAP_SLOP_TOUCH : TAP_SLOP_MOUSE;

    const hits = [];
    for (const { place, edge } of biblical?.near(at.lat, at.lng, slop) ?? []) {
      const n = place.v.length;
      hits.push({ edge, name: place.n, note: `${n} verse${n === 1 ? '' : 's'}`, open: () => openPlace(place) });
    }
    if (townDots && map.hasLayer(townDots)) {
      for (const r of townShown) {
        const edge = map.latLngToContainerPoint([r.lat, r.lon]).distanceTo(point) - townRadius(r) - TOWN_STROKE / 2;
        if (edge > slop) continue;
        hits.push({ edge, name: r.name, note: FEATURE_NOTE[r.fcode] ?? 'modern place', open: () => openTown(r) });
      }
    }
    if (!hits.length) return false;

    hits.sort((a, b) => a.edge - b.edge);
    // A mouse landing inside a dot means that dot. A fingertip inside one may
    // still have been aiming at the neighbour it also covered.
    if (hits.length === 1 || (!touch && hits[0].edge <= 0)) {
      hits[0].open();
    } else {
      showChooser(at, hits.slice(0, 8));
    }
    return true;
  }

  function showChooser(latlng, hits) {
    const popup = L.popup({ closeButton: false, className: 'atlas-pick-popup', autoPanPadding: [16, 16] });
    const list = document.createElement('div');
    list.className = 'atlas-pick';

    const head = document.createElement('div');
    head.className = 'atlas-pick-head';
    head.textContent = 'Which one?';
    list.appendChild(head);

    for (const hit of hits) {
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'atlas-pick-row';
      const name = document.createElement('span');
      name.className = 'atlas-pick-name';
      name.textContent = hit.name;
      const note = document.createElement('span');
      note.className = 'atlas-pick-note';
      note.textContent = hit.note;
      row.append(name, note);
      row.addEventListener('click', () => {
        map.closePopup(popup);
        hit.open();
      });
      list.appendChild(row);
    }

    popup.setLatLng(latlng).setContent(list).openOn(map);
  }

  // -------------------------------------------------------------- movement

  /** How close to an edge a point may sit before it is worth moving inward. */
  const EDGE_MARGIN = 60;
  /** Below this, a move would be a jiggle rather than a journey. */
  const CENTRE_SLOP = 8;

  /**
   * Put a point in the middle of the space actually visible.
   *
   * With the info panel open the clear space is the container minus the strip
   * the panel covers, so centring on the container would park the city behind
   * the very panel describing it. This aims at the centre of what is left.
   *
   * Without `force` it only moves when it has to — the point is behind the
   * panel, or close enough to an edge to be awkward — so tapping a city already
   * sitting in clear space leaves the map where the reader put it.
   */
  function centreInView(lat, lon, { force = false, zoom = null } = {}) {
    const size = map.getSize();
    const clear = clearRect();
    const target = L.point((clear.x0 + clear.x1) / 2, clear.y1 / 2);
    const z = zoom ?? map.getZoom();

    if (z === map.getZoom()) {
      const at = map.latLngToContainerPoint([lat, lon]);
      if (!force) {
        const inside =
          at.x >= clear.x0 + EDGE_MARGIN && at.x <= clear.x1 - EDGE_MARGIN &&
          at.y >= EDGE_MARGIN && at.y <= clear.y1 - EDGE_MARGIN;
        if (inside) return;
      }
      if (Math.abs(at.x - target.x) < CENTRE_SLOP && Math.abs(at.y - target.y) < CENTRE_SLOP) return;
    }

    // The centre that puts the point under the clear space's middle, worked in
    // the destination zoom's pixels so a zoom and a pan land together.
    const offset = target.subtract(size.divideBy(2));
    const centre = map.unproject(map.project([lat, lon], z).subtract(offset), z);
    map.flyTo(centre, z, { duration: 1.1 });
  }

  /**
   * The part of the container nothing is sitting on, in container pixels.
   *
   * A panel squeezed to nearly the whole width or height leaves no meaningful
   * space to aim at, so that side falls back to the whole container rather
   * than aiming at a sliver.
   */
  function clearRect() {
    const size = map.getSize();
    const right = reserved.right < size.x * 0.55 ? reserved.right : 0;
    const left = reserved.left + right < size.x * 0.8 ? reserved.left : 0;
    const bottom = reserved.bottom < size.y * 0.7 ? reserved.bottom : 0;
    return { x0: left, x1: size.x - right, y1: size.y - bottom };
  }

  /** Fit bounds into the clear space rather than the whole container. */
  function fitClear(bounds, { maxZoom = 8, pad = 40 } = {}) {
    const size = map.getSize();
    const clear = clearRect();
    map.flyToBounds(bounds, {
      paddingTopLeft: [clear.x0 + pad, pad],
      paddingBottomRight: [size.x - clear.x1 + pad, size.y - clear.y1 + pad],
      maxZoom,
      duration: 1,
    });
  }

  /**
   * The biblical place an era's town stands for.
   *
   * The era's towns come from the atlas pack and the dots from the place
   * catalogue. Both start from OpenBible's names, so the name usually matches;
   * when it doesn't, the nearest dot within a few miles is the same place.
   */
  function biblicalFor(town) {
    const all = biblical?.places ?? [];
    const named = all.find((p) => p.id === town.name) ?? all.find((p) => p.n === town.name);
    if (named) return named;
    let best = null;
    let bestKm = 15;
    for (const p of all) {
      const km = haversine(town.lat, town.lon, p.y, p.x);
      if (km < bestKm) { bestKm = km; best = p; }
    }
    return best;
  }

  /**
   * Fly to one of the era's towns, close enough to read the streets around it.
   * `open` also opens its panel; a narrow window leaves no room for one beside
   * the era sheet, so there the dot is only marked.
   */
  function showTown(town, { open = true } = {}) {
    const place = biblicalFor(town);
    const lat = place?.y ?? town.lat;
    const lon = place?.x ?? town.lon;
    if (place && open) openPlaceWith(place, null, { move: false });
    else if (place) markSelected(place.id);
    const zoom = Math.max(map.getZoom(), 8);
    requestAnimationFrame(() => requestAnimationFrame(() => {
      if (!destroyed) centreInView(lat, lon, { force: true, zoom });
    }));
  }

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
          await host.setEnabled('eras', true);
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
      // Every basemap needs the pass. A tile basemap letters itself, but the
      // biblical dots are the map's own on all of them: skipping it there left
      // the dots sized for the last zoom and missing from anywhere panned to.
      const detail = detailFor(map.getZoom());
      // The timeline still needs its names laid out over a tile basemap, but the
      // parchment must not come with them. It used to: every zoom that crossed a
      // detail level painted the drawn world over the tiles, and since the
      // opacity dial dims both together, the tiles never showed again.
      if (basemapKind === 'parchment' && detail !== loadedDetail) {
        emit.status(`detail ${detail}m…`, true);
        await drawParchment(detail);
        applyBasemapOpacity();
      }
      // drawLabels reports the placement count itself; don't overwrite it.
      await drawLabels();
    }, 160);
  }
  map.on('moveend zoomend', scheduleRedraw);
  if (!slim) map.on('click', (e) => { if (!pickDotAt(e)) openPoint(e.latlng); });

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

  /**
   * Frame the era's full extent, so Rome's reach is one tap away.
   *
   * Only the era's own lands and places. It used to measure every layer the
   * era draws, and those include the world's coastline and sea, so every era
   * framed the whole world.
   */
  function frameEra() {
    if (!timeline) return;
    const bounds = timeline.bounds;
    if (bounds.isValid()) fitClear(bounds, { maxZoom: 8 });
  }

  // ----------------------------------------------------------------- start

  async function start() {
    await setBasemap('parchment');

    // The places Scripture names, in both maps: they are the reason the map
    // exists, and a map of the Bible with Bethlehem unmarked is not the same map
    // with fewer buttons. Slim leaves `onOpen` unwired, so they carry their name
    // and nothing else happens when one is tapped.
    const biblicalRows = await getJson(index.biblicalPlaces.file);
    biblical = new BiblicalPlaces(map, { places: biblicalRows });
    biblical.visible = showBiblical;

    // Everything past here is machinery to operate the map, which is exactly
    // what the bare one does without.
    if (slim) {
      await drawLabels();
      return api;
    }

    biblical.onOpen = openPlace;
    biblical.onTap = (e, place) => { if (!pickDotAt(e)) openPlace(place); };

    // Any overlay appearing, vanishing or changing era reshuffles the lettering,
    // because all of it is laid out in one pass.
    host = new OverlayHost(map, {
      rendererFor, getJson, index,
      onChange: () => { drawLabels(); },
    });
    host.onLabelsChanged = () => { drawLabels(); };

    // A photograph for three quarters of the places Scripture names. Only URLs
    // — Wikimedia serves the pictures — so this is half a megabyte, not fifty.
    try {
      photos = await getJson(index.placePhotos.file);
    } catch {
      photos = {};
    }

    const overlayPlaces = await getJson(index.overlayPlaces.file);
    timeline = host.register(new ErasOverlay({ eras: index.eras, places: overlayPlaces }));
    timeline.onEraChange = (era) => emit.era(era);
    timeline.onDrawn = () => options.onEraDrawn?.();

    // Journeys, registered beside the timeline and independent of it: they do not
    // belong to an era and must not vanish when the slider moves, which would
    // read as a bug rather than as a date.
    //
    // A pack built before the journey tables existed has nothing to read, and a
    // map without journeys is still a map, so a failure here leaves the overlay
    // unregistered instead of stopping the map from opening. The Layers panel
    // loops what is registered, so it simply does not offer the toggle.
    try {
      const routes = await getJson(index.journeys.file);
      if (routes?.length) {
        journeys = host.register(new JourneysOverlay({ routes }));
        journeys.onRoutesChanged = () => emit.layers();

        // A stop tap opens the gazetteer place behind it, so it gets the same
        // panel a city dot does. The stop carries `placeId` and these rows are
        // already in hand, so this is a lookup rather than new data.
        journeys.onOpenStop = (stop, route, i, shared = false) => {
          const place = biblicalPlaceById(stop.placeId);
          // A stop whose place has fallen out of the gazetteer still deserves an
          // answer, so it falls back to the generic point panel rather than
          // swallowing the tap.
          if (!place) return openPoint({ lat: stop.y, lng: stop.x });

          // Several journeys meet here and the reader tapped the place, not one
          // of them — so the panel asks which he means instead of guessing. The
          // guess is what was wrong before: at Kadesh-barnea a tap always landed
          // on the Twelve Spies, and a reader following the Exodus was moved
          // onto another journey without being told. An arrow does not come
          // through here; it knows its journey already and says so.
          const visits = shared ? visitsFor(stop) : null;
          if (visits) {
            return openPlaceWith(place, { visits, choosing: true });
          }
          openPlaceWith(place, journeyContext(stop, route, i));
        };
      }
    } catch {
      journeys = null;
    }

    // The basemap laid its lettering out before any of this existed, so the
    // places Scripture names had nothing to appear in. One more pass now that
    // they do — otherwise they turn up on the first pan rather than on opening.
    await drawLabels();

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
    get bordersOpacity() { return bordersOpacity; },
    get showLabels() { return showLabels; },
    get showBiblical() { return showBiblical; },
    get showEveryPlace() { return showEveryPlace; },
    get timeline() { return timeline; },
    get journeys() { return journeys; },
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
    setBordersOpacity(value) {
      bordersOpacity = Math.max(0, Math.min(1, value));
      applyBordersOpacity();
    },
    // The nav's one Layer dial, which fades whichever overlays are on rather
    // than the timeline it was written for. Naming 'timeline' here meant the
    // dial silently did nothing to any second layer — and each overlay decides
    // what its own opacity governs, so journeys taking its lettering with it is
    // the overlay's business rather than a case handled out here.
    setLayerOpacity(value) {
      if (!host) return;
      const v = Math.max(0, Math.min(1, value));
      for (const ov of host.list()) if (ov.enabled) host.setOpacity(ov.id, v);
    },
    setLayerTextOpacity(value) {
      if (!host) return;
      const v = Math.max(0, Math.min(1, value));
      for (const ov of host.list()) if (ov.enabled) host.setTextOpacity(ov.id, v);
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
    /** One of the era's lands, framed in the space the panels leave. */
    focusBounds(bounds) { if (bounds?.isValid()) fitClear(bounds, { maxZoom: 7 }); },
    showTown,

    goToPlace,
    goToScripture,
    openPlace,

    /**
     * The host says how much of the container its own furniture covers, in
     * pixels from each edge. Measured rather than assumed, because the panels'
     * widths are max-widths that shrink on a narrow window.
     */
    setReserved({ right = 0, left = 0, bottom = 0 } = {}) {
      reserved.right = Math.max(0, right || 0);
      reserved.left = Math.max(0, left || 0);
      reserved.bottom = Math.max(0, bottom || 0);
    },

    /** The panel closed: nothing is the chosen dot any more. */
    clearSelection() {
      markSelected(null);
    },

    /**
     * Open a stop by its position in a journey, which is what the panel's
     * previous/next arrows call.
     *
     * The map always recentres: following an arrow should visibly take you
     * somewhere, and a panel that changed while the map sat still reads as the
     * arrow having done nothing. It used to move only when the stop fell
     * outside the bounds, but the bounds include the strip the panel covers, so
     * a stop hidden behind the panel counted as already in view.
     */
    openJourneyStop(routeId, i) {
      const route = journeys?.routes?.find((r) => r.id === routeId);
      const stop = route?.stops?.[i];
      if (!stop) return;
      const place = biblicalPlaceById(stop.placeId);
      if (!place) {
        centreInView(stop.y, stop.x, { force: true });
        return openPoint({ lat: stop.y, lng: stop.x });
      }
      // Arriving by arrow, or by picking a journey out of the chooser, settles
      // which journey this is — so it opens straight into that one. The other
      // journeys through the place still come along, as the "also in" line
      // underneath rather than as a question.
      openPlaceWith(place, journeyContext(stop, route, i, visitsFor(stop)), { force: true });
    },
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
      paper.destroy();
      map.off();
      map.remove();
      filterSvg.remove();
      renderers.clear();
      drawnLayers.clear();
    },
  };

  return api;
}
