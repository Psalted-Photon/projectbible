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
    if (!this.visible) return [];

    this.layer = L.layerGroup([], { pane: this.pane }).addTo(this.map);
    const shown = this.forZoom(zoom, bounds);

    for (const p of shown) {
      // Size carries weight of attestation: Jerusalem's 955 references should
      // not look like a place mentioned once.
      const r = p.v.length > 200 ? 5 : p.v.length > 40 ? 4 : p.v.length > 5 ? 3.2 : 2.6;
      const marker = L.circleMarker([p.y, p.x], {
        pane: this.pane, radius: r,
        fillColor: '#8c4a3f', fillOpacity: 0.85,
        color: '#f4ecd8', weight: 1.2,
        interactive: true, bubblingMouseEvents: false,
      });
      marker.on('click', (e) => {
        L.DomEvent.stop(e);
        this.onOpen(p);
      });
      marker.bindTooltip(`${p.n} · ${p.v.length} verse${p.v.length === 1 ? '' : 's'}`,
        { direction: 'top', offset: [0, -5] });
      this.layer.addLayer(marker);
    }
    return shown;
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
