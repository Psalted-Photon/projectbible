/**
 * The page's side of the search worker (searchWorker.ts), the way
 * voice/voiceControl.ts is the page's side of Voice Control's.
 *
 * The worker starts a little after launch, once the app has settled, and
 * builds the word lists in the background; a search before that starts it.
 * When a pack comes in or goes, it brings the lists up to date.
 *
 * Anything going wrong here hands back null, and the search reads every verse
 * the old way instead. A worker that stopped isn't started again that session.
 */

import type { TranslationHits, VerseQuery } from './searchWorker';

let worker: Worker | null = null;
let broken = false;
let started = false;
let nextId = 1;
const pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }>();

function getWorker(): Worker | null {
  if (worker) return worker;
  if (broken || typeof Worker === 'undefined') return null;
  try {
    worker = new Worker(new URL('./searchWorker.ts', import.meta.url), { type: 'module' });
  } catch {
    broken = true;
    return null;
  }
  worker.onmessage = (event) => {
    const { id, ok, result, error } = event.data ?? {};
    const entry = pending.get(id);
    if (!entry) return;
    pending.delete(id);
    if (ok) entry.resolve(result);
    else entry.reject(new Error(error || 'Search failed'));
  };
  worker.onerror = (event) => {
    console.error('[Search] worker stopped:', event.message);
    for (const [id, entry] of pending) {
      entry.reject(new Error(`Search stopped: ${event.message}`));
      pending.delete(id);
    }
    worker?.terminate();
    worker = null;
    broken = true;
  };
  return worker;
}

function call<T>(action: string, payload?: unknown): Promise<T> {
  const w = getWorker();
  if (!w) return Promise.reject(new Error('No search worker'));
  const id = nextId++;
  return new Promise<T>((resolve, reject) => {
    pending.set(id, { resolve, reject });
    w.postMessage({ id, action, payload });
  });
}

/** Start building the word lists, once a session. */
export function warmSearchIndex(): void {
  if (started || broken) return;
  started = true;
  call('sync').catch(() => {});
}

/**
 * The verses each translation finds for the bar's words, from the word lists.
 * Null when the worker can't answer, so the caller reads every verse instead.
 */
export async function indexedVerseSearch(q: VerseQuery): Promise<TranslationHits[] | null> {
  warmSearchIndex();
  try {
    return await call<TranslationHits[]>('verses', q);
  } catch (error) {
    console.warn('[Search] word list search failed, reading every verse instead:', error);
    return null;
  }
}

if (typeof window !== 'undefined') {
  // A pack in or out: the lists catch up once the installs settle.
  let resyncTimer: ReturnType<typeof setTimeout> | null = null;
  window.addEventListener('packsUpdated', () => {
    if (!started || broken) return;
    if (resyncTimer) clearTimeout(resyncTimer);
    resyncTimer = setTimeout(() => {
      resyncTimer = null;
      call('sync').catch(() => {});
    }, 3000);
  });

  // In the background once the reader has opened, so the first search
  // doesn't wait on the build.
  setTimeout(() => {
    const idle = (window as any).requestIdleCallback as ((cb: () => void, o?: { timeout: number }) => void) | undefined;
    if (idle) idle(warmSearchIndex, { timeout: 10000 });
    else warmSearchIndex();
  }, 5000);
}
