#!/usr/bin/env node
// The Android app's home-screen icon and launch screen, from the same master
// art as the web icons (public/Logo.png, see scripts/build-app-icons.mjs).
//
//   node apps/pwa-polished/native/build-icons.mjs
//
// Home-screen icon: an adaptive icon, cream (#FFFAED, always) behind the iris.
// The iris is 62% of the 108dp layer, as on the web's maskable icon, so it sits
// inside the 72dp Android always shows whatever shape the launcher cuts.
// Older Androids (before 8) get the rounded cream tile the web uses.
//
// Launch screen: every splash.png Capacitor generated, redrawn at its own size
// as cream with the iris in the middle, so its blue logo never flashes up
// between Android's own splash and the app's first frame.

import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import sharp from 'sharp';

const HERE = dirname(fileURLToPath(import.meta.url));
const SOURCE = join(HERE, '..', 'public', 'Logo.png');
const RES = join(HERE, 'android', 'app', 'src', 'main', 'res');
const CREAM = { r: 0xff, g: 0xfa, b: 0xed };

// dp to px for each density bucket.
const DENSITIES = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 };

const iris = (d) => sharp(SOURCE).resize(d, d, { fit: 'fill' }).png().toBuffer();

/** The iris centered on a transparent or cream canvas of w x h. */
async function irisOn(w, h, d, background) {
  const layer = await iris(d);
  return sharp({ create: { width: w, height: h, channels: 4, background } })
    .composite([{ input: layer, left: Math.round((w - d) / 2), top: Math.round((h - d) / 2) }])
    .png({ compressionLevel: 9 })
    .toBuffer();
}

/** The web's rounded cream tile with the iris at 93%, for pre-8 launchers. */
async function legacyTile(size, round) {
  const tile = await irisOn(size, size, Math.round(size * 0.93), { ...CREAM, alpha: 1 });
  const shape = round
    ? `<circle cx="${size / 2}" cy="${size / 2}" r="${size / 2}" fill="#fff"/>`
    : `<rect width="${size}" height="${size}" rx="${size * 0.22}" fill="#fff"/>`;
  const mask = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">${shape}</svg>`);
  return sharp(tile).composite([{ input: mask, blend: 'dest-in' }]).png({ compressionLevel: 9 }).toBuffer();
}

for (const [bucket, scale] of Object.entries(DENSITIES)) {
  const dir = join(RES, `mipmap-${bucket}`);
  const layer = Math.round(108 * scale);
  writeFileSync(join(dir, 'ic_launcher_foreground.png'),
    await irisOn(layer, layer, Math.round(layer * 0.62), { r: 0, g: 0, b: 0, alpha: 0 }));
  const legacy = Math.round(48 * scale);
  writeFileSync(join(dir, 'ic_launcher.png'), await legacyTile(legacy, false));
  writeFileSync(join(dir, 'ic_launcher_round.png'), await legacyTile(legacy, true));
}

writeFileSync(join(RES, 'values', 'ic_launcher_background.xml'),
  '<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="ic_launcher_background">#FFFAED</color>\n</resources>\n');

let splashes = 0;
for (const dir of readdirSync(RES).filter((d) => d.startsWith('drawable'))) {
  const file = join(RES, dir, 'splash.png');
  if (!existsSync(file)) continue;
  const { width, height } = await sharp(file).metadata();
  // About 150dp across on a phone, whatever the bucket.
  const d = Math.round(Math.min(width, height) * 0.3);
  writeFileSync(file, await irisOn(width, height, d, { ...CREAM, alpha: 1 }));
  splashes++;
}

// Notification icon for the Auto-Read Alarm and reminders: the one-color iris
// the web's notifications use (public/notification-badge-96.png), 24dp in
// each bucket. Android draws it in a single color, from its shape alone.
const BADGE = join(HERE, '..', 'public', 'notification-badge-96.png');
for (const [bucket, scale] of Object.entries(DENSITIES)) {
  const dir = join(RES, `drawable-${bucket}`);
  mkdirSync(dir, { recursive: true });
  const px = Math.round(24 * scale);
  writeFileSync(join(dir, 'ic_notification.png'),
    await sharp(BADGE).resize(px, px).png({ compressionLevel: 9 }).toBuffer());
}

console.log(`Icons written for ${Object.keys(DENSITIES).length} densities, ${splashes} launch screens redrawn.`);
