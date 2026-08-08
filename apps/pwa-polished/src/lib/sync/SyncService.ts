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
import { syncQueue } from './SyncQueueService';
import { realtimeService } from './RealtimeService';
import { pullSettings } from './settingsSync';
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
  
  private async onSignIn(userId: string): Promise<void> {
    if (this.signingIn) return;
    this.signingIn = true;
    console.log('[SyncService] User signed in:', userId.slice(0, 8) + '...');
    
    // Supabase fires SIGNED_IN on every token refresh (triggered by tab visibility
    // changes). Throttle the expensive pull to at most once per 60 seconds.
    const skipPull = Date.now() - this.lastSignInSyncAt < 60_000;

    this.updateState({ status: 'syncing', activity: 'checking' });

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
    
    // Do NOT clear the sync queue — pending writes are user-scoped and will
    // be retried on the next sign-in. Clearing them here causes progress
    // to be silently lost when the user logs out before a write reaches Supabase.
    
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
    // The empty-rows gate protects tables whose apply fns reconcile deletions
    // (e.g. user_notes would wipe local data on an empty server). reading_progress
    // must run even with zero remote rows so its reconciliation can push local
    // progress up to a fresh/empty server.
    if (data && (data.length > 0 || table === 'reading_progress')) {
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
