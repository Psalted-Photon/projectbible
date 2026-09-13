/**
 * Old paper, under the ink.
 *
 * The first attempt was a fine speckle and a dark vignette laid over the whole
 * map. At the strength it ran, all it did was make the map slightly darker, and
 * because it was pinned to the window it read as a smudge on the glass rather
 * than as the sheet the map was drawn on.
 *
 * This is the sheet itself, built in layers the way old paper actually ages:
 *
 *   a warm yellowing over everything;
 *   uneven tone — broad blotches where the sheet has browned more;
 *   fibres, some darker and some lighter than the paper around them;
 *   foxing, the rust-brown spots old paper grows, and a faint tide-line or two;
 *   a fine grain and the odd fleck of dust;
 *   and worn, darker edges.
 *
 * Everything but the edges lives in panes inside the map, so it pans with the
 * map like a real sheet would. It sits above the historical drawing and below
 * the dots and the modern lettering, so the ancient world looks printed on the
 * paper while the things you tap stay crisp. The edges belong to the window —
 * they are where the sheet stops — so they stay put.
 *
 * Every texture is drawn here in code from a fixed seed, so nothing is
 * downloaded or licensed and the paper looks the same every time. They are
 * built the first time the map is aged, not before, so the encyclopedia's bare
 * map, which is never aged, never pays for them.
 */

import L from 'leaflet';

/** Draw order: above the overlay's names (560), below the dots (600). */
const INK_PANE = ['paper', 585];
const LIGHT_PANE = ['paper-light', 586];

/** How far the sheet reaches past each edge of the view, so a drag never outruns it. */
const MARGIN = 384;

/** Tile sizes on screen, in CSS pixels. Unrelated sizes keep the repeats from lining up. */
const TILE = { mottle: 1024, spots: 1280, fibres: 512, grain: 256 };

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

/** Broad browned patches. Drawn small and stretched, since blotches have no fine detail. */
function mottle() {
  const size = 256;
  const noise = tilingNoise(size, 2, 6, seeded(11));
  const c = canvasOf(size, size);
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(size, size);
  for (let i = 0; i < noise.length; i++) {
    const t = Math.min(1, Math.max(0, (noise[i] - 0.42) / 0.45));
    img.data[i * 4] = 128;
    img.data[i * 4 + 1] = 88;
    img.data[i * 4 + 2] = 40;
    img.data[i * 4 + 3] = Math.round(t ** 1.4 * 0.4 * 255);
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

/** Foxing, dust and a faint tide-line or two. Soft shapes, so half resolution is plenty. */
function spots() {
  const css = TILE.spots;
  const scale = 0.5;
  const size = css * scale;
  const rand = seeded(23);
  const c = canvasOf(size, size);
  const ctx = c.getContext('2d');

  // Tide-lines: the edge a spill dried to, an uneven ring barely darker than
  // the paper, with a faint wash inside it.
  for (let n = 0; n < 2; n++) {
    const cx = rand() * size;
    const cy = rand() * size;
    const r = (100 + rand() * 120) * scale;
    const wobble = [rand() * 6, rand() * 6, rand() * 6];
    const ring = (x, y) => {
      ctx.beginPath();
      for (let a = 0; a <= 64; a++) {
        const th = (a / 64) * Math.PI * 2;
        const rr = r * (1 + 0.05 * Math.sin(3 * th + wobble[0]) + 0.03 * Math.sin(5 * th + wobble[1]) + 0.02 * Math.sin(9 * th + wobble[2]));
        const px = x + Math.cos(th) * rr;
        const py = y + Math.sin(th) * rr;
        a ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
      }
      ctx.closePath();
      ctx.fillStyle = 'rgba(168,124,62,0.05)';
      ctx.fill();
      for (const [w, alpha] of [[5, 0.03], [2.6, 0.06], [1.2, 0.09]]) {
        ctx.lineWidth = w * scale * 2;
        ctx.strokeStyle = `rgba(130,88,40,${alpha})`;
        ctx.stroke();
      }
    };
    wrapped(size, cx, cy, r * 1.2, ring);
  }

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

/** Fibres: short curved strands, dark or light. Fine detail, so drawn at screen resolution. */
function fibres(light) {
  const css = TILE.fibres;
  const res = Math.min(2, window.devicePixelRatio || 1);
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
  const css = TILE.grain;
  const res = Math.min(2, window.devicePixelRatio || 1);
  const size = css * res;
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

function urlOf(canvas) {
  return new Promise((resolve) => {
    if (canvas.toBlob) {
      canvas.toBlob((blob) => resolve(blob ? URL.createObjectURL(blob) : canvas.toDataURL()), 'image/png');
    } else {
      resolve(canvas.toDataURL());
    }
  });
}

/** Built once per page and shared by every map on it. */
let textures = null;
function paperTextures() {
  textures ??= (async () => {
    const [m, s, fd, fl, g] = await Promise.all([mottle(), spots(), fibres(false), fibres(true), grain()].map(urlOf));
    return { mottle: m, spots: s, fibresDark: fd, fibresLight: fl, grain: g };
  })();
  return textures;
}

// --------------------------------------------------------------------- sheet

const mod = (v, t) => ((v % t) + t) % t;

export class Paper {
  /** @param {L.Map} map */
  constructor(map) {
    this.map = map;
    this.strength = 0;
    this.built = false;
    this.destroyed = false;
    this.origin = null;
    this.size = null;
    this.onMove = () => this.place(false);
    this.onReset = () => this.place(true);
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
      const sheet = L.DomUtil.create('div', '', p);
      sheet.style.position = 'absolute';
      return { p, sheet };
    };

    const ink = pane(INK_PANE, 'multiply');
    const light = pane(LIGHT_PANE, null);
    this.inkPane = ink.p;
    this.inkSheet = ink.sheet;
    this.lightPane = light.p;
    this.lightSheet = light.sheet;
    // The yellowing. A wash, not a colour: at full age it turns the parchment
    // toward old newsprint without hiding anything under it.
    this.inkSheet.style.backgroundColor = 'rgba(226,188,122,0.32)';

    // Worn edges, fixed to the window. A darkening rim, broken up by the same
    // blotches as the sheet so the edge looks handled rather than airbrushed.
    const container = map.getContainer();
    this.edges = L.DomUtil.create('div', '', container);
    Object.assign(this.edges.style, {
      position: 'absolute', inset: '0', pointerEvents: 'none', zIndex: '450',
      mixBlendMode: 'multiply', opacity: '0',
    });
    const edgeMask = 'radial-gradient(ellipse at 50% 50%, transparent 52%, #000 100%)';
    this.edges.style.webkitMaskImage = edgeMask;
    this.edges.style.maskImage = edgeMask;

    map.on('move', this.onMove);
    map.on('moveend zoomend viewreset resize', this.onReset);

    paperTextures().then((t) => {
      if (this.destroyed) return;
      this.inkSheet.style.backgroundImage = [t.spots, t.fibresDark, t.grain, t.mottle].map((u) => `url("${u}")`).join(',');
      this.inkSheet.style.backgroundSize = [TILE.spots, TILE.fibres, TILE.grain, TILE.mottle].map((n) => `${n}px ${n}px`).join(',');
      this.lightSheet.style.backgroundImage = `url("${t.fibresLight}")`;
      this.lightSheet.style.backgroundSize = `${TILE.fibres}px ${TILE.fibres}px`;
      this.edges.style.backgroundImage =
        `radial-gradient(ellipse at 50% 50%, rgba(0,0,0,0) 40%, rgba(88,56,20,.55) 100%), url("${t.mottle}")`;
      this.edges.style.backgroundSize = `100% 100%, ${TILE.mottle / 2}px ${TILE.mottle / 2}px`;
      this.place(true);
    });
    this.place(true);
  }

  /**
   * Keep the sheet under the view.
   *
   * The sheet sits in the map's own coordinates, so a drag carries it along
   * for free. It is only moved when the view gets near its edge, and then its
   * texture is shifted by exactly the distance it moved, so the fibres stay
   * where they were on the map and the jump never shows.
   */
  place(force) {
    if (!this.built || this.destroyed) return;
    const map = this.map;
    const view = map.getSize();
    const tl = map.containerPointToLayerPoint([0, 0]);

    const o = this.origin;
    const sz = this.size;
    const covered = o && sz &&
      tl.x >= o.x + 32 && tl.y >= o.y + 32 &&
      tl.x + view.x <= o.x + sz.x - 32 && tl.y + view.y <= o.y + sz.y - 32;
    if (covered && !force) return;

    const origin = L.point(Math.floor(tl.x - MARGIN), Math.floor(tl.y - MARGIN));
    const size = L.point(view.x + MARGIN * 2, view.y + MARGIN * 2);
    this.origin = origin;
    this.size = size;

    const positions = [TILE.spots, TILE.fibres, TILE.grain, TILE.mottle]
      .map((t) => `${-mod(origin.x, t)}px ${-mod(origin.y, t)}px`).join(',');
    for (const sheet of [this.inkSheet, this.lightSheet]) {
      L.DomUtil.setPosition(sheet, origin);
      sheet.style.width = `${size.x}px`;
      sheet.style.height = `${size.y}px`;
    }
    this.inkSheet.style.backgroundPosition = positions;
    this.lightSheet.style.backgroundPosition = `${-mod(origin.x, TILE.fibres)}px ${-mod(origin.y, TILE.fibres)}px`;
  }

  destroy() {
    this.destroyed = true;
    this.map.off('move', this.onMove);
    this.map.off('moveend zoomend viewreset resize', this.onReset);
    this.edges?.remove();
  }
}
