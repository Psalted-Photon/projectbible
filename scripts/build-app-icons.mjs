#!/usr/bin/env node
// Builds the irisBible app icons from the master art.
//
//   node scripts/build-app-icons.mjs
//
// Source is public/Logo.png (1024x1024): the iris, a full circle on a
// transparent ground. It is scaled and composited true-centered on a full-bleed
// cream square (#FFFAED, always — the home-screen icon never changes color), so
// changing Logo.png and re-running is all a future logo change needs.
//
// Also written from the same master: favicon.ico (the iris alone, no tile),
// pb-gem.png (the spinner and the email header), and the one-color
// notification badge.

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
const TARGETS = [
  { file: 'pwa-64x64.png',                size: 64,  fill: 0.93 },
  { file: 'pwa-192x192.png',              size: 192, fill: 0.93 },
  { file: 'pwa-512x512.png',              size: 512, fill: 0.93 },
  { file: 'maskable-icon-512x512.png',    size: 512, fill: 0.62 },
  { file: 'apple-touch-icon-180x180.png', size: 180, fill: 0.88 }
];

// Android's adaptive-icon safe zone, as a share of the icon's width.
const ANDROID_SAFE_ZONE = 72 / 108;

// At favicon sizes legibility beats margin, and the tab supplies its own
// background, so these are the bare iris with a transparent surround.
const FAVICON_SIZES = [16, 32, 48];

/** The iris scaled to `diameter` px, transparent surround kept. */
function irisAt(diameter) {
  return sharp(SOURCE).resize(diameter, diameter, { fit: 'fill' });
}

/** One icon: the iris centered on an opaque cream square. */
async function renderIcon(size, fill) {
  const d = Math.max(1, Math.round(size * fill));
  const layer = await irisAt(d).png().toBuffer();
  return sharp({
    create: { width: size, height: size, channels: 3, background: CREAM }
  })
    .composite([{ input: layer, left: Math.round((size - d) / 2), top: Math.round((size - d) / 2) }])
    // 24-bit RGB is kept: the iris is a smooth gradient and a palette bands it.
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

/**
 * The notification badge: Android uses only its alpha, so it is the iris as a
 * white disc with the dark cross cut out of it.
 */
async function renderBadge(size) {
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
    .png({ compressionLevel: 9 })
    .toBuffer();
}

for (const { file, size, fill } of TARGETS) {
  writeFileSync(join(PUBLIC, file), await renderIcon(size, fill));
  console.log('  ' + file.padEnd(30) + (size + 'x' + size).padEnd(9) +
    'iris ' + (fill * 100).toFixed(0) + '%');
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
