/**
 * The overlay system, and the timeline that is its first tenant.
 *
 * An overlay is not decoration floating on someone else's map. The contract is
 * that it carries whatever it needs to be readable by itself, so that with the
 * basemap faded to nothing it still reads as a finished map. That rule is what
 * makes the opacity dials worth having: the reader can sit anywhere between the
 * modern world and the overlay's own world.
 *
 * Each overlay declares its name, its colour, its legend and what a tap on it
 * means. Nothing here knows about the timeline specifically, so the journeys
 * overlay and whatever comes after drop in without touching the map.
 */
import L from 'leaflet';
import { assignColours, polityColour, fallbackColour } from './colours.js';

/** @typedef {{ id:string, title:string, colour:string, opacity:number, enabled:boolean }} OverlayState */

export class OverlayHost {
  constructor(map, { rendererFor, getJson, index, onChange }) {
    this.map = map;
    /** A canvas renderer lives in one pane, so each pane needs its own. */
    this.rendererFor = rendererFor;
    this.getJson = getJson;
    this.index = index;
    this.onChange = onChange ?? (() => {});
    /** @type {Map<string, any>} */
    this.overlays = new Map();
  }

  register(overlay) {
    overlay.host = this;
    this.overlays.set(overlay.id, overlay);
    return overlay;
  }

  get(id) { return this.overlays.get(id); }
  list() { return [...this.overlays.values()]; }

  async setEnabled(id, on) {
    const ov = this.overlays.get(id);
    if (!ov || ov.enabled === on) return;
    ov.enabled = on;
    if (on) await ov.mount();
    else ov.unmount();
    this.onChange();
  }

  setOpacity(id, value) {
    const ov = this.overlays.get(id);
    if (!ov) return;
    ov.opacity = value;
    ov.applyOpacity?.();
    this.onChange();
  }

  setTextOpacity(id, value) {
    const ov = this.overlays.get(id);
    if (!ov) return;
    ov.textOpacity = value;
    ov.applyTextOpacity?.();
  }

  /** Ask every live overlay what sits under a tap, nearest-first by relevance. */
  identify(latlng) {
    const found = [];
    for (const ov of this.overlays.values()) {
      if (!ov.enabled) continue;
      const hit = ov.identify?.(latlng);
      if (hit) found.push(...(Array.isArray(hit) ? hit : [hit]));
    }
    return found;
  }
}

/** Shared plumbing: a bag of Leaflet layers that mounts, unmounts and dims. */
class BaseOverlay {
  constructor({ id, title, colour }) {
    this.id = id;
    this.title = title;
    this.colour = colour;
    this.opacity = 1;
    /** Lettering fades separately from what it names. */
    this.textOpacity = 1;
    this.enabled = false;
    this.layers = [];
    this.host = null;
  }

  get map() { return this.host.map; }

  add(layer, styleFor) {
    layer.__styleFor = styleFor;
    layer.addTo(this.map);
    this.layers.push(layer);
    return layer;
  }

  clear() {
    for (const l of this.layers) this.map.removeLayer(l);
    this.layers = [];
    this.namedLands = [];
    this.towns = [];
  }

  unmount() { this.clear(); }

  applyOpacity() {
    const dim = (style) => ({
      ...style,
      opacity: (style.opacity ?? 1) * this.opacity,
      fillOpacity: (style.fillOpacity ?? 0) * this.opacity,
    });
    for (const layer of this.layers) {
      const base = layer.__styleFor;
      if (!base || !layer.setStyle) continue;
      // A style can be a function of the feature, so each land keeps its own
      // colour. Flattening one to a single object here once painted every land
      // in the first one's style.
      layer.setStyle(typeof base === 'function' ? (f) => dim(base(f)) : dim(base));
    }
  }

  /** The overlay's lettering, dimmed without touching its geography. */
  applyTextOpacity() {
    if (this.labelPane) this.labelPane.style.opacity = String(this.textOpacity);
  }
}

// ---------------------------------------------------------------------------

/**
 * How the timeline's palette shifts as the centuries pass.
 *
 * The earliest eras are drawn as an old atlas would draw them — brown inks on
 * aged paper, a heavy hand. The look cleans up and cools as the slider advances,
 * so scrubbing feels like watching cartography develop. `t` runs 0 (oldest) to
 * 1 (present day).
 */
function ageStyle(t) {
  const lerp = (a, b) => a + (b - a) * t;
  const mix = (c1, c2) => {
    const p = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
    const [r1, g1, b1] = p(c1), [r2, g2, b2] = p(c2);
    const h = (n) => Math.round(n).toString(16).padStart(2, '0');
    return `#${h(lerp(r1, r2))}${h(lerp(g1, g2))}${h(lerp(b1, b2))}`;
  };
  return {
    ink: mix('#5c3f1c', '#26323d'),        // warm sepia -> cool slate
    coastWeight: lerp(2.1, 1.3),
    coastOpacity: lerp(1, 0.9),
    water: mix('#8fa9a3', '#7ba5bd'),
    // The overlay's own sea. Aged blue-green early on, cooling to a modern blue.
    sea: mix('#93b1b5', '#8fbcd4'),
    // Strong enough to read over a busy parchment basemap at full opacity —
    // the overlay is the point, not a wash over it.
    territoryFill: lerp(0.5, 0.4),
    bandFill: lerp(0.2, 0.16),
    labelColour: mix('#4a3418', '#1f2a33'),
    paper: mix('#e8dcc0', '#f2efe9'),
  };
}

/** More than this and the lettering turns to soup at any sensible zoom. */
const MAX_LANDS = 22;

/**
 * The lands an era actually draws.
 *
 * Only lands we can also name: unlabelled probability bands read as random
 * brush strokes, because the shape means nothing without the word. Shared by the
 * drawing and the colouring, which have to agree on exactly which lands appear
 * together.
 */
function landsIn(geojson) {
  return geojson.features.filter((f) => f.properties?.name).slice(0, MAX_LANDS);
}

/** A sea, lake or river, lettered as water rather than as land. */
const isWaterBody = (kind) => /water|sea|river|lake/i.test(kind || '');

/**
 * The timeline overlay: a complete historical map for each era.
 *
 * It carries its own coastlines and lettering rather than borrowing the
 * basemap's, which is what lets it stand alone when the basemap is faded out.
 */
export class TimelineOverlay extends BaseOverlay {
  constructor({ eras, places }) {
    super({ id: 'timeline', title: 'Historical timeline', colour: '#8c4a3f' });
    this.eras = eras;
    this.places = places;
    this.index = 0;
    this.showAgeing = true;
    this.onEraChange = () => {};
    /** name → palette entry, once the whole timeline has been coloured. */
    this.colourMap = null;
    this.colourJob = null;
  }

  get era() { return this.eras[this.index]; }

  /** A land's or province's fill and ink. */
  colourFor(name) {
    return this.colourMap?.get(name) ?? fallbackColour(name);
  }

  /**
   * Colour every land and province on the timeline, once.
   *
   * A land keeps its colour from era to era, so the choice can't be made one
   * era at a time: it needs every era's lands in view at once. That means
   * reading every era's layers on first mount — about a megabyte, which the
   * slider would have read anyway — and the assignment itself takes a few
   * milliseconds.
   */
  ensureColours() {
    this.colourJob ??= (async () => {
      const { getJson, index } = this.host;
      const eras = await Promise.all(this.eras.map(async (era) => {
        const layers = await Promise.all((index.overlays[era.id] ?? [])
          .filter((l) => l.kind === 'region' || l.kind === 'territory')
          .map((l) => getJson(l.file).then((g) => ({ kind: l.kind, geojson: g }), () => null)));

        const lands = [];
        const provinces = [];
        let hasPolity = false;
        for (const layer of layers) {
          if (!layer?.geojson?.features) continue;
          if (layer.kind === 'region') {
            for (const f of landsIn(layer.geojson)) {
              lands.push({ name: f.properties.name, kind: f.properties.kind, geometry: f.geometry });
            }
          } else {
            for (const f of layer.geojson.features) {
              if (f.properties?.name) provinces.push({ name: f.properties.name, geometry: f.geometry });
              else hasPolity = true;
            }
          }
        }
        return { id: era.id, hasPolity, lands, provinces };
      }));
      try {
        this.colourMap = assignColours(eras);
      } catch {
        // Every name still gets a steady colour of its own; only the promises
        // about neighbours are lost.
        this.colourMap = null;
      }
    })();
    return this.colourJob;
  }

  /** 0 at the oldest era, 1 at the newest — drives the ageing ramp. */
  get progress() {
    return this.eras.length < 2 ? 1 : this.index / (this.eras.length - 1);
  }

  get style() {
    return ageStyle(this.showAgeing ? this.progress : 1);
  }

  async mount() {
    this.labelPane = this.map.getPane('overlay-labels');
    this.applyTextOpacity();
    await this.draw();
  }

  /**
   * Move to another era.
   *
   * A straight cut, the way an atlas turns a page. It used to dissolve out
   * through the parchment and back in, which read as the map reloading rather
   * than as the borders changing. The next era is fetched before the last one
   * is cleared, so the cut never shows an empty map in between.
   */
  async setEra(i) {
    const next = Math.max(0, Math.min(this.eras.length - 1, i));
    if (next === this.index && this.layers.length) return;

    this.index = next;
    this.onEraChange(this.era);
    if (!this.enabled) return;

    await this.draw();
  }

  /** Everything the current era draws, in one pass. */
  async draw() {
    const { getJson, index } = this.host;
    const era = this.era;
    const s = this.style;

    // Fetch before clearing, so a slow layer never leaves the map blank.
    const always = index.overlays._always ?? [];
    const mine = index.overlays[era.id] ?? [];

    const coastFile = always.find((l) => l.kind === 'coast')?.file;
    const waterFile = always.find((l) => l.kind === 'water')?.file;
    // The overlay needs its own sea or it cannot stand alone: with the basemap
    // faded out the Mediterranean was bare parchment, so a label reading
    // "Great Sea" sat over what looked like desert.
    const seaFile = index.basemap?.ocean?.[50]?.file ?? index.basemap?.ocean?.[110]?.file;

    const [, coast, water, sea, ...eraLayers] = await Promise.all([
      this.ensureColours(),
      coastFile ? getJson(coastFile) : null,
      waterFile ? getJson(waterFile) : null,
      seaFile ? getJson(seaFile) : null,
      ...mine.map((l) => getJson(l.file).then((g) => ({ ...l, geojson: g }))),
    ]);

    // Dragging the slider starts a new draw before a slow fetch has come back.
    // Without this the slow one would land last and paint an era the reader had
    // already scrubbed past; the draw for the era now showing will paint it.
    if (era !== this.era || !this.enabled) return;

    this.clear();

    // --- the overlay's own geography ---
    if (sea) {
      const style = { fillColor: s.sea, fillOpacity: 1, color: s.sea, weight: 0.5, opacity: 1 };
      this.add(L.geoJSON(sea, {
        pane: 'overlay-sea', renderer: this.host.rendererFor('overlay-sea'), style, interactive: false,
      }), style);
    }
    if (coast) {
      const style = { color: s.ink, weight: s.coastWeight, opacity: s.coastOpacity, fill: false };
      this.add(L.geoJSON(coast, { pane: 'overlay-line', renderer: this.host.rendererFor('overlay-line'), style, interactive: false }), style);
    }
    if (water) {
      const style = { fillColor: s.water, fillOpacity: 0.55, color: s.water, weight: 0.5, opacity: 0.7 };
      this.add(L.geoJSON(water, { pane: 'overlay-fill', renderer: this.host.rendererFor('overlay-fill'), style, interactive: false }), style);
    }

    // --- what changes era to era ---
    this.hitAreas = [];
    this.namedProvinces = [];

    // The empire this era's unnamed territory belongs to. Where the era also
    // names its provinces, the extent under them is only an outline: a wash of
    // the empire's colour beneath would tint every province alike.
    const realm = polityColour(era.id);
    const namesProvinces = eraLayers.some((l) =>
      l.kind === 'territory' && l.geojson.features.some((f) => f.properties?.name));

    for (const layer of eraLayers) {
      if (layer.kind === 'territory') {
        const style = (f) => {
          if (f.properties?.name) {
            const c = this.colourFor(f.properties.name);
            return { fillColor: c.fill, fillOpacity: s.territoryFill, color: c.ink, weight: 1.3, opacity: 0.9 };
          }
          return {
            fillColor: realm.fill, fillOpacity: namesProvinces ? 0 : s.territoryFill,
            color: realm.ink, weight: 2.2, opacity: 0.95,
          };
        };
        this.add(L.geoJSON(layer.geojson, {
          pane: 'overlay-fill', renderer: this.host.rendererFor('overlay-fill'), style, interactive: false,
        }), style);

        // A territory that names its parts is worth more than one that does not.
        // Eighty-one anonymous provinces all answered "Rome" to a tap and wrote
        // nothing on the map; named ones letter themselves and answer for
        // themselves, so a tap in Achaia says Achaia.
        const named = layer.geojson.features.filter((f) => f.properties?.name);
        if (named.length) {
          for (const f of named) {
            this.hitAreas.push({
              label: f.properties.name, kind: 'province',
              geojson: { type: 'FeatureCollection', features: [f] },
            });
          }
          this.namedProvinces = (this.namedProvinces ?? []).concat(named);
        } else {
          this.hitAreas.push({ label: era.title, kind: 'territory', geojson: layer.geojson });
        }
      }

      if (layer.kind === 'region') {
        const named = { type: 'FeatureCollection', features: landsIn(layer.geojson) };

        // Each land in its own colour, its contours in the darker ink its name
        // is lettered in. Bands are nested contours, so stacking them makes the
        // middle densest; a faint line on each keeps the land reading as one
        // shape rather than a smear, without claiming a border nobody knows.
        // A land known only roughly, rather than in bands, gets a dashed edge.
        const style = (f) => {
          const c = this.colourFor(f.properties.name);
          return f.properties.bands
            ? { fillColor: c.fill, fillOpacity: s.bandFill, color: c.ink, weight: 0.7, opacity: 0.45 }
            : { fillColor: c.fill, fillOpacity: s.bandFill + 0.06, color: c.ink, weight: 1.2, opacity: 0.85, dashArray: '4 3' };
        };
        this.add(L.geoJSON(named, {
          pane: 'overlay-fill', renderer: this.host.rendererFor('overlay-fill'), interactive: false, style,
        }), style);

        for (const f of named.features) {
          this.hitAreas.push({ label: f.properties.name, kind: 'land', geojson: { type: 'FeatureCollection', features: [f] } });
        }
        this.namedLands = named.features;
      }
    }

    this.towns = this.places
      .filter((p) => p.era_id === era.id)
      .sort((a, b) => b.verses - a.verses)
      .slice(0, 30);

    this.applyOpacity();
    this.host.onLabelsChanged?.();
  }

  /**
   * Offer this era's lettering to the shared placement pass.
   *
   * The overlay does not place its own names. Basemap country names and these
   * land names want the same pixels, so they have to be laid out together or
   * they collide however careful either is alone.
   */
  labelCandidates(zoom, inView) {
    const s = this.style;
    const out = [];

    // Province names outrank the era's lands and the modern countries beneath,
    // because when the empire is the subject its provinces are what you read.
    for (const f of this.namedProvinces ?? []) {
      const c = centroid(f.geometry);
      if (!c || !inView(c[0], c[1])) continue;
      out.push({
        lat: c[0], lon: c[1], text: f.properties.name,
        kind: 'land', pane: 'overlay-labels', shape: 'area',
        // In the ink of its own border, so the name says which shape it is.
        priority: 120, colour: this.colourFor(f.properties.name).ink,
      });
    }

    for (const f of this.namedLands ?? []) {
      const c = centroid(f.geometry);
      if (!c || !inView(c[0], c[1])) continue;
      out.push({
        lat: c[0], lon: c[1], text: f.properties.name,
        kind: isWaterBody(f.properties.kind) ? 'sea' : 'land',
        pane: 'overlay-labels', shape: 'area',
        // The overlay is the subject while it's on, so its lands outrank the
        // modern country names underneath.
        priority: 100 + Math.min(30, (f.properties.verses ?? 0) / 3),
        colour: this.colourFor(f.properties.name).ink,
      });
    }

    if (zoom >= 4.5) {
      for (const p of this.towns ?? []) {
        if (!inView(p.lat, p.lon)) continue;
        out.push({
          lat: p.lat, lon: p.lon, text: p.name,
          kind: 'city', pane: 'overlay-labels', shape: 'point',
          priority: 55 + Math.min(25, (p.verses ?? 0) / 2),
          colour: s.labelColour,
          dot: { fill: s.ink, stroke: s.paper, radius: 2.8 },
        });
      }
    }

    return out;
  }

  /** What this overlay says sits under a tap. */
  identify(latlng) {
    const out = [];
    const pt = [latlng.lng, latlng.lat];

    for (const area of this.hitAreas ?? []) {
      for (const f of area.geojson.features) {
        if (pointInGeometry(pt, f.geometry)) {
          out.push({ source: this.title, kind: area.kind, label: area.label, era: this.era.title });
          break;
        }
      }
    }

    let nearest = null;
    for (const p of this.towns ?? []) {
      const d = haversine(latlng.lat, latlng.lng, p.lat, p.lon);
      if (!nearest || d < nearest.km) nearest = { km: d, place: p };
    }
    if (nearest && nearest.km < 120) {
      out.push({
        source: this.title, kind: 'place', label: nearest.place.name,
        distanceKm: nearest.km, verses: nearest.place.verses,
      });
    }
    return out;
  }
}

// ------------------------------------------------------------------ geometry

export function centroid(geom) {
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

/** Ray casting, for "what am I standing in". */
function pointInRing(pt, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > pt[1]) !== (yj > pt[1]) &&
        pt[0] < ((xj - xi) * (pt[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export function pointInGeometry(pt, geom) {
  const polys = geom.type === 'Polygon' ? [geom.coordinates]
              : geom.type === 'MultiPolygon' ? geom.coordinates : [];
  for (const poly of polys) {
    if (!poly.length || !pointInRing(pt, poly[0])) continue;
    // A hit inside a hole is not a hit.
    let inHole = false;
    for (let h = 1; h < poly.length; h++) if (pointInRing(pt, poly[h])) { inHole = true; break; }
    if (!inHole) return true;
  }
  return false;
}

export function haversine(lat1, lon1, lat2, lon2) {
  const R = 6371, rad = Math.PI / 180;
  const dLat = (lat2 - lat1) * rad, dLon = (lon2 - lon1) * rad;
  const a = Math.sin(dLat / 2) ** 2 +
            Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

// ---------------------------------------------------------------------------

/**
 * The journeys overlay — the second tenant of the overlay system.
 *
 * Its real job is proving the system isn't secretly the timeline wearing a
 * different hat: it registers the same way, fades the same way, letters through
 * the same placement pass, and answers taps the same way, while drawing
 * something completely different.
 *
 * PARKED: deliberately not registered by the lab. The routes it has are a thin
 * seed — three of them, no dates, no distances, and not one of the thirty
 * events carries a verse — and a half-finished journey reads worse than none.
 * It comes back when the routes are authored properly, with a verse on every
 * stop, its own colour per journey, and green and red ends. The class is kept
 * working so that day is wiring, not a rebuild.
 */
export class JourneysOverlay extends BaseOverlay {
  constructor({ routes }) {
    super({ id: 'journeys', title: 'Journeys', colour: '#3f7d8c' });
    this.routes = routes;
    this.selected = routes.map((r) => r.id);   // all on until told otherwise
    this.onRoutesChanged = () => {};
  }

  get shown() {
    return this.routes.filter((r) => this.selected.includes(r.id));
  }

  toggleRoute(id) {
    this.selected = this.selected.includes(id)
      ? this.selected.filter((x) => x !== id)
      : [...this.selected, id];
    if (this.enabled) this.draw();
    this.onRoutesChanged();
  }

  async mount() {
    this.labelPane = this.map.getPane('overlay-labels');
    this.applyTextOpacity();
    this.draw();
  }

  draw() {
    this.clear();

    for (const route of this.shown) {
      const pts = route.stops.map((s) => [s.y, s.x]);

      // Sea legs are dashed and land legs solid, because "he sailed" and "he
      // walked" are different claims and the map should not blur them.
      for (let i = 1; i < route.stops.length; i++) {
        const bySea = /ship|sail|sea|boat/i.test(route.stops[i].by);
        const style = {
          color: this.colour,
          weight: bySea ? 2 : 2.8,
          opacity: 0.9,
          dashArray: bySea ? '7 6' : null,
          fill: false,
        };
        this.add(L.polyline([pts[i - 1], pts[i]], {
          pane: 'overlay-line', renderer: this.host.rendererFor('overlay-line'),
          ...style, interactive: false,
        }), style);
      }

      const dots = L.layerGroup([], { pane: 'overlay-labels' });
      route.stops.forEach((stop, i) => {
        const first = i === 0;
        const last = i === route.stops.length - 1;
        const marker = L.circleMarker([stop.y, stop.x], {
          pane: 'overlay-labels', radius: first || last ? 5.5 : 4,
          fillColor: first ? '#f4ecd8' : this.colour,
          fillOpacity: 1, color: this.colour, weight: 2.2,
          interactive: true, bubblingMouseEvents: false,
        });
        const lines = [
          `<strong>${i + 1}. ${stop.n}</strong>`,
          stop.km ? `${Math.round(stop.km)} km by ${stop.by}` : `by ${stop.by}`,
          ...stop.events.map((e) => `• ${e.what}${e.ref ? ` (${e.ref})` : ''}`),
        ];
        marker.bindPopup(`<div style="min-width:190px">${lines.join('<br>')}</div>`);
        marker.bindTooltip(`${i + 1}. ${stop.n}`, { direction: 'top', offset: [0, -5] });
        dots.addLayer(marker);
      });
      this.add(dots, null);
    }
  }

  /** Stop names, offered to the shared placement pass like any other lettering. */
  labelCandidates(zoom, inView) {
    if (zoom < 5) return [];
    const out = [];
    for (const route of this.shown) {
      route.stops.forEach((stop, i) => {
        if (!inView(stop.y, stop.x)) return;
        out.push({
          lat: stop.y, lon: stop.x, text: `${i + 1}. ${stop.n}`,
          kind: 'journey', pane: 'overlay-labels', shape: 'point',
          priority: 90,
        });
      });
    }
    return out;
  }

  /** What a tap near a journey means. */
  identify(latlng) {
    let best = null;
    for (const route of this.shown) {
      route.stops.forEach((stop, i) => {
        const km = haversine(latlng.lat, latlng.lng, stop.y, stop.x);
        if (!best || km < best.km) best = { km, stop, route, i };
      });
    }
    if (!best || best.km > 40) return null;
    return {
      source: this.title,
      kind: 'journey',
      label: `${best.route.name}, stop ${best.i + 1}: ${best.stop.n}`,
      distanceKm: best.km,
    };
  }
}
