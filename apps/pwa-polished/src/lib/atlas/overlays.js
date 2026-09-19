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
// The journey popups group a stop's verses the way every other verse list in the
// app is grouped, so one reads the same wherever you meet it. `haversine` is not
// taken from there: this module exports its own, and importing the twin would be
// two names for one formula.

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
    /**
     * Whether this overlay's lettering follows its layer opacity instead of
     * having a dial of its own. The panel reads it to decide whether to offer a
     * second slider, so the overlay owns the answer rather than the panel
     * knowing which overlay is which.
     */
    this.textFollowsOpacity = false;
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
    this.dotGroups = [];
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
 * Where a journey starts and where it ends.
 *
 * Fixed rather than derived from the route's colour: they have to mean the same
 * thing on all seventeen, and a green that shifted per journey would say
 * "journey" rather than "start".
 *
 * Both are darker and more saturated than any route colour, which is the
 * constraint rather than a preference — a ring the colour of the line it sits on
 * marks nothing. The first red tried here was #b0463f, which is exactly the Last
 * Journey to Jerusalem's own colour and 15 from Elijah's, so that journey's
 * arrival at Jerusalem would have been invisible. The check asserts the gap now
 * rather than trusting the next pair of eyes.
 */
const START_COLOUR = '#1f7a34';
const END_COLOUR = '#8f1d16';

/**
 * Past this, a stop is not on the drawn line at all.
 *
 * The builder already refuses anything over 120 km unless the index exempts it,
 * so this only ever catches the two stops that are exempt on purpose. Well
 * above the ~25 km a legitimately-drawn stop sits from its road, so a route
 * whose survey is merely coarse does not sprout dotted lines.
 */
const UNREACHED_KM = 120;

/**
 * How far a drawn line may stop short of a journey's first or last stop and
 * still be bridged to it.
 *
 * The complaint this answers is that the lines do not touch the dots. Two
 * independent sources meet at every stop — the dot is the gazetteer's city
 * coordinate, the line is Ritmeyer's traced road — and they were only ever
 * checked for proximity, never joined. Measured against the shipped pack, the
 * end gaps run 1 km at best and 113 km at worst, with 23 of 34 already under
 * 10 km; the ones that stand out are land journeys on foot whose survey simply
 * stops short of the terminal city (Capernaum 113, Paul's Third at Jerusalem
 * 87, Abram at Hebron 80).
 *
 * 120 is deliberately the same as UNREACHED_KM rather than a second opinion
 * about the same thing: above it a stop is already drawn its own dotted
 * connector, so a higher limit here would draw both and a lower one would
 * leave a band of stops with neither. The smallest genuine water gap is 309 km
 * (Paul's Second) and the next 370 (his Third), so nothing here can bridge an
 * open-water crossing.
 */
const ANCHOR_KM = 120;

/**
 * How far one leg's end may sit from the next leg's start and still be joined.
 *
 * Lower than the anchor limit, and for a different reason: an anchor closes a
 * known gap between a line and the city it was drawn for, while a joint claims
 * two separate strokes are one continuous road. That is the claim that goes
 * wrong if it is made too freely, so it keeps a wide margin below the 309 km
 * Aegean crossing.
 */
const JOINT_KM = 60;

/**
 * A `#rrggbb` faded to an alpha, for somewhere only a colour can be given.
 *
 * The journey colours are all six-digit hex out of the index, and the gate
 * asserts it, so anything else returning unchanged is the right failure: a
 * colour that renders at full strength is a missed fade, not a broken label.
 */
function withAlpha(hex, alpha) {
  if (alpha >= 1) return hex;
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex ?? '');
  if (!m) return hex;
  const [r, g, b] = m.slice(1).map((h) => parseInt(h, 16));
  return `rgba(${r},${g},${b},${Math.max(0, alpha).toFixed(2)})`;
}

/**
 * The journeys overlay — the second tenant of the overlay system.
 *
 * Its real job is proving the system isn't secretly the timeline wearing a
 * different hat: it registers the same way, fades the same way, letters through
 * the same placement pass, and answers taps the same way, while drawing
 * something completely different.
 *
 * Each route brings its own colour, so unlike the timeline this overlay's
 * `colour` is only what the Layers panel puts in its swatch — nothing drawn
 * uses it.
 */
export class JourneysOverlay extends BaseOverlay {
  constructor({ routes }) {
    super({ id: 'journeys', title: 'Journeys', colour: '#3f7d8c' });
    this.routes = routes;
    this.selected = routes.map((r) => r.id);   // all on until told otherwise
    this.onRoutesChanged = () => {};
    // Mirrors BiblicalPlaces.onOpen: a stop tap is routed to the host, which
    // opens the same info panel the city dots use. Unwired by default, so an
    // overlay nobody has connected simply does nothing on a tap.
    this.onOpenStop = () => {};
    this.textFollowsOpacity = true;
    /** The place whose panel is open, so the stop standing for it can show it. */
    this.selectedId = null;
  }

  /**
   * Every visit to every place, grouped by the place visited.
   *
   * Nineteen of the eighty-five places on the shipped journeys are visited by
   * more than one journey, and Kadesh-barnea is the plainest case: the Exodus
   * ends there and the Twelve Spies begin there, two dots at one coordinate,
   * the second drawn over the first. Whichever journey drew last owned the
   * place — its dot, its tooltip and its tap — and the other may as well not
   * have been on the map.
   *
   * Keyed on `placeId` rather than on the coordinate, because the coordinate is
   * what the two sources happen to agree on and the place is what they mean; a
   * stop without one falls back to its rounded position, which is the best
   * available answer for a point the gazetteer does not know.
   *
   * Rebuilt per draw rather than cached against the route list, because what
   * belongs in it is the *shown* journeys: switching one off has to take its
   * wedge out of a shared dot, or a place would go on claiming a visit from a
   * journey no longer on the map.
   */
  indexVisits() {
    const visits = new Map();
    for (const route of this.shown) {
      route.stops.forEach((stop, i) => {
        const key = stop.placeId ?? `@${stop.y.toFixed(4)},${stop.x.toFixed(4)}`;
        if (!visits.has(key)) visits.set(key, []);
        visits.get(key).push({ route, stop, i });
      });
    }
    return visits;
  }

  /** The visits sharing this stop's place, in the order the journeys are drawn. */
  visitsAt(stop) {
    const key = stop.placeId ?? `@${stop.y.toFixed(4)},${stop.x.toFixed(4)}`;
    return this.visits?.get(key) ?? [];
  }

  /**
   * Mark a stop's dot as the chosen one.
   *
   * Unlike the biblical dots, this overlay does not rebuild itself on a pan, so
   * the class has to be re-applied by asking for a draw. Ignored when nothing
   * is showing — a redraw would only rebuild an empty map.
   */
  markSelected(placeId) {
    if (this.selectedId === placeId) return;
    this.selectedId = placeId;
    if (this.enabled) this.draw();
  }

  get shown() {
    return this.routes.filter((r) => this.selected.includes(r.id));
  }

  toggleRoute(id) {
    this.setRoutes(
      this.selected.includes(id)
        ? this.selected.filter((x) => x !== id)
        : [...this.selected, id]
    );
  }

  /**
   * The whole selection at once.
   *
   * `toggleRoute` redraws, and a redraw rebuilds every shown journey's line and
   * all of its stops — so "show all" written as seventeen toggles is seventeen
   * full rebuilds, each one throwing away the markers the last had just made.
   * Setting the list and drawing once is the same end state for one pass.
   *
   * Filtered against the routes actually held, so a stale id — from a panel
   * that outlived a pack change — cannot sit in `selected` forever counting
   * towards "all on".
   */
  setRoutes(ids) {
    const known = new Set(this.routes.map((r) => r.id));
    this.selected = ids.filter((id) => known.has(id));
    if (this.enabled) {
      this.draw();
      // The names are placed by the shared pass, not by draw(), so a journey
      // switched off keeps its lettering on the map until something else asks
      // for a pass — a pan, or another layer changing. Ask here. This only
      // began to matter with per-journey switches: turning the whole layer off
      // goes through the host, which runs the pass itself.
      this.host?.onLabelsChanged?.();
    }
    this.onRoutesChanged();
  }

  async mount() {
    // No labelPane here, unlike the timeline: this overlay's lettering fades
    // through its own colour rather than through the pane, which it shares. The
    // placement pass runs on the host's change anyway, so mounting does not have
    // to ask for one.
    this.draw();
  }

  draw() {
    // clear() empties dotGroups along with the layers — the dots it holds are
    // the ones just removed from the map.
    this.clear();

    // Before any dot is drawn, because a dot has to know whether it is sharing
    // its place with another journey to know what shape to be.
    this.visits = this.indexVisits();
    // A place visited by several journeys gets one dot between them, drawn with
    // the first journey to reach it; the rest skip it rather than stack on it.
    this.dotsDrawn = new Set();

    for (const route of this.shown) {
      this.drawRoute(route);
    }
    // A redraw replaces the markers the last fade was applied to, so the fade has
    // to be re-applied or toggling one journey off would bring the rest back to
    // full strength.
    if (this.opacity < 1) this.applyOpacity();
  }

  /**
   * One journey: its line, then its stops on top.
   *
   * The colour comes from the route rather than the overlay, because seventeen
   * journeys crossing the same country in one teal are seventeen journeys a
   * reader cannot tell apart.
   */
  drawRoute(route) {
    const drawn = route.legs?.length
      ? this.drawGeometry(route)
      : this.drawStraight(route);

    // Stops last, so a dot is never buried under the line of the journey after
    // it. One group per route rather than per stop: `clear()` walks this list on
    // every toggle, and 111 stops would make it 111 entries long.
    //
    // Added with no style bag, because the base class dims a group by flattening
    // one style over all its children — which is right for a coastline and wrong
    // here, where the start ring, the end ring and the stops between are three
    // different colours. applyOpacity dims them one at a time instead.
    const dots = L.layerGroup([], { pane: 'overlay-labels' });
    route.stops.forEach((stop, i) => {
      // A shared place is one dot, not one per journey. The first journey to
      // reach it draws it for all of them — the marker itself carries every
      // visit, so nothing is lost by the others standing down.
      const key = stop.placeId ?? `@${stop.y.toFixed(4)},${stop.x.toFixed(4)}`;
      if (this.dotsDrawn?.has(key)) return;
      this.dotsDrawn?.add(key);
      dots.addLayer(this.stopMarker(route, stop, i));
    });
    this.add(dots, null);
    this.dotGroups.push(dots);
    return drawn;
  }

  /**
   * The drawn route: the real surveyed line, one polyline per leg.
   *
   * The legs are deliberately not joined into one path. Where a journey crosses
   * open water the source drew nothing — Paul's Second Journey has a 309 km gap
   * and the Third 370 km — so joining them would invent a coastline-ignoring
   * straight line and present it as surveyed. Separate strokes say "and then he
   * was there", which is what the source actually claims.
   *
   * Sea or land is a property of the stop a leg arrives at, and legs and stops
   * are different counts — fourteen stops and eight legs on Paul's Second — so
   * each leg has to be matched to the stops it runs between before it can be
   * styled. It is matched to a consecutive *pair*, both endpoints at once, and
   * scored in both orientations, because the stored direction is unreliable:
   * several source lines are drawn against their own name.
   *
   * Asking only which stop a leg ends nearest is the version that looks
   * reasonable and is wrong. On Paul's First Journey it matched the Seleucia →
   * Salamis crossing to Seleucia, which is the stop it left, so the one leg that
   * had to be dashed came out solid — and the same for Paphos → Perga. All three
   * of that journey's sea legs drew as roads.
   */
  drawGeometry(route) {
    const legs = route.legs.filter((leg) => leg.length >= 2);
    for (const leg of legs) {
      // Stored [lon,lat]; Leaflet wants [lat,lon].
      const latlngs = leg.map(([lon, lat]) => [lat, lon]);
      const style = this.legStyle(route, this.methodForLeg(route, leg));
      this.add(L.polyline(latlngs, {
        pane: 'overlay-line', renderer: this.host.rendererFor('overlay-line'),
        ...style, interactive: false,
      }), style);
    }
    this.bridge(route, legs);

    // A stop the line never reaches, joined to the route by a faint straight
    // line. Two journeys need this and both are the point rather than a defect:
    // the Egypt line stops at the border, and nobody ever drew Jonah's Atlantic
    // leg, because that voyage is the thing he did not complete. Drawn thin and
    // dotted so it reads as a claim about direction rather than a surveyed road.
    for (let i = 1; i < route.stops.length; i++) {
      const stop = route.stops[i];
      if (this.nearestLegKm(route, stop.y, stop.x) <= UNREACHED_KM) continue;
      const from = route.stops[i - 1];
      const style = {
        color: route.colour, weight: 1.4, opacity: 0.55,
        dashArray: '2 7', fill: false,
      };
      this.add(L.polyline([[from.y, from.x], [stop.y, stop.x]], {
        pane: 'overlay-line', renderer: this.host.rendererFor('overlay-line'),
        ...style, interactive: false,
      }), style);
    }
    return 'geometry';
  }

  /**
   * Close the gaps between the drawn line and the dots it was drawn for.
   *
   * Two coordinate systems meet at every stop: the dot is the gazetteer's city
   * coordinate, the line is a traced road, and nothing ever joined them. The
   * result is the visible gap at the green ring — the line starts near Antioch
   * rather than at it.
   *
   * Three cases, and the distinction between them is what keeps this honest:
   *
   *   anchor  the journey's first stop to the nearest end of the line, and the
   *           last stop to its nearest end. Drawn in the adjacent leg's own
   *           style, because this is survey coarseness rather than a separate
   *           claim about how he travelled.
   *   joint   one leg's end to another leg's start, where they nearly meet.
   *           Also the adjacent leg's style, for the same reason.
   *   neither anything wider is left alone. Open water is not a road, and the
   *           existing dotted connector already speaks for stops the line
   *           genuinely never reaches.
   *
   * The anchor ends at the exact `[stop.y, stop.x]` that stopMarker() uses, so
   * the line and the dot cannot disagree about where the city is.
   *
   * Which leg is nearest is measured rather than assumed. The stored leg order
   * is unreliable — several source lines are drawn against their own name, and
   * the order does not follow travel order — so taking legs[0] as the start
   * would anchor the wrong end of the wrong leg on about a third of these.
   */
  bridge(route, legs) {
    if (!legs.length) return;

    // Every leg endpoint, each remembering the leg it belongs to so the bridge
    // can borrow that leg's styling.
    const ends = [];
    for (const leg of legs) {
      ends.push({ leg, point: leg[0] }, { leg, point: leg[leg.length - 1] });
    }

    const draw = (from, to, leg) => {
      const style = this.legStyle(route, this.methodForLeg(route, leg));
      this.add(L.polyline([from, to], {
        pane: 'overlay-line', renderer: this.host.rendererFor('overlay-line'),
        ...style, interactive: false,
      }), style);
    };

    // Anchors: the two ends of the journey.
    for (const stop of [route.stops[0], route.stops[route.stops.length - 1]]) {
      if (!stop) continue;
      let best = null;
      for (const end of ends) {
        const km = haversine(stop.y, stop.x, end.point[1], end.point[0]);
        if (!best || km < best.km) best = { km, end };
      }
      // Zero-length lines are not worth drawing, and a gap this wide is a stop
      // the line never reached — the dotted connector's business, not this.
      if (!best || best.km > ANCHOR_KM || best.km < 0.05) continue;
      draw([stop.y, stop.x], [best.end.point[1], best.end.point[0]], best.end.leg);
    }

    // Joints: a free leg end to the nearest free end of another leg.
    //
    // Endpoint to endpoint, not leg to leg, and each endpoint is spent once.
    // Elisha's Ministry is why: six short legs around the Jordan valley, where
    // every one of the fifteen leg pairs comes within 60 km of another, and
    // joining pairs drew a scribble across the same few miles. An endpoint,
    // though, is one loose thread — a leg has two, a line drawn in two strokes
    // has one apiece where they meet — so matching the closest free pair and
    // spending both joins each visible gap exactly once.
    //
    // Nearest-first, so the obvious joins are made before the marginal ones can
    // claim an endpoint they have a weaker claim on.
    const candidates = [];
    for (let i = 0; i < ends.length; i++) {
      for (let j = i + 1; j < ends.length; j++) {
        if (ends[i].leg === ends[j].leg) continue;
        const km = haversine(
          ends[i].point[1], ends[i].point[0],
          ends[j].point[1], ends[j].point[0]
        );
        if (km > JOINT_KM || km < 0.05) continue;
        candidates.push({ km, i, j });
      }
    }
    candidates.sort((a, b) => a.km - b.km);

    // One joint per endpoint, and one per pair of legs: two strokes meet in one
    // place, not two. The pair rule is what stops a closed loop from being
    // bridged twice — Jesus' Galilee ministry draws its second leg as a circuit
    // whose start and end are the same point, so both of its ends sit the same
    // distance from the other leg and each would otherwise claim a partner.
    const spent = new Set();
    const pairs = new Set();
    for (const c of candidates) {
      if (spent.has(c.i) || spent.has(c.j)) continue;
      const a = ends[c.i];
      const b = ends[c.j];
      const pair = `${legs.indexOf(a.leg)}:${legs.indexOf(b.leg)}`;
      if (pairs.has(pair)) continue;
      spent.add(c.i);
      spent.add(c.j);
      pairs.add(pair);
      draw([a.point[1], a.point[0]], [b.point[1], b.point[0]], b.leg);
    }
  }

  /** No surveyed line for this journey: stop to stop, the honest approximation. */
  drawStraight(route) {
    for (let i = 1; i < route.stops.length; i++) {
      const style = this.legStyle(route, route.stops[i].by);
      this.add(L.polyline([
        [route.stops[i - 1].y, route.stops[i - 1].x],
        [route.stops[i].y, route.stops[i].x],
      ], {
        pane: 'overlay-line', renderer: this.host.rendererFor('overlay-line'),
        ...style, interactive: false,
      }), style);
    }
    return 'straight';
  }

  /**
   * Sea legs dashed and land legs solid, because "he sailed" and "he walked" are
   * different claims and the map should not blur them.
   */
  legStyle(route, method) {
    const bySea = /ship|sail|sea|boat/i.test(method ?? '');
    return {
      color: route.colour,
      weight: bySea ? 2 : 2.8,
      opacity: 0.9,
      dashArray: bySea ? '7 6' : null,
      fill: false,
    };
  }

  /**
   * How the traveller covered this leg.
   *
   * The leg is matched to the consecutive pair of stops its two ends sit closest
   * to, scoring both orientations and keeping the cheaper, and the method is then
   * the arriving stop's — which is what `travel_method` records. Matching the
   * pair rather than one endpoint is what keeps a crossing from being credited to
   * the port it sailed from.
   */
  methodForLeg(route, leg) {
    const a = leg[0];
    const b = leg[leg.length - 1];
    let best = null;
    for (let i = 1; i < route.stops.length; i++) {
      const from = route.stops[i - 1];
      const to = route.stops[i];
      const fwd = haversine(a[1], a[0], from.y, from.x) + haversine(b[1], b[0], to.y, to.x);
      const rev = haversine(a[1], a[0], to.y, to.x) + haversine(b[1], b[0], from.y, from.x);
      const cost = Math.min(fwd, rev);
      // Ties keep the earlier pair, so a journey that visits one place twice
      // credits the leg to the first passage rather than to whichever comparison
      // happened to run last.
      if (!best || cost < best.cost) best = { cost, by: to.by };
    }
    return best?.by ?? '';
  }

  /** How far this point sits from the nearest drawn coordinate. */
  nearestLegKm(route, lat, lon) {
    let best = Infinity;
    for (const leg of route.legs ?? []) {
      for (const [lon2, lat2] of leg) {
        const km = haversine(lat, lon, lat2, lon2);
        if (km < best) best = km;
      }
    }
    return best;
  }

  /**
   * A stop's dot: green where the journey starts, red where it ends.
   *
   * The ends are the one thing a route drawn in a single colour cannot say for
   * itself — a line has two ends and no direction — so they are marked in
   * colours that mean the same thing on every journey rather than in the
   * route's own.
   */
  stopMarker(route, stop, i) {
    const visits = this.visitsAt(stop);
    // Several journeys at one place is a different drawing problem, not a
    // variation on this one: it has no single colour and no single start/end
    // to state, so it gets its own marker rather than a pile of parameters here.
    if (visits.length > 1) return this.sharedStopMarker(visits, stop);

    const first = i === 0;
    const last = i === route.stops.length - 1;
    const marker = L.circleMarker([stop.y, stop.x], {
      pane: 'overlay-labels',
      radius: first || last ? 5.5 : 4,
      // The first stop stays hollow — it is where the journey has not happened
      // yet — while the last is filled, because it is where it arrived.
      fillColor: first ? '#f4ecd8' : last ? END_COLOUR : route.colour,
      fillOpacity: 1,
      color: first ? START_COLOUR : last ? END_COLOUR : route.colour,
      weight: first || last ? 2.8 : 2.2,
      interactive: true, bubblingMouseEvents: false,
      className: this.selectedId != null && stop.placeId === this.selectedId ? 'dot-chosen' : '',
    });

    // The tap opens the app's own info panel rather than a Leaflet bubble, so a
    // stop gets the colour-coded reference list, the verse previews and the
    // crumb back to the map that every city dot already has. The hover name
    // stays — it is good and costs nothing.
    marker.on('click', (e) => {
      if (e?.originalEvent) L.DomEvent.stop(e.originalEvent);
      this.onOpenStop(stop, route, i);
    });
    marker.bindTooltip(`${i + 1}. ${stop.n}`, { direction: 'top', offset: [0, -5] });
    return marker;
  }

  /**
   * One place, several journeys: a dot cut into a wedge per visit.
   *
   * The problem it answers is that two stops at one coordinate were two dots in
   * the same spot, so the map showed one journey and silently swallowed the
   * other — at Kadesh-barnea the Exodus's red arrival covered the green dot the
   * Twelve Spies set out from, and nothing on the map said the second journey
   * was there at all.
   *
   * A wedge per visit says it in the one language the rest of the layer already
   * speaks, which is colour: the reader who knows red is the Exodus and green
   * the Spies reads "both of these meet here" without a legend. Drawn as an
   * element rather than a `circleMarker` because Leaflet's vector dots are
   * single-fill by definition; a conic gradient gives exact wedges with no
   * per-slice geometry, and the ring around it is a border rather than a second
   * shape to keep aligned.
   *
   * The ring still carries start and end, because that is the question a shared
   * dot makes *more* pressing rather than less: at Kadesh one journey ends and
   * another begins, so it is drawn green where any journey starts there, red
   * where one ends, and in neither colour when it is only passed through. A
   * place that both starts and ends a journey takes the green — a beginning is
   * the more useful thing to see, and the panel names both the moment it opens.
   */
  sharedStopMarker(visits, stop) {
    const starts = visits.some((v) => v.i === 0);
    const ends = visits.some((v) => v.i === v.route.stops.length - 1);
    const ring = starts ? START_COLOUR : ends ? END_COLOUR : '#4a3f33';

    // One wedge per journey, not per visit. Antioch is why: Paul's First and
    // Second both set out from it and both come home to it, so five visits fall
    // on that dot from three journeys — and cutting it five ways would put two
    // pairs of identical wedges on it, which reads as five journeys rather than
    // as three, two of which went twice. The wedge is the journey; how many
    // times it called is the panel's to say.
    const byRoute = [];
    for (const v of visits) {
      const found = byRoute.find((g) => g.route.id === v.route.id);
      if (found) found.visits.push(v);
      else byRoute.push({ route: v.route, visits: [v] });
    }

    // Equal wedges in the order the journeys are drawn, so a shared dot looks
    // the same on every redraw rather than shuffling as the layer rebuilds.
    const span = 360 / byRoute.length;
    const slices = byRoute
      .map((g, n) => `${g.route.colour} ${(n * span).toFixed(2)}deg ${((n + 1) * span).toFixed(2)}deg`)
      .join(', ');

    const size = 15;
    const chosen = this.selectedId != null && stop.placeId === this.selectedId ? ' dot-chosen' : '';
    const icon = L.divIcon({
      className: `journey-shared${chosen}`,
      iconSize: [size, size],
      iconAnchor: [size / 2, size / 2],
      html: `<span class="js-dot" style="background:conic-gradient(${slices});border-color:${ring}"></span>`,
    });

    const marker = L.marker([stop.y, stop.x], {
      icon, pane: 'overlay-labels', interactive: true, bubblingMouseEvents: false,
      // Above the single dots, so where a shared place sits near a plain one the
      // dot carrying two journeys is the one the tap finds.
      zIndexOffset: 400,
    });

    // The host is told which stop was tapped and that it is a shared one; it
    // builds the journey list itself, from the routes rather than from what is
    // drawn, so the panel says the same thing whichever way the reader arrived.
    // A tap asks which journey he means, an arrow already knows — and that is
    // the panel's choice to make, not the dot's.
    marker.on('click', (e) => {
      if (e?.originalEvent) L.DomEvent.stop(e.originalEvent);
      const [head] = visits;
      this.onOpenStop(head.stop, head.route, head.i, true);
    });

    // The place named once, then what each journey does there. The single dots
    // put the stop number first because there is only ever one; here the number
    // means nothing until you know whose sequence it counts in, so the journey
    // leads and a journey that called twice says both in one line.
    marker.bindTooltip(
      `<b>${stop.n}</b><br>` + byRoute.map((g) => {
        const at = g.visits.map((v) => v.i + 1).join(' &amp; ');
        return `${g.route.name} — stop ${at} of ${g.route.stops.length}`;
      }).join('<br>'),
      { direction: 'top', offset: [0, -8] }
    );
    return marker;
  }

  /** Stop names, offered to the shared placement pass like any other lettering. */
  labelCandidates(zoom, inView) {
    if (zoom < 5) return [];
    const out = [];
    for (const route of this.shown) {
      // Lettered in the journey's own colour, so a numbered name belongs to a
      // visible line rather than floating between two of them. The fade is baked
      // into the colour because the pass renders it as an inline `color:` — see
      // applyTextOpacity for why it cannot be done with the pane.
      const colour = withAlpha(route.colour, this.textOpacity);
      route.stops.forEach((stop, i) => {
        if (!inView(stop.y, stop.x)) return;
        out.push({
          lat: stop.y, lon: stop.x, text: `${i + 1}. ${stop.n}`,
          kind: 'journey', pane: 'overlay-labels', shape: 'point',
          priority: 90, colour,
        });
      });
    }
    return out;
  }

  /**
   * One dial for the whole layer — the deliberate departure from the timeline.
   *
   * A journey is a line, its dots and its numbered names saying one thing
   * together; fading the line while the numbers stayed put would leave a column
   * of floating numerals. So the layer opacity drives the lettering too, and the
   * separate text dial the panel offers is kept in step rather than independent.
   */
  applyOpacity() {
    super.applyOpacity();

    // Each dot keeps the colour it was drawn in — the start ring, the end ring
    // and the route's own are three different answers — so they fade one at a
    // time rather than under one flattened style.
    for (const group of this.dotGroups ?? []) {
      group.eachLayer((marker) => {
        // A shared place's dot is an element, not a vector, so it has no
        // setStyle to flatten — it fades through the element's own opacity.
        if (marker.setStyle) marker.setStyle({ opacity: this.opacity, fillOpacity: this.opacity });
        else marker.setOpacity?.(this.opacity);
      });
    }

    this.textOpacity = this.opacity;
    this.applyTextOpacity();
  }

  /**
   * Journey lettering fades through its own colour, not through the pane.
   *
   * `overlay-labels` is shared with the timeline, so setting its opacity here
   * would dim the timeline's land and sea names as well — one overlay reaching
   * into another's lettering. The names carry their alpha in the colour instead,
   * which means a redraw rather than a style tweak; the placement pass has to run
   * anyway for a colour change to reach the page.
   */
  applyTextOpacity() {
    this.host?.onLabelsChanged?.();
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
