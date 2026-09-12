/**
 * Biblical places, and what happens when you tap the map.
 *
 * The reader already hands off to the map. This is the return trip: tap
 * Bethlehem and get its Scripture, its encyclopedia article, and a way back
 * into the reader at any of the verses.
 *
 * Tapping empty ground answers too. It asks every live overlay what sits under
 * the point, then falls back to the nearest named place, so a tap in the hills
 * south of Jerusalem still says where you are rather than doing nothing.
 */
import L from 'leaflet';

/** Books in canonical order, so a verse list reads the way a Bible does. */
const BOOK_ORDER = [
  'Gen', 'Exod', 'Lev', 'Num', 'Deut', 'Josh', 'Judg', 'Ruth', '1Sam', '2Sam',
  '1Kgs', '2Kgs', '1Chr', '2Chr', 'Ezra', 'Neh', 'Esth', 'Job', 'Ps', 'Prov',
  'Eccl', 'Song', 'Isa', 'Jer', 'Lam', 'Ezek', 'Dan', 'Hos', 'Joel', 'Amos',
  'Obad', 'Jonah', 'Mic', 'Nah', 'Hab', 'Zeph', 'Hag', 'Zech', 'Mal',
  'Matt', 'Mark', 'Luke', 'John', 'Acts', 'Rom', '1Cor', '2Cor', 'Gal', 'Eph',
  'Phil', 'Col', '1Thess', '2Thess', '1Tim', '2Tim', 'Titus', 'Phlm', 'Heb',
  'Jas', '1Pet', '2Pet', '1John', '2John', '3John', 'Jude', 'Rev',
];
const ORDER = new Map(BOOK_ORDER.map((b, i) => [b, i]));

/** Great-circle distance in kilometres. */
export function haversine(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const rad = Math.PI / 180;
  const dLat = (lat2 - lat1) * rad;
  const dLon = (lon2 - lon1) * rad;
  const a = Math.sin(dLat / 2) ** 2 +
            Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

/**
 * Dot size by weight of attestation, in seven even steps.
 *
 * The smallest step sits just above the largest of the map's other dots (the
 * gazetteer's 3.4 for a city of a hundred thousand), so a place Scripture names
 * never looks smaller than a modern one. The largest is not quite double.
 *
 * Where each step starts was read off the data rather than spaced evenly in
 * verses. Of 1,278 places, 618 are named once and four more than two hundred
 * times, so even spacing in verses would have put nearly every dot in the
 * smallest step, and an even share of places per step would have drawn a
 * village named in 22 verses the same size as Jerusalem. These give 618, 216,
 * 169, 136, 88, 40 and 11 places, and the last step is the eleven places named
 * a hundred times or more.
 */
const STEP_RADII = [3.5, 4, 4.5, 5, 5.5, 6, 6.5];
const STEP_FROM = [1, 2, 3, 5, 10, 25, 100];
const MIN_RADIUS = STEP_RADII[0];
const STROKE = 1.2;
/** Clear space between the edges of two dots, in pixels. */
const DOT_GAP = 1;
/** Neighbour lookups only ever need to reach one dot-pair away. */
const CELL = Math.ceil(STEP_RADII[STEP_RADII.length - 1] * 2 + STROKE + DOT_GAP);

function radiusFor(verses) {
  let i = 0;
  while (i + 1 < STEP_FROM.length && verses >= STEP_FROM[i + 1]) i++;
  return STEP_RADII[i];
}

/**
 * The biblical places layer.
 *
 * Kept separate from the timeline so tapping works with no overlay switched on —
 * these places exist in every era, which is the point of them.
 */
export class BiblicalPlaces {
  constructor(map, { places, pane = 'pins' }) {
    this.map = map;
    this.places = places;
    this.pane = pane;
    this.layer = null;
    this.visible = false;
    this.onOpen = () => {};
    /** A tap on a dot. The full map swaps this for its chooser. */
    this.onTap = (_e, place) => this.onOpen(place);
    /**
     * The dots as drawn, in world pixels at the zoom they were sized for. World
     * pixels rather than screen ones because a pan moves the screen under them
     * but leaves every distance between two dots exactly as it was.
     */
    this.dots = [];
    this.dotZoom = 0;
    this.grid = new Map();
  }

  /** Places worth drawing at this zoom, most-referenced first. */
  forZoom(zoom, bounds) {
    const cap = zoom < 5 ? 40 : zoom < 7 ? 120 : zoom < 9 ? 320 : 900;
    const out = [];
    for (const p of this.places) {
      if (!bounds.contains([p.y, p.x])) continue;
      out.push(p);
      if (out.length >= cap) break;
    }
    return out;
  }

  draw(zoom, bounds) {
    if (this.layer) this.map.removeLayer(this.layer);
    this.layer = null;
    this.dots = [];
    this.grid = new Map();
    if (!this.visible) return [];

    this.layer = L.layerGroup([], { pane: this.pane }).addTo(this.map);
    const shown = this.forZoom(zoom, bounds);
    this.dotZoom = zoom;
    this.fit(shown);

    for (const dot of this.dots) {
      const p = dot.place;
      const marker = L.circleMarker([p.y, p.x], {
        pane: this.pane, radius: dot.r,
        fillColor: '#8c4a3f', fillOpacity: 0.85,
        color: '#f4ecd8', weight: STROKE,
        interactive: true, bubblingMouseEvents: false,
      });
      marker.on('click', (e) => {
        L.DomEvent.stop(e);
        this.onTap(e, p);
      });
      marker.bindTooltip(`${p.n} · ${p.v.length} verse${p.v.length === 1 ? '' : 's'}`,
        { direction: 'top', offset: [0, -5] });
      this.layer.addLayer(marker);
    }
    return shown;
  }

  /**
   * Size every dot so none of them touches another.
   *
   * Places come most-referenced first, so each one is sized against the dots
   * already down and shrinks to clear them. It also leaves room for every
   * lesser neighbour still to come at the smallest size, so a well-attested
   * place can never crowd a village off the map. Nothing goes below the
   * smallest step: two places close enough to collide even then are a zoom
   * away from coming apart.
   */
  fit(shown) {
    const pts = shown.map((p) => this.map.project([p.y, p.x], this.dotZoom));

    // Every place in view goes in the grid first, so a dot can see the lesser
    // neighbours it has to leave room for as well as the ones already sized.
    const grid = new Map();
    pts.forEach((pt, i) => {
      const k = `${Math.floor(pt.x / CELL)}:${Math.floor(pt.y / CELL)}`;
      if (!grid.has(k)) grid.set(k, []);
      grid.get(k).push(i);
    });

    const radii = new Array(shown.length);
    shown.forEach((p, i) => {
      let r = radiusFor(p.v.length);
      const cx = Math.floor(pts[i].x / CELL);
      const cy = Math.floor(pts[i].y / CELL);
      for (let gx = cx - 1; gx <= cx + 1; gx++) {
        for (let gy = cy - 1; gy <= cy + 1; gy++) {
          for (const j of grid.get(`${gx}:${gy}`) ?? []) {
            if (j === i) continue;
            const d = pts[i].distanceTo(pts[j]);
            const other = j < i ? radii[j] : MIN_RADIUS;
            r = Math.min(r, d - other - STROKE - DOT_GAP);
          }
        }
      }
      radii[i] = Math.max(MIN_RADIUS, r);
    });

    this.dots = shown.map((place, i) => ({ place, x: pts[i].x, y: pts[i].y, r: radii[i] }));
    this.grid = grid;
  }

  /** Dots near a world-pixel point, at the zoom they were sized for. */
  *around(pt) {
    const cx = Math.floor(pt.x / CELL);
    const cy = Math.floor(pt.y / CELL);
    for (let gx = cx - 1; gx <= cx + 1; gx++) {
      for (let gy = cy - 1; gy <= cy + 1; gy++) {
        for (const i of this.grid.get(`${gx}:${gy}`) ?? []) yield this.dots[i];
      }
    }
  }

  /**
   * Would a dot of this radius here touch one of these?
   *
   * The map's other dots ask before they draw. A modern town sitting under a
   * place Scripture names is the same spot twice, and the biblical dot is the
   * one that answers a tap, so the other one steps aside.
   */
  touches(lat, lon, radius) {
    if (!this.dots.length) return false;
    const pt = this.map.project([lat, lon], this.dotZoom);
    for (const dot of this.around(pt)) {
      if (pt.distanceTo(dot) < dot.r + STROKE / 2 + radius + DOT_GAP) return true;
    }
    return false;
  }

  /**
   * Every dot within `slop` pixels of a point, measured from the dot's edge
   * rather than its centre, so a big dot is as easy to hit as it looks.
   * Nearest first.
   */
  near(lat, lon, slop) {
    if (!this.dots.length) return [];
    const pt = this.map.project([lat, lon], this.dotZoom);
    const out = [];
    const reach = Math.ceil(slop / CELL);
    const cx = Math.floor(pt.x / CELL);
    const cy = Math.floor(pt.y / CELL);
    for (let gx = cx - 1 - reach; gx <= cx + 1 + reach; gx++) {
      for (let gy = cy - 1 - reach; gy <= cy + 1 + reach; gy++) {
        for (const i of this.grid.get(`${gx}:${gy}`) ?? []) {
          const dot = this.dots[i];
          const edge = pt.distanceTo(dot) - dot.r - STROKE / 2;
          if (edge <= slop) out.push({ place: dot.place, edge });
        }
      }
    }
    return out.sort((a, b) => a.edge - b.edge || b.place.v.length - a.place.v.length);
  }

  /** Nearest biblical place to a point, if one is close enough to mean it. */
  nearest(lat, lon, maxKm = 60) {
    let best = null;
    for (const p of this.places) {
      const km = haversine(lat, lon, p.y, p.x);
      if (!best || km < best.km) best = { km, place: p };
    }
    return best && best.km <= maxKm ? best : null;
  }
}

/**
 * Group a place's references by book, in canonical order.
 *
 * Same shape the word study, the encyclopedia and Nave's use, so a verse list
 * reads identically wherever you meet one in the app.
 */
export function groupByBook(verses) {
  const byBook = new Map();
  for (const [readable, osis] of verses) {
    const book = osis.split('.')[0];
    if (!byBook.has(book)) byBook.set(book, []);
    byBook.get(book).push({ readable, osis });
  }
  return [...byBook.entries()]
    .sort((a, b) => (ORDER.get(a[0]) ?? 999) - (ORDER.get(b[0]) ?? 999))
    .map(([book, refs]) => ({ book, refs }));
}

/** Readable book name from an OSIS abbreviation, for the group headings. */
const BOOK_NAMES = {
  Gen: 'Genesis', Exod: 'Exodus', Lev: 'Leviticus', Num: 'Numbers',
  Deut: 'Deuteronomy', Josh: 'Joshua', Judg: 'Judges', Ruth: 'Ruth',
  '1Sam': '1 Samuel', '2Sam': '2 Samuel', '1Kgs': '1 Kings', '2Kgs': '2 Kings',
  '1Chr': '1 Chronicles', '2Chr': '2 Chronicles', Ezra: 'Ezra', Neh: 'Nehemiah',
  Esth: 'Esther', Job: 'Job', Ps: 'Psalms', Prov: 'Proverbs',
  Eccl: 'Ecclesiastes', Song: 'Song of Songs', Isa: 'Isaiah', Jer: 'Jeremiah',
  Lam: 'Lamentations', Ezek: 'Ezekiel', Dan: 'Daniel', Hos: 'Hosea',
  Joel: 'Joel', Amos: 'Amos', Obad: 'Obadiah', Jonah: 'Jonah', Mic: 'Micah',
  Nah: 'Nahum', Hab: 'Habakkuk', Zeph: 'Zephaniah', Hag: 'Haggai',
  Zech: 'Zechariah', Mal: 'Malachi', Matt: 'Matthew', Mark: 'Mark',
  Luke: 'Luke', John: 'John', Acts: 'Acts', Rom: 'Romans',
  '1Cor': '1 Corinthians', '2Cor': '2 Corinthians', Gal: 'Galatians',
  Eph: 'Ephesians', Phil: 'Philippians', Col: 'Colossians',
  '1Thess': '1 Thessalonians', '2Thess': '2 Thessalonians', '1Tim': '1 Timothy',
  '2Tim': '2 Timothy', Titus: 'Titus', Phlm: 'Philemon', Heb: 'Hebrews',
  Jas: 'James', '1Pet': '1 Peter', '2Pet': '2 Peter', '1John': '1 John',
  '2John': '2 John', '3John': '3 John', Jude: 'Jude', Rev: 'Revelation',
};
export const bookName = (osisBook) => BOOK_NAMES[osisBook] ?? osisBook;
