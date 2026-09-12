/**
 * Label placement — keeping dense lettering legible.
 *
 * Every name on the map, from any source, goes through one pass. That matters:
 * the basemap's country names and the timeline overlay's land names compete for
 * the same pixels, so placing them separately guarantees they collide with each
 * other however careful each pass is on its own.
 *
 * The method is the usual cartographic one. Measure each label, sort by how much
 * it deserves the space, then place them one at a time: a name takes the first
 * candidate position that doesn't overlap anything already placed, and is
 * dropped if none is free. Dropping is a feature — a map that shows fewer names
 * legibly beats one that shows every name in a pile.
 */
import L from 'leaflet';

/** Type styles, mirroring the CSS so measurement matches what renders. */
const TYPE = {
  country: { size: 12,   weight: 600, style: 'normal', tracking: 0.16, caps: true },
  sea:     { size: 11.5, weight: 400, style: 'italic', tracking: 0.20, caps: true },
  land:    { size: 13,   weight: 600, style: 'normal', tracking: 0.16, caps: true },
  terrain: { size: 10.5, weight: 400, style: 'italic', tracking: 0.13, caps: true },
  city:    { size: 11.5, weight: 500, style: 'normal', tracking: 0.01, caps: false },
  ancient: { size: 11.5, weight: 500, style: 'normal', tracking: 0.18, caps: true },
  people:  { size: 11,   weight: 500, style: 'italic', tracking: 0.14, caps: false },
  peak:    { size: 11,   weight: 400, style: 'normal', tracking: 0.02, caps: false },
  biblical: { size: 12, weight: 600, style: 'normal', tracking: 0.03, caps: false },
  journey:  { size: 11.5, weight: 600, style: 'normal', tracking: 0.02, caps: false },
  'water-point': { size: 11, weight: 400, style: 'italic', tracking: 0.02, caps: false },
};

const SERIF = '"Iowan Old Style", "Palatino Linotype", Palatino, Georgia, serif';

/** Breathing room between two labels, in pixels. */
const GAP = 3;

/** A place's dot, when the caller doesn't size it. */
const DOT_RADIUS = 2.7;
const DOT_STROKE = 1.1;

/**
 * Where a label may sit relative to its anchor.
 *
 * Area names want to sit on the middle of their shape and have little freedom.
 * A town is a dot with a name beside it, so the name can go round the clock
 * until it finds room — that freedom is what keeps dense clusters readable.
 */
const CANDIDATES = {
  area: [[0, 0], [0, -13], [0, 13]],
  point: [
    [9, 1], [-9, 1], [0, -11], [0, 12],
    [8, -9], [-8, -9], [8, 10], [-8, 10],
    [17, 1], [-17, 1],
  ],
};

export class LabelEngine {
  constructor(map) {
    this.map = map;
    this.canvas = document.createElement('canvas').getContext('2d');
    this.groups = new Map();
    this.candidates = [];
    /**
     * Asked before a name with a dot is placed: would a dot this size here
     * touch one that outranks it? If so the whole place is left off, since a
     * name beside someone else's dot reads as a mislabel.
     * @type {((lat: number, lon: number, radius: number) => boolean) | null}
     */
    this.avoid = null;
  }

  /** One Leaflet layer group per pane, reused across passes. */
  group(pane) {
    if (!this.groups.has(pane)) {
      const g = L.layerGroup([], { pane });
      this.groups.set(pane, g);
    }
    return this.groups.get(pane);
  }

  reset() {
    this.candidates = [];
    for (const g of this.groups.values()) g.clearLayers();
  }

  detach() {
    for (const g of this.groups.values()) this.map.removeLayer(g);
  }

  /**
   * Offer a name for placement.
   *
   * `priority` decides who wins a contested spot — bigger wins. `dot` draws a
   * marker for the place, and is only drawn if the name itself finds room, so
   * the map never shows an unexplained speck.
   */
  add({ lat, lon, text, kind, pane = 'labels', priority = 0, shape = 'area', dot = null, colour = null }) {
    if (!text) return;
    this.candidates.push({ lat, lon, text, kind, pane, priority, shape, dot, colour });
  }

  measure(text, kind) {
    const t = TYPE[kind] ?? TYPE.city;
    const shown = t.caps ? text.toUpperCase() : text;
    this.canvas.font = `${t.style} ${t.weight} ${t.size}px ${SERIF}`;
    // Canvas ignores letter-spacing, so add it back: n-1 gaps of tracking em.
    const tracking = Math.max(0, shown.length - 1) * t.tracking * t.size;
    return {
      w: this.canvas.measureText(shown).width + tracking,
      h: t.size * 1.25,
    };
  }

  /**
   * Place everything that fits, drop the rest.
   *
   * A uniform grid keeps the overlap test cheap: a label only ever compares
   * itself against labels in the cells it touches, rather than every label
   * already on the map.
   */
  render() {
    const size = this.map.getSize();
    const pad = 40;                       // let names just off-screen still reserve space
    const cell = 64;
    const grid = new Map();
    const key = (cx, cy) => `${cx}:${cy}`;

    const cellsFor = (box) => {
      const out = [];
      for (let cx = Math.floor(box.x0 / cell); cx <= Math.floor(box.x1 / cell); cx++) {
        for (let cy = Math.floor(box.y0 / cell); cy <= Math.floor(box.y1 / cell); cy++) {
          out.push(key(cx, cy));
        }
      }
      return out;
    };

    const collides = (box) => {
      for (const k of cellsFor(box)) {
        const bucket = grid.get(k);
        if (!bucket) continue;
        for (const other of bucket) {
          if (box.x0 < other.x1 && box.x1 > other.x0 &&
              box.y0 < other.y1 && box.y1 > other.y0) return true;
        }
      }
      return false;
    };

    const occupy = (box) => {
      for (const k of cellsFor(box)) {
        if (!grid.has(k)) grid.set(k, []);
        grid.get(k).push(box);
      }
    };

    // Most deserving first: whoever is placed early keeps the best position.
    const ordered = [...this.candidates].sort((a, b) => b.priority - a.priority);

    let placed = 0;
    let dropped = 0;

    for (const c of ordered) {
      const pt = this.map.latLngToContainerPoint([c.lat, c.lon]);
      if (pt.x < -pad || pt.y < -pad || pt.x > size.x + pad || pt.y > size.y + pad) continue;
      if (c.dot && this.avoid?.(c.lat, c.lon, (c.dot.radius ?? DOT_RADIUS) + DOT_STROKE / 2)) continue;

      const { w, h } = this.measure(c.text, c.kind);
      let chosen = null;

      for (const [dx, dy] of CANDIDATES[c.shape] ?? CANDIDATES.area) {
        const cx = pt.x + dx;
        const cy = pt.y + dy;
        const box = {
          x0: cx - w / 2 - GAP, x1: cx + w / 2 + GAP,
          y0: cy - h / 2 - GAP, y1: cy + h / 2 + GAP,
        };
        if (collides(box)) continue;
        chosen = { dx, dy, box, w, h };
        break;
      }

      if (!chosen) { dropped++; continue; }

      occupy(chosen.box);
      placed++;

      const group = this.group(c.pane);

      if (c.dot) {
        group.addLayer(L.circleMarker([c.lat, c.lon], {
          pane: c.pane, radius: c.dot.radius ?? DOT_RADIUS,
          fillColor: c.dot.fill, fillOpacity: 0.9,
          color: c.dot.stroke, weight: DOT_STROKE, interactive: false,
        }));
      }

      // Explicit size and anchor put the rendered box exactly where the
      // collision test said it would be.
      group.addLayer(L.marker([c.lat, c.lon], {
        pane: c.pane,
        interactive: false,
        icon: L.divIcon({
          className: `map-label ${c.kind}`,
          html: c.colour ? `<span style="color:${c.colour}">${c.text}</span>` : c.text,
          iconSize: [chosen.w, chosen.h],
          iconAnchor: [chosen.w / 2 - chosen.dx, chosen.h / 2 - chosen.dy],
        }),
      }));
    }

    for (const g of this.groups.values()) if (!this.map.hasLayer(g)) g.addTo(this.map);

    return { placed, dropped };
  }
}
