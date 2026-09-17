/**
 * SyncService - Main orchestrator for sync functionality
 * 
 * Responsibilities:
 * - Connect/disconnect Realtime on auth changes
 * - Process sync queue when online
 * - Pull initial data on sign-in
 * - Provide sync state to UI
 */

import { supabase } from '../supabase/client';
import { adoptUnownedRows } from './adoptOwnership';
import { clearPersonalData, pendingWork } from './clearPersonalData';
import { getDeviceOwner, isOwnerReadable } from './deviceOwner';
import { syncQueue } from './SyncQueueService';
import { realtimeService } from './RealtimeService';
import { pullSettings } from './settingsSync';
import { sharedNotebookStore } from '../../adapters/SharedNotebookStore';
import { pullAlarmIfUnset } from '../alarm/alarmSync';
import type { SyncState, SyncTable } from './types';

interface SyncStore {
  initialize(): Promise<void>;
  dispose(): void;
}

type StateListener = (state: SyncState) => void;

/** A sync gave up before finishing. Distinguished so the UI can say so plainly. */
class SyncTimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SyncTimeoutError';
  }
}

/**
 * Reject once `ms` has elapsed, whatever the wrapped promise is doing.
 *
 * Every network call underneath is a bare fetch or an IndexedDB request, and
 * either can hang without ever settling — a half-open socket on a device that
 * just woke, or an aborted IDB transaction. A promise that never settles never
 * runs its `finally`, which is what used to leave the mutex latched on and the
 * status parked at 'syncing' until a page reload.
 */
function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new SyncTimeoutError(`${label} timed out`)), ms);
    promise.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (err) => { clearTimeout(timer); reject(err); },
    );
  });
}

/** Ceiling for one whole sync pass (push + pull + settings). */
const SYNC_TIMEOUT_MS = 25_000;

class SyncService {
  private state: SyncState = {
    status: 'idle',
    pendingCount: 0,
    lastSyncedAt: null,
    error: null,
    isOnline: typeof navigator !== 'undefined' ? navigator.onLine : true,
    activity: null,
    lastUploadedCount: 0,
  };
  
  private listeners: Set<StateListener> = new Set();
  private initialized = false;
  private signingIn = false;    // mutex — prevents double-call from onAuthStateChange + getUser()
  private forceSyncing = false; // mutex — prevents overlapping forceSync / visibility calls
  private lastForceSyncAt = 0;  // epoch ms — used to throttle rapid re-triggers
  private lastSignInSyncAt = 0; // epoch ms — throttles repeated onSignIn pulls (token refreshes)
  private authUnsubscribe: (() => void) | null = null;
  private queueUnsubscribe: (() => void) | null = null;
  private syncStores: SyncStore[] = [];
  private applyFns: Map<SyncTable, (rows: any[]) => Promise<void>> = new Map();

  /**
   * Register a synced store. Called by adapter modules at import time.
   * SyncService will call initialize() on sign-in and dispose() on sign-out.
   */
  registerSyncStore(store: SyncStore): void {
    this.syncStores.push(store);
  }

  /**
   * Register a remote-pull function for a table. Called by adapter modules at import time.
   */
  registerApplyFn(table: SyncTable, fn: (rows: any[]) => Promise<void>): void {
    this.applyFns.set(table, fn);
  }
  
  /**
   * Initialize the sync service
   * Call once on app startup
   */
  async init(): Promise<void> {
    if (this.initialized) return;
    this.initialized = true;
    
    // Listen for online/offline
    if (typeof window !== 'undefined') {
      window.addEventListener('online', this.handleOnline);
      window.addEventListener('offline', this.handleOffline);
    }
    
    // Listen for queue changes
    this.queueUnsubscribe = syncQueue.subscribe((count) => {
      this.updateState({ pendingCount: count });
    });
    
    // Listen for auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        if (event === 'SIGNED_IN' && session?.user) {
          await this.onSignIn(session.user.id);
        } else if (event === 'SIGNED_OUT') {
          await this.onSignOut();
        }
      }
    );
    this.authUnsubscribe = () => subscription.unsubscribe();
    
    // Check if already signed in
    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
      await this.onSignIn(user.id);
    }
  }
  
  /**
   * Subscribe to sync state changes
   */
  subscribe(listener: StateListener): () => void {
    this.listeners.add(listener);
    listener(this.state);
    return () => this.listeners.delete(listener);
  }
  
  /**
   * Force a sync (manual refresh)
   */
  async forceSync(throttleMs = 0): Promise<void> {
    if (!navigator.onLine) {
      this.updateState({ status: 'offline', activity: null, error: null });
      return;
    }
    // Mutex: skip if already running
    if (this.forceSyncing) return;
    // Throttle: skip if called again within throttleMs of last completion
    if (throttleMs > 0 && Date.now() - this.lastForceSyncAt < throttleMs) return;

    this.forceSyncing = true;
    this.updateState({
      status: 'syncing',
      error: null,
      // Uploading only if something is actually queued; otherwise this pass is
      // purely a pull, and saying "uploading" would be a lie.
      activity: this.state.pendingCount > 0 ? 'uploading' : 'checking',
      lastUploadedCount: 0,
    });

    try {
      const pushResult = await withTimeout(this.runSyncPass(), SYNC_TIMEOUT_MS, 'Sync');

      this.lastForceSyncAt = Date.now();
      if (pushResult.failed > 0) {
        // Be honest: the sync ran, but some changes did NOT reach Supabase.
        this.updateState({
          status: 'error',
          activity: null,
          error: `${pushResult.failed} change${pushResult.failed === 1 ? '' : 's'} failed to upload`,
        });
      } else {
        this.updateState({
          status: 'idle',
          activity: null,
          lastSyncedAt: new Date(),
          lastUploadedCount: pushResult.success,
          error: null
        });
      }
    } catch (err: any) {
      if (err?.name === 'AbortError') {
        console.debug('[SyncService] forceSync aborted (transient), ignoring');
        this.updateState({ status: 'idle', activity: null, error: null });
      } else if (err?.name === 'SyncTimeoutError') {
        console.warn('[SyncService] forceSync timed out after', SYNC_TIMEOUT_MS, 'ms');
        this.updateState({
          status: 'error',
          activity: null,
          error: 'Sync timed out — tap to retry',
        });
      } else {
        this.updateState({ status: 'error', activity: null, error: err.message });
      }
    } finally {
      this.forceSyncing = false;
    }
  }

  /**
   * One push-then-pull pass. Split out of forceSync so the whole sequence can
   * sit behind a single timeout.
   */
  private async runSyncPass(): Promise<{ success: number; failed: number }> {
    // Re-check the realtime channel — forceSync runs on tab-visibility
    // resume and back-online, the moments a woken device needs to rejoin.
    await realtimeService.ensureConnected();

    // Revive any permanently-failed queue items so they get a fresh retry.
    // Items can get permanently failed after 5 rapid retries (e.g. from a
    // previous app bug). Without this, "Sync Now" finds 0 pending items and
    // shows "Synced" while nothing was actually sent.
    await syncQueue.resetFailed();

    // Process pending writes first
    const pushResult = await syncQueue.processQueue();

    // Then pull remote changes (settings ride along — LWW, not part of the
    // per-table applyFn pipeline)
    this.updateState({ activity: 'checking' });
    await this.pullRemoteData();
    await pullSettings();

    return pushResult;
  }
  
  /**
   * Get current sync state
   */
  getState(): SyncState {
    return { ...this.state };
  }
  
  /**
   * Cleanup on app unmount
   */
  destroy(): void {
    if (typeof window !== 'undefined') {
      window.removeEventListener('online', this.handleOnline);
      window.removeEventListener('offline', this.handleOffline);
    }
    this.authUnsubscribe?.();
    this.queueUnsubscribe?.();
    realtimeService.disconnect();
  }
  
  // ========== Private ==========
  
  /**
   * A different account has signed in on a device still holding the last
   * one's work. Empty it before anything is pulled.
   *
   * Phases 3 and 4 handle the orderly case: sign out, the device is emptied,
   * sign in, it fills back up. This is the case where the first half never
   * happened. A session that expired rather than ended, an app reinstalled
   * over an IndexedDB that survived it, a device restored from a backup —
   * in all of them account A's notes, journal, highlights and notebooks are
   * still in the thirteen stores when B arrives, and nothing so far would
   * take them out. B's pull lands on top of them and the two stay merged,
   * which is the symptom this whole roadmap started from.
   *
   * The check is phase 2's ownership rather than a guess: the device records
   * one account id, and a real previous owner that is not the one signing in
   * is the only condition that clears. A match is the ordinary case and does
   * nothing. No recorded owner is a device that has never signed anybody in,
   * where the rows are either genuinely nobody's — adoptUnownedRows is about
   * to claim them — or were already cleared by a sign-out.
   *
   * Unreadable storage does nothing here, which is the opposite of what the
   * queue does with it. Phase 1 drops a queue it cannot attribute because
   * uploading to the wrong account is permanent and dropping is not. Here the
   * asymmetry runs the other way: the rows on a device whose storage is
   * blocked are most likely the same person's, and wiping them on a wrong
   * guess destroys work that may never have reached the server. Refusing to
   * act leaves at worst the pre-phase-5 behaviour.
   *
   * Nothing asks before clearing. By the time this runs Supabase has already
   * changed who is signed in, so there is no longer anybody to put the
   * question to: the person at the screen is the incoming account, who does
   * not know what the outgoing one had unsent and cannot answer for it. What
   * reached the server comes back on that account's next sign-in; what did
   * not was already unsendable, because phase 1's check would have refused to
   * upload that queue under this account in any case. The count is logged.
   */
  private async switchAccounts(userId: string): Promise<boolean> {
    if (!isOwnerReadable()) return false;

    const previous = getDeviceOwner();
    if (previous === null || previous === userId) return false;

    console.warn(
      `[SyncService] A different account signed in — clearing ${previous.slice(0, 8)}...'s work before pulling ${userId.slice(0, 8)}...`,
    );

    // Said before the sweep, because the sweep is what empties them.
    const pending = await pendingWork().catch(() => null);
    if (pending && pending.total > 0) {
      console.warn(
        `[SyncService] ${pending.total} unsent change(s) from the previous account went with it (${pending.queued} queued, ${pending.outbox} in the shared outbox) — they could not have been uploaded under this account anyway`,
      );
    }

    await clearPersonalData('account-switch');

    // The timestamp belonged to the account that just left, and the device it
    // was describing no longer exists. `skipPull` ignores it on this pass
    // anyway, but if this pass then fails the next one would read it and skip
    // a pull on a device that has nothing in it. Sign-out clears it for the
    // same reason.
    this.lastSignInSyncAt = 0;

    // The stores are empty and the previous owner is forgotten. Ownership is
    // settled a moment later in onSignIn, which is what records the incoming
    // account; leaving it to that one call keeps a single place that writes it.
    return true;
  }

  private async onSignIn(userId: string): Promise<void> {
    if (this.signingIn) return;
    this.signingIn = true;
    console.log('[SyncService] User signed in:', userId.slice(0, 8) + '...');
    
    // Is this a different account than the one whose rows are on the device?
    // Asked before settleOwnership, which is what overwrites the answer.
    const switched = await this.switchAccounts(userId);

    // Supabase fires SIGNED_IN on every token refresh (triggered by tab visibility
    // changes). Throttle the expensive pull to at most once per 60 seconds.
    //
    // A switch is never throttled. The device has just been emptied, so
    // skipping the pull would leave the incoming account looking at an app
    // with nothing in it — the same trap phase 3 hit on sign-out, arrived at
    // from the other side.
    const skipPull = !switched && Date.now() - this.lastSignInSyncAt < 60_000;

    this.updateState({ status: 'syncing', activity: 'checking' });

    // Settle who this device is keeping rows for, before anything is written
    // or pulled. This compares the account signing in against the one the
    // device was last queueing for — dropping that queue on a mismatch — and
    // then records the new one, which is what stamps every row saved from
    // here on. Then the rows that were already here when ownership arrived
    // are claimed, once per device.
    //
    // Both sit outside the timeout and ahead of the throttle: neither touches
    // the network, and a sign-in that skips the pull still needs to know
    // whose rows it is writing.
    // Guarded: a sign-in is not worth failing over this. Left unsettled, the
    // first upload pass settles it instead, exactly as before phase 2.
    await syncQueue.settleOwnership(userId).catch((err) => {
      console.warn('[SyncService] Could not settle device ownership:', err);
    });
    await adoptUnownedRows(userId);

    try {
      await withTimeout((async () => {
        // Reset any permanently-failed queue items so they are retried with
        // the correct payload format after an app update.
        await syncQueue.resetFailed();

        // Connect to Realtime (idempotent — already connected calls are no-ops)
        await realtimeService.connect(userId);

        // Initialize store Realtime subscriptions (registers handlers on the live channel)
        for (const store of this.syncStores) {
          await store.initialize();
        }

        // Pull initial data — skip if we just did this within the last 60s
        if (!skipPull) {
          await this.pullRemoteData();
          await pullSettings();
          // Adopt the account's alarm only on a device that has never set one.
          await pullAlarmIfUnset();
        } else {
          console.debug('[SyncService] Skipping pull — synced recently');
        }
      })(), SYNC_TIMEOUT_MS, 'Sign-in sync');

      this.lastSignInSyncAt = Date.now();
      this.updateState({
        status: 'idle',
        activity: null,
        lastSyncedAt: new Date(),
        error: null
      });
    } catch (err: any) {
      // AbortError is thrown by Supabase when a token-refresh interrupts an in-flight
      // auth request (e.g. visibility change). It's transient — don't surface to the user.
      if (err?.name === 'AbortError') {
        console.debug('[SyncService] Sign-in pull aborted (transient), ignoring');
        this.updateState({ status: 'idle', activity: null, error: null });
      } else if (err?.name === 'SyncTimeoutError') {
        console.warn('[SyncService] Sign-in sync timed out');
        this.updateState({ status: 'error', activity: null, error: 'Sync timed out — tap to retry' });
      } else {
        console.error('[SyncService] Sign-in sync error:', err);
        this.updateState({ status: 'error', activity: null, error: err.message });
      }
    } finally {
      // Always flush pending writes — even if pulling failed
      if (navigator.onLine) {
        void syncQueue.processQueue();
      }

      // Bring the shared notebooks back down.
      //
      // They are not in the applyFn pipeline and must not be: the shared
      // tables have no user_id to filter on, the policies in migration 012
      // decide what comes back, and the reconciliation has to spare pages
      // whose writing is still in the outbox. So this is its own call.
      //
      // Until now nothing pulled them on sign-in — only opening the Shared
      // tab did, and the back-online listener. That was survivable while
      // sign-out left them in place; phase 3 clears all four stores, so
      // without this the Shared tab stays empty after a sign-in until
      // somebody happens to look at it.
      //
      // Not awaited, and outside the timeout above: the pull flushes the
      // outbox before it reads, so it can take a while, and a sign-in should
      // not wait on it or fail because of it. The store announces itself when
      // rows land, which is what the pane already listens to. Forced, because
      // `clear()` zeroes `lastPullAt` but a sign-in on a device that never
      // signed out would otherwise fall inside the ten-second window.
      if (navigator.onLine) {
        void sharedNotebookStore.pull({ force: true }).catch((err) => {
          console.warn('[SyncService] Shared notebook pull failed on sign-in:', err);
        });
      }

      this.signingIn = false;
    }
  }
  
  private async onSignOut(): Promise<void> {
    console.log('[SyncService] User signed out');
    
    // Disconnect from Realtime
    await realtimeService.disconnect();
    
    // Dispose store Realtime subscriptions (so they re-initialize on next sign-in)
    for (const store of this.syncStores) {
      store.dispose();
    }
    
    // A sign-out ends the run of sign-ins the throttle was counting.
    //
    // `lastSignInSyncAt` exists because Supabase fires SIGNED_IN on every
    // token refresh, and pulling everything each time a tab regains
    // visibility would be wasteful. Skipping a pull used to cost nothing: the
    // rows were still on the device either way. Since phase 3 they are not —
    // sign-out empties thirteen stores — so a sign-out followed by a sign-in
    // inside the window would skip the pull and leave somebody looking at an
    // app with no notes, no journal and no highlights. Forgetting the
    // timestamp here keeps the refresh throttle and drops the part of it that
    // had become a way to lose sight of your own work.
    this.lastSignInSyncAt = 0;

    // Take this account's work off the device: the personal stores, the
    // journal lock, the shared notebooks, and the queue along with them.
    //
    // The queue used to be kept here, on the reasoning that pending writes
    // are user-scoped and would be retried on the next sign-in. They are
    // user-scoped, but nothing recorded which user — which is the hole phase
    // 1 closed by refusing to upload a queue left by another account. Now
    // that the stores those writes refer to are emptied on the way out,
    // keeping the queue would only mean offering the server rows this device
    // no longer has, and phase 1 would refuse them anyway.
    //
    // Whoever calls sign-out has already tried to send this work and asked
    // about anything that would not go — see `pendingWork` in
    // clearPersonalData.ts. By the time it gets here the answer is in.
    await clearPersonalData();

    this.updateState({
      status: 'idle',
      pendingCount: 0,
      lastSyncedAt: null,
      error: null,
      activity: null,
      lastUploadedCount: 0
    });
  }

  /**
   * Coming back online. Every step is guarded and time-boxed: this handler
   * used to have no try/catch at all, so a single throw left the status stuck
   * on 'syncing' with nothing able to clear it.
   */
  private handleOnline = async (): Promise<void> => {
    console.log('[SyncService] Back online');
    this.updateState({ isOnline: true, status: 'idle', activity: null });

    try {
      const { data: { user } } = await withTimeout(
        supabase.auth.getUser(), SYNC_TIMEOUT_MS, 'Reconnect');
      if (!user) return;

      this.updateState({
        status: 'syncing',
        activity: this.state.pendingCount > 0 ? 'uploading' : 'checking',
        error: null,
      });
      const pushResult = await withTimeout(
        syncQueue.processQueue(), SYNC_TIMEOUT_MS, 'Reconnect upload');
      this.updateState({
        status: 'idle',
        activity: null,
        lastSyncedAt: new Date(),
        lastUploadedCount: pushResult.success,
      });
    } catch (err: any) {
      console.warn('[SyncService] Back-online sync failed:', err);
      this.updateState({
        status: 'error',
        activity: null,
        error: err?.name === 'SyncTimeoutError'
          ? 'Sync timed out — tap to retry'
          : (err?.message ?? 'Sync failed — tap to retry'),
      });
    }
  };

  private handleOffline = (): void => {
    console.log('[SyncService] Went offline');
    this.updateState({ isOnline: false, status: 'offline', activity: null });
  };
  
  private async pullRemoteData(): Promise<void> {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const pulls: Promise<void>[] = [];
    for (const [table, applyFn] of this.applyFns) {
      pulls.push(
        this.pullTable(table, user.id, applyFn).catch((err) => {
          console.error(`[SyncService] pullTable(${table}) threw unexpectedly:`, err);
        })
      );
    }
    await Promise.all(pulls);
  }
  
  private async pullTable(
    table: SyncTable, 
    userId: string,
    applyFn: (rows: any[]) => Promise<void>
  ): Promise<void> {
    const { data, error } = await supabase
      .from(table)
      .select('*')
      .eq('user_id', userId);
    
    if (error) {
      console.error(`[SyncService] Failed to pull ${table}:`, error);
      return;
    }
    
    console.log(`[SyncService] Pulled ${data?.length ?? 0} rows from ${table}`);

    // Every table applies, including an empty one.
    //
    // There used to be a gate here that skipped applyFn on zero rows, with
    // reading_progress and journal_lock named as exceptions. It was there
    // because these apply fns reconcile deletions — reconcileDeletedRows
    // removes any local row the snapshot does not contain — so an empty
    // result would delete everything local. While sign-out left the stores
    // in place that was a real danger and the gate was the right answer.
    //
    // Phase 3 changed the meaning of an empty answer. A device that has just
    // signed out holds no personal rows, so a signing-in account whose server
    // copy is genuinely empty should end with empty stores: that is the
    // correct outcome, not a loss. Meanwhile the gate had become the reason a
    // cleared device could not fully restore — a table reconciling to nothing
    // never ran at all, so nothing downstream of it ran either.
    //
    // Nothing is silently wiped on a populated device, for three reasons
    // worth keeping together:
    //
    //   A failed request returns `error` and bails above, so a network or
    //   policy failure can never arrive here disguised as an empty table.
    //
    //   reconcileDeletedRows spares every id with a pending queue op, so
    //   rows made or restored offline are not mistaken for remote deletions.
    //   That is what makes restoreBackup safe: it enqueues everything it
    //   writes, and runSyncPass pushes the queue up before it pulls.
    //
    //   A row already uploaded and then missing from the snapshot really was
    //   deleted elsewhere, which is the ghost this reconciliation exists to
    //   clear.
    if (data) {
      await applyFn(data);
    }
  }
  
  private updateState(partial: Partial<SyncState>): void {
    this.state = { ...this.state, ...partial };
    for (const listener of this.listeners) {
      listener(this.state);
    }
  }
}

export const syncService = new SyncService();
