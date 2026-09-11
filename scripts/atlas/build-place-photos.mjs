#!/usr/bin/env node
/**
 * Photographs for the places Scripture names.
 *
 * OpenBible catalogues a photograph for almost every biblical site — 2,423 of
 * them, mostly from Wikimedia — and the app has never used one. A tap on
 * Bethlehem should show you the place, not only tell you about it.
 *
 * Nothing is downloaded. Wikimedia serves resized copies, so the pack carries
 * URLs rather than pictures and stays a few tens of kilobytes instead of tens
 * of megabytes. That does mean photographs need a connection, which is the same
 * bargain the tile basemaps already make; the drawn map still works offline.
 *
 * Sizes are not free choices. Wikimedia stopped serving arbitrary widths and
 * now allows a fixed set — 120, 250, 330, 500 and 1280 are served, 400 and 800
 * are refused — so those are the two picked here rather than round numbers.
 *
 * Every photograph carries its photographer and licence, which is what CC BY-SA
 * asks for and what the viewer shows under the picture.
 */
import fs from 'fs';
import path from 'path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, '$1'), '../..');
const SRC = path.join(ROOT, 'data-sources/openbible/data');
const OUT = path.join(ROOT, 'apps/pwa-polished/public/atlas');

/** Widths Wikimedia will actually serve. */
const THUMB_PX = 330;
const FULL_PX = 1280;

const lines = (file) => fs.readFileSync(path.join(SRC, file), 'utf8').split('\n').filter((l) => l.trim());

// ------------------------------------------------------------- the images

const images = new Map();
for (const line of lines('image.jsonl')) {
  const d = JSON.parse(line);
  if (!d.id || !d.thumbnail_url_pattern) continue;
  images.set(d.id, d);
}
console.log(`${images.size} images catalogued`);

// --------------------------------------------------- best photo per place

/**
 * Which thumbnail belongs to a place.
 *
 * OpenBible's own advice: prefer the one on the ancient place itself, then the
 * identification, then the resolution — the higher it sits, the more it is
 * about the place rather than about one candidate location for it.
 */
function thumbnailFor(place) {
  if (place.media?.thumbnail) return place.media.thumbnail;
  for (const ident of place.identifications ?? []) {
    if (ident.media?.thumbnail) return ident.media.thumbnail;
    for (const res of ident.resolutions ?? []) {
      if (res.media?.thumbnail) return res.media.thumbnail;
    }
  }
  return null;
}

/** Strip the <modern id="..."> markup OpenBible uses inside descriptions. */
const plain = (text) => String(text ?? '').replace(/<[^>]*>/g, '').trim();

const byFriendlyId = new Map();
let places = 0;
for (const line of lines('ancient.jsonl')) {
  const d = JSON.parse(line);
  places++;
  const thumb = thumbnailFor(d);
  if (!thumb?.image_id) continue;

  const img = images.get(thumb.image_id);
  if (!img) continue;

  byFriendlyId.set(d.friendly_id, {
    // thumbnail and full-size, both from Wikimedia's resizer
    t: img.thumbnail_url_pattern.replace('####', String(THUMB_PX)),
    f: img.thumbnail_url_pattern.replace('####', String(FULL_PX)),
    a: img.author || thumb.credit || '',
    l: img.license || '',
    // The page the picture came from. A link in the caption, never a redirect.
    u: img.url || thumb.credit_url || '',
    d: plain(thumb.description || Object.values(img.descriptions ?? {})[0] || ''),
    // Average colours, so the space holds its shape before the picture lands.
    p: thumb.placeholder || '',
  });
}
console.log(`${byFriendlyId.size} of ${places} ancient places have a photograph`);

// ------------------------------------------ join to the map's own places

const biblical = JSON.parse(fs.readFileSync(path.join(OUT, 'biblical-places.json'), 'utf8'));

/** OpenBible disambiguates with a trailing number; ISBE doesn't. */
const candidates = (name) => [name, `${name} 1`, `${name} 2`];

const out = {};
for (const p of biblical) {
  for (const key of candidates(p.id)) {
    const photo = byFriendlyId.get(key);
    if (photo) { out[p.id] = photo; break; }
  }
}

const json = JSON.stringify(out);
fs.writeFileSync(path.join(OUT, 'place-photos.json'), json);

const indexPath = path.join(OUT, 'index.json');
const index = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
index.placePhotos = { file: 'place-photos.json', count: Object.keys(out).length };
fs.writeFileSync(indexPath, JSON.stringify(index, null, 1));

const covered = Object.keys(out).length;
console.log(`matched       ${covered} of ${biblical.length} map places (${Math.round(covered / biblical.length * 100)}%)`);
console.log(`size          ${(json.length / 1e6).toFixed(2)} MB`);
// Places are keyed by id, which carries OpenBible's disambiguating number —
// the Judean Bethlehem is "Bethlehem 1" — so a sample has to look up the id.
const sample = ['Bethlehem 1', 'Capernaum', 'Jerusalem', 'Nazareth', 'Golgotha', 'Jericho 1'];
for (const key of sample) {
  const p = out[key];
  console.log(`  ${key.padEnd(14)} ${p ? `${p.a || 'unattributed'} · ${p.l}` : 'no photograph'}`);
}

/**
 * The rest have satellite imagery or a street view rather than a photograph.
 * Those are skipped: the map already offers a satellite basemap, and a picture
 * of a roof from orbit is not what a tap on Bethlehem should answer with.
 */
const satellite = biblical.length - covered;
console.log(`without       ${satellite} places have no photograph (satellite or street view only)`);
