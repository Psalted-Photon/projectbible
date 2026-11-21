#!/usr/bin/env node
// Puts the newest release APK on GitHub Releases and tells irisbible.com.
//
//   node apps/pwa-polished/native/publish-android.mjs [--notes "What's new"]
//
// Run after `build-android.mjs --release` (and after trying that APK on a
// phone): it publishes exactly the file in native/release/, never a new build.
//
//  1. Creates the GitHub release android-<version> on this repository with
//     the APK attached (public, free, up to 2 GB a file). It is never marked
//     "Latest", so the pack release keeps that label.
//  2. Checks the APK downloads from there, byte for byte the right size.
//  3. Writes apps/pwa-polished/public/android/version.json, which the app's
//     update check (src/lib/android/appUpdate.ts) and the download page
//     (public/android/index.html) both read.
//
// Nothing is live until that file is: commit it and "push live".

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const NATIVE = dirname(fileURLToPath(import.meta.url));
const APP = join(NATIVE, '..');
const RELEASE_DIR = join(NATIVE, 'release');
const VERSION_FILE = join(APP, 'public', 'android', 'version.json');

const argv = process.argv.slice(2);
const notesAt = argv.indexOf('--notes');
const NOTES = notesAt >= 0 ? String(argv[notesAt + 1] ?? '').trim() : '';

function fail(message) {
  console.error(`\n✗ ${message}`);
  process.exit(1);
}

function gh(args, opts = {}) {
  return execFileSync('gh', args, { encoding: 'utf8', ...opts });
}

const releaseFile = join(RELEASE_DIR, 'release.json');
if (!existsSync(releaseFile)) fail('No release build in native/release. Run build-android.mjs --release first.');
const release = JSON.parse(readFileSync(releaseFile, 'utf8'));
const apkPath = join(RELEASE_DIR, release.apk.file);
if (!existsSync(apkPath) || statSync(apkPath).size !== release.apk.bytes) {
  fail(`${release.apk.file} is missing or has changed since it was built. Build it again.`);
}

try {
  const live = JSON.parse(readFileSync(VERSION_FILE, 'utf8'));
  if (Number(live.versionCode) >= release.versionCode) {
    fail(`${release.versionName} is not newer than ${live.versionName}, which is already published.`);
  }
} catch (error) {
  if (error?.code !== 'ENOENT') throw error;
}

try {
  gh(['auth', 'status'], { stdio: 'ignore' });
} catch {
  fail('The GitHub command line (gh) is not signed in. Run: gh auth login');
}

const repo = gh(['repo', 'view', '--json', 'nameWithOwner', '--jq', '.nameWithOwner']).trim();
const tag = `android-${release.versionName}`;
let exists = true;
try {
  gh(['release', 'view', tag], { stdio: 'ignore' });
} catch {
  exists = false;
}
if (exists) fail(`GitHub already has a release called ${tag}.`);

const pageUrl = 'https://irisbible.com/android';
const body = [
  `irisBible for Android, version ${release.versionName}.`,
  '',
  `Download ${release.apk.file} on an Android phone and open it. Every Bible, voice and tool comes inside, so after it's installed it needs no internet.`,
  '',
  `Install steps: ${pageUrl}`,
  ...(NOTES ? ['', "What's new:", NOTES] : []),
  '',
  `SHA-256: ${release.apk.sha256}`,
].join('\n');

console.log(`▶ Creating ${tag} on ${repo} and uploading ${(release.apk.bytes / 1024 / 1024).toFixed(0)} MB (this takes a while)`);
gh(
  ['release', 'create', tag, apkPath, '--title', `irisBible for Android ${release.versionName}`, '--notes', body, '--latest=false'],
  { stdio: 'inherit' },
);

const url = `https://github.com/${repo}/releases/download/${tag}/${encodeURIComponent(release.apk.file)}`;
console.log('▶ Checking it downloads');
// A plain download, stopped once its headers arrive: GitHub's file servers
// sign their links for downloading, which a HEAD request may not match.
const controller = new AbortController();
const response = await fetch(url, { redirect: 'follow', signal: controller.signal });
const size = Number(response.headers.get('content-length'));
controller.abort();
if (!response.ok || size !== release.apk.bytes) {
  fail(`The uploaded APK doesn't check out (status ${response.status}, ${size} bytes). The release is on GitHub; version.json was not written.`);
}

const published = {
  versionCode: release.versionCode,
  versionName: release.versionName,
  published: new Date().toISOString().slice(0, 10),
  ...(NOTES ? { notes: NOTES } : {}),
  apk: { url, bytes: release.apk.bytes, sha256: release.apk.sha256 },
  // Capacitor 8's lowest: Android 7.
  minAndroid: '7.0',
};
mkdirSync(dirname(VERSION_FILE), { recursive: true });
writeFileSync(VERSION_FILE, `${JSON.stringify(published, null, 2)}\n`);

console.log(`\n✓ Published ${release.versionName}`);
console.log(`  ${url}`);
console.log('  Wrote apps/pwa-polished/public/android/version.json. Commit it and push live,');
console.log('  and the download page and every installed app see the new version.');
