/**
 * Old paper on the land, engraved water on the sea.
 *
 * The first attempt was a fine speckle and a dark vignette laid over the whole
 * map. At the strength it ran, all it did was make the map slightly darker, and
 * because it was pinned to the window it read as a smudge on the glass rather
 * than as the sheet the map was drawn on.
 *
 * The land is the sheet itself, built in layers the way old paper ages:
 *
 *   a warm yellowing;
 *   uneven tone — broad blotches where the sheet has browned more;
 *   fibres, some darker and some lighter than the paper around them;
 *   foxing, the rust-brown spots old paper grows;
 *   a fine grain and the odd fleck of dust;
 *   and worn, darker edges.
 *
 * The water is drawn the way engravers drew it: fine lines that follow every
 * shore and island, spreading and fading as they go out, and across the open
 * sea beyond them an even, slightly wavy hatching, all over a cool wash.
 *
 * Both live in one canvas inside the map, so they pan with it like a real sheet
 * would. It sits above the historical drawing and below the dots and the modern
 * lettering, so the ancient world looks printed on the paper while the things
 * you tap stay crisp. Only the worn edges belong to the window — they are where
 * the sheet stops — so they stay put.
 *
 * Every texture is drawn here in code from a fixed seed, so nothing is
 * downloaded or licensed and the paper looks the same every time. Nothing is
 * built until the first time the map is aged, so the encyclopedia's bare map,
 * which is never aged, never pays for any of it.
 */

import L from 'leaflet';

/** Draw order: above the overlay's names (560), below the dots (600). */
const INK_PANE = ['paper', 585];
const LIGHT_PANE = ['paper-light', 586];

/** Tile sizes on screen, in CSS pixels. Unrelated sizes keep the repeats from lining up. */
const TILE = { mottle: 1024, spots: 1280, fibres: 512, grain: 256, hatch: [240, 60] };

/** The land's yellowing: a wash, not a colour, so nothing under it is hidden. */
const LAND_TINT = 'rgba(226,188,122,0.32)';
/** The sea's: cool and a little grey, so aged water still reads as water. */
const WATER_TINT = 'rgba(168,190,192,0.22)';
/** The engraver's ink for the water, a dark blue-grey. */
const WATER_INK = '38,66,78';

/**
 * The ripples along a shore: how far out each line runs, in pixels, and how
 * dark it is. Spacing grows and ink thins going out, the way an engraver's did.
 */
const RIPPLES = [
  { reach: 2.5, alpha: 0.55 },
  { reach: 6, alpha: 0.44 },
  { reach: 10.5, alpha: 0.34 },
  { reach: 16, alpha: 0.25 },
  { reach: 23, alpha: 0.17 },
];
const RIPPLE_WIDTH = 0.8;
/** Where the hatching of the open sea begins, clear of the last ripple. */
const HATCH_FROM = 30;

// ------------------------------------------------------------------ textures

/** A small seeded generator, so the paper is the same sheet every session. */
function seeded(seed) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function canvasOf(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

/** Fine textures are drawn at screen resolution, capped where it stops showing. */
const sharpness = () => Math.min(2, window.devicePixelRatio || 1);

/**
 * Smooth noise that repeats exactly at the edges of the tile.
 *
 * Several octaves of value noise on grids that wrap, so the blotches continue
 * seamlessly from one tile into the next rather than stopping at a line.
 */
function tilingNoise(size, baseCells, octaves, rand) {
  const out = new Float32Array(size * size);
  const smooth = (t) => t * t * (3 - 2 * t);
  let amp = 1;
  let cells = baseCells;
  for (let o = 0; o < octaves && cells <= size; o++, amp *= 0.5, cells *= 2) {
    const grid = Float32Array.from({ length: cells * cells }, rand);
    for (let y = 0; y < size; y++) {
      const gy = (y / size) * cells;
      const y0 = Math.floor(gy);
      const y1 = (y0 + 1) % cells;
      const ty = smooth(gy - y0);
      for (let x = 0; x < size; x++) {
        const gx = (x / size) * cells;
        const x0 = Math.floor(gx);
        const x1 = (x0 + 1) % cells;
        const tx = smooth(gx - x0);
        const top = grid[y0 * cells + x0] + (grid[y0 * cells + x1] - grid[y0 * cells + x0]) * tx;
        const bottom = grid[y1 * cells + x0] + (grid[y1 * cells + x1] - grid[y1 * cells + x0]) * tx;
        out[y * size + x] += (top + (bottom - top) * ty) * amp;
      }
    }
  }
  let min = Infinity, max = -Infinity;
  for (const v of out) { if (v < min) min = v; if (v > max) max = v; }
  for (let i = 0; i < out.length; i++) out[i] = (out[i] - min) / (max - min || 1);
  return out;
}

/** Broad uneven patches in one colour. Drawn small and stretched, since blotches have no fine detail. */
function mottle(seed, [r, g, b], strength) {
  const size = 256;
  const noise = tilingNoise(size, 2, 6, seeded(seed));
  const c = canvasOf(size, size);
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(size, size);
  for (let i = 0; i < noise.length; i++) {
    const t = Math.min(1, Math.max(0, (noise[i] - 0.42) / 0.45));
    img.data[i * 4] = r;
    img.data[i * 4 + 1] = g;
    img.data[i * 4 + 2] = b;
    img.data[i * 4 + 3] = Math.round(t ** 1.4 * strength * 255);
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

/**
 * Draw `fn` again on the far side of any tile edge its reach crosses, so the
 * tile has no seam. A shape poking out past the right edge also appears at the
 * left, shifted a whole tile.
 */
function wrapped(size, x, y, reach, fn) {
  for (const dx of [-size, 0, size]) {
    if ((dx < 0 && x + reach <= size) || (dx > 0 && x - reach >= 0)) continue;
    for (const dy of [-size, 0, size]) {
      if ((dy < 0 && y + reach <= size) || (dy > 0 && y - reach >= 0)) continue;
      fn(x + dx, y + dy);
    }
  }
}

/** Foxing and dust. Soft shapes, so half resolution is plenty. */
function spots() {
  const css = TILE.spots;
  const scale = 0.5;
  const size = css * scale;
  const rand = seeded(23);
  const c = canvasOf(size, size);
  const ctx = c.getContext('2d');

  // Foxing: rust-brown spots, darkest at the core, some with a speck or two
  // beside them the way mould spreads.
  for (let n = 0; n < 26; n++) {
    const x = rand() * size;
    const y = rand() * size;
    const r = (1.5 + rand() ** 2 * 7) * scale * 2;
    const alpha = 0.22 + rand() * 0.3;
    const spot = (sx, sy, sr, a) => {
      const g = ctx.createRadialGradient(sx, sy, 0, sx, sy, sr);
      g.addColorStop(0, `rgba(122,66,24,${a})`);
      g.addColorStop(0.55, `rgba(150,92,38,${a * 0.55})`);
      g.addColorStop(1, 'rgba(160,104,48,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(sx, sy, sr, 0, Math.PI * 2);
      ctx.fill();
    };
    // Decided once, before wrapping, so every copy of a spot is the same spot.
    const satellites = Array.from({ length: Math.floor(rand() * 3) }, () => [
      (rand() - 0.5) * r * 5, (rand() - 0.5) * r * 5, r * (0.25 + rand() * 0.35),
    ]);
    wrapped(size, x, y, r * 4, (px, py) => {
      spot(px, py, r, alpha);
      for (const [ox, oy, sr] of satellites) spot(px + ox, py + oy, sr, alpha * 0.8);
    });
  }

  // Dust: single dark flecks.
  for (let n = 0; n < 90; n++) {
    ctx.fillStyle = `rgba(70,50,30,${0.2 + rand() * 0.35})`;
    ctx.beginPath();
    ctx.arc(rand() * size, rand() * size, (0.3 + rand() * 0.5) * scale * 2, 0, Math.PI * 2);
    ctx.fill();
  }
  return c;
}

/** Fibres: short curved strands, dark or light. */
function fibres(light) {
  const css = TILE.fibres;
  const res = sharpness();
  const rand = seeded(light ? 41 : 37);
  const c = canvasOf(css * res, css * res);
  const ctx = c.getContext('2d');
  ctx.scale(res, res);
  ctx.lineCap = 'round';

  const count = light ? 420 : 1100;
  for (let n = 0; n < count; n++) {
    const x = rand() * css;
    const y = rand() * css;
    // Mostly short, now and then a long one.
    const len = 4 + rand() ** 3 * (rand() < 0.08 ? 110 : 36);
    const th = rand() * Math.PI * 2;
    const bend = (rand() - 0.5) * 0.9;
    const ex = x + Math.cos(th) * len;
    const ey = y + Math.sin(th) * len;
    const mx = (x + ex) / 2 + Math.cos(th + Math.PI / 2) * len * bend * 0.5;
    const my = (y + ey) / 2 + Math.sin(th + Math.PI / 2) * len * bend * 0.5;
    ctx.lineWidth = light ? 0.45 + rand() * 0.7 : 0.3 + rand() * 0.6;
    ctx.strokeStyle = light
      ? `rgba(255,251,238,${0.12 + rand() * 0.26})`
      : `rgba(92,66,34,${0.05 + rand() * 0.13})`;
    wrapped(css, x, y, len + 4, (px, py) => {
      ctx.beginPath();
      ctx.moveTo(px, py);
      ctx.quadraticCurveTo(mx - x + px, my - y + py, ex - x + px, ey - y + py);
      ctx.stroke();
    });
  }
  return c;
}

/** The grain of the sheet: a per-pixel unevenness too fine to see as anything but texture. */
function grain() {
  const size = TILE.grain * sharpness();
  const rand = seeded(53);
  const c = canvasOf(size, size);
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(size, size);
  for (let i = 0; i < size * size; i++) {
    img.data[i * 4] = 84;
    img.data[i * 4 + 1] = 62;
    img.data[i * 4 + 2] = 36;
    img.data[i * 4 + 3] = Math.round(rand() ** 2.2 * 0.16 * 255);
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

/**
 * The open sea's hatching: close, slightly wavy horizontal lines, each a little
 * darker or lighter than the next the way a burin's pressure varied. Every wave
 * repeats a whole number of times across the tile, so the lines join up.
 */
function hatch() {
  const [w, h] = TILE.hatch;
  const res = sharpness();
  const rand = seeded(61);
  const c = canvasOf(w * res, h * res);
  const ctx = c.getContext('2d');
  ctx.scale(res, res);
  ctx.lineWidth = 0.55;
  const gap = 6;
  for (let row = 0; row < h / gap; row++) {
    const y0 = gap / 2 + row * gap;
    const phase = rand() * Math.PI * 2;
    ctx.strokeStyle = `rgba(${WATER_INK},${0.14 + rand() * 0.12})`;
    ctx.beginPath();
    for (let x = -2; x <= w + 2; x += 2) {
      const y = y0 + Math.sin((x / w) * Math.PI * 4) * 0.7 + Math.sin((x / w) * Math.PI * 12 + phase) * 0.3;
      x < 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  return c;
}

/** Built once per page and shared by every map on it. */
let textures = null;
function paperTextures() {
  textures ??= new Promise((resolve) => {
    // A frame's grace, so switching the timeline on paints before this runs.
    requestAnimationFrame(() => {
      const landMottle = mottle(11, [128, 88, 40], 0.4);
      const t = {
        landMottle,
        waterMottle: mottle(17, [52, 84, 96], 0.3),
        spots: spots(),
        fibresDark: fibres(false),
        fibresLight: fibres(true),
        grain: grain(),
        hatch: hatch(),
        edgeUrl: landMottle.toDataURL(),
      };
      resolve(t);
    });
  });
  return textures;
}

// ------------------------------------------------------------------ renderer

/**
 * A canvas renderer that draws the sheet instead of its paths.
 *
 * Leaflet already knows how to keep a canvas under the view, move it with a
 * drag, scale it through a zoom and project and clip shapes to it; this reuses
 * all of that. Its only shapes are the water, and it never strokes or fills
 * them as shapes: it paints the paper across the whole canvas, then uses the
 * water to cut the paper away and lay the engraved water in its place.
 *
 * The light fibres need a normal blend while everything else multiplies, so a
 * second canvas rides along in its own pane, sized, moved and scaled in step.
 */
const PaperRenderer = L.Canvas.extend({
  options: { padding: 0.3 },

  setTextures(t) {
    const pattern = (canvas, cssWidth) => {
      const p = this._ctx.createPattern(canvas, 'repeat');
      // Textures drawn at a higher resolution are scaled back to their size on screen.
      p.setTransform?.(new DOMMatrix().scaleSelf(cssWidth / canvas.width));
      return p;
    };
    this._patterns = {
      landMottle: pattern(t.landMottle, TILE.mottle),
      waterMottle: pattern(t.waterMottle, TILE.mottle),
      spots: pattern(t.spots, TILE.spots),
      fibresDark: pattern(t.fibresDark, TILE.fibres),
      fibresLight: pattern(t.fibresLight, TILE.fibres),
      grain: pattern(t.grain, TILE.grain),
      hatch: pattern(t.hatch, TILE.hatch[0]),
    };
    if (this._map) this._redrawRequest ||= L.Util.requestAnimFrame(this._redraw, this);
  },

  _initContainer() {
    L.Canvas.prototype._initContainer.call(this);
    this._light = L.DomUtil.create('canvas', 'leaflet-zoom-animated', this._map.getPane(LIGHT_PANE[0]));
    this._lightCtx = this._light.getContext('2d');
    this._scratch = document.createElement('canvas');
  },

  _destroyContainer() {
    L.Canvas.prototype._destroyContainer.call(this);
    L.DomUtil.remove(this._light);
  },

  /** Leaflet's own, with the light canvas kept in step before anything draws. */
  _update() {
    if (this._map._animatingZoom && this._bounds) return;
    L.Renderer.prototype._update.call(this);

    const b = this._bounds;
    const size = b.getSize();
    const m = L.Browser.retina ? 2 : 1;
    for (const [canvas, ctx] of [[this._container, this._ctx], [this._light, this._lightCtx]]) {
      L.DomUtil.setPosition(canvas, b.min);
      canvas.width = m * size.x;
      canvas.height = m * size.y;
      canvas.style.width = `${size.x}px`;
      canvas.style.height = `${size.y}px`;
      ctx.setTransform(m, 0, 0, m, 0, 0);
      ctx.translate(-b.min.x, -b.min.y);
    }
    this.fire('update');
  },

  _updateTransform(center, zoom) {
    L.Canvas.prototype._updateTransform.call(this, center, zoom);
    if (this._light) this._light.style.transform = this._container.style.transform;
  },

  /** Always the whole canvas: the paper covers all of it, not just where shapes changed. */
  _redraw() {
    this._redrawBounds = null;
    L.Canvas.prototype._redraw.call(this);
  },

  _draw() {
    const pat = this._patterns;
    const b = this._bounds;
    if (!pat || !b || !this._ctx) return;
    const ctx = this._ctx;
    const light = this._lightCtx;
    const x = b.min.x, y = b.min.y, w = b.max.x - x, h = b.max.y - y;

    light.save();
    light.setTransform(1, 0, 0, 1, 0, 0);
    light.clearRect(0, 0, this._light.width, this._light.height);
    light.restore();

    // The paper, everywhere.
    ctx.fillStyle = LAND_TINT;
    ctx.fillRect(x, y, w, h);
    for (const p of [pat.landMottle, pat.fibresDark, pat.grain, pat.spots]) {
      ctx.fillStyle = p;
      ctx.fillRect(x, y, w, h);
    }
    light.fillStyle = pat.fibresLight;
    light.fillRect(x, y, w, h);

    const shapes = this._waterShapes();
    if (!shapes.length) return;

    // Then the water cut out of it and engraved in its place. The sea and the
    // inland water are cut separately: each needs its own even-odd fill for its
    // islands, and where the two overlap, cutting twice and laying the same
    // water twice changes nothing.
    const water = this._engrave(b, shapes);
    for (const path of shapes) {
      ctx.save();
      ctx.clip(path, 'evenodd');
      ctx.clearRect(x, y, w, h);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.drawImage(water, 0, 0);
      ctx.restore();

      light.save();
      light.clip(path, 'evenodd');
      light.clearRect(x, y, w, h);
      light.restore();
    }
    // A full-size scratch canvas is a lot of memory to hold between redraws.
    water.width = 0;
    water.height = 0;
  },

  /** The water's outlines, already projected and clipped to the canvas by Leaflet. */
  _waterShapes() {
    const shapes = [];
    for (let order = this._drawFirst; order; order = order.next) {
      const parts = order.layer._parts;
      if (!parts?.length) continue;
      const path = new Path2D();
      for (const ring of parts) {
        if (ring.length < 3) continue;
        path.moveTo(ring[0].x, ring[0].y);
        for (let i = 1; i < ring.length; i++) path.lineTo(ring[i].x, ring[i].y);
        path.closePath();
      }
      shapes.push(path);
    }
    return shapes;
  },

  /**
   * The engraved water, on a scratch canvas the size of this one.
   *
   * Every line is a stroke of the shoreline itself, which is what makes the
   * ripples follow every cape and island. A ripple is drawn as a wide band of
   * ink out from the shore with a slightly narrower band erased from inside it,
   * leaving one thin line at that distance. Working from the outermost ripple
   * in, each erase only ever takes out what lies nearer the shore, so the lines
   * already drawn further out survive — and in a strait narrower than the
   * ripples, the nearer shore's lines win, as an engraver's would.
   */
  _engrave(b, shapes) {
    const pat = this._patterns;
    const canvas = this._scratch;
    canvas.width = this._container.width;
    canvas.height = this._container.height;
    const g = canvas.getContext('2d');
    const m = L.Browser.retina ? 2 : 1;
    const x = b.min.x, y = b.min.y, w = b.max.x - x, h = b.max.y - y;
    g.setTransform(m, 0, 0, m, 0, 0);
    g.translate(-x, -y);
    g.lineJoin = 'round';
    g.lineCap = 'round';

    // Hatching across the open sea, cleared back from every shore with a
    // feathered edge so it gives way to the ripples gradually.
    g.fillStyle = pat.hatch;
    g.fillRect(x, y, w, h);
    g.globalCompositeOperation = 'destination-out';
    for (const [reach, alpha] of [[HATCH_FROM + 24, 0.3], [HATCH_FROM + 12, 0.5], [HATCH_FROM, 1]]) {
      g.strokeStyle = `rgba(0,0,0,${alpha})`;
      g.lineWidth = reach * 2;
      for (const p of shapes) g.stroke(p);
    }

    // The ripples, outermost first.
    for (let i = RIPPLES.length - 1; i >= 0; i--) {
      const { reach, alpha } = RIPPLES[i];
      g.globalCompositeOperation = 'source-over';
      g.strokeStyle = `rgba(${WATER_INK},${alpha})`;
      g.lineWidth = reach * 2 + RIPPLE_WIDTH;
      for (const p of shapes) g.stroke(p);
      g.globalCompositeOperation = 'destination-out';
      g.strokeStyle = '#000';
      g.lineWidth = Math.max(0.01, reach * 2 - RIPPLE_WIDTH);
      for (const p of shapes) g.stroke(p);
    }

    // The wash and its unevenness go underneath everything drawn so far.
    g.globalCompositeOperation = 'destination-over';
    g.fillStyle = pat.waterMottle;
    g.fillRect(x, y, w, h);
    g.fillStyle = WATER_TINT;
    g.fillRect(x, y, w, h);
    g.globalCompositeOperation = 'source-over';
    return canvas;
  },
});

/** Every polygon in a collection as one shape, so Leaflet tracks one layer, not thousands. */
function asOneShape(fc) {
  const polygons = [];
  for (const f of fc?.features ?? []) {
    const geom = f.geometry;
    if (geom?.type === 'Polygon') polygons.push(geom.coordinates);
    else if (geom?.type === 'MultiPolygon') for (const p of geom.coordinates) polygons.push(p);
  }
  return { type: 'Feature', properties: {}, geometry: { type: 'MultiPolygon', coordinates: polygons } };
}

// --------------------------------------------------------------------- sheet

export class Paper {
  /**
   * @param {L.Map} map
   * @param {{ getJson: (key: string) => Promise<any>, index: any }} data
   */
  constructor(map, data) {
    this.map = map;
    this.data = data;
    this.strength = 0;
    this.built = false;
    this.destroyed = false;
  }

  /**
   * How aged the paper looks, 0 to 1.
   *
   * Nothing is built until the first time this is above zero.
   */
  setStrength(value) {
    this.strength = Math.max(0, Math.min(1, value));
    if (this.strength > 0 && !this.built) this.build();
    this.apply();
  }

  apply() {
    if (!this.built) return;
    // The texture stays visible well into the later eras rather than thinning
    // out evenly, then goes once the timeline leaves antiquity behind.
    const s = this.strength > 0 ? this.strength ** 0.6 : 0;
    this.inkPane.style.opacity = s.toFixed(3);
    this.lightPane.style.opacity = (s * 0.85).toFixed(3);
    this.edges.style.opacity = s.toFixed(3);
  }

  build() {
    this.built = true;
    const map = this.map;

    const pane = ([name, z], blend) => {
      const p = map.createPane(name);
      p.style.zIndex = String(z);
      p.style.pointerEvents = 'none';
      p.style.opacity = '0';
      // The blend has to sit on the pane itself. A pane is its own stacking
      // context, so a blend set on anything inside it would only see the empty
      // pane and never the map beneath.
      if (blend) p.style.mixBlendMode = blend;
      return p;
    };
    this.inkPane = pane(INK_PANE, 'multiply');
    this.lightPane = pane(LIGHT_PANE, null);

    this.renderer = new PaperRenderer({ pane: INK_PANE[0] });
    map.addLayer(this.renderer);

    // Worn edges, fixed to the window. A darkening rim, broken up by the same
    // blotches as the sheet so the edge looks handled rather than airbrushed.
    this.edges = L.DomUtil.create('div', '', map.getContainer());
    Object.assign(this.edges.style, {
      position: 'absolute', inset: '0', pointerEvents: 'none', zIndex: '450',
      mixBlendMode: 'multiply', opacity: '0',
    });
    const edgeMask = 'radial-gradient(ellipse at 50% 50%, transparent 52%, #000 100%)';
    this.edges.style.webkitMaskImage = edgeMask;
    this.edges.style.maskImage = edgeMask;

    // The water the paper gives way to: the same sea the timeline paints, and
    // its lakes and rivers.
    const { getJson, index } = this.data;
    const seaFile = index?.basemap?.ocean?.[50]?.file ?? index?.basemap?.ocean?.[110]?.file;
    const inlandFile = (index?.overlays?._always ?? []).find((l) => l.kind === 'water')?.file;
    for (const file of [seaFile, inlandFile]) {
      if (!file) continue;
      getJson(file).then((fc) => {
        if (this.destroyed) return;
        L.geoJSON(asOneShape(fc), { renderer: this.renderer, pane: INK_PANE[0], interactive: false }).addTo(map);
      }, () => {});
    }

    paperTextures().then((t) => {
      if (this.destroyed) return;
      this.renderer.setTextures(t);
      this.edges.style.backgroundImage =
        `radial-gradient(ellipse at 50% 50%, rgba(0,0,0,0) 40%, rgba(88,56,20,.55) 100%), url("${t.edgeUrl}")`;
      this.edges.style.backgroundSize = `100% 100%, ${TILE.mottle / 2}px ${TILE.mottle / 2}px`;
    });
  }

  destroy() {
    this.destroyed = true;
    this.edges?.remove();
  }
}
