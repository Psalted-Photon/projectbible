#!/usr/bin/env node
// Builds the irisBible app icons from the master art.
//
//   node scripts/build-app-icons.mjs
//
// Source is public/Logo.png (1024x1024): the iris, a full circle on a
// transparent ground. It is scaled and composited true-centered on a cream tile
// (#FFFAED, always — the home-screen icon never changes color), so changing
// Logo.png and re-running is all a future logo change needs.
//
// The "any" icons carry their own rounded corners, because Windows and desktop
// installs show the image exactly as drawn. The Apple icon stays a full-bleed
// square: iOS cuts its own shape and fills any transparent corner with black.
//
// The maskable icon's tile covers only the part Android's home screen shows
// (its inner 72/108), rounded, with nothing around it. The home screen never
// shows that outer ring, but Chrome's launch screen draws the whole image
// uncut, and a full-bleed tile there is a hard-cornered square.
//
// Also written from the same master: favicon.ico (the iris alone, no tile),
// pb-gem.png (the spinner and the email header), and the one-color
// notification badge (drawn, not traced: a slit disc with the cross cut out).

import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { writeFileSync } from 'node:fs';

let sharp;
try {
  sharp = (await import('sharp')).default;
} catch {
  console.error('This script needs sharp, which is currently only a transitive');
  console.error('dependency. If it has gone missing:  npm i -D sharp');
  process.exit(1);
}

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC = join(REPO, 'apps', 'pwa-polished', 'public');
const SOURCE = join(PUBLIC, 'Logo.png');

const CREAM = { r: 0xff, g: 0xfa, b: 0xed };

// Android's adaptive-icon safe zone, as a share of the icon's width.
const ANDROID_SAFE_ZONE = 72 / 108;

// Iris diameter as a share of the canvas.
//
// 93% on the "any" icons is the design's own tile. The iris is a circle, so it
// also survives the circular crop Android gives pwa-192, which doubles as the
// push notification icon.
//
// 62% on the maskable icon is set by Android, not by the maskable spec. The
// spec promises a safe zone of 80% diameter, but Android hands the image to an
// adaptive icon where only the inner 72dp of 108dp survives — about 67%. The
// iris is a circle, so its furthest pixel from center is simply half its
// diameter; assertMaskableFits() below measures it rather than trusting the
// arithmetic.
//
// `tile` is the rounded tile's width as a share of the canvas (1 when absent).
// On the maskable icon it is the safe zone plus a hair, so the home screen's
// own shape always lands on cream, never on the transparent ring.
const TARGETS = [
  { file: 'pwa-64x64.png',                size: 64,  fill: 0.93, rounded: true },
  { file: 'pwa-192x192.png',              size: 192, fill: 0.93, rounded: true },
  { file: 'pwa-512x512.png',              size: 512, fill: 0.93, rounded: true },
  { file: 'maskable-icon-512x512.png',    size: 512, fill: 0.62, rounded: true, tile: ANDROID_SAFE_ZONE + 0.01 },
  { file: 'apple-touch-icon-180x180.png', size: 180, fill: 0.88 }
];

// Corner radius of the rounded tile, as a share of its width. At 0.22 the
// rounded square still holds any shape a launcher inscribes in it (a squircle's
// corner reaches 84% of the way out along the diagonal; this reaches 87%).
const CORNER_RADIUS = 0.22;

// At favicon sizes legibility beats margin, and the tab supplies its own
// background, so these are the bare iris with a transparent surround.
const FAVICON_SIZES = [16, 32, 48];

/** The iris scaled to `diameter` px, transparent surround kept. */
function irisAt(diameter) {
  return sharp(SOURCE).resize(diameter, diameter, { fit: 'fill' });
}

/** One icon: the iris centered on a cream tile, square or rounded. */
async function renderIcon(size, fill, rounded, tileShare = 1) {
  const d = Math.max(1, Math.round(size * fill));
  const layer = await irisAt(d).png().toBuffer();
  const tile = await sharp({
    create: { width: size, height: size, channels: 3, background: CREAM }
  })
    .composite([{ input: layer, left: Math.round((size - d) / 2), top: Math.round((size - d) / 2) }])
    .png()
    .toBuffer();
  if (!rounded) {
    // 24-bit RGB is kept: the iris is a smooth gradient and a palette bands it.
    return sharp(tile).png({ compressionLevel: 9, effort: 10 }).toBuffer();
  }
  const w = size * tileShare;
  const at = (size - w) / 2;
  const r = w * CORNER_RADIUS;
  const mask = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">` +
    `<rect x="${at}" y="${at}" width="${w}" height="${w}" rx="${r}" ry="${r}" fill="#fff"/></svg>`
  );
  return sharp(tile)
    .ensureAlpha()
    .composite([{ input: mask, blend: 'dest-in' }])
    .png({ compressionLevel: 9, effort: 10 })
    .toBuffer();
}

/**
 * Minimal ICO container: ICONDIR, one ICONDIRENTRY per size, then the PNG data.
 * sharp can neither read nor write ICO, and this is small enough not to be
 * worth a dependency. PNG-in-ICO is understood by every current browser.
 */
function buildIco(images) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);              // reserved
  header.writeUInt16LE(1, 2);              // 1 = icon
  header.writeUInt16LE(images.length, 4);
  const entries = Buffer.alloc(16 * images.length);
  let offset = header.length + entries.length;
  images.forEach(({ size, data }, n) => {
    const e = 16 * n;
    entries[e] = size >= 256 ? 0 : size;   // 0 means 256
    entries[e + 1] = size >= 256 ? 0 : size;
    entries[e + 2] = 0;                    // palette colors
    entries[e + 3] = 0;                    // reserved
    entries.writeUInt16LE(1, e + 4);       // color planes
    entries.writeUInt16LE(32, e + 6);      // bits per pixel
    entries.writeUInt32LE(data.length, e + 8);
    entries.writeUInt32LE(offset, e + 12);
    offset += data.length;
  });
  return Buffer.concat([header, entries, ...images.map(i => i.data)]);
}

// The cross in Logo.png, measured on its 1024px canvas.
const LOGO_CROSS = {
  upright: { x: 451, y: 294, w: 121, h: 434 },
  beam:    { x: 347, y: 391, w: 330, h: 120 },
  radius: 10
};

// Radial slits cut into the badge's disc, so it reads as an iris rather than
// a plain donut. Widths are on the 96px badge and scale with it.
const BADGE_SLITS = { count: 24, from: 22 / 96, inner: 0.8 / 96, outer: 3.6 / 96 };

/**
 * The one-color iris: a disc with radial slits and the cross cut out of it,
 * drawn rather than taken from the art. The notification badge is this in
 * white (Android uses only its alpha); the launch splash draws it big in
 * `currentColor` before it turns into the color iris.
 */
function monoIrisSvg(size, fill) {
  const c = size / 2;
  const k = size / 1024;
  const rect = ({ x, y, w, h }) =>
    `<rect x="${x * k}" y="${y * k}" width="${w * k}" height="${h * k}" rx="${LOGO_CROSS.radius * k}"/>`;
  const at = (r, a) => (c + r * Math.cos(a)).toFixed(2) + ',' + (c + r * Math.sin(a)).toFixed(2);
  const { count, from, inner, outer } = BADGE_SLITS;
  const r0 = from * size;
  const r1 = c + 1;                      // run the slits out past the rim
  let slits = '';
  for (let n = 0; n < count; n++) {
    // half a step off, so no slit lines up with an arm of the cross
    const a = ((n + 0.5) / count) * 2 * Math.PI;
    const d0 = (inner * size) / 2 / r0, d1 = (outer * size) / 2 / r1;
    slits += `<polygon points="${at(r0, a - d0)} ${at(r1, a - d1)} ${at(r1, a + d1)} ${at(r0, a + d0)}"/>`;
  }
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}">` +
    `<mask id="iris-mono-cut"><circle cx="${c}" cy="${c}" r="${c - 1}" fill="#fff"/>` +
    `<g fill="#000">${slits}${rect(LOGO_CROSS.upright)}${rect(LOGO_CROSS.beam)}</g></mask>` +
    `<rect width="${size}" height="${size}" fill="${fill}" mask="url(#iris-mono-cut)"/></svg>`
  );
}

async function renderBadge(size) {
  return sharp(Buffer.from(monoIrisSvg(size, '#fff'))).png({ compressionLevel: 9 }).toBuffer();
}

/**
 * The launch splash's black-and-white iris: the art itself traced to one
 * color, so its fibers and flecks show. White wherever the art is light, cut
 * away where it is dark (the cross and the flecks); the splash tints it.
 */
async function renderMonoArt(size) {
  const { data, info } = await irisAt(size).ensureAlpha().raw()
    .toBuffer({ resolveWithObject: true });
  const out = Buffer.alloc(size * size * 4);
  for (let p = 0; p < size * size; p++) {
    const i = p * 4;
    const lum = 0.3 * data[i] + 0.59 * data[i + 1] + 0.11 * data[i + 2];
    // fully cut at lum 40 and below, fully white from 100 up
    const keep = Math.min(1, Math.max(0, (lum - 40) / 60));
    out[i] = out[i + 1] = out[i + 2] = 255;
    out[i + 3] = Math.round(data[i + 3] * keep);
  }
  return sharp(out, { raw: { width: info.width, height: info.height, channels: 4 } })
    .png({ compressionLevel: 9, effort: 10 })
    .toBuffer();
}

for (const { file, size, fill, rounded, tile } of TARGETS) {
  writeFileSync(join(PUBLIC, file), await renderIcon(size, fill, rounded, tile));
  console.log('  ' + file.padEnd(30) + (size + 'x' + size).padEnd(9) +
    'iris ' + (fill * 100).toFixed(0) + '%' + (rounded ? ', rounded' : '') +
    (tile ? ', tile ' + (tile * 100).toFixed(0) + '%' : ''));
}

const images = [];
for (const size of FAVICON_SIZES) {
  images.push({ size, data: await irisAt(size).png({ compressionLevel: 9 }).toBuffer() });
}
writeFileSync(join(PUBLIC, 'favicon.ico'), buildIco(images));
console.log('  ' + 'favicon.ico'.padEnd(30) + FAVICON_SIZES.join('/').padEnd(9) + 'iris alone');

// The spinner turns this, and the email header sits it above the wordmark.
writeFileSync(join(PUBLIC, 'pb-gem.png'), await irisAt(192).png({ compressionLevel: 9 }).toBuffer());
console.log('  ' + 'pb-gem.png'.padEnd(30) + '192x192'.padEnd(9) + 'iris alone');

writeFileSync(join(PUBLIC, 'notification-badge-96.png'), await renderBadge(96));
console.log('  ' + 'notification-badge-96.png'.padEnd(30) + '96x96'.padEnd(9) + 'one-color');

// Big enough to stay sharp at the splash's largest size on a dense screen.
writeFileSync(join(PUBLIC, 'iris-mono.png'), await renderMonoArt(768));
console.log('  ' + 'iris-mono.png'.padEnd(30) + '768x768'.padEnd(9) + 'traced art, for the splash');

/**
 * The maskable icon is the one Android crops, and getting it wrong stays
 * invisible until it reaches a home screen. Measure the furthest non-cream
 * pixel from the center and fail loudly if it falls outside the safe zone.
 */
async function assertMaskableFits(file) {
  const { data, info } = await sharp(join(PUBLIC, file)).ensureAlpha().raw()
    .toBuffer({ resolveWithObject: true });
  const { width: w, height: h, channels: c } = info;
  const cx = (w - 1) / 2, cy = (h - 1) / 2;
  let maxR = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * c;
      if (data[i + 3] < 128) continue;   // the transparent ring round the tile
      const off = Math.abs(data[i] - CREAM.r) + Math.abs(data[i + 1] - CREAM.g) + Math.abs(data[i + 2] - CREAM.b);
      if (off < 90) continue;
      const d = Math.hypot(x - cx, y - cy);
      if (d > maxR) maxR = d;
    }
  }
  const safeR = (w * ANDROID_SAFE_ZONE) / 2;
  console.log('\n  maskable: furthest iris pixel ' + maxR.toFixed(1) + 'px vs Android safe radius ' +
    safeR.toFixed(1) + 'px -> ' + ((1 - maxR / safeR) * 100).toFixed(1) + '% margin');
  if (maxR > safeR) {
    console.error('  FAIL: the iris overruns Android\'s safe zone and will be clipped on a home screen.');
    process.exit(1);
  }
}

await assertMaskableFits('maskable-icon-512x512.png');
