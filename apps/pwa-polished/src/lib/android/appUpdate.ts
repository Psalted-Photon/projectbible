/**
 * New versions of the Android app.
 *
 * Only the APK downloaded from irisbible.com updates itself. It reads
 * irisbible.com/android/version.json (written by native/publish-android.mjs),
 * and when that names a newer version, AppUpdateCard offers it. Update
 * downloads the new APK with Android's own downloader (IrisUpdatePlugin.java),
 * which carries on with the app closed, then hands it to Android's installer.
 * Android only installs it over this app when it carries the same signing
 * key, so a tampered download can't replace it.
 *
 * The Play Store build never checks: Play updates it. A test build from the
 * PC never checks either; its key isn't the release key, so Android would
 * refuse the update anyway.
 *
 * Reached only behind IS_ANDROID_APP.
 */

import { writable, get } from 'svelte/store';
import { callNative } from './bridge';
import { SITE_ORIGIN } from '../platform';
import { showNotice } from '../../stores/noticeStore';

/** www on purpose; see SITE_ORIGIN. */
export const VERSION_URL = `${SITE_ORIGIN}/android/version.json`;

export interface AppInfo {
  versionCode: number;
  versionName: string;
  channel: 'sideload' | 'play';
  test: boolean;
}

/** irisbible.com/android/version.json */
export interface PublishedVersion {
  versionCode: number;
  versionName: string;
  published?: string;
  notes?: string;
  apk: { url: string; bytes: number; sha256?: string };
}

type FailReason = 'space' | 'network' | 'damaged' | 'missing' | 'file' | 'installer' | 'bad-link';

interface NativeStatus {
  state: 'none' | 'running' | 'paused' | 'ready' | 'failed';
  reason?: string;
  versionCode?: number;
  versionName?: string;
  downloaded?: number;
  total?: number;
  installAllowed: boolean;
}

/** What AppUpdateCard shows. */
export type UpdatePhase =
  | { kind: 'idle' }
  | { kind: 'offer'; next: PublishedVersion }
  | { kind: 'metered'; next: PublishedVersion }
  | { kind: 'downloading'; name: string; downloaded: number; total: number; waiting: 'wifi' | 'network' | null }
  | { kind: 'ready'; name: string }
  | { kind: 'permission'; name: string }
  | { kind: 'failed'; reason: FailReason; needed?: number; next?: PublishedVersion };

export const appUpdate = writable<UpdatePhase>({ kind: 'idle' });
/** The card was closed for now (a download carries on without it). */
export const appUpdateHidden = writable(false);

const SNOOZE_KEY = 'iris-app-update-snooze';
const SEEN_KEY = 'iris-app-version-seen';
const SNOOZE_MS = 24 * 60 * 60 * 1000;
/** How often a running app looks again when brought back to the front. */
const RECHECK_MS = 12 * 60 * 60 * 1000;

let infoPromise: Promise<AppInfo | null> | null = null;
let lastCheck = 0;
let lastPublished: PublishedVersion | null = null;
let pollTimer: ReturnType<typeof setTimeout> | null = null;

/** This app's version and build. Null outside the app or if it can't say. */
export function appInfo(): Promise<AppInfo | null> {
  infoPromise ??= callNative<AppInfo>('IrisApp', 'info').catch(() => null);
  return infoPromise;
}

/** Whether this build updates itself from irisbible.com. */
function selfUpdating(info: AppInfo | null): info is AppInfo {
  return !!info && info.channel === 'sideload' && !info.test;
}

function nativeStatus(): Promise<NativeStatus> {
  return callNative<NativeStatus>('IrisUpdate', 'status');
}

/** version.json, or null when none is published yet. Throws when offline. */
async function fetchPublished(): Promise<PublishedVersion | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);
  try {
    const response = await fetch(VERSION_URL, { cache: 'no-store', signal: controller.signal });
    if (response.status === 404) return null;
    if (!response.ok) throw new Error(`version.json: ${response.status}`);
    const data = (await response.json()) as PublishedVersion;
    if (!Number.isFinite(data?.versionCode) || !data?.apk?.url?.startsWith('https://')) return null;
    return data;
  } finally {
    clearTimeout(timer);
  }
}

function snoozed(code: number): boolean {
  try {
    const saved = JSON.parse(localStorage.getItem(SNOOZE_KEY) ?? 'null');
    return saved?.code === code && Date.now() < saved.until;
  } catch {
    return false;
  }
}

/** The download as the card shows it, from what Android's downloader says. */
function phaseFromStatus(status: NativeStatus): UpdatePhase | null {
  const name = status.versionName ?? '';
  switch (status.state) {
    case 'running':
    case 'paused':
      return {
        kind: 'downloading',
        name,
        downloaded: status.downloaded ?? 0,
        total: status.total ?? 0,
        waiting: status.state === 'paused' && (status.reason === 'wifi' || status.reason === 'network') ? status.reason : null,
      };
    case 'ready':
      return { kind: 'ready', name };
    case 'failed':
      return { kind: 'failed', reason: (status.reason as FailReason) ?? 'network', next: lastPublished ?? undefined };
    default:
      return null;
  }
}

export type CheckResult = 'test' | 'play' | 'up-to-date' | 'offline' | 'found';

/**
 * Looks for a newer version. On launch and on coming back to the front it is
 * quiet and respects Not now; from Settings (manual) it always shows what it
 * finds and the caller says the rest.
 */
export async function checkForAppUpdate(manual = false): Promise<CheckResult> {
  const info = await appInfo();
  if (!info || info.test) return 'test';
  if (info.channel === 'play') return 'play';
  lastCheck = Date.now();

  // A download already under way, finished or failed.
  let status: NativeStatus | null = null;
  try {
    status = await nativeStatus();
  } catch {
    status = null;
  }

  let published: PublishedVersion | null;
  try {
    published = await fetchPublished();
  } catch {
    // Offline: still show a download that was already going.
    const going = status ? phaseFromStatus(status) : null;
    if (going) {
      appUpdate.set(going);
      if (going.kind === 'downloading') poll();
      return 'found';
    }
    return 'offline';
  }
  lastPublished = published;

  if (!published || published.versionCode <= info.versionCode) {
    appUpdate.set({ kind: 'idle' });
    return 'up-to-date';
  }

  // The download is for an older version than the newest one: start over.
  if (status && status.state !== 'none' && (status.versionCode ?? 0) < published.versionCode) {
    await callNative('IrisUpdate', 'cancel').catch(() => {});
    status = null;
  }

  const going = status ? phaseFromStatus(status) : null;
  if (going) {
    appUpdate.set(going);
    if (going.kind === 'downloading') poll();
    if (manual) appUpdateHidden.set(false);
    return 'found';
  }

  if (!manual && snoozed(published.versionCode)) return 'found';
  appUpdate.set({ kind: 'offer', next: published });
  if (manual) appUpdateHidden.set(false);
  return 'found';
}

/** Update tapped: ask first on mobile data, since the APK is over a gigabyte. */
export async function startAppUpdate(next: PublishedVersion): Promise<void> {
  try {
    const network = await callNative<{ online: boolean; metered: boolean }>('IrisUpdate', 'network');
    if (!network.online) {
      appUpdate.set({ kind: 'failed', reason: 'network', next });
      return;
    }
    if (network.metered) {
      appUpdate.set({ kind: 'metered', next });
      return;
    }
  } catch {
    // Can't tell; go ahead.
  }
  await downloadAppUpdate(next, true);
}

/** Starts the download. allowMetered false waits for Wi-Fi. */
export async function downloadAppUpdate(next: PublishedVersion, allowMetered: boolean): Promise<void> {
  try {
    await callNative('IrisUpdate', 'start', {
      url: next.apk.url,
      versionCode: next.versionCode,
      versionName: next.versionName,
      bytes: next.apk.bytes,
      allowMetered,
    });
  } catch (error) {
    const code = (error as { code?: string })?.code;
    const needed = Number((error as { data?: { needed?: number } })?.data?.needed) || undefined;
    appUpdate.set({ kind: 'failed', reason: (code as FailReason) ?? 'file', needed, next });
    return;
  }
  appUpdate.set({
    kind: 'downloading',
    name: next.versionName,
    downloaded: 0,
    total: next.apk.bytes,
    waiting: allowMetered ? null : 'wifi',
  });
  poll();
}

/** Reads the download's progress once a second while the app is on screen. */
function poll(): void {
  if (pollTimer) clearTimeout(pollTimer);
  pollTimer = setTimeout(async () => {
    pollTimer = null;
    if (document.hidden || get(appUpdate).kind !== 'downloading') return;
    try {
      const phase = phaseFromStatus(await nativeStatus());
      appUpdate.set(phase ?? { kind: 'idle' });
      if (phase?.kind === 'downloading') poll();
      // Finished while the card was closed: bring it back for Install.
      if (phase?.kind === 'ready') appUpdateHidden.set(false);
    } catch {
      poll();
    }
  }, 1000);
}

/** Install tapped: Android's installer, or first its permission screen. */
export async function installAppUpdate(): Promise<void> {
  const phase = get(appUpdate);
  const name = phase.kind === 'ready' || phase.kind === 'permission' ? phase.name : '';
  try {
    const result = await callNative<{ needsPermission?: boolean }>('IrisUpdate', 'install');
    if (result.needsPermission) {
      appUpdate.set({ kind: 'permission', name });
      await callNative('IrisUpdate', 'allowInstalls');
    }
  } catch (error) {
    const code = (error as { code?: string })?.code;
    // The file went missing; look again from the start.
    if (code === 'not-ready') {
      void checkForAppUpdate(true);
      return;
    }
    appUpdate.set({ kind: 'failed', reason: 'installer', next: lastPublished ?? undefined });
  }
}

/** Not now: ask again in a day. */
export function snoozeAppUpdate(code: number): void {
  try {
    localStorage.setItem(SNOOZE_KEY, JSON.stringify({ code, until: Date.now() + SNOOZE_MS }));
  } catch {
    // Private storage off: it simply asks again next launch.
  }
  appUpdate.set({ kind: 'idle' });
}

/** Stops a download, or clears a failed one. */
export async function cancelAppUpdate(): Promise<void> {
  await callNative('IrisUpdate', 'cancel').catch(() => {});
  appUpdate.set({ kind: 'idle' });
}

/** Back to the front: catch up on a download, a permission, or a new version. */
async function onVisible(): Promise<void> {
  const info = await appInfo();
  if (!selfUpdating(info)) return;
  const phase = get(appUpdate);
  if (phase.kind === 'permission') {
    // Back from the "Install unknown apps" switch.
    const status = await nativeStatus().catch(() => null);
    if (status?.installAllowed && status.state === 'ready') void installAppUpdate();
    else if (status) appUpdate.set(phaseFromStatus(status) ?? { kind: 'idle' });
    return;
  }
  if (phase.kind === 'downloading' || phase.kind === 'ready') {
    const status = await nativeStatus().catch(() => null);
    if (status) {
      const next = phaseFromStatus(status);
      appUpdate.set(next ?? { kind: 'idle' });
      if (next?.kind === 'downloading') poll();
    }
    return;
  }
  if (Date.now() - lastCheck > RECHECK_MS) void checkForAppUpdate();
}

/**
 * Called once at launch (App.svelte). Says "Updated to …" after an update,
 * then checks for a newer version a little after the app has settled.
 */
export function startAppUpdates(): void {
  void (async () => {
    const info = await appInfo();
    if (!info) return;
    try {
      const seen = Number(localStorage.getItem(SEEN_KEY) ?? 0);
      if (seen && info.versionCode > seen && !info.test) showNotice(`irisBible is updated to ${info.versionName}.`);
      localStorage.setItem(SEEN_KEY, String(info.versionCode));
    } catch {
      // No storage: no message.
    }
    if (!selfUpdating(info)) return;
    setTimeout(() => void checkForAppUpdate(), 8000);
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) void onVisible();
    });
  })();
}

/** "1.1 GB", "640 MB". */
export function sizeText(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  return `${Math.max(1, Math.round(bytes / 1024 ** 2))} MB`;
}
