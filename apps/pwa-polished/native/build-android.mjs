#!/usr/bin/env node
// Builds the Android app and, with --install, puts it on the phone over USB.
//
//   node apps/pwa-polished/native/build-android.mjs [--release] [--install] [--fresh] [--skip-web]
//
//   --release   the real thing, signed with the permanent key: the APK people
//               download from irisbible.com and the bundle for the Play
//               Store, both in native/release/. Without it, a test build
//               (debug key, the web view open to the PC's DevTools).
//   --install   install on the first phone adb sees (emulators are skipped)
//   --fresh     uninstall first, so the app starts with no saved data at all.
//               Needed once when a phone switches between test and release
//               builds: Android won't install one key's app over another's.
//   --skip-web  reuse the web app already copied into the Android project
//
// Steps: the app is built in its Android mode (core, then `npm run
// build:android`, NODE_ENV=production; see src/lib/platform.ts for what that
// changes), Capacitor copies dist/ into the Android project, every pack and
// voice is gathered beside it (gather-included.mjs), and Gradle builds it.
// dist/ is removed afterwards; the Android project keeps its own copy.
//
// Inside the app the page runs at https://localhost, and Capacitor answers
// https://localhost/... from the APK's assets/public folder. The packs and
// voices are served from https://localhost/included/, so the app installs
// them with no internet.
//
// Two builds of one app (app/build.gradle): "sideload", the APK from
// irisbible.com, which updates itself, and "play", for the Play Store. Test
// builds are always the sideload one. publish-android.mjs puts a release APK
// on GitHub and tells the app and the download page about it.

import { execFileSync, execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gatherIncluded } from './gather-included.mjs';

const args = new Set(process.argv.slice(2));
const RELEASE = args.has('--release');
const INSTALL = args.has('--install') || args.has('--fresh');
const FRESH = args.has('--fresh');
const SKIP_WEB = args.has('--skip-web');

const NATIVE = dirname(fileURLToPath(import.meta.url));
const APP = join(NATIVE, '..');
const REPO = join(APP, '..', '..');
const ANDROID = join(NATIVE, 'android');
const PUBLIC_ASSETS = join(ANDROID, 'app', 'src', 'main', 'assets', 'public');
const OUTPUTS = join(ANDROID, 'app', 'build', 'outputs');
const TEST_APK = join(OUTPUTS, 'apk', 'sideload', 'debug', 'app-sideload-debug.apk');
const RELEASE_APK = join(OUTPUTS, 'apk', 'sideload', 'release', 'app-sideload-release.apk');
const RELEASE_AAB = join(OUTPUTS, 'bundle', 'playRelease', 'app-play-release.aab');
/** Where release builds are kept, with release.json for publish-android.mjs. Not in git. */
const RELEASE_DIR = join(NATIVE, 'release');
/** What the last published version was (written by publish-android.mjs). */
const PUBLISHED = join(APP, 'public', 'android', 'version.json');
const APP_ID = 'com.irisbible.app';

// The permanent signing key (see app/build.gradle). Same folder Gradle reads.
const SIGNING_DIR = process.env.IRIS_SIGNING_DIR || join(process.env.USERPROFILE ?? '', 'irisbible-signing');

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

/**
 * The version this build carries. The code is minutes since the start of
 * 2026 (app/build.gradle works it out the same way when run without this
 * script), so each build is newer than the one before. The name is the day:
 * 2026.11.20, then 2026.11.20.2 for a second release that day. Test builds
 * end in -test.
 */
function appVersion() {
  const now = new Date();
  const code = Math.floor((now.getTime() - Date.UTC(2026, 0, 1)) / 60000);
  const day = `${now.getFullYear()}.${now.getMonth() + 1}.${now.getDate()}`;
  if (!RELEASE) return { code, name: `${day}-test` };
  let name = day;
  try {
    const last = String(JSON.parse(readFileSync(PUBLISHED, 'utf8')).versionName ?? '');
    if (last === day) name = `${day}.2`;
    else if (last.startsWith(`${day}.`)) name = `${day}.${Number(last.slice(day.length + 1)) + 1}`;
  } catch {
    // Nothing published yet.
  }
  return { code, name };
}

function sha256(file) {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    createReadStream(file)
      .on('data', (chunk) => hash.update(chunk))
      .on('end', () => resolve(hash.digest('hex')))
      .on('error', reject);
  });
}

/** The newest apksigner in the SDK's build tools. */
function apksigner() {
  const tools = join(SDK, 'build-tools');
  const versions = existsSync(tools)
    ? readdirSync(tools)
        .filter((v) => existsSync(join(tools, v, 'apksigner.bat')))
        .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))
    : [];
  return versions.length ? join(tools, versions[0], 'apksigner.bat') : null;
}

/**
 * Checks the release APK is signed with the permanent key, not the debug one:
 * the certificate in the APK must match the fingerprint saved beside the key.
 */
function checkSignedWithReleaseKey(apk) {
  const tool = apksigner();
  if (!tool) fail('Could not find apksigner in the Android SDK build tools.');
  const printed = execFileSync(tool, ['verify', '--print-certs', apk], { encoding: 'utf8', env, shell: true });
  const inApk = printed.match(/certificate SHA-256 digest:\s*([0-9a-f]+)/i)?.[1]?.toLowerCase();
  const saved = readFileSync(join(SIGNING_DIR, 'fingerprint.txt'), 'utf8')
    .match(/SHA-256:\s*([0-9A-F:]+)/i)?.[1]
    ?.replaceAll(':', '')
    .toLowerCase();
  if (!inApk || !saved || inApk !== saved) {
    fail(`The APK is not signed with the irisBible release key.\n  in the APK: ${inApk ?? '?'}\n  the key:    ${saved ?? '?'}`);
  }
  console.log('  signed with the irisBible release key');
}

if (RELEASE && !existsSync(join(SIGNING_DIR, 'keystore.properties'))) {
  fail(
    `No signing key at ${SIGNING_DIR}.\n  Release builds need the permanent key (keystore + keystore.properties).\n  Copy it back from your backup, or set IRIS_SIGNING_DIR to where it is.`,
  );
}

const version = appVersion();
console.log(`irisBible ${version.name} (${version.code})${RELEASE ? ', release' : ', test build'}`);

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
  const t = step('Gathering the packs and voices that come inside the app');
  try {
    await gatherIncluded();
  } catch (error) {
    fail(error?.message ?? String(error));
  }
  done(t);
}

const versionArgs = `-PirisVersionCode=${version.code} -PirisVersionName=${version.name}`;
// By full path: this shell may not look in the current folder for commands.
const gradlew = `"${join(ANDROID, 'gradlew.bat')}"`;
let apkToInstall = TEST_APK;

if (!RELEASE) {
  const t = step('Building the test APK');
  run(`${gradlew} assembleSideloadDebug ${versionArgs}`, ANDROID);
  console.log(`  ${TEST_APK}\n  ${mb(statSync(TEST_APK).size)}`);
  done(t);
} else {
  let t = step('Building the release APK and the Play Store bundle');
  rmSync(RELEASE_APK, { force: true });
  rmSync(RELEASE_AAB, { force: true });
  run(`${gradlew} assembleSideloadRelease bundlePlayRelease ${versionArgs}`, ANDROID);
  checkSignedWithReleaseKey(RELEASE_APK);
  done(t);

  t = step('Keeping them in native/release');
  // Only the newest release is kept: each is over a gigabyte, twice.
  mkdirSync(RELEASE_DIR, { recursive: true });
  for (const old of readdirSync(RELEASE_DIR)) rmSync(join(RELEASE_DIR, old), { force: true });
  const apkName = `irisBible-${version.name}.apk`;
  const aabName = `irisBible-${version.name}-play.aab`;
  // Moved, not copied: Gradle makes them again next time.
  renameSync(RELEASE_APK, join(RELEASE_DIR, apkName));
  renameSync(RELEASE_AAB, join(RELEASE_DIR, aabName));
  const apkPath = join(RELEASE_DIR, apkName);
  const aabPath = join(RELEASE_DIR, aabName);
  const release = {
    versionCode: version.code,
    versionName: version.name,
    built: new Date().toISOString(),
    apk: { file: apkName, bytes: statSync(apkPath).size, sha256: await sha256(apkPath) },
    aab: { file: aabName, bytes: statSync(aabPath).size },
  };
  writeFileSync(join(RELEASE_DIR, 'release.json'), `${JSON.stringify(release, null, 2)}\n`);
  console.log(`  ${apkPath}\n  ${mb(release.apk.bytes)}`);
  console.log(`  ${aabPath}\n  ${mb(release.aab.bytes)}`);
  console.log('  To put the APK on irisbible.com: node apps/pwa-polished/native/publish-android.mjs');
  apkToInstall = apkPath;
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
  try {
    execFileSync(ADB, ['-s', phone, 'install', '-r', apkToInstall], { stdio: 'inherit' });
  } catch {
    fail(
      'The install was refused. If the phone has the other kind of build (test or release), run again with --fresh; that removes the app and its data first.',
    );
  }
  done(t);
}
