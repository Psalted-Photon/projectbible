/**
 * Pack-install breadcrumbs that survive a browser crash.
 *
 * When Chrome kills a renderer for memory ("Aw, Snap!") it drops whatever was
 * still sitting in the console buffer, so the last few lines before a crash --
 * the ones that say where it died -- are exactly the ones you never see. Each
 * entry here is written synchronously to localStorage as well as the console,
 * so it is still on the device after the tab dies. Reopen the app and the
 * previous run replays into the console.
 *
 * Deliberately dependency-free and defensive: this runs while memory is already
 * under pressure, on a device we cannot attach a debugger to.
 */

const KEY = 'pb:install-log';
const MAX_ENTRIES = 200;

/** One breadcrumb. Kept short -- it is re-serialised on every write. */
interface LogEntry {
  /** ms since the run started */
  t: number;
  stage: string;
  /** JS heap in MB, when the browser exposes it */
  heap?: number;
  detail?: Record<string, unknown>;
}

let entries: LogEntry[] = [];
let runStart = 0;

/** Chrome-only, and absent on other engines -- hence the loose typing. */
function heapMB(): number | undefined {
  const mem = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory;
  if (!mem) return undefined;
  return Math.round((mem.usedJSHeapSize / 1048576) * 10) / 10;
}

function heapLimitMB(): number | undefined {
  const mem = (performance as unknown as { memory?: { jsHeapSizeLimit: number } }).memory;
  if (!mem) return undefined;
  return Math.round(mem.jsHeapSizeLimit / 1048576);
}

/** Persist immediately -- a buffered write would be lost in the crash we are chasing. */
function persist(): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(entries));
  } catch {
    // Quota or a private-mode restriction. The console copy still stands, and
    // losing breadcrumbs must never be what breaks an install.
  }
}

/**
 * Start a new run, replacing whatever the previous one left behind.
 *
 * Call `dumpPreviousInstallLog()` before this if the old run still matters.
 */
export function startInstallLog(packId: string, extra?: Record<string, unknown>): void {
  runStart = Date.now();
  entries = [];
  logInstall('run-start', { packId, heapLimitMB: heapLimitMB(), ...extra });
  void recordDeviceFacts();
}

/** One-off device context, useful for comparing a phone that works against one that does not. */
async function recordDeviceFacts(): Promise<void> {
  const facts: Record<string, unknown> = {
    deviceMemoryGB: (navigator as unknown as { deviceMemory?: number }).deviceMemory,
    cores: navigator.hardwareConcurrency,
    ua: navigator.userAgent,
  };
  try {
    if (navigator.storage?.estimate) {
      const { quota, usage } = await navigator.storage.estimate();
      facts.quotaMB = quota ? Math.round(quota / 1048576) : undefined;
      facts.usageMB = usage ? Math.round(usage / 1048576) : undefined;
    }
  } catch {
    // Reporting storage is optional; never let it interrupt an install.
  }
  logInstall('device', facts);
}

/** Record a stage boundary. Safe to call before startInstallLog. */
export function logInstall(stage: string, detail?: Record<string, unknown>): void {
  const entry: LogEntry = {
    t: runStart ? Date.now() - runStart : 0,
    stage,
    heap: heapMB(),
  };
  if (detail && Object.keys(detail).length) entry.detail = detail;

  entries.push(entry);
  // Keep the tail: the end of a run is where the failure is.
  if (entries.length > MAX_ENTRIES) entries = entries.slice(-MAX_ENTRIES);

  persist();
  console.log(
    `[install +${entry.t}ms${entry.heap !== undefined ? ` heap=${entry.heap}MB` : ''}] ${stage}`,
    detail ?? ''
  );
}

/** Record a thrown error with the fields that actually identify it. */
export function logInstallError(stage: string, error: unknown): void {
  const e = error as { name?: string; message?: string; stack?: string };
  logInstall(stage, {
    name: e?.name ?? typeof error,
    message: e?.message ?? String(error),
    stack: e?.stack?.split('\n').slice(0, 4).join(' | '),
  });
}

/**
 * Replay the previous run into the console, if one was left behind.
 *
 * Called once at startup. A log survives only until the next install starts, so
 * the sequence after a crash is: reopen the app, read this.
 */
export function dumpPreviousInstallLog(): void {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(KEY);
  } catch {
    return;
  }
  if (!raw) return;

  try {
    const previous = JSON.parse(raw) as LogEntry[];
    if (!Array.isArray(previous) || previous.length === 0) return;

    const last = previous[previous.length - 1];
    console.log(
      `%c[install-log] previous pack install — ${previous.length} entries, ended at "${last.stage}" (+${last.t}ms)`,
      'font-weight:bold'
    );
    console.log(
      '[install-log] if the app crashed, the last line below is where it died:'
    );
    for (const entry of previous) {
      console.log(
        `  +${entry.t}ms${entry.heap !== undefined ? ` heap=${entry.heap}MB` : ''} — ${entry.stage}`,
        entry.detail ?? ''
      );
    }
  } catch {
    console.log('[install-log] previous log was unreadable:', raw.slice(0, 200));
  }
}
