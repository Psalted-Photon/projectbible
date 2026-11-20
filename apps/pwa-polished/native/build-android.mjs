#!/usr/bin/env node
// Builds the Android app and, with --install, puts it on the phone over USB.
//
//   node apps/pwa-polished/native/build-android.mjs [--install] [--fresh] [--skip-web]
//
//   --install   install on the first phone adb sees (emulators are skipped)
//   --fresh     uninstall first, so the app starts with no saved data at all
//   --skip-web  reuse the web app already copied into the Android project
//
// Steps: the app is built in its Android mode (core, then `npm run
// build:android`, NODE_ENV=production; see src/lib/platform.ts for what that
// changes), Capacitor copies dist/ into the Android project, the
// packs are copied in beside it, and Gradle builds a debug APK. dist/ is
// removed afterwards; the Android project keeps its own copy.
//
// Packs (Phase 0): the web app asks for /api/packs/<file>. Inside the app the
// page runs at https://localhost, and Capacitor answers https://localhost/...
// from the APK's assets/public folder, so packs placed at
// assets/public/api/packs/ are found with no change to the app's code and no
// internet. A file that is not there gets a 404, as a missing pack should.

import { execFileSync, execSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const args = new Set(process.argv.slice(2));
const INSTALL = args.has('--install') || args.has('--fresh');
const FRESH = args.has('--fresh');
const SKIP_WEB = args.has('--skip-web');

const NATIVE = dirname(fileURLToPath(import.meta.url));
const APP = join(NATIVE, '..');
const REPO = join(APP, '..', '..');
const ANDROID = join(NATIVE, 'android');
const PUBLIC_ASSETS = join(ANDROID, 'app', 'src', 'main', 'assets', 'public');
const PACKS_SRC = join(REPO, 'packs', 'consolidated');
const PACKS_DEST = join(PUBLIC_ASSETS, 'api', 'packs');
const APK = join(ANDROID, 'app', 'build', 'outputs', 'apk', 'debug', 'app-debug.apk');
const APP_ID = 'com.irisbible.app';

// Gradle 8 cannot run on Java 25 (this PC's default), so it gets Android
// Studio's own Java 21, and the SDK Android Studio installed.
const SDK = process.env.ANDROID_HOME || join(process.env.LOCALAPPDATA ?? '', 'Android', 'Sdk');
const JBR = [
  process.env.ANDROID_JAVA_HOME,
  'C:\\Program Files\\Android\\Android Studio\\jbr',
].find((p) => p && existsSync(join(p, 'bin', 'java.exe')));
if (!JBR) fail("Could not find Android Studio's Java (C:\\Program Files\\Android\\Android Studio\\jbr).");
if (!existsSync(SDK)) fail(`Could not find the Android SDK at ${SDK}.`);
const ADB = join(SDK, 'platform-tools', 'adb.exe');
const env = { ...process.env, JAVA_HOME: JBR, ANDROID_HOME: SDK, ANDROID_SDK_ROOT: SDK };

function fail(message) {
  console.error(`\n✗ ${message}`);
  process.exit(1);
}

function step(label) {
  console.log(`\n▶ ${label}`);
  return Date.now();
}

function done(started) {
  console.log(`  done in ${((Date.now() - started) / 1000).toFixed(0)} s`);
}

function run(command, cwd, extraEnv = {}) {
  execSync(command, { cwd, stdio: 'inherit', env: { ...env, ...extraEnv } });
}

const mb = (bytes) => `${(bytes / 1024 / 1024).toFixed(0)} MB`;

if (!SKIP_WEB) {
  let t = step('Building the app (Android mode)');
  run('npm run build --workspace=@projectbible/core', REPO, { NODE_ENV: 'production' });
  run('npm run build:android', APP, { NODE_ENV: 'production' });
  done(t);

  t = step('Copying the web app into the Android project');
  run('npx cap sync android', NATIVE);
  rmSync(join(APP, 'dist'), { recursive: true, force: true });
  done(t);
} else if (!existsSync(join(PUBLIC_ASSETS, 'index.html'))) {
  fail('--skip-web needs a web app already in the Android project; run once without it.');
}

{
  const t = step('Copying the packs into the Android project');
  const manifestFile = join(PACKS_SRC, 'manifest.json');
  if (!existsSync(manifestFile)) fail(`No pack manifest at ${manifestFile}.`);
  const manifest = JSON.parse(readFileSync(manifestFile, 'utf8'));
  mkdirSync(PACKS_DEST, { recursive: true });
  copyFileSync(manifestFile, join(PACKS_DEST, 'manifest.json'));
  let total = 0;
  const missing = [];
  for (const pack of manifest.packs ?? []) {
    const file = basename(String(pack.downloadUrl ?? ''));
    const src = join(PACKS_SRC, file);
    if (!file || !existsSync(src)) {
      missing.push(pack.id);
      continue;
    }
    const dest = join(PACKS_DEST, file);
    const size = statSync(src).size;
    if (!existsSync(dest) || statSync(dest).size !== size || statSync(dest).mtimeMs < statSync(src).mtimeMs) {
      copyFileSync(src, dest);
    }
    total += size;
  }
  console.log(`  ${(manifest.packs ?? []).length - missing.length} files, ${mb(total)}`);
  if (missing.length) console.warn(`  ⚠ not found in packs/consolidated: ${missing.join(', ')}`);
  done(t);
}

{
  const t = step('Building the APK');
  // By full path: this shell may not look in the current folder for commands.
  run(`"${join(ANDROID, 'gradlew.bat')}" assembleDebug`, ANDROID);
  console.log(`  ${APK}\n  ${mb(statSync(APK).size)}`);
  done(t);
}

if (INSTALL) {
  const list = execFileSync(ADB, ['devices'], { encoding: 'utf8' });
  const phone = list
    .split('\n')
    .map((line) => line.trim().split(/\s+/))
    .find(([serial, state]) => state === 'device' && !serial.startsWith('emulator-'))?.[0];
  if (!phone) fail('No phone found. Plug it in with USB debugging on and allow this PC.');

  if (FRESH) {
    const t = step('Removing the old app and its data');
    try {
      execFileSync(ADB, ['-s', phone, 'uninstall', APP_ID], { stdio: 'inherit' });
    } catch {
      console.log('  (it was not installed)');
    }
    done(t);
  }

  const t = step(`Installing on ${phone}`);
  execFileSync(ADB, ['-s', phone, 'install', '-r', APK], { stdio: 'inherit' });
  done(t);
}
