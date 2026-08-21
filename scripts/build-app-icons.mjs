#!/usr/bin/env node
// Builds the Hexapla app icons from the master art.
//
//   node scripts/build-app-icons.mjs
//
// Source is public/Logo.png (1024x1024). The gold gem is located by its own
// colour rather than hardcoded coordinates, scaled, and composited true-centred
// on a full-bleed black square — so changing Logo.png and re-running is all a
// future logo change needs.
//
// Every target is a downscale from the master's 547px gem, so nothing is
// upscaled. Written because the icons had drifted to roughly half black margin:
// the gem filled 50.6% of the app icon and 37% of the maskable and Apple ones,
// the latter two also carrying a stray white frame.

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

// Gem height as a share of the canvas.
//
// 84% on the "any" icons keeps the hexagon's top and bottom points clear of a
// circular crop — pwa-192 doubles as the push notification icon, and Android
// circle-crops that one.
//
// 60% on the maskable icon is set by Android, not by the maskable spec. The
// spec promises a safe zone of 80% diameter, but Android hands the image to an
// adaptive icon where only the inner 72dp of 108dp survives — about 67%. A
// first attempt at 78% trusted the spec and lost its points on a real home
// screen.
//
// What has to fit is the gem's furthest pixel from centre, and that is NOT half
// its height. The gem is a pointy-top hexagon whose side vertices sit at
// roughly (W/2, H/4); with W=505 and H=547 that diagonal is longer than H/2, so
// the sides bind before the points do. assertMaskableFits() below measures it
// rather than trusting the arithmetic — 63% looked right on paper and still
// overran the safe zone by a pixel.
const TARGETS = [
  { file: 'pwa-64x64.png',                size: 64,  fill: 0.84 },
  { file: 'pwa-192x192.png',              size: 192, fill: 0.84 },
  { file: 'pwa-512x512.png',              size: 512, fill: 0.84 },
  { file: 'maskable-icon-512x512.png',    size: 512, fill: 0.60 },
  { file: 'apple-touch-icon-180x180.png', size: 180, fill: 0.86 }
];

// Android's adaptive-icon safe zone, as a share of the icon's width.
const ANDROID_SAFE_ZONE = 72 / 108;

// At favicon sizes legibility beats margin.
const FAVICON_SIZES = [16, 32, 48];
const FAVICON_FILL = 0.92;

/** Bounding box of the gold gem, found by colour so the art can move. */
async function findGem(file) {
  const { data, info } = await sharp(file).ensureAlpha().raw()
    .toBuffer({ resolveWithObject: true });
  const { width: w, height: h, channels: c } = info;
  let minX = w, minY = h, maxX = -1, maxY = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * c;
      const r = data[i], g = data[i + 1], b = data[i + 2], a = data[i + 3];
      if (a < 128) continue;
      // warm, red >= green > blue, and clearly not grey
      if (r > 90 && g > 60 && r - b > 50 && g - b > 30) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) throw new Error('no gold found in ' + file);
  return { left: minX, top: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
}

/**
 * One icon: the gem scaled so its height is `fill` of `size`, centred on opaque
 * black. The crop carries the master's own black backing, which meets the black
 * canvas seamlessly, so the gem's anti-aliased edge stays clean.
 */
async function renderIcon(gem, size, fill) {
  const scale = (size * fill) / gem.height;
  const w = Math.max(1, Math.round(gem.width * scale));
  const h = Math.max(1, Math.round(gem.height * scale));
  const layer = await sharp(SOURCE).extract(gem).resize(w, h, { fit: 'fill' }).toBuffer();
  return sharp({
    create: { width: size, height: size, channels: 3, background: { r: 0, g: 0, b: 0 } }
  })
    .composite([{ input: layer, left: Math.round((size - w) / 2), top: Math.round((size - h) / 2) }])
    // A gem this size is mostly gradient, and 24-bit RGB costs 220KB for the
    // 512 alone. A 256-colour palette is 4x smaller at a mean error of 0.56/255
    // — indistinguishable here. Do not lower it: sharp snaps anything under 256
    // down to a 16-colour palette, which bands the gold visibly.
    .png({ palette: true, colours: 256, effort: 10 })
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
    entries[e + 2] = 0;                    // palette colours
    entries[e + 3] = 0;                    // reserved
    entries.writeUInt16LE(1, e + 4);       // colour planes
    entries.writeUInt16LE(32, e + 6);      // bits per pixel
    entries.writeUInt32LE(data.length, e + 8);
    entries.writeUInt32LE(offset, e + 12);
    offset += data.length;
  });
  return Buffer.concat([header, entries, ...images.map(i => i.data)]);
}

const gem = await findGem(SOURCE);
console.log('gem located in Logo.png: ' + gem.width + 'x' + gem.height +
  ' at (' + gem.left + ',' + gem.top + ')\n');

for (const { file, size, fill } of TARGETS) {
  writeFileSync(join(PUBLIC, file), await renderIcon(gem, size, fill));
  console.log('  ' + file.padEnd(30) + (size + 'x' + size).padEnd(9) +
    'gem ' + (fill * 100).toFixed(0) + '%');
}

const images = [];
for (const size of FAVICON_SIZES) {
  images.push({ size, data: await renderIcon(gem, size, FAVICON_FILL) });
}
writeFileSync(join(PUBLIC, 'favicon.ico'), buildIco(images));
console.log('  ' + 'favicon.ico'.padEnd(30) + FAVICON_SIZES.join('/').padEnd(9) +
  'gem ' + (FAVICON_FILL * 100).toFixed(0) + '%');

/**
 * The maskable icon is the one Android crops, and getting it wrong stays
 * invisible until it reaches a home screen. Measure the furthest gold pixel
 * from the centre and fail loudly if it falls outside the safe zone.
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
      const r = data[i], g = data[i + 1], b = data[i + 2], a = data[i + 3];
      if (a < 128) continue;
      if (r > 90 && g > 60 && r - b > 50 && g - b > 30) {
        const d = Math.hypot(x - cx, y - cy);
        if (d > maxR) maxR = d;
      }
    }
  }
  const safeR = (w * ANDROID_SAFE_ZONE) / 2;
  console.log('\n  maskable: furthest gold ' + maxR.toFixed(1) + 'px vs Android safe radius ' +
    safeR.toFixed(1) + 'px -> ' + ((1 - maxR / safeR) * 100).toFixed(1) + '% margin');
  if (maxR > safeR) {
    console.error('  FAIL: the gem overruns Android\'s safe zone and will be clipped on a home screen.');
    process.exit(1);
  }
}

await assertMaskableFits('maskable-icon-512x512.png');
